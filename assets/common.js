/* أدوات مشتركة بين صفحة التصويت ولوحة الإدارة */

const CFG = window.MOTM_CFG;

/* ---------- نداء دوال قاعدة البيانات ---------- */
async function rpc(fn, args) {
  const res = await fetch(CFG.url + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": CFG.key,
      "Authorization": "Bearer " + CFG.key
    },
    body: JSON.stringify(args || {})
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch (e) { /* تجاهل */ }
    const err = new Error(detail || ("خطأ في الاتصال (" + res.status + ")"));
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ---------- بصمة الجهاز ---------- */
function deviceId() {
  let id = null;
  try { id = localStorage.getItem("motm_device"); } catch (e) { /* تخزين محجوب */ }
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID()
                            : Date.now().toString(36) + Math.random().toString(36).slice(2));
    try { localStorage.setItem("motm_device", id); } catch (e) { /* تجاهل */ }
  }
  return id;
}

async function deviceSig() {
  const parts = [
    navigator.userAgent, navigator.language,
    screen.width + "x" + screen.height, screen.colorDepth,
    new Date().getTimezoneOffset(), navigator.hardwareConcurrency || 0
  ];
  try {
    const c = document.createElement("canvas");
    const x = c.getContext("2d");
    x.textBaseline = "top";
    x.font = "14px Arial";
    x.fillStyle = "#f60"; x.fillRect(0, 0, 60, 20);
    x.fillStyle = "#069"; x.fillText("motm", 2, 2);
    parts.push(c.toDataURL().slice(-64));
  } catch (e) { /* تجاهل */ }

  const raw = parts.join("|");
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    let h = 0;
    for (let i = 0; i < raw.length; i++) { h = (h * 31 + raw.charCodeAt(i)) | 0; }
    return "fb" + (h >>> 0).toString(16);
  }
}

/* ---------- أدوات عرض ---------- */
const AR = "٠١٢٣٤٥٦٧٨٩";
function arNum(n) {
  return String(n).replace(/[0-9]/g, d => AR[+d]);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("ar-SA-u-ca-gregory",
    { day: "numeric", month: "long", year: "numeric" });
}

function fmtClock(sec) {
  if (sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = sec % 60;
  return arNum(m) + ":" + arNum(String(s).padStart(2, "0"));
}

function el(tag, attrs, children) {
  const n = document.createElement(tag);
  for (const k in (attrs || {})) {
    if (k === "class") n.className = attrs[k];
    else if (k === "text") n.textContent = attrs[k];
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
  }
  (children || []).forEach(c => c && n.appendChild(c));
  return n;
}

function setBrand(color) {
  if (color) document.documentElement.style.setProperty("--brand", color);
}

function toast(msg, kind) {
  let t = document.getElementById("toast");
  if (!t) {
    t = el("div", { id: "toast", class: "toast" });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = "toast show" + (kind === "bad" ? " bad" : "");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = "toast"; }, 3200);
}
