const form = document.getElementById("registerForm");
const messageBox = document.getElementById("formMessage");
const submitBtn = document.getElementById("submitBtn");

if (getToken()) {
  window.location.href = "dashboard.html";
}

function showMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = `form-message ${type}`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const role = document.getElementById("role").value;

  if (password !== confirmPassword) {
    showMessage("Mật khẩu xác nhận không khớp", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Đang tạo tài khoản...";

  try {
    await Api.register(username, password, role);
    showMessage("Đăng ký thành công! Đang chuyển tới trang đăng nhập...", "success");
    setTimeout(() => (window.location.href = "login.html"), 1200);
  } catch (err) {
    showMessage(err.message, "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Đăng ký";
  }
});
