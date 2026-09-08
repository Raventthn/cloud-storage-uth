"""Run once: docker compose exec backend python scripts/seed_admin.py"""
import asyncio, getpass, os
from datetime import datetime
from app.auth import hash_password
from app.database import users_collection

async def main():
    username = input("Admin username: ").strip()
    password = getpass.getpass("Admin password (min 8 chars): ")
    if len(username) < 3 or len(password) < 8: raise SystemExit("Username tối thiểu 3 ký tự, mật khẩu tối thiểu 8 ký tự.")
    if await users_collection.find_one({"username": username}): raise SystemExit("Username đã tồn tại.")
    await users_collection.insert_one({"username": username, "password_hash": hash_password(password), "role": "admin", "quota_bytes": int(os.getenv("ADMIN_QUOTA_BYTES", str(10 * 1024**3))), "created_at": datetime.utcnow()})
    print("Đã tạo admin.")
asyncio.run(main())
