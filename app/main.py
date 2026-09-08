import asyncio
import os
from datetime import datetime, timedelta
from pathlib import PurePath

from bson import ObjectId
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.auth import create_access_token, get_current_admin, get_current_user, hash_password, verify_password
from app.database import files_collection, logs_collection, users_collection
from app.models import QuotaUpdate, ShareFileRequest, UserLogin, UserRegister
from app.storage import delete_object, ensure_bucket, get_object_stream, put_object

app = FastAPI(title="Cloud Storage Service API")
app.add_middleware(
    CORSMiddleware,
      allow_origins=[
          x.strip() 
          for x in os.getenv("CORS_ORIGINS", "http://localhost").split(",")], 
          allow_credentials=True, 
          allow_methods=["GET", "POST", "PATCH", "DELETE"], 
          allow_headers=["Authorization", "Content-Type"])
USER_QUOTA_BYTES = int(os.getenv("USER_QUOTA_BYTES", str(5 * 1024**3)))
ADMIN_QUOTA_BYTES = int(os.getenv("ADMIN_QUOTA_BYTES", str(10 * 1024**3)))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(100 * 1024**2)))
TRASH_RETENTION_DAYS = int(os.getenv("TRASH_RETENTION_DAYS", "30"))
ALLOWED_EXTENSIONS = {x.strip().lower() for x in os.getenv("ALLOWED_EXTENSIONS", "pdf,txt,md,doc,docx,xls,xlsx,csv,png,jpg,jpeg,gif,webp,ppt,pptx").split(",")}

async def write_log(user_id, action, file_id=None, detail=""):
    await logs_collection.insert_one({"user_id": user_id, "action": action, "file_id": file_id, "detail": detail, "timestamp": datetime.utcnow()})

def oid(value):
    if not ObjectId.is_valid(value): raise HTTPException(404, "Không tìm thấy tệp tin")
    return ObjectId(value)

def clean_filename(filename):
    name = PurePath(filename or "").name.strip()
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if not name or name in {".", ".."} or ext not in ALLOWED_EXTENSIONS: raise HTTPException(400, "Tên hoặc định dạng tệp không hợp lệ")
    return name

async def used_bytes(user_id):
    rows = await files_collection.aggregate([{"$match": {"owner_id": user_id}}, {"$group": {"_id": None, "total": {"$sum": "$size"}}}]).to_list(1)
    return int(rows[0]["total"]) if rows else 0

def quota_for(user): return int(user.get("quota_bytes") or (ADMIN_QUOTA_BYTES if user.get("role") == "admin" else USER_QUOTA_BYTES))

async def serialize(doc):
    owner = await users_collection.find_one({"_id": ObjectId(doc["owner_id"])}, {"username": 1})
    return {"id": str(doc["_id"]), "filename": doc["filename"], "size": doc["size"], "owner_id": doc["owner_id"], "owner_username": owner.get("username", "Đã xóa tài khoản") if owner else "Đã xóa tài khoản", "shared_with": doc.get("shared_with", []), "created_at": doc["created_at"], "deleted_at": doc.get("deleted_at"), "purge_at": doc.get("purge_at")}

async def purge_expired():
    async for doc in files_collection.find({"deleted_at": {"$ne": None}, "purge_at": {"$lte": datetime.utcnow()}}):
        delete_object(doc["object_key"]); await files_collection.delete_one({"_id": doc["_id"]}); await write_log(doc["owner_id"], "AUTO_PURGE", str(doc["_id"]), "Tệp trong thùng rác đã hết hạn 30 ngày")

async def cleanup_loop():
    while True:
        await asyncio.sleep(86400); await purge_expired()

@app.on_event("startup")
async def startup():
    ensure_bucket(); await users_collection.create_index("username", unique=True); await files_collection.create_index([("owner_id", 1), ("deleted_at", 1)]); await files_collection.create_index("purge_at"); await purge_expired(); app.state.cleanup_task = asyncio.create_task(cleanup_loop())

@app.on_event("shutdown")
async def shutdown(): app.state.cleanup_task.cancel()

@app.get("/health", tags=["Operations"])
async def health():
    await users_collection.database.command("ping"); return {"status": "ok"}

@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED, tags=["Auth"])
async def register(user: UserRegister):
    if len(user.username.strip()) < 3 or len(user.password) < 8: raise HTTPException(400, "Username tối thiểu 3 ký tự, mật khẩu tối thiểu 8 ký tự")
    if await users_collection.find_one({"username": user.username.strip()}): raise HTTPException(400, "Tên người dùng đã tồn tại")
    doc = {"username": user.username.strip(), "password_hash": hash_password(user.password), "role": "user", "quota_bytes": USER_QUOTA_BYTES, "created_at": datetime.utcnow()}
    result = await users_collection.insert_one(doc); await write_log(str(result.inserted_id), "REGISTER", detail=f"User {doc['username']} registered")
    return {"message": "Đăng ký tài khoản thành công", "user_id": str(result.inserted_id)}

@app.post("/api/auth/login", tags=["Auth"])
async def login(credentials: UserLogin):
    user = await users_collection.find_one({"username": credentials.username.strip()})
    if not user or not verify_password(credentials.password, user["password_hash"]): raise HTTPException(401, "Sai tài khoản hoặc mật khẩu")
    token = create_access_token({"sub": str(user["_id"]), "role": user.get("role", "user")}); await write_log(str(user["_id"]), "LOGIN", detail="User logged in successfully")
    return {"access_token": token, "token_type": "bearer", "role": user.get("role", "user")}

@app.get("/api/storage/usage", tags=["Storage"])
async def storage_usage(current_user=Depends(get_current_user)):
    used = await used_bytes(current_user["_id"]); quota = quota_for(current_user)
    return {"used_bytes": used, "quota_bytes": quota, "remaining_bytes": max(0, quota - used), "warning_level": "full" if used >= quota else "warning" if used >= quota * .8 else "normal"}

@app.post("/api/files/upload", tags=["Files"])
async def upload_file(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    filename = clean_filename(file.filename); file.file.seek(0, 2); size = file.file.tell(); file.file.seek(0)
    if size <= 0 or size > MAX_UPLOAD_BYTES: raise HTTPException(413, f"Tệp phải lớn hơn 0 và không quá {MAX_UPLOAD_BYTES // 1024 // 1024} MB")
    if await used_bytes(current_user["_id"]) + size > quota_for(current_user): raise HTTPException(413, "Vượt quá dung lượng lưu trữ được phép")
    file_id = ObjectId(); object_key = f"users/{current_user['_id']}/{file_id}"; put_object(object_key, file.file, file.content_type)
    await files_collection.insert_one({"_id": file_id, "filename": filename, "object_key": object_key, "size": size, "owner_id": current_user["_id"], "shared_with": [], "created_at": datetime.utcnow(), "deleted_at": None, "purge_at": None}); await write_log(current_user["_id"], "UPLOAD", str(file_id), f"Uploaded {filename}")
    return {"message": "Tải tệp lên thành công", "file_id": str(file_id), "filename": filename}

@app.get("/api/files", tags=["Files"])
async def list_files(current_user=Depends(get_current_user)):
    query = {"deleted_at": None}
    if current_user.get("role") != "admin": query["$or"] = [{"owner_id": current_user["_id"]}, {"shared_with": current_user["username"]}]
    return [await serialize(doc) async for doc in files_collection.find(query)]

@app.get("/api/files/trash", tags=["Files"])
async def list_trash(current_user=Depends(get_current_user)):
    return [await serialize(doc) async for doc in files_collection.find({"owner_id": current_user["_id"], "deleted_at": {"$ne": None}})]

async def accessible(file_id, user, include_deleted=False):
    doc = await files_collection.find_one({"_id": oid(file_id)})
    if not doc or (not include_deleted and doc.get("deleted_at") is not None): raise HTTPException(404, "Không tìm thấy tệp tin")
    if doc["owner_id"] != user["_id"] and user["username"] not in doc.get("shared_with", []) and user.get("role") != "admin": raise HTTPException(403, "Không có quyền truy cập tệp tin này")
    return doc

@app.get("/api/files/download/{file_id}", tags=["Files"])
async def download(file_id, current_user=Depends(get_current_user)):
    doc = await accessible(file_id, current_user); await write_log(current_user["_id"], "DOWNLOAD", file_id, f"Downloaded {doc['filename']}")
    return StreamingResponse(get_object_stream(doc["object_key"]), media_type="application/octet-stream", headers={"Content-Disposition": f'attachment; filename="{doc["filename"]}"'})

@app.delete("/api/files/{file_id}", tags=["Files"])
async def trash(file_id, current_user=Depends(get_current_user)):
    doc = await accessible(file_id, current_user)
    if doc["owner_id"] != current_user["_id"] and current_user.get("role") != "admin": raise HTTPException(403, "Chỉ chủ sở hữu hoặc admin mới được xóa")
    now = datetime.utcnow(); await files_collection.update_one({"_id": doc["_id"]}, {"$set": {"deleted_at": now, "purge_at": now + timedelta(days=TRASH_RETENTION_DAYS)}})
    action = "ADMIN_TRASH" if current_user.get("role") == "admin" and doc["owner_id"] != current_user["_id"] else "TRASH"; await write_log(current_user["_id"], action, file_id, f"Moved {doc['filename']} to trash")
    return {"message": f"Đã chuyển tệp vào thùng rác trong {TRASH_RETENTION_DAYS} ngày"}

@app.post("/api/files/{file_id}/restore", tags=["Files"])
async def restore(file_id, current_user=Depends(get_current_user)):
    doc = await accessible(file_id, current_user, True)
    if not doc.get("deleted_at"): raise HTTPException(400, "Tệp không nằm trong thùng rác")
    if doc["owner_id"] != current_user["_id"] and current_user.get("role") != "admin": raise HTTPException(403, "Chỉ chủ sở hữu hoặc admin mới được khôi phục")
    await files_collection.update_one({"_id": doc["_id"]}, {"$set": {"deleted_at": None, "purge_at": None}}); action = "ADMIN_RESTORE" if current_user.get("role") == "admin" and doc["owner_id"] != current_user["_id"] else "RESTORE"; await write_log(current_user["_id"], action, file_id, f"Restored {doc['filename']}")
    return {"message": "Đã khôi phục tệp tin"}

@app.delete("/api/files/{file_id}/permanent", tags=["Files"])
async def purge(file_id, current_user=Depends(get_current_user)):
    doc = await accessible(file_id, current_user, True)
    if not doc.get("deleted_at"): raise HTTPException(400, "Chỉ được xóa vĩnh viễn tệp trong thùng rác")
    if doc["owner_id"] != current_user["_id"] and current_user.get("role") != "admin": raise HTTPException(403, "Chỉ chủ sở hữu hoặc admin mới được xóa vĩnh viễn")
    delete_object(doc["object_key"]); await files_collection.delete_one({"_id": doc["_id"]}); action = "ADMIN_PURGE" if current_user.get("role") == "admin" and doc["owner_id"] != current_user["_id"] else "PURGE"; await write_log(current_user["_id"], action, file_id, f"Permanently deleted {doc['filename']}")
    return {"message": "Đã xóa vĩnh viễn tệp tin"}

@app.post("/api/files/{file_id}/share", tags=["Permissions"])
async def share(file_id, payload: ShareFileRequest, current_user=Depends(get_current_user)):
    doc = await accessible(file_id, current_user)
    if doc["owner_id"] != current_user["_id"]: raise HTTPException(403, "Chỉ chủ sở hữu mới có quyền chia sẻ")
    target = await users_collection.find_one({"username": payload.target_username.strip()})
    if not target: raise HTTPException(404, "Người dùng đích không tồn tại")
    await files_collection.update_one({"_id": doc["_id"]}, {"$addToSet": {"shared_with": target["username"]}}); await write_log(current_user["_id"], "SHARE", file_id, f"Shared with {target['username']}")
    return {"message": f"Đã chia sẻ tệp với {target['username']}"}

@app.get("/api/logs", tags=["Logs"])
async def logs(current_user=Depends(get_current_user)):
    query = {} if current_user.get("role") == "admin" else {"user_id": current_user["_id"]}
    return [{"id": str(doc["_id"]), "user_id": doc["user_id"], "action": doc["action"], "file_id": doc.get("file_id"), "timestamp": doc["timestamp"], "detail": doc.get("detail", "")} async for doc in logs_collection.find(query).sort("timestamp", -1).limit(50)]

@app.get("/api/admin/users", tags=["Admin"])
async def users(_=Depends(get_current_admin)):
    return [{"id": str(doc["_id"]), "username": doc["username"], "role": doc.get("role", "user"), "quota_bytes": quota_for(doc), "created_at": doc["created_at"]} async for doc in users_collection.find({}, {"password_hash": 0})]

@app.patch("/api/admin/users/{user_id}/quota", tags=["Admin"])
async def set_user_quota(user_id, payload: QuotaUpdate, current_admin=Depends(get_current_admin)):
    target = await users_collection.find_one({"_id": oid(user_id)})
    if not target: raise HTTPException(404, "Không tìm thấy người dùng")
    await users_collection.update_one({"_id": target["_id"]}, {"$set": {"quota_bytes": payload.quota_bytes}})
    await write_log(current_admin["_id"], "ADMIN_QUOTA_CHANGE", detail=f"Changed quota for {target['username']} to {payload.quota_bytes} bytes")
    return {"message": "Đã cập nhật quota", "user_id": user_id, "quota_bytes": payload.quota_bytes}
