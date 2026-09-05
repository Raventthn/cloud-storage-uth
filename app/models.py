from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class UserRegister(BaseModel):
    username: str
    password: str
    role: Optional[str] = "user"

class UserLogin(BaseModel):
    username: str
    password: str

class ShareFileRequest(BaseModel):
    target_username: str

class FileResponse(BaseModel):
    id: str
    filename: str
    size: int
    owner_id: str
    shared_with: List[str]
    created_at: datetime

class ActivityLog(BaseModel):
    user_id: str
    action: str
    file_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    detail: Optional[str] = None