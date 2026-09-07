// Đổi dòng này nếu backend chạy ở địa chỉ khác (ví dụ khi deploy lên server thật)
const API_BASE_URL = "http://localhost:8000";

// Giới hạn dung lượng demo phía frontend (backend hiện không giới hạn dung lượng thật).
// Đổi số này nếu muốn khung "Thống kê lưu trữ" hiển thị hạn mức khác.
const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
