var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var DEFAULT_PASSWORD = "12345678";
var PBKDF2_ITERATIONS = 1e5;

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
__name(bufToB64, "bufToB64");

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${bufToB64(salt)}$${bufToB64(bits)}`;
}
__name(hashPassword, "hashPassword");

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(escapeHtml, "escapeHtml");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
__name(json, "json");

// Helper to parse cookies
function parseCookies(request) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(";").map(c => c.trim().split("="))
  );
}
__name(parseCookies, "parseCookies");

// Render Login Page
function renderLoginPage(error = "", secretNotConfigured = false) {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ورود به داشبورد اضطراری</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Tahoma, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; }
  .login-card { background: #1e293b; padding: 30px; border-radius: 12px; border: 1px solid #334155; width: 100%; max-width: 350px; text-align: center; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); }
  h2 { margin: 0 0 20px; font-size: 20px; color: #f8fafc; }
  input { width: 100%; padding: 12px; margin-bottom: 15px; background: #0b1220; border: 1px solid #475569; color: white; border-radius: 8px; font-family: inherit; }
  button { width: 100%; background: #2563eb; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-size: 15px; font-family: inherit; font-weight: bold; }
  button:hover { background: #1d4ed8; }
  .err { color: #ef4444; font-size: 13px; margin-bottom: 15px; background: #7f1d1d33; padding: 10px; border-radius: 6px; }
  .warn { color: #eab308; font-size: 13px; margin-bottom: 15px; text-align: justify; line-height: 1.6; }
</style>
</head>
<body>
  <div class="login-card">
    <h2>ورود امن</h2>
    ${secretNotConfigured ? `<div class="warn"><b>هشدار امنیتی:</b> رمز مستر (RECOVERY_SECRET) هنوز در Cloudflare تنظیم نشده است. ابتدا دستور <code>npx wrangler secret put RECOVERY_SECRET</code> را در ترمینال اجرا کنید.</div>` : ''}
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="رمز عبور مستر..." required autofocus ${secretNotConfigured ? 'disabled' : ''}>
      <button type="submit" ${secretNotConfigured ? 'disabled' : ''}>تأیید و ورود</button>
    </form>
  </div>
</body>
</html>`;
}
__name(renderLoginPage, "renderLoginPage");

// Render Main Dashboard Page
function renderPage(users) {
  const rows = users.map(
    (u) => `
      <tr>
        <td>${escapeHtml(u.display_name || "\u2014")}</td>
        <td><code>${escapeHtml(u.username)}</code></td>
        <td><span class="role">${escapeHtml(u.role)}</span></td>
        <td>
          <button class="reset" data-id="${u.id}" data-name="${escapeHtml(u.username)}">
            بازنشانی رمز
          </button>
        </td>
      </tr>`
  ).join("");
  
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>داشبورد بازیابی رمز</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Tahoma, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { color: #94a3b8; margin: 0; font-size: 13px; }
  a.logout { color: #f87171; text-decoration: none; font-size: 14px; border: 1px solid #f87171; padding: 6px 12px; border-radius: 6px; }
  a.logout:hover { background: #f8717122; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: right; padding: 10px 14px; border-bottom: 1px solid #334155; font-size: 14px; }
  th { background: #0b1220; color: #cbd5e1; font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  code { background: #0b1220; padding: 2px 6px; border-radius: 6px; color: #7dd3fc; }
  .role { font-size: 12px; color: #94a3b8; }
  button.reset { background: #dc2626; color: #fff; border: none; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px; }
  button.reset:hover { background: #b91c1c; }
  button.reset:disabled { opacity: .5; cursor: default; }
  #toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #16a34a; color: #fff; padding: 10px 18px; border-radius: 10px; display: none; }
  #toast.err { background: #dc2626; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>داشبورد اضطراری بازیابی رمز</h1>
      <p class="sub">بازنشانی رمز هر کاربر به «12345678».</p>
    </div>
    <a href="/logout" class="logout">خروج</a>
  </div>
  <div class="card">
    <table>
      <thead>
        <tr><th>نام نمایشی</th><th>نام کاربری</th><th>نقش</th><th>عملیات</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="4">کاربری یافت نشد.</td></tr>'}</tbody>
    </table>
  </div>
  <div id="toast"></div>
<script>
  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = isErr ? 'err' : '';
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3000);
  }
  document.querySelectorAll('button.reset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      if (!confirm('رمز عبور «' + name + '» به «12345678» بازنشانی شود؟')) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: Number(id) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'خطا');
        toast('رمز «' + name + '» بازنشانی شد.');
      } catch (e) {
        toast(e.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  });
</script>
</body>
</html>`;
}
__name(renderPage, "renderPage");

var recovery_worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 1. Check if the environment secret is configured
    if (!env.RECOVERY_SECRET) {
      if (url.pathname === "/") {
        return new Response(renderLoginPage("", true), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response("Secret not configured", { status: 500 });
    }

    // 2. Authentication Logic (Cookie Check)
    const cookies = parseCookies(request);
    const isAuthenticated = cookies["RecoverySession"] === env.RECOVERY_SECRET;

    // 3. Handle Login Submission
    if (request.method === "POST" && url.pathname === "/login") {
      const formData = await request.formData();
      const password = formData.get("password");
      
      if (password === env.RECOVERY_SECRET) {
        // Login successful: Set secure cookie and redirect to dashboard
        return new Response(null, {
          status: 302,
          headers: {
            "Location": "/",
            "Set-Cookie": `RecoverySession=${env.RECOVERY_SECRET}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600` // 1 hour session
          }
        });
      } else {
        // Login failed
        return new Response(renderLoginPage("رمز عبور اشتباه است."), { 
          status: 401, 
          headers: { "content-type": "text/html; charset=utf-8" } 
        });
      }
    }

    // 4. Handle Logout
    if (request.method === "GET" && url.pathname === "/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `RecoverySession=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` // Clear cookie
        }
      });
    }

    // --- PROTECTED ROUTES BELOW ---
    // If not authenticated, force them to the login page or return 401
    if (!isAuthenticated) {
      if (request.method === "GET" && url.pathname === "/") {
        return new Response(renderLoginPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return json({ error: "Unauthorized" }, 401);
    }

    // 5. Protected DB Check
    if (!env.DB) {
      return new Response('D1 binding "DB" is not configured.', { status: 500 });
    }

    // 6. Reset Password API
    if (request.method === "POST" && url.pathname === "/api/reset") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
      const id = Number(body.id);
      if (!Number.isInteger(id)) return json({ error: "Invalid user id" }, 400);
      
      const user = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(id).first();
      if (!user) return json({ error: "User not found" }, 404);
      
      const password_hash = await hashPassword(DEFAULT_PASSWORD);
      await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(password_hash, id).run();
      
      return json({ ok: true, id, username: user.username });
    }

    // 7. Render Dashboard User List
    if (request.method === "GET" && url.pathname === "/") {
      const { results } = await env.DB.prepare(
        "SELECT id, username, display_name, role FROM users ORDER BY role, username"
      ).all();
      return new Response(renderPage(results ?? []), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }

    return new Response("Method not allowed", { status: 405 });
  }
};
export {
  recovery_worker_default as default
};