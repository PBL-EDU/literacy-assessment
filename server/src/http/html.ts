export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function adminPage(title: string, body: string, username = ""): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · 素养教师工作台</title>
  <style>
    :root{--ink:#1f2933;--muted:#6b7280;--line:#d9e2e8;--bg:#eef3f4;--accent:#0f766e;--paper:#fff}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);font-family:"Microsoft YaHei","Segoe UI",sans-serif;color:var(--ink)}
    header{background:var(--paper);border-bottom:1px solid var(--line);padding:14px 24px;display:flex;justify-content:space-between;align-items:center}
    header b{font-size:16px} header span{color:var(--muted);font-size:12px}
    main{max-width:980px;margin:28px auto;padding:0 20px}
    .card{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:20px 22px;margin-bottom:16px}
    h1{font-size:22px;margin:0 0 16px} h2{font-size:16px;margin:0 0 10px}
    p,li{font-size:14px;line-height:1.7;color:#374151}
    a{color:var(--accent)} label{display:block;font-size:13px;font-weight:700;margin:12px 0 4px}
    input,button{font:inherit} input[type=text],input[type=password],input[type=number]{width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:6px}
    button{border:0;background:var(--accent);color:#fff;border-radius:6px;padding:9px 14px;font-weight:700;cursor:pointer}
    .muted{color:var(--muted);font-size:12px}.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;padding:9px 11px;border-radius:6px;margin-bottom:12px}
    .ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;padding:9px 11px;border-radius:6px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:13px} th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line)}
    th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  </style>
</head>
<body>
  <header><b>素养教师工作台 · 组织后台</b><span>${username ? escapeHtml(username) : "未登录"}</span></header>
  <main>${body}</main>
</body>
</html>`;
}
