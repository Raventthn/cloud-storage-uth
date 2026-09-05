import os
import shutil
from datetime import datetime
from bson import ObjectId
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse as FastAPIFileResponse
from fastapi.middleware.cors import CORSMiddleware
from app.database import users_collection, files_collection, logs_collection
from app.models import UserRegister, UserLogin, ShareFileRequest
from app.auth import hash_password, verify_password, create_access_token, get_current_user

app = FastAPI(title="Cloud Storage Service API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = os.getenv("STORAGE_PATH", "./storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

async def write_log(user_id: str, action: str, file_id: str = None, detail: str = ""):
    log_doc = {
        "user_id": user_id,
        "action": action,
        "file_id": file_id,
        "detail": detail,
        "timestamp": datetime.utcnow()
    }
    await logs_collection.insert_one(log_doc)

@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED, tags=["Auth"])
async def register(user: UserRegister):
    existing_user = await users_collection.find_one({"username": user.username})
    if existing_user:
        raise HTTPException(status_code=400, detail="Tên người dùng đã tồn tại")
    
    doc = {
        "username": user.username,
        "password_hash": hash_password(user.password),
        "role": user.role,
        "created_at": datetime.utcnow()
    }
    result = await users_collection.insert_one(doc)
    await write_log(str(result.inserted_id), "REGISTER", detail=f"User {user.username} registered")
    return {"message": "Đăng ký tài khoản thành công", "user_id": str(result.inserted_id)}

@app.post("/api/auth/login", tags=["Auth"])
async def login(credentials: UserLogin):
    user = await users_collection.find_one({"username": credentials.username})
    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Sai tài khoản hoặc mật khẩu")
    
    token = create_access_token(data={"sub": str(user["_id"]), "role": user.get("role", "user")})
    await write_log(str(user["_id"]), "LOGIN", detail="User logged in successfully")
    return {"access_token": token, "token_type": "bearer", "role": user.get("role", "user")}

@app.post("/api/files/upload", tags=["Files"])
async def upload_file(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    file_id = str(ObjectId())
    storage_filename = f"{file_id}_{file.filename}"
    file_path = os.path.join(STORAGE_DIR, storage_filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    file_size = os.path.getsize(file_path)
    
    metadata = {
        "_id": ObjectId(file_id),
        "filename": file.filename,
        "storage_path": file_path,
        "size": file_size,
        "owner_id": current_user["_id"],
        "shared_with": [],
        "created_at": datetime.utcnow()
    }
    await files_collection.insert_one(metadata)
    await write_log(current_user["_id"], "UPLOAD", file_id=file_id, detail=f"Uploaded {file.filename}")
    return {"message": "Tải tệp lên thành công", "file_id": file_id, "filename": file.filename}

@app.get("/api/files", tags=["Files"])
async def list_files(current_user: dict = Depends(get_current_user)):
    cursor = files_collection.find({
        "$or": [
            {"owner_id": current_user["_id"]},
            {"shared_with": current_user["username"]}
        ]
    })
    files = []
    async for doc in cursor:
        files.append({
            "id": str(doc["_id"]),
            "filename": doc["filename"],
            "size": doc["size"],
            "owner_id": doc["owner_id"],
            "shared_with": doc.get("shared_with", []),
            "created_at": doc["created_at"]
        })
    return files

@app.get("/api/files/download/{file_id}", tags=["Files"])
async def download_file(file_id: str, current_user: dict = Depends(get_current_user)):
    file_doc = await files_collection.find_one({"_id": ObjectId(file_id)})
    if not file_doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp tin")
    
    if file_doc["owner_id"] != current_user["_id"] and current_user["username"] not in file_doc.get("shared_with", []):
        raise HTTPException(status_code=403, detail="Không có quyền truy cập tệp tin này")
    
    await write_log(current_user["_id"], "DOWNLOAD", file_id=file_id, detail=f"Downloaded {file_doc['filename']}")
    return FastAPIFileResponse(path=file_doc["storage_path"], filename=file_doc["filename"], media_type="application/octet-stream")

@app.delete("/api/files/{file_id}", tags=["Files"])
async def delete_file(file_id: str, current_user: dict = Depends(get_current_user)):
    file_doc = await files_collection.find_one({"_id": ObjectId(file_id)})
    if not file_doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp tin")
    
    if file_doc["owner_id"] != current_user["_id"] and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Chỉ chủ sở hữu hoặc admin mới được xóa")
    
    if os.path.exists(file_doc["storage_path"]):
        os.remove(file_doc["storage_path"])
        
    await files_collection.delete_one({"_id": ObjectId(file_id)})
    await write_log(current_user["_id"], "DELETE", file_id=file_id, detail=f"Deleted {file_doc['filename']}")
    return {"message": "Đã xóa tệp tin thành công"}

@app.post("/api/files/{file_id}/share", tags=["Permissions"])
async def share_file(file_id: str, payload: ShareFileRequest, current_user: dict = Depends(get_current_user)):
    file_doc = await files_collection.find_one({"_id": ObjectId(file_id)})
    if not file_doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp tin")
    
    if file_doc["owner_id"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Chỉ chủ sở hữu mới có quyền chia sẻ")
    
    target_user = await users_collection.find_one({"username": payload.target_username})
    if not target_user:
        raise HTTPException(status_code=404, detail="Người dùng đích không tồn tại")
        
    await files_collection.update_one(
        {"_id": ObjectId(file_id)},
        {"$addToSet": {"shared_with": payload.target_username}}
    )
    await write_log(current_user["_id"], "SHARE", file_id=file_id, detail=f"Shared with {payload.target_username}")
    return {"message": f"Đã chia sẻ tệp với {payload.target_username}"}

@app.get("/api/logs", tags=["Logs"])
async def get_activity_logs(current_user: dict = Depends(get_current_user)):
    query = {} if current_user.get("role") == "admin" else {"user_id": current_user["_id"]}
    cursor = logs_collection.find(query).sort("timestamp", -1).limit(50)
    
    logs = []
    async for doc in cursor:
        logs.append({
            "id": str(doc["_id"]),
            "user_id": doc["user_id"],
            "action": doc["action"],
            "file_id": doc.get("file_id"),
            "timestamp": doc["timestamp"]
        })
    return logs