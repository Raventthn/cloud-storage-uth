/**
 * Lớp bọc các lời gọi tới backend (main.py / auth.py của Thành viên 1).
 * Mọi hàm ở đây trả về Promise, ném lỗi (throw) kèm message tiếng Việt
 * lấy từ trường "detail" mà backend trả về khi có lỗi.
 */

function getToken() {
  return localStorage.getItem("access_token");
}

function getUsername() {
  return localStorage.getItem("username");
}

function getRole() {
  return localStorage.getItem("role");
}

function clearSession() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("username");
  localStorage.removeItem("role");
}

function requireAuthOrRedirect() {
  if (!getToken()) {
    window.location.href = "login.html";
  }
}

async function apiRequest(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      "Không thể kết nối tới máy chủ. Kiểm tra xem backend đã chạy ở " +
        API_BASE_URL +
        " chưa."
    );
  }

  if (response.status === 401) {
    clearSession();
    window.location.href = "login.html";
    return;
  }

  let data = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await response.json();
  }

  if (!response.ok) {
    const message = (data && data.detail) || "Đã xảy ra lỗi không xác định";
    throw new Error(message);
  }

  return data;
}

const Api = {
  register(username, password) {
    return apiRequest("/api/auth/register", {
      method: "POST",
      body: { username, password },
    });
  },

  login(username, password) {
    return apiRequest("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
  },

  listFiles() {
    return apiRequest("/api/files");
  },

  async uploadFile(file) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest("/api/files/upload", {
      method: "POST",
      body: form,
      isForm: true,
    });
  },

  async downloadFile(fileId, filename) {
    const token = getToken();
    const response = await fetch(`${API_BASE_URL}/api/files/download/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error((data && data.detail) || "Tải xuống thất bại");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  deleteFile(fileId) {
    return apiRequest(`/api/files/${fileId}`, { method: "DELETE" });
  },

  shareFile(fileId, targetUsername) {
    return apiRequest(`/api/files/${fileId}/share`, {
      method: "POST",
      body: { target_username: targetUsername },
    });
  },

  getLogs() {
    return apiRequest("/api/logs");
  },

  getStorageUsage() { return apiRequest("/api/storage/usage"); },
  getTrash() { return apiRequest("/api/files/trash"); },
  restoreFile(fileId) { return apiRequest(`/api/files/${fileId}/restore`, { method: "POST" }); },
  permanentlyDeleteFile(fileId) { return apiRequest(`/api/files/${fileId}/permanent`, { method: "DELETE" }); },

  getAdminUsers() {
    return apiRequest("/api/admin/users");
  },
};
