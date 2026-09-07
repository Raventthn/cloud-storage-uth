requireAuthOrRedirect();

if (getRole() !== "admin") {
  window.location.href = "dashboard.html";
}

document.getElementById("userNameLabel").textContent = getUsername() || "Quản trị viên";
document.getElementById("userAvatar").textContent = (getUsername() || "?").charAt(0).toUpperCase();

document.getElementById("logoutLink").addEventListener("click", (e) => {
  e.preventDefault();
  clearSession();
  window.location.href = "login.html";
});

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch (e) {
    return "—";
  }
}

function formatDateTime(isoString) {
  try {
    return new Date(isoString).toLocaleString("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch (e) {
    return "—";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML.replace(/'/g, "&#39;");
}

function getCategory(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (["doc", "docx", "pdf", "txt", "md", "ppt", "pptx", "xls", "xlsx", "csv"].includes(ext)) {
    return { label: "Tài liệu", color: "#3e6ff2" };
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
    return { label: "Hình ảnh", color: "#23b26d" };
  }
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) {
    return { label: "Video", color: "#e0523f" };
  }
  return { label: "Khác", color: "#8b93a7" };
}

const ACTION_LABELS = {
  REGISTER: "đã đăng ký tài khoản",
  LOGIN: "đã đăng nhập",
  UPLOAD: "đã tải lên",
  DOWNLOAD: "đã tải xuống",
  DELETE: "đã xóa",
  SHARE: "đã chia sẻ",
};

// ---------- State ----------
let allFiles = [];
let allLogs = [];
let usersById = null; // null = endpoint chưa có / lỗi; object = có dữ liệu thật
let currentView = "overview";
let currentSearch = "";
let pendingDeleteId = null;

function resolveUsername(userId) {
  if (usersById && usersById[userId]) return usersById[userId];
  return userId; // fallback: hiện ObjectId thô nếu chưa có bảng map
}

// ---------- Load data ----------
async function init() {
  let usersLoadFailed = false;

  try {
    const users = await Api.getAdminUsers();
    usersById = {};
    users.forEach((u) => (usersById[u.id] = u.username));
  } catch (err) {
    usersById = null;
    usersLoadFailed = true;
  }

  try {
    allFiles = await Api.listFiles();
  } catch (err) {
    showToast(err.message, "error");
  }

  try {
    allLogs = await Api.getLogs();
  } catch (err) {
    showToast(err.message, "error");
  }

  renderBackendNotice(usersLoadFailed);
  renderOverview();
  renderFilesTable();
  renderLogsTable();
}

function renderBackendNotice(usersLoadFailed) {
  const notice = document.getElementById("backendNotice");
  if (usersLoadFailed) {
    notice.hidden = false;
    notice.innerHTML =
      'Chưa gọi được <code>GET /api/admin/users</code> (endpoint này chưa có ở backend). ' +
      '"Tổng người dùng" và tên chủ sở hữu file/log sẽ tạm hiện dạng ID thô. ' +
      "Xem <code>ADMIN_FEATURE_SPEC.md</code> để bổ sung.";
  } else {
    notice.hidden = true;
  }

  document.getElementById("scopeNote").textContent =
    "Lưu ý: số liệu dung lượng/tệp ở trên phản ánh đúng những gì API /api/files trả về cho tài khoản admin hiện tại. " +
    "Nếu Thành viên 1 đã áp dụng bản vá bỏ lọc owner cho admin (ADMIN_FEATURE_SPEC.md), đây là số liệu toàn hệ thống.";
}

// ---------- Overview ----------
function renderOverview() {
  document.getElementById("metricUsers").textContent = usersById ? Object.keys(usersById).length : "—";
  const totalBytes = allFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  document.getElementById("metricStorage").textContent = formatSize(totalBytes);
  document.getElementById("metricFiles").textContent = allFiles.length;

  // Bảng file mới nhất
  const recentBody = document.getElementById("recentFilesTableBody");
  const recents = [...allFiles].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  if (recents.length === 0) {
    recentBody.innerHTML = `<tr><td colspan="4" class="empty-state">Chưa có tệp tin nào</td></tr>`;
  } else {
    recentBody.innerHTML = recents
      .map(
        (f) => `
      <tr>
        <td>${escapeHtml(f.filename)}</td>
        <td>${escapeHtml(resolveUsername(f.owner_id))}</td>
        <td>${formatSize(f.size)}</td>
        <td>${formatDate(f.created_at)}</td>
      </tr>`
      )
      .join("");
  }

  // Donut cơ cấu định dạng
  const byCategory = {};
  allFiles.forEach((f) => {
    const cat = getCategory(f.filename);
    byCategory[cat.label] = byCategory[cat.label] || { size: 0, color: cat.color };
    byCategory[cat.label].size += f.size || 0;
  });

  document.getElementById("storageUsedLabel").textContent = formatSize(totalBytes);
  const donut = document.getElementById("storageDonut");
  const legend = document.getElementById("storageLegend");

  if (totalBytes === 0) {
    donut.style.background = "#eef1f8";
    legend.innerHTML = `<li style="justify-content:center;color:var(--text-muted)">Chưa có tệp tin nào</li>`;
    return;
  }

  let acc = 0;
  const stops = [];
  Object.entries(byCategory).forEach(([, data]) => {
    const start = (acc / totalBytes) * 360;
    acc += data.size;
    const end = (acc / totalBytes) * 360;
    stops.push(`${data.color} ${start}deg ${end}deg`);
  });
  donut.style.background = `conic-gradient(${stops.join(", ")})`;

  legend.innerHTML = Object.entries(byCategory)
    .map(
      ([label, data]) => `
      <li>
        <span class="legend-label"><span class="legend-dot" style="background:${data.color}"></span>${label}</span>
        <span>${formatSize(data.size)}</span>
      </li>`
    )
    .join("");
}

// ---------- Quản lý toàn bộ tệp ----------
function getFilteredFiles() {
  if (!currentSearch) return allFiles;
  return allFiles.filter(
    (f) =>
      f.filename.toLowerCase().includes(currentSearch) ||
      resolveUsername(f.owner_id).toLowerCase().includes(currentSearch)
  );
}

function renderFilesTable() {
  const tbody = document.getElementById("allFilesTableBody");
  const files = [...getFilteredFiles()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  document.getElementById("filesCountLabel").textContent = `${allFiles.length} tệp`;

  if (files.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Không có tệp tin nào</td></tr>`;
    return;
  }

  tbody.innerHTML = files
    .map((f) => {
      const isShared = (f.shared_with || []).length > 0;
      const statusHtml = isShared
        ? `<span class="share-status shared">Đã chia sẻ (${f.shared_with.length})</span>`
        : `<span class="share-status private">Cá nhân</span>`;
      return `
      <tr>
        <td>${escapeHtml(f.filename)}</td>
        <td>${escapeHtml(resolveUsername(f.owner_id))}</td>
        <td>${statusHtml}</td>
        <td>${formatSize(f.size)}</td>
        <td>${formatDate(f.created_at)}</td>
        <td>
          <div class="row-actions">
            <button class="danger" title="Xóa" onclick="openDeleteModal('${f.id}', '${escapeHtml(f.filename)}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function openDeleteModal(fileId, filename) {
  pendingDeleteId = fileId;
  document.getElementById("deleteModalFileName").textContent = `Bạn có chắc muốn xóa "${filename}"? Hành động này không thể hoàn tác.`;
  document.getElementById("deleteModal").classList.add("open");
}

document.getElementById("deleteCancelBtn").addEventListener("click", () => {
  document.getElementById("deleteModal").classList.remove("open");
});

document.getElementById("deleteConfirmBtn").addEventListener("click", async () => {
  if (!pendingDeleteId) return;
  try {
    await Api.deleteFile(pendingDeleteId);
    showToast("Đã xóa tệp tin thành công", "success");
    document.getElementById("deleteModal").classList.remove("open");
    allFiles = await Api.listFiles();
    renderOverview();
    renderFilesTable();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ---------- Nhật ký hệ thống ----------
function getFilteredLogs() {
  if (!currentSearch) return allLogs;
  return allLogs.filter(
    (log) =>
      resolveUsername(log.user_id).toLowerCase().includes(currentSearch) ||
      (log.detail || "").toLowerCase().includes(currentSearch)
  );
}

function renderLogsTable() {
  const tbody = document.getElementById("logsTableBody");
  const logs = getFilteredLogs();

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Chưa có hoạt động nào</td></tr>`;
    return;
  }

  tbody.innerHTML = logs
    .map((log) => {
      const label = ACTION_LABELS[log.action] || log.action;
      return `
      <tr>
        <td>${formatDateTime(log.timestamp)}</td>
        <td>${escapeHtml(resolveUsername(log.user_id))}</td>
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(log.detail || "—")}</td>
      </tr>`;
    })
    .join("");
}

// ---------- Nav switching ----------
document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
  item.addEventListener("click", () => {
    currentView = item.dataset.view;
    currentSearch = "";
    document.getElementById("searchInput").value = "";
    document.querySelectorAll(".nav-item[data-view]").forEach((n) => n.classList.toggle("active", n === item));
    document.getElementById("overviewView").hidden = currentView !== "overview";
    document.getElementById("filesView").hidden = currentView !== "files";
    document.getElementById("logsView").hidden = currentView !== "logs";
    renderFilesTable();
    renderLogsTable();
  });
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  currentSearch = e.target.value.trim().toLowerCase();
  if (currentView === "files") renderFilesTable();
  if (currentView === "logs") renderLogsTable();
});

init();
