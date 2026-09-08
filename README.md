# Cloud Storage UTH — demo Docker + MinIO

## Chạy demo

1. Sao chép `.env.example` thành `.env`, thay toàn bộ mật khẩu mẫu và đặt `JWT_SECRET` ngẫu nhiên tối thiểu 32 ký tự.
2. Chạy `docker compose up --build -d`.
3. Mở `http://localhost:8080`.
4. Tạo admin một lần: `docker compose exec backend python scripts/seed_admin.py`.

MongoDB và MinIO không public ra mạng. MinIO Console chỉ phục vụ local tại `http://localhost:9001`; ứng dụng truy cập object qua backend, bucket mặc định là private.

## Luồng demo đề nghị

1. Đăng ký hai tài khoản user (không có tùy chọn tạo admin).
2. User A upload file, kiểm tra quota 5 GB ở Dashboard, rồi chia sẻ cho User B.
3. User A xóa file: file chuyển sang **Thùng rác**, quota không giảm.
4. Khôi phục file từ thùng rác; file trở lại danh sách chính.
5. Đăng nhập admin, mở Quản trị hệ thống để xem toàn bộ file, user và audit log.

## Chính sách dữ liệu và bảo mật

- Soft delete giữ metadata/object 30 ngày (`TRASH_RETENTION_DAYS`); tiến trình backend purge mỗi ngày và object bị xóa vĩnh viễn khi hết hạn.
- User quota mặc định 5 GB; admin 10 GB; `quota_bytes` trên user cho phép cấu hình riêng. File trong thùng rác vẫn được tính quota.
- Public registration luôn gán role `user`. Admin duy nhất được tạo qua seed CLI.
- API kiểm tra quyền owner/share/admin tại backend cho upload, download, trash, restore và purge; mọi thao tác admin trên file người khác tạo audit log.
- Upload giới hạn dung lượng, allow-list extension và loại bỏ đường dẫn từ filename.
- Không commit `.env`; volumes `mongo_data` và `minio_data` giúp restart container không mất dữ liệu.

## Backup và phục hồi demo

Trước khi demo quan trọng, dừng stack rồi sao lưu Docker volumes `mongo_data` và `minio_data` bằng cơ chế volume backup của Docker. Khôi phục cả hai volumes cùng lúc để metadata MongoDB luôn khớp object MinIO. Thử khôi phục trên máy demo trước buổi thuyết trình.

## Sơ đồ kiến trúc

```text
Browser → Nginx :8080 → FastAPI → MongoDB (metadata, users, audit)
                         └──────→ MinIO private bucket (file objects)
```
