requireAuthOrRedirect();

let allFiles = [];
let trashFiles = [];
let currentFilter = "all";
let currentCategoryFilter = "all";
let currentSearch = "";
let pendingDeleteId = null;
let pendingShareId = null;

const currentUserId = getUserIdFromToken();

function getUserIdFromToken() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || null;
  } catch (e) {
    return null;
  }
}

// ---------- Header ----------
document.getElementById("userNameLabel").textContent = getUsername() || "Người dùng";
document.getElementById("userAvatar").textContent = (getUsername() || "?").charAt(0).toUpperCase();

if (getRole() === "admin") {
  document.getElementById("adminNavGroup").hidden = false;
}

document.getElementById("logoutLink").addEventListener("click", (e) => {
  e.preventDefault();
  clearSession();
  window.location.href = "login.html";
});

// ---------- Toast ----------
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ---------- Helpers ----------
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch (e) {
    return "—";
  }
}

function formatRelativeTime(isoString) {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "vừa mới";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} phút trước`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} giờ trước`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 30) return `${diffDay} ngày trước`;
    return formatDate(isoString);
  } catch (e) {
    return "";
  }
}

function getCategory(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (["doc", "docx", "pdf", "txt", "md", "ppt", "pptx", "xls", "xlsx", "csv"].includes(ext)) {
    return { key: "doc", label: "Tài liệu", color: "#3e6ff2" };
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
    return { key: "image", label: "Hình ảnh", color: "#23b26d" };
  }
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) {
    return { key: "video", label: "Video", color: "#e0523f" };
  }
  return { key: "other", label: "Khác", color: "#8b93a7" };
}

function fileIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M15 2v5h5"/></svg>`;
}

// ---------- Sidebar filters ----------
const FILTER_TITLES = {
  all: "Tổng quan gần đây",
  mine: "Tập tin của tôi",
  shared: "Được chia sẻ với tôi",
  trash: "Thùng rác (tự xóa sau 30 ngày)",
};
const DASHBOARD_PREVIEW_COUNT = 5;
let viewMode = "files"; // "files" | "logs"

document.querySelectorAll(".nav-item[data-filter]").forEach((item) => {
  item.addEventListener("click", () => {
    setActiveFilter(item.dataset.filter);
  });
});

function setAllNavActive(activeEl) {
  document.querySelectorAll(".nav-item[data-filter], #logsNav").forEach((n) => {
    n.classList.toggle("active", n === activeEl);
  });
}

function setActiveFilter(filter) {
  viewMode = "files";
  currentFilter = filter;
  currentCategoryFilter = "all";
  setAllNavActive(document.querySelector(`.nav-item[data-filter="${filter}"]`));

  // Khu vực Kéo & Thả chỉ dành riêng cho Dashboard (filter "all"),
  // ẩn đi ở "Tập tin của tôi" / "Được chia sẻ" để bảng quản lý file có tối đa không gian.
  document.getElementById("dropzoneSection").hidden = filter !== "all";
  document.getElementById("filesSection").hidden = false;
  document.getElementById("logsFullSection").hidden = true;

  // Cột phải (Thống kê lưu trữ + mini nhật ký) chỉ có ý nghĩa ở Dashboard tổng quan.
  // Ở các trang quản lý, ẩn đi để bảng dữ liệu chính có toàn bộ chiều ngang.
  setRightColVisible(filter === "all");

  // Thanh lọc định dạng chỉ có ý nghĩa khi xem danh sách file đầy đủ (không phải Dashboard tổng quan)
  const filterBar = document.getElementById("formatFilterBar");
  filterBar.hidden = filter === "all";
  filterBar.querySelectorAll(".format-filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === "all");
  });

  renderFileTable();
}

function setRightColVisible(visible) {
  document.getElementById("rightCol").hidden = !visible;
  document.getElementById("appShell").classList.toggle("hide-right-col", !visible);
}

document.querySelectorAll(".format-filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentCategoryFilter = btn.dataset.category;
    document.querySelectorAll(".format-filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderFileTable();
  });
});

document.getElementById("viewAllLink").addEventListener("click", (e) => {
  e.preventDefault();
  setActiveFilter("mine");
});

document.getElementById("logsNav").addEventListener("click", () => {
  viewMode = "logs";
  setAllNavActive(document.getElementById("logsNav"));
  document.getElementById("dropzoneSection").hidden = true;
  document.getElementById("filesSection").hidden = true;
  document.getElementById("logsFullSection").hidden = false;
  setRightColVisible(false);
  loadFullLogs();
});

// ---------- Search ----------
document.getElementById("searchInput").addEventListener("input", (e) => {
  currentSearch = e.target.value.trim().toLowerCase();
  renderFileTable();
});

// ---------- Load files ----------
async function loadFiles() {
  try {
    allFiles = await Api.listFiles();
    trashFiles = await Api.getTrash();
    renderFileTable();
    renderRecentFiles();
    await renderStorage();
    updateNotificationDot();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function getFilteredFiles() {
  const source = currentFilter === "trash" ? trashFiles : allFiles;
  return source.filter((f) => {
    if (currentSearch && !f.filename.toLowerCase().includes(currentSearch)) return false;
    if (currentFilter === "mine" && f.owner_id !== currentUserId) return false;
    if (currentFilter === "shared" && f.owner_id === currentUserId) return false;
    if (currentCategoryFilter !== "all" && getCategory(f.filename).key !== currentCategoryFilter) return false;
    return true;
  });
}

function renderFileTable() {
  const tbody = document.getElementById("fileTableBody");
  const titleEl = document.getElementById("fileSectionTitle");
  const viewAllLink = document.getElementById("viewAllLink");

  titleEl.textContent = FILTER_TITLES[currentFilter] || "Tệp tin";

  let files = getFilteredFiles().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const isDashboard = currentFilter === "all";
  const showViewAll = isDashboard && !currentSearch && files.length > DASHBOARD_PREVIEW_COUNT;
  viewAllLink.hidden = !showViewAll;

  if (isDashboard && !currentSearch) {
    files = files.slice(0, DASHBOARD_PREVIEW_COUNT);
  }

  if (files.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Không có tệp tin nào để hiển thị</td></tr>`;
    return;
  }

  tbody.innerHTML = files
    .map((f) => {
      const isMine = f.owner_id === currentUserId;
      const isShared = (f.shared_with || []).length > 0;
      const statusHtml = !isMine
        ? `<span class="share-status shared">Được chia sẻ bởi ${escapeHtml(f.owner_username || "người dùng khác")}</span>`
        : isShared
        ? `<span class="share-status shared"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/><circle cx="18" cy="8" r="2.5"/><path d="M16 14.3c2.9.4 5 2.3 5 5.2"/></svg>Đã chia sẻ (${f.shared_with.length})</span>`
        : `<span class="share-status private"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Cá nhân</span>`;

      if (currentFilter === "trash") {
        return `
        <tr><td><div class="file-name-cell"><div class="file-icon">${fileIconSvg()}</div><span>${escapeHtml(f.filename)}</span></div></td>
        <td><span class="share-status private">Đã xóa</span></td><td>${formatSize(f.size)}</td><td>${formatDate(f.deleted_at)}</td>
        <td><div class="row-actions"><button title="Khôi phục" onclick="handleRestore('${f.id}')">Khôi phục</button><button class="danger" title="Xóa vĩnh viễn" onclick="handlePermanentDelete('${f.id}')">Xóa hẳn</button></div></td></tr>`;
      }
      const shareBtn = isMine
        ? `<button title="Chia sẻ" onclick="openShareModal('${f.id}', '${escapeHtml(f.filename)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.9-4M8.6 13.5l6.9 4"/></svg></button>`
        : "";
      const deleteBtn = isMine
        ? `<button class="danger" title="Xóa" onclick="openDeleteModal('${f.id}', '${escapeHtml(f.filename)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg></button>`
        : "";

      return `
      <tr>
        <td>
          <div class="file-name-cell">
            <div class="file-icon">${fileIconSvg()}</div>
            <span>${escapeHtml(f.filename)}</span>
          </div>
        </td>
        <td>${statusHtml}</td>
        <td>${formatSize(f.size)}</td>
        <td>${formatDate(f.created_at)}</td>        <td>
          <div class="row-actions">
            <button title="Tải xuống" onclick="handleDownload('${f.id}', '${escapeHtml(f.filename)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg></button>
            ${shareBtn}
            ${deleteBtn}
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replace(/'/g, "&#39;");
}

function renderRecentFiles() {
  const outerWrap = document.getElementById("recentFilesWrap");
  const wrap = document.getElementById("recentFiles");
  const recents = [...allFiles]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 2);

  if (recents.length === 0) {
    outerWrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  outerWrap.hidden = false;
  wrap.innerHTML = recents
    .map(
      (f) => `
      <div class="recent-file-card">
        <div class="recent-file-thumb">${escapeHtml(f.filename)}</div>
        <div class="recent-file-time">${formatRelativeTime(f.created_at)}</div>
      </div>`
    )
    .join("");
}

// ---------- Storage stats ----------
async function renderStorage() {
  const mine = allFiles.filter((f) => f.owner_id === currentUserId);
  const totalBytes = mine.reduce((sum, f) => sum + (f.size || 0), 0);

  const byCategory = {};
  mine.forEach((f) => {
    const cat = getCategory(f.filename);
    byCategory[cat.label] = byCategory[cat.label] || { size: 0, color: cat.color };
    byCategory[cat.label].size += f.size || 0;
  });

  let usage = { used_bytes: totalBytes, quota_bytes: STORAGE_QUOTA_BYTES, warning_level: "normal" };
  try { usage = await Api.getStorageUsage(); } catch (err) { console.warn("Không tải được quota", err); }
  document.getElementById("storageUsedLabel").textContent = formatSize(usage.used_bytes);
  const quotaWrap = document.getElementById("quotaBarWrap");
  quotaWrap.hidden = false;
  const ratio = Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100);
  document.getElementById("quotaBarFill").style.width = `${ratio}%`;
  document.getElementById("quotaBarFill").style.background = usage.warning_level === "full" ? "var(--red)" : usage.warning_level === "warning" ? "#e59b20" : "var(--blue)";
  document.getElementById("quotaBarLabel").textContent = `${formatSize(usage.used_bytes)} / ${formatSize(usage.quota_bytes)} đã dùng`;

  const donut = document.getElementById("storageDonut");
  const legend = document.getElementById("storageLegend");

  if (totalBytes === 0) {
    donut.style.background = "#eef1f8";
    legend.innerHTML = `<li style="justify-content:center;color:var(--text-muted)">Chưa có tệp tin nào</li>`;
    return;
  }

  let acc = 0;
  const stops = [];
  Object.entries(byCategory).forEach(([label, data]) => {
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

// ---------- Upload ----------
const dropzoneArea = document.getElementById("dropzoneArea");
const fileInput = document.getElementById("fileInput");

document.getElementById("browseLink").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleUpload(e.target.files[0]);
});

["dragenter", "dragover"].forEach((evt) =>
  dropzoneArea.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzoneArea.classList.add("drag-over");
  })
);

["dragleave", "drop"].forEach((evt) =>
  dropzoneArea.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzoneArea.classList.remove("drag-over");
  })
);

dropzoneArea.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleUpload(file);
});

async function handleUpload(file) {
  try {
    showToast(`Đang tải lên "${file.name}"...`, "success");
    await Api.uploadFile(file);
    showToast(`Tải lên "${file.name}" thành công`, "success");
    fileInput.value = "";
    await loadFiles();
    loadActivity();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleRestore(fileId) {
  try { await Api.restoreFile(fileId); showToast("Đã khôi phục tệp", "success"); await loadFiles(); }
  catch (err) { showToast(err.message, "error"); }
}

async function handlePermanentDelete(fileId) {
  if (!confirm("Xóa vĩnh viễn tệp này? Không thể hoàn tác.")) return;
  try { await Api.permanentlyDeleteFile(fileId); showToast("Đã xóa vĩnh viễn", "success"); await loadFiles(); }
  catch (err) { showToast(err.message, "error"); }
}

// ---------- Download ----------
async function handleDownload(fileId, filename) {
  try {
    await Api.downloadFile(fileId, filename);
    loadActivity();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ---------- Delete ----------
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
    await loadFiles();
    loadActivity();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ---------- Share ----------
function openShareModal(fileId, filename) {
  pendingShareId = fileId;
  document.getElementById("shareModalFileName").textContent = `Tệp: ${filename}`;
  document.getElementById("shareUsername").value = "";
  document.getElementById("shareModal").classList.add("open");
}

document.getElementById("shareCancelBtn").addEventListener("click", () => {
  document.getElementById("shareModal").classList.remove("open");
});

document.getElementById("shareConfirmBtn").addEventListener("click", async () => {
  const target = document.getElementById("shareUsername").value.trim();
  if (!target || !pendingShareId) return;
  try {
    await Api.shareFile(pendingShareId, target);
    showToast(`Đã chia sẻ với ${target}`, "success");
    document.getElementById("shareModal").classList.remove("open");
    await loadFiles();
    loadActivity();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ---------- Activity log ----------
const ACTION_LABELS = {
  REGISTER: "đã đăng ký tài khoản",
  LOGIN: "đã đăng nhập",
  UPLOAD: "đã tải lên",
  DOWNLOAD: "đã tải xuống",
  DELETE: "đã xóa",
  SHARE: "đã chia sẻ",
};

const ACTION_ICONS = {
  REGISTER: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-5.5 8-5.5s8 2.2 8 5.5"/></svg>`,
  LOGIN: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H3"/></svg>`,
  UPLOAD: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4m0 0 4 4m-4-4-4 4"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>`,
  DOWNLOAD: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>`,
  DELETE: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg>`,
  SHARE: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.9-4M8.6 13.5l6.9 4"/></svg>`,
};

async function loadActivity() {
  const list = document.getElementById("activityList");
  try {
    const logs = await Api.getLogs();
    // Trang Dashboard cá nhân chỉ nên hiện HÀNH ĐỘNG CỦA CHÍNH MÌNH.
    // Khi tài khoản là admin, /api/logs trả về log của TẤT CẢ mọi người (đúng thiết kế
    // để phục vụ trang Quản trị) — nên phải tự lọc lại ở đây theo user_id của người
    // đang đăng nhập, tránh hiện nhầm hành động của người khác lên Dashboard cá nhân.
    const myLogs = logs.filter((log) => log.user_id === currentUserId);
    if (myLogs.length === 0) {
      list.innerHTML = `<li class="activity-item">Chưa có hoạt động nào</li>`;
      return;
    }
    list.innerHTML = myLogs
      .slice(0, 8)
      .map((log) => {
        const cls = (log.action || "").toLowerCase();
        const icon = ACTION_ICONS[log.action] || ACTION_ICONS.LOGIN;
        const label = ACTION_LABELS[log.action] || log.action;
        return `
        <li class="activity-item">
          <div class="activity-icon ${cls}">${icon}</div>
          <div class="activity-text">
            <div><strong>${escapeHtml(getUsername() || "Bạn")}</strong> ${label}</div>
            <div class="activity-time">${formatDate(log.timestamp)}</div>
          </div>
        </li>`;
      })
      .join("");
  } catch (err) {
    list.innerHTML = `<li class="activity-item">Không thể tải nhật ký</li>`;
  }
}

function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return "—";
  }
}

async function loadFullLogs() {
  const tbody = document.getElementById("logsFullTableBody");
  try {
    const logs = await Api.getLogs();
    // Cùng lý do như loadActivity(): trang "Nhật ký hoạt động" ở Dashboard cá nhân
    // chỉ nên hiện log của chính người dùng đang đăng nhập. Log toàn hệ thống (mọi
    // user) đã có chỗ riêng ở trang Quản trị (admin.html → "Nhật ký hệ thống").
    const myLogs = logs.filter((log) => log.user_id === currentUserId);
    if (myLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Chưa có hoạt động nào</td></tr>`;
      return;
    }
    tbody.innerHTML = myLogs
      .map((log) => {
        const label = ACTION_LABELS[log.action] || log.action;
        return `
        <tr>
          <td>${formatDateTime(log.timestamp)}</td>
          <td>${escapeHtml(label)}</td>
          <td>${escapeHtml(log.detail || "—")}</td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Không thể tải nhật ký</td></tr>`;
  }
}

// ---------- Init ----------
loadFiles();
loadActivity();

// ---------- Notifications (chỉ lưu ở localStorage, không đụng backend) ----------
// "Đã xem" = danh sách id file-được-chia-sẻ-cho-tôi mà tôi đã bấm chuông xem qua.
function getSeenSharedIds() {
  try {
    return JSON.parse(localStorage.getItem("seen_shared_file_ids") || "[]");
  } catch (e) {
    return [];
  }
}

function saveSeenSharedIds(ids) {
  localStorage.setItem("seen_shared_file_ids", JSON.stringify(ids));
}

function getFilesSharedWithMe() {
  return allFiles.filter((f) => f.owner_id !== currentUserId);
}

function updateNotificationDot() {
  const seen = getSeenSharedIds();
  const sharedWithMe = getFilesSharedWithMe();
  const hasNew = sharedWithMe.some((f) => !seen.includes(f.id));
  document.getElementById("notifDot").hidden = !hasNew;
}

document.getElementById("notifBtn").addEventListener("click", () => {
  const sharedWithMe = getFilesSharedWithMe();
  saveSeenSharedIds(sharedWithMe.map((f) => f.id));
  document.getElementById("notifDot").hidden = true;
});
