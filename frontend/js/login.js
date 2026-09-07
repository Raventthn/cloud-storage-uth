const form = document.getElementById("loginForm");
const messageBox = document.getElementById("formMessage");
const submitBtn = document.getElementById("submitBtn");

// Nếu đã đăng nhập rồi thì vào thẳng dashboard
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

  submitBtn.disabled = true;
  submitBtn.textContent = "Đang đăng nhập...";

  try {
    const result = await Api.login(username, password);
    localStorage.setItem("access_token", result.access_token);
    localStorage.setItem("username", username);
    localStorage.setItem("role", result.role || "user");
    window.location.href = "dashboard.html";
  } catch (err) {
    showMessage(err.message, "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Đăng nhập";
  }
});
