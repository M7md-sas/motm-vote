/* أدوات مشتركة بين صفحة التصويت ولوحة الإدارة */

const CFG = window.MOTM_CFG;

/* ---------- هوية المصوّت عند تفعيل التسجيل ----------
   بلا مكتبة خارجية: نُحوّل إلى Google عبر Supabase، ونلتقط الرمز من عنوان
   الصفحة عند العودة. لا يعتمد على تخزين المتصفح، فيعمل في التصفّح الخاص. */
let AUTH_TOKEN = null;
let AUTH_ERROR = null;

function loadSession() {
  const h = location.hash || "";

  if (h.length > 1) {
    const p = new URLSearchParams(h.slice(1));

    /* رفض المستخدم للأذونات أو فشل التحويل يرجع هنا، وتركه بلا تفسير يحيّره */
    const err = p.get("error_description") || p.get("error");
    if (err) {
      AUTH_ERROR = /access_denied|denied/i.test(err)
        ? "أُلغي تسجيل الدخول. لن تقدر تصوّت في هذه المباراة قبل التسجيل."
        : "تعذّر تسجيل الدخول. حاول مرة أخرى.";
      history.replaceState({}, "", location.pathname + location.search);
      return;
    }

    const tok = p.get("access_token");
    if (tok) {
      AUTH_TOKEN = tok;
      try { sessionStorage.setItem("motm_tok", tok); } catch (e) { /* تجاهل */ }
      history.replaceState({}, "", location.pathname + location.search);
      return;
    }
  }

  try { AUTH_TOKEN = sessionStorage.getItem("motm_tok"); } catch (e) { /* تجاهل */ }
}

function signInWithGoogle() {
  const back = location.origin + location.pathname + location.search;
  location.href = CFG.url + "/auth/v1/authorize?provider=google&redirect_to=" +
                  encodeURIComponent(back);
}

function signOut() {
  AUTH_TOKEN = null;
  try { sessionStorage.removeItem("motm_tok"); } catch (e) { /* تجاهل */ }
}

/* ---------- نداء دوال قاعدة البيانات ---------- */
async function rpc(fn, args) {
  const res = await fetch(CFG.url + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": CFG.key,
      "Authorization": "Bearer " + (AUTH_TOKEN || CFG.key)
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

/* ---------- معرّف الجهاز ----------
   يُحفظ في ثلاثة مخازن، ويُقرأ من أيّها نجا. سفاري في التصفّح الخاص يرفض
   الكتابة في localStorage، وكان ذلك يولّد معرّفاً جديداً كل تحديث بلا أثر ظاهر. */
const DEV_KEY = "motm_device";

function readCookie(name) {
  try {
    const hit = document.cookie.split("; ").filter(c => c.indexOf(name + "=") === 0)[0];
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
  } catch (e) { return null; }
}

function writeCookie(name, value) {
  try {
    document.cookie = name + "=" + encodeURIComponent(value) +
      ";path=/;max-age=31536000;samesite=lax" +
      (location.protocol === "https:" ? ";secure" : "");
  } catch (e) { /* تجاهل */ }
}

function idbGet() {
  return new Promise(resolve => {
    try {
      const rq = indexedDB.open("motm", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
      rq.onerror = () => resolve(null);
      rq.onsuccess = () => {
        try {
          const db = rq.result;
          const g = db.transaction("kv", "readonly").objectStore("kv").get(DEV_KEY);
          g.onsuccess = () => resolve(g.result || null);
          g.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      };
    } catch (e) { resolve(null); }
  });
}

function idbPut(value) {
  return new Promise(resolve => {
    try {
      const rq = indexedDB.open("motm", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
      rq.onerror = () => resolve();
      rq.onsuccess = () => {
        try {
          rq.result.transaction("kv", "readwrite").objectStore("kv").put(value, DEV_KEY);
        } catch (e) { /* تجاهل */ }
        resolve();
      };
    } catch (e) { resolve(); }
  });
}

async function deviceId() {
  let id = null;
  try { id = localStorage.getItem(DEV_KEY); } catch (e) { /* تخزين محجوب */ }
  if (!id) id = readCookie(DEV_KEY);
  if (!id) id = await idbGet();

  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID()
                            : Date.now().toString(36) + Math.random().toString(36).slice(2));
  }

  /* يُعاد نشره في كل مخزن، فلو ضاع أحدها بقي الباقي */
  try { localStorage.setItem(DEV_KEY, id); } catch (e) { /* تجاهل */ }
  writeCookie(DEV_KEY, id);
  idbPut(id);
  return id;
}

/* ---------- بصمة العتاد ----------
   إشارات العتاد وحدها، بلا userAgent ولا canvas — فتتطابق البصمة بين متصفحات
   الجهاز الواحد، وينكسر الالتفاف بفتح متصفح ثانٍ. */
async function deviceSig() {
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* تجاهل */ }

  const raw = [
    Math.max(screen.width, screen.height) + "x" + Math.min(screen.width, screen.height),
    screen.colorDepth,
    window.devicePixelRatio || 1,
    tz,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.deviceMemory || 0,
    navigator.maxTouchPoints || 0,
    (navigator.platform || "")
  ].join("|");

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
/* الأرقام تُعرض بالصيغة العربية الأصلية 0123456789 لا الهندية ٠١٢٣٤٥٦٧٨٩ */
function arNum(n) {
  return String(n);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn",
    { day: "numeric", month: "long", year: "numeric" });
}

function fmtClock(sec) {
  if (sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}

/* ---------- فانلة اللاعب ---------- */
const KIT_DEFAULT = "#9E9E9E";

/* سطوع اللون حسب معيار WCAG */
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || KIT_DEFAULT).trim());
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
}

/* رقم أبيض على الفانلات الغامقة وأسود على الفاتحة، ما لم يُفرَض لون يدوياً.
   العتبة 0.179 هي نقطة تعادل التباين بين الأبيض والأسود. */
function numberInk(kit, forced) {
  if (forced === "white" || forced === "black") return forced === "white" ? "#ffffff" : "#111111";
  return luminance(kit) > 0.179 ? "#111111" : "#ffffff";
}

/* svg فانلة بلون الفريق ورقم اللاعب مطبوع عليها */
function kitSVG(number, kit, forcedInk, size) {
  const fill = kit || KIT_DEFAULT;
  const ink = numberInk(fill, forcedInk);
  const has = number !== null && number !== undefined && number !== "";
  const light = luminance(fill) > 0.6;   /* الفانلة شديدة الفتحة تحتاج إطاراً أظهر */
  const px = size || 58;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", px);
  svg.setAttribute("height", px);
  svg.setAttribute("aria-hidden", "true");
  svg.style.flex = "none";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M17 6 L10 10 L7 18 L13 21 L13 42 L35 42 L35 21 L41 18 L38 10 L31 6 C31 11 17 11 17 6 Z");
  path.setAttribute("fill", fill);
  path.setAttribute("stroke", light ? "#9aa0a6" : "#00000026");
  path.setAttribute("stroke-width", light ? "2" : "1.5");
  svg.appendChild(path);

  if (has) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", "24");
    t.setAttribute("y", "35");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", String(number).length > 2 ? "14" : "18");
    t.setAttribute("font-weight", "700");
    t.setAttribute("fill", ink);
    t.setAttribute("font-family", "Segoe UI, Tahoma, system-ui, sans-serif");
    t.textContent = String(number);
    svg.appendChild(t);
  }
  return svg;
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
  if (!color) return;
  const root = document.documentElement;
  root.style.setProperty("--brand", color);

  /* درجة فاتحة مشتقّة من لون الهوية، حتى تبقى الخلفيات متناسقة مع أي لون يختاره الإداري */
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return;
  const n = parseInt(m[1], 16);
  const mix = c => Math.round(c * 0.13 + 255 * 0.87);
  const soft = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)]
    .map(c => c.toString(16).padStart(2, "0")).join("");
  root.style.setProperty("--brand-soft", "#" + soft);
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
