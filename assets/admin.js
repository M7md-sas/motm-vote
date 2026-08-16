/* لوحة الإدارة — رابط سري واحد للبطولة كلها */

const app = document.getElementById("app");
let KEY = null, CFGS = null, TEAMS = [], tab = "matches", openMatch = null, openTeamId = null;
let refresher = null, clockTimer = null;

/* ===== تتبّع خطوات التنقّل حتى يرجع زر الرجوع خطوة واحدة فقط ===== */
function snapshot() {
  return { tab: tab, openMatch: openMatch, openTeam: openTeamId };
}

function navTo(next, replace) {
  if ("tab" in next)       tab = next.tab;
  if ("openMatch" in next) openMatch = next.openMatch;
  if ("openTeam" in next)  openTeamId = next.openTeam;
  const st = snapshot();
  if (replace) history.replaceState(st, ""); else history.pushState(st, "");
  render();
}

window.addEventListener("popstate", function (e) {
  const ov = document.querySelector(".qrfull");
  if (ov) { ov.remove(); return; }          /* الرجوع يقفل العرض المكبّر أولاً */
  const s = e.state || { tab: "matches", openMatch: null, openTeam: null };
  tab        = s.tab || "matches";
  openMatch  = s.openMatch || null;
  openTeamId = s.openTeam || null;
  render();
});

const STATE_LABEL = {
  not_started: ["لم يبدأ", "grey"],
  open:        ["مفتوح الآن", ""],
  closed:      ["مغلق", "grey"],
  cancelled:   ["ملغاة", "red"]
};

const publicBase = location.href.split("#")[0].replace(/admin\.html.*$/, "");
const linkFor = code => publicBase + "?m=" + code;

function stopRefresh() {
  if (refresher)  { clearInterval(refresher);  refresher = null; }
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

/* quiet = أعِد الرد كما هو حتى لو كان فيه خطأ، ليتصرّف المستدعي بنفسه */
async function call(fn, args, quiet) {
  let r;
  try {
    r = await rpc(fn, Object.assign({ p_key: KEY }, args || {}));
  } catch (e) {
    if (e.status === 403) {           /* المفتاح لم يعد صالحاً */
      try { localStorage.removeItem("motm_admin_key"); } catch (e2) { /* تجاهل */ }
      stopRefresh();
      askKey("المفتاح لم يعد صالحاً.");
      return null;
    }
    if (e.status === 404) {                 /* دالة غير موجودة في قاعدة البيانات */
      toast("هذه الميزة تحتاج تحديث قاعدة البيانات — راجع ملف التحديث", "bad");
      return null;
    }
    toast("تعذّر الاتصال بالخادم. تحقّق من الإنترنت.", "bad");
    return null;
  }
  if (!quiet && r && r.ok === false && r.error) { toast(r.error, "bad"); return null; }
  return r;
}

/* ============ البوابة ============ */
async function boot() {
  const q = new URLSearchParams(location.search).get("k");
  let saved = null;
  try { saved = localStorage.getItem("motm_admin_key"); } catch (e) { /* تجاهل */ }
  KEY = q || saved;
  if (!KEY) return askKey();
  try {
    CFGS = await rpc("admin_check", { p_key: KEY });
    try { localStorage.setItem("motm_admin_key", KEY); } catch (e) { /* تجاهل */ }
    setBrand(CFGS.brand_color);
    document.getElementById("tname").textContent = CFGS.tournament_name;
    navTo({}, true);
  } catch (e) {
    try { localStorage.removeItem("motm_admin_key"); } catch (e2) { /* تجاهل */ }
    askKey(e.status === 403 || e.status === 400 ? "المفتاح غير صحيح." : "تعذّر الاتصال بالخادم.");
  }
}

function askKey(msg) {
  app.innerHTML = "";
  const inp = el("input", { type: "password", placeholder: "الصق المفتاح السري", autocomplete: "off" });
  const go = el("button", { class: "btn", text: "دخول", onclick: () => {
    const v = inp.value.trim();
    if (!v) return;
    KEY = v;
    try { localStorage.setItem("motm_admin_key", v); } catch (e) { /* تجاهل */ }
    boot();
  }});
  inp.addEventListener("keydown", e => { if (e.key === "Enter") go.click(); });
  app.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "دخول الإدارة" }),
    msg ? el("p", { class: "badge red", text: msg }) : null,
    el("label", { text: "المفتاح السري" }), inp,
    el("div", { style: "height:12px" }), go
  ]));
}

/* ============ الهيكل ============ */
function render() {
  stopRefresh();
  app.innerHTML = "";
  const tabs = el("nav", { class: "tabs" });
  [["matches", "المباريات"], ["teams", "الفرق"], ["archive", "الأرشيف"], ["settings", "الإعدادات"]]
    .forEach(([id, label]) => {
      tabs.appendChild(el("button", {
        class: tab === id ? "on" : "", text: label,
        onclick: () => navTo({ tab: id, openMatch: null, openTeam: null })
      }));
    });
  app.appendChild(tabs);
  const body = el("div", { id: "body" });
  app.appendChild(body);

  if (tab === "matches")  return openMatch ? viewMatch(body) : viewMatches(body);
  if (tab === "teams")    return viewTeams(body);
  if (tab === "archive")  return viewArchive(body);
  if (tab === "settings") return viewSettings(body);
}

function loading(box) {
  box.innerHTML = "";
  box.appendChild(el("div", { class: "card center muted", text: "جارٍ التحميل…" }));
}

/* ============ المباريات ============ */
let showAllMatches = false;

async function viewMatches(box) {
  loading(box);
  if (!TEAMS.length) TEAMS = await call("admin_teams") || [];
  const list = await call("admin_matches", { p_all: showAllMatches }) || [];
  box.innerHTML = "";

  /* إنشاء مباراة */
  const home = el("select"), away = el("select");
  [home, away].forEach(s => {
    s.appendChild(el("option", { value: "", text: "— اختر الفريق —" }));
    TEAMS.forEach(t => s.appendChild(el("option", { value: t.id, text: t.name })));
  });
  const date = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });

  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "مباراة جديدة" }),
    TEAMS.length < 2
      ? el("p", { class: "muted", text: "سجّل فريقين على الأقل من تبويب «الفرق» أولاً." })
      : el("div", {}, [
          el("div", { class: "split" }, [
            el("div", {}, [el("label", { text: "الفريق الأول" }), home]),
            el("div", {}, [el("label", { text: "الفريق الثاني" }), away])
          ]),
          el("label", { text: "التاريخ" }), date,
          el("div", { style: "height:12px" }),
          el("button", { class: "btn", text: "أنشئ المباراة", onclick: async () => {
            if (!home.value || !away.value) return toast("اختر الفريقين", "bad");
            const r = await call("admin_create_match", {
              p_home: home.value, p_away: away.value, p_date: date.value, p_title: null });
            if (r && r.ok) { toast("أُنشئت المباراة"); navTo({ openMatch: r.id }); }
          }})
        ])
  ]));

  /* القائمة */
  const card = el("div", { class: "card" }, [
    el("h2", { text: showAllMatches ? "كل المباريات" : "مباريات اليوم" })
  ]);
  if (!list.length) {
    card.appendChild(el("p", { class: "muted", text: "لا توجد مباريات." }));
  }
  list.forEach(m => {
    const [label, cls] = STATE_LABEL[m.state] || ["—", "grey"];
    card.appendChild(el("div", { class: "item" }, [
      el("div", { class: "grow" }, [
        el("b", { text: m.title }),
        el("span", { text: fmtDate(m.match_date) + " · " + arNum(m.votes) + " صوت · رمز " + m.code })
      ]),
      el("span", { class: "badge " + cls, text: label }),
      el("button", { class: "icon", text: "‹", title: "فتح",
                     onclick: () => navTo({ openMatch: m.id }) })
    ]));
  });
  card.appendChild(el("button", {
    class: "btn ghost sm", text: showAllMatches ? "اعرض مباريات اليوم" : "اعرض كل المباريات",
    onclick: () => { showAllMatches = !showAllMatches; render(); }
  }));
  box.appendChild(card);
}

/* ============ تفاصيل مباراة ============ */
async function viewMatch(box) {
  loading(box);
  const d = await call("admin_match_detail", { p_match_id: openMatch });
  if (!d) return navTo({ openMatch: null }, true);
  box.innerHTML = "";
  const [label, cls] = STATE_LABEL[d.state] || ["—", "grey"];

  box.appendChild(el("button", { class: "btn ghost sm", text: "› رجوع للقائمة",
    onclick: () => history.back() }));

  /* الترويسة والرابط */
  const link = linkFor(d.code);
  box.appendChild(el("div", { class: "card" }, [
    el("div", { class: "item", style: "border:0;padding:0;margin-bottom:8px" }, [
      el("div", { class: "grow" }, [
        el("b", { text: d.title }),
        el("span", { text: fmtDate(d.match_date) +
                           (d.require_login ? " · تصويت موثّق بـ Google" : "") })
      ]),
      el("span", { class: "badge " + cls, text: label })
    ]),
    el("div", { class: "linkbox" }, [
      el("code", { text: link }),
      el("button", { class: "icon", text: "⧉", title: "نسخ", onclick: async () => {
        try { await navigator.clipboard.writeText(link); toast("نُسخ الرابط"); }
        catch (e) { toast("انسخ الرابط يدوياً", "bad"); }
      }})
    ]),
    el("a", { class: "btn ghost sm", target: "_blank", rel: "noopener",
      href: "https://wa.me/?text=" + encodeURIComponent(d.title + " — صوّت لأفضل لاعب:\n" + link),
      text: "مشاركة عبر واتساب" }),
    qrBox(link, d)
  ]));

  if (d.state === "not_started") nomineePicker(box, d);
  if (d.state === "open")        livePanel(box, d);
  if (d.state === "closed")      resultPanel(box, d);

  /* إجراءات خطرة */
  const danger = el("div", { class: "card" }, [ el("h2", { text: "إجراءات" }) ]);
  if (d.state === "not_started" || d.state === "open") {
    danger.appendChild(el("button", { class: "btn ghost sm", text: "إلغاء المباراة (بلا نتيجة)",
      onclick: async () => {
        if (!confirm("إلغاء المباراة نهائياً بلا إعلان نتيجة؟")) return;
        if (await call("admin_cancel_match", { p_match_id: d.id })) { toast("أُلغيت"); render(); }
      }}));
  }
  danger.appendChild(el("button", {
    class: d.total_votes ? "btn danger sm" : "btn ghost sm",
    text: d.total_votes ? "حذف المباراة بأصواتها" : "حذف المباراة",
    onclick: async () => {
      const msg = d.total_votes
        ? "حذف المباراة نهائياً مع " + arNum(d.total_votes) + " صوتاً مسجّلاً؟\nلا يمكن التراجع."
        : "حذف المباراة نهائياً؟";
      if (!confirm(msg)) return;
      if (d.total_votes && !confirm("تأكيد أخير: ستختفي النتيجة من رابط المباراة نهائياً.")) return;
      const r = await call("admin_delete_match", { p_match_id: d.id, p_force: true });
      if (r && r.ok) { toast("حُذفت المباراة"); navTo({ openMatch: null }, true); }
    }
  }));
  box.appendChild(danger);
}

/* ===== رمز QR لرابط المباراة ===== */
function qrBox(link, d) {
  const wrap = el("div", { class: "qrbox" });
  let svg;
  try {
    svg = QR.toSVG(link);
  } catch (e) {
    return null;                                  /* لا يظهر شيء إن تعذّر التوليد */
  }
  wrap.innerHTML = svg;
  wrap.firstChild.addEventListener("click", () => qrFullscreen(link, d.title));
  wrap.appendChild(el("p", { class: "muted", style: "font-size:13px;margin:0 0 8px",
    text: "وجّه الكاميرا على الرمز للدخول للتصويت" }));
  wrap.appendChild(el("div", { class: "row", style: "justify-content:center" }, [
    el("button", { class: "btn ghost sm", text: "تكبير للعرض",
      onclick: () => qrFullscreen(link, d.title) }),
    el("button", { class: "btn ghost sm", text: "حفظ صورة",
      onclick: () => qrDownload(link, d.code) })
  ]));
  return wrap;
}

function qrFullscreen(link, title) {
  const ov = el("div", { class: "qrfull" });
  const inner = el("div", { class: "center" });
  inner.innerHTML = QR.toSVG(link, { quiet: 2 });
  inner.appendChild(el("p", { style: "font-size:20px;font-weight:700;margin:14px 0 4px",
                              text: title }));
  inner.appendChild(el("p", { class: "muted", style: "font-size:14px;margin:0",
                              text: "صوّت لأفضل لاعب · المس الشاشة للإغلاق" }));
  ov.appendChild(inner);
  ov.addEventListener("click", () => history.back());
  document.body.appendChild(ov);
  /* خطوة تنقّل مستقلة: زر الرجوع يقفل العرض المكبّر ولا يخرج من المباراة */
  history.pushState(Object.assign(snapshot(), { qr: true }), "");
}

function qrDownload(link, code) {
  const blob = new Blob([QR.toSVG(link, { px: 1000 })], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = function () {
    const S = 1000;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#fff";
    cx.fillRect(0, 0, S, S);
    cx.drawImage(img, 0, 0, S, S);
    URL.revokeObjectURL(url);
    cv.toBlob(function (b) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "qr-" + code + ".png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast("حُفظت صورة الرمز");
    }, "image/png");
  };
  img.onerror = function () { URL.revokeObjectURL(url); toast("تعذّر حفظ الصورة", "bad"); };
  img.src = url;
}

/* اختيار المرشّحين — الرقم يُحدَّد لكل مباراة على حدة لأنه يتغيّر بين المباريات */
function nomineePicker(box, d) {
  /* قائمة مرتّبة تحمل رقم كل مرشّح في هذه المباراة تحديداً */
  const chosen = d.nominees.map(n => ({
    id: n.player_id, name: n.name, team: n.team,
    number: (n.shirt_number === null || n.shirt_number === undefined) ? "" : String(n.shirt_number)
  }));
  const at = id => chosen.map(c => c.id).indexOf(id);
  const chips = {};
  const picked = el("div");

  const card = el("div", { class: "card" }, [
    el("h2", { text: "اختر المرشّحين" }),
    el("p", { class: "muted", text: "اضغط على اللاعب لاختياره، ثم حدّد رقم قميصه في هذه المباراة. الرقم اختياري." })
  ]);

  function syncChips() {
    Object.keys(chips).forEach(id => {
      if (at(id) !== -1) chips[id].classList.add("on");
      else chips[id].classList.remove("on");
    });
  }

  function repaintPicked() {
    picked.innerHTML = "";
    picked.appendChild(el("h3", { style: "font-size:15px;margin:18px 0 8px",
      text: chosen.length ? "المرشّحون وأرقامهم (" + arNum(chosen.length) + ")"
                          : "المرشّحون وأرقامهم" }));

    if (!chosen.length) {
      picked.appendChild(el("p", { class: "muted", text: "لم تختر أحداً بعد." }));
      return;
    }

    chosen.forEach((c, i) => {
      const sel = el("select", { style: "width:110px;flex:none" });
      sel.appendChild(el("option", { value: "", text: "بلا رقم" }));
      for (let n = 1; n <= 99; n++) {
        sel.appendChild(el("option", { value: String(n), text: arNum(n) }));
      }
      sel.value = c.number;
      sel.addEventListener("change", () => { c.number = sel.value; });

      picked.appendChild(el("div", { class: "item" }, [
        el("div", { class: "grow" }, [
          el("b", { text: arNum(i + 1) + ". " + c.name }),
          el("span", { text: c.team })
        ]),
        sel,
        el("button", { class: "icon", text: "✕", title: "إزالة", onclick: () => {
          chosen.splice(i, 1); syncChips(); repaintPicked();
        }})
      ]));
    });
  }

  function makeChip(sq, p) {
    const chip = el("button", { class: "chip", type: "button", onclick: () => {
      const i = at(p.id);
      if (i !== -1) chosen.splice(i, 1);
      else if (chosen.length >= 5) return toast("الحد الأقصى خمسة مرشّحين", "bad");
      else chosen.push({ id: p.id, name: p.name, team: sq.team, number: "" });
      syncChips(); repaintPicked();
    }}, [
      el("span", { text: p.name }),
      el("span", { class: "n", text: p.shirt_number === null || p.shirt_number === undefined
                                     ? "" : arNum(p.shirt_number) })
    ]);
    chips[p.id] = chip;
    return chip;
  }

  d.squads.forEach(sq => {
    const head = el("div", { style: "display:flex;align-items:center;gap:8px;margin:14px 0 8px" });
    head.appendChild(kitSVG(null, sq.kit_color, sq.number_color, 24));
    head.appendChild(el("h3", { style: "font-size:15px;margin:0", text: sq.team }));
    card.appendChild(head);
    const wrap = el("div");
    sq.players.forEach(p => wrap.appendChild(makeChip(sq, p)));

    /* إضافة لاعب سريعة — بلا رقم، لأن الرقم يُحدَّد أدناه لهذه المباراة */
    const addBtn = el("button", { class: "chip", type: "button", text: "＋ لاعب جديد",
      onclick: async () => {
        const name = prompt("اسم اللاعب:");
        if (!name || !name.trim()) return;
        const r = await call("admin_save_player", {
          p_id: null, p_team_id: sq.team_id, p_name: name.trim(),
          p_number: null, p_active: true });
        if (!r || !r.ok) return;

        TEAMS = [];
        const np = { id: r.id, name: name.trim(), shirt_number: null };
        sq.players.push(np);
        wrap.insertBefore(makeChip(sq, np), addBtn);   /* بلا إعادة بناء تفقد اختياراتك */
        if (chosen.length < 5) chosen.push({ id: np.id, name: np.name, team: sq.team, number: "" });
        syncChips(); repaintPicked();
        toast("أُضيف اللاعب واختير");
      }});
    wrap.appendChild(addBtn);
    card.appendChild(wrap);
  });

  syncChips();
  repaintPicked();
  card.appendChild(picked);

  card.appendChild(el("button", { class: "btn ghost", style: "margin-top:14px",
    text: "احفظ المرشّحين", onclick: async () => {
      if (chosen.length < 2) return toast("اختر مرشّحَين على الأقل", "bad");
      const payload = chosen.map(c => ({
        player_id: c.id,
        shirt_number: c.number === "" ? null : parseInt(c.number, 10)
      }));
      if (await call("admin_set_nominees", {
        p_match_id: d.id, p_nominees: payload })) { toast("حُفظ"); render(); }
    }}));
  box.appendChild(card);

  /* الفتح */
  const mins = el("select");
  [["10", "10 دقائق"], ["5", "5 دقائق"], ["15", "15 دقيقة"], ["30", "30 دقيقة"], ["0", "بلا مؤقّت"]]
    .forEach(([v, t]) => mins.appendChild(el("option", { value: v, text: t })));

  const login = el("select");
  [["false", "مفتوح للجميع بلا تسجيل"], ["true", "يتطلّب تسجيل دخول Google"]]
    .forEach(([v, t]) => login.appendChild(el("option", { value: v, text: t })));
  login.value = String(!!(CFGS && CFGS.login_default));

  const hint = el("p", { class: "muted", style: "font-size:13px;margin:6px 0 0" });
  const paintHint = () => {
    hint.textContent = login.value === "true"
      ? "صوت واحد لكل حساب Google. أقوى منع للتكرار، لكن توقّع عدد مصوّتين أقل، ومن لا يملك حساباً لن يصوّت."
      : "بلا احتكاك وأكثر مشاركة. المنع يعتمد على الجهاز والشبكة، ومن يبدّل شبكته يقدر يصوّت مرتين.";
  };
  paintHint();
  login.addEventListener("change", paintHint);

  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "افتح التصويت" }),
    el("label", { text: "مدة التصويت" }), mins,
    el("label", { text: "طريقة التصويت" }), login, hint,
    el("div", { style: "height:14px" }),
    el("button", { class: "btn", text: "افتح التصويت الآن", onclick: async () => {
      if (d.nominees.length < 2) return toast("احفظ المرشّحين أولاً", "bad");
      if (await call("admin_open_voting", {
        p_match_id: d.id, p_minutes: parseInt(mins.value, 10),
        p_require_login: login.value === "true" })) { toast("فُتح التصويت"); render(); }
    }})
  ]));
}

/* اللوحة الحيّة أثناء التصويت */
function livePanel(box, d) {
  const card = el("div", { class: "card" }, [
    el("h2", { text: "العدّاد الحيّ" }),
    el("p", { class: "muted", text: "يتحدّث تلقائياً كل خمس ثوانٍ. لا يراه الجمهور." })
  ]);
  const total = el("p", { class: "center", style: "font-size:34px;font-weight:700;margin:6px 0",
                          text: arNum(d.total_votes) });
  const totalLbl = el("p", { class: "muted center", style: "margin:0", text: "إجمالي الأصوات" });
  const rows = el("div", { style: "margin-top:14px" });
  const blocks = el("div", { style: "margin-top:12px" });
  const timer = el("p", { class: "timer" });

  const BLOCK_LABEL = {
    PAIR_LIMIT:    "محاولة تصويت ثانٍ من نفس الجهاز والشبكة",
    ALREADY_VOTED: "محاولة تصويت ثانٍ من نفس الجهاز",
    DEVICE_LIMIT:  "تجاوز حد الجهاز",
    IP_LIMIT:      "تجاوز حد الشبكة",
    BAD_TOKEN:     "طلب بلا جلسة صحيحة"
  };

  const paintBlocks = data => {
    blocks.innerHTML = "";
    const b = data.blocks || {};
    const keys = Object.keys(b).filter(k => b[k] > 0);
    if (!keys.length) return;
    let sum = 0;
    keys.forEach(k => { sum += b[k]; });
    blocks.appendChild(el("p", { class: "badge amber",
      text: "محاولات مرفوضة: " + arNum(sum) }));
    keys.sort((x, y) => b[y] - b[x]).forEach(k => {
      blocks.appendChild(el("p", { class: "muted", style: "font-size:13px;margin:4px 0",
        text: "• " + (BLOCK_LABEL[k] || k) + " — " + arNum(b[k]) }));
    });
  };

  const paint = data => {
    total.textContent = arNum(data.total_votes);
    rows.innerHTML = "";
    const t = data.total_votes || 0;
    data.nominees.forEach(n => {
      const pct = t ? Math.round(n.votes * 1000 / t) / 10 : 0;
      const row = el("div", { class: "res", style: "display:flex;align-items:center;gap:10px" });
      row.appendChild(kitSVG(n.shirt_number, n.kit_color, n.number_color, 40));
      row.appendChild(el("div", { style: "flex:1;min-width:0" }, [
        el("div", { class: "line" }, [
          el("b", { text: n.name }),
          el("span", { class: "pct", text: arNum(n.votes) + " (" + arNum(pct) + "٪)" })
        ]),
        el("div", { class: "bar" }, [ el("i", { style: "width:" + pct + "%" }) ])
      ]));
      rows.appendChild(row);
    });
  };
  paint(d);
  paintBlocks(d);

  card.appendChild(total); card.appendChild(totalLbl); card.appendChild(rows);
  card.appendChild(blocks);
  if (d.closes_at) card.appendChild(timer);

  card.appendChild(el("div", { class: "row", style: "margin-top:14px" }, [
    el("button", { class: "btn ghost", text: "＋ ٥ دقائق", onclick: async () => {
      if (await call("admin_extend_voting", { p_match_id: d.id, p_minutes: 5 })) {
        toast("مُدّد ٥ دقائق"); render();
      }
    }}),
    el("button", { class: "btn", text: "أغلق التصويت الآن", onclick: async () => {
      if (!confirm("إغلاق التصويت وإعلان النتيجة؟ لا يمكن التراجع.")) return;
      if (await call("admin_close_voting", { p_match_id: d.id })) { toast("أُغلق التصويت"); render(); }
    }})
  ]));
  box.appendChild(card);

  const end = d.closes_at ? new Date(d.closes_at).getTime() : null;
  const paintClock = () => {
    if (!end) return true;
    const left = Math.round((end - Date.now()) / 1000);
    timer.textContent = left > 0 ? "يُغلق تلقائياً خلال " + fmtClock(left) : "انتهى الوقت…";
    return left > 0;
  };
  paintClock();
  clockTimer = setInterval(paintClock, 1000);

  refresher = setInterval(async () => {
    if (!paintClock()) { stopRefresh(); return render(); }
    const fresh = await call("admin_match_detail", { p_match_id: d.id });
    if (!fresh) return;
    if (fresh.state !== "open") { stopRefresh(); return render(); }
    paint(fresh);
    paintBlocks(fresh);
  }, 5000);
}

/* ===== نص النتيجة الجاهز للمشاركة مع اللجنة ===== */
function resultText(d) {
  const r = d.results;
  const winners = r.committee_winner_id ? [r.committee_winner_id] : (r.winner_player_ids || []);
  const named = p => p.name + (p.shirt_number === null || p.shirt_number === undefined
                               ? "" : " (" + arNum(p.shirt_number) + ")");
  const lines = ["🏆 أفضل لاعب — " + d.title];

  if (r.total_voters === 0) {
    lines.push("لم يُسجَّل أي صوت في هذه المباراة.");
  } else {
    const win = r.nominees.filter(n => winners.indexOf(n.player_id) !== -1).map(named);
    if (win.length) lines.push("الفائز: " + win.join(" و "));
    lines.push("");
    r.nominees.forEach(n => lines.push("• " + n.name + " — " + arNum(n.percent) + "٪"));
    lines.push("");
    lines.push("إجمالي المصوّتين: " + arNum(r.total_voters));
  }

  if (r.tie_pending) lines.push("تعادل — بانتظار قرار اللجنة");
  else if (r.committee_winner_id) lines.push("حُسم التعادل بقرار اللجنة");

  lines.push("");
  lines.push(CFGS.tournament_name);
  lines.push(linkFor(d.code));
  return lines.join("\n");
}

async function shareResult(d) {
  const text = resultText(d);

  /* 1) قائمة مشاركة الجوّال — المسار الأساسي */
  if (navigator.share) {
    try {
      await navigator.share({ title: "نتيجة أفضل لاعب", text: text });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;   /* أغلق القائمة بنفسه */
    }
  }

  /* 2) النسخ الحديث */
  try {
    await navigator.clipboard.writeText(text);
    toast("نُسخت النتيجة — الصقها في محادثة اللجنة");
    return;
  } catch (e) { /* نكمل للطريقة الأقدم */ }

  /* 3) النسخ بالطريقة القديمة، تشتغل بلا أذونات */
  try {
    const ta = el("textarea", { style: "position:fixed;inset-inline-start:-9999px;top:0" });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const done = document.execCommand("copy");
    ta.remove();
    if (done) { toast("نُسخت النتيجة — الصقها في محادثة اللجنة"); return; }
  } catch (e) { /* نكمل للعرض اليدوي */ }

  /* 4) آخر حل: نعرض النص ليُنسخ يدوياً */
  showCopyBox(text);
}

function showCopyBox(text) {
  const ov = el("div", { class: "qrfull" });
  const ta = el("textarea", { style: "width:min(92vw,520px);height:46vh;font-size:15px" });
  ta.value = text;

  const inner = el("div", { class: "center" }, [
    el("p", { style: "font-weight:700;margin:0 0 10px", text: "انسخ النتيجة وأرسلها للجنة" }),
    ta,
    el("button", { class: "btn", style: "margin-top:12px", text: "تم",
      onclick: () => ov.remove() })
  ]);

  ov.appendChild(inner);
  ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  ta.focus();
  ta.select();
}

function shareButton(d) {
  return el("button", { class: "btn", style: "margin-top:14px",
    text: "شارك النتيجة مع اللجنة", onclick: () => shareResult(d) });
}

/* النتيجة بعد الإغلاق */
function resultPanel(box, d) {
  const r = d.results;
  const winners = r.committee_winner_id ? [r.committee_winner_id] : (r.winner_player_ids || []);
  const card = el("div", { class: "card" }, [ el("h2", { text: "النتيجة" }) ]);

  if (r.total_voters === 0) {
    card.appendChild(el("p", { class: "muted", text: "لم يُسجَّل أي صوت." }));
    card.appendChild(shareButton(d));
    box.appendChild(card);
    return;
  }

  r.nominees.forEach(n => {
    const win = winners.indexOf(n.player_id) !== -1;
    const row = el("div", { class: "res" + (win ? " win" : ""),
                            style: "display:flex;align-items:center;gap:10px" });
    row.appendChild(kitSVG(n.shirt_number, n.kit_color, n.number_color, 40));
    row.appendChild(el("div", { style: "flex:1;min-width:0" }, [
      el("div", { class: "line" }, [
        el("b", { text: n.name }),
        el("span", { class: "pct", text: arNum(n.percent) + "٪" })
      ]),
      el("div", { class: "bar" }, [ el("i", { style: "width:" + n.percent + "%" }) ]),
      el("div", { class: "muted", style: "font-size:13px", text: arNum(n.votes) + " صوت" })
    ]));
    card.appendChild(row);
  });
  card.appendChild(el("p", { class: "muted center",
    text: "إجمالي المصوّتين: " + arNum(r.total_voters) }));

  if (r.tie_pending) {
    const box2 = el("div", { style: "margin-top:10px" }, [
      el("p", { class: "badge amber", text: "تعادل — القرار لك" }),
      el("p", { class: "muted", text: "اختر الفائز، وسيظهر للجمهور أن الحسم كان بقرار اللجنة." })
    ]);
    r.nominees.filter(n => (r.winner_player_ids || []).indexOf(n.player_id) !== -1).forEach(n => {
      box2.appendChild(el("button", { class: "chip", type: "button", text: n.name,
        onclick: async () => {
          if (!confirm("إعلان " + n.name + " فائزاً؟")) return;
          if (await call("admin_resolve_tie", {
            p_match_id: d.id, p_player_id: n.player_id })) { toast("أُعلن الفائز"); render(); }
        }}));
    });
    card.appendChild(box2);
  } else if (r.committee_winner_id) {
    card.appendChild(el("p", { class: "muted center", text: "حُسم التعادل بقرار اللجنة." }));
  }

  card.appendChild(shareButton(d));
  box.appendChild(card);
}

/* ============ ألوان الفرق ============ */
const KITS = [
  ["#D32F2F", "أحمر"],   ["#7B1E3A", "عنابي"],  ["#EF6C00", "برتقالي"], ["#C9A227", "ذهبي"],
  ["#FBC02D", "أصفر"],   ["#2E7D32", "أخضر"],   ["#00897B", "تركوازي"], ["#29B6F6", "سماوي"],
  ["#1565C0", "أزرق"],   ["#14213D", "كحلي"],   ["#6A1B9A", "بنفسجي"],  ["#E91E63", "وردي"],
  ["#5D4037", "بني"],    ["#111111", "أسود"],   ["#9E9E9E", "رمادي"],   ["#FFFFFF", "أبيض"]
];

/* لوحة الاختيار: اللون المأخوذ لفريق آخر يظهر معطّلاً باسم صاحبه */
function kitPalette(current, forcedInk, takenBy, onPick) {
  const wrap = el("div");
  const state = { kit: current || null, ink: forcedInk || null };

  const grid = el("div", { style: "display:grid;grid-template-columns:repeat(8,1fr);gap:8px" });
  KITS.forEach(([hex, name]) => {
    const owner = takenBy[hex.toLowerCase()];
    const cell = el("button", {
      type: "button", title: owner ? name + " — مأخوذ لفريق " + owner : name,
      style: "aspect-ratio:1;border-radius:10px;cursor:pointer;padding:0;background:" + hex +
             ";border:" + (hex === "#FFFFFF" ? "1px solid #b4b2a9" : "1px solid #00000022") +
             (owner ? ";opacity:.28;cursor:not-allowed" : ""),
      onclick: () => {
        if (owner) return toast("هذا اللون مأخوذ لفريق " + owner, "bad");
        state.kit = hex;
        paint();
        onPick(state);
      }
    });
    cell._hex = hex;
    grid.appendChild(cell);
  });
  wrap.appendChild(grid);

  const inkRow = el("div", { style: "display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap" });
  inkRow.appendChild(el("span", { class: "muted", style: "font-size:14px", text: "لون الرقم" }));
  const inkBtns = {};
  [[null, "تلقائي"], ["white", "أبيض"], ["black", "أسود"]].forEach(([v, label]) => {
    const b = el("button", { class: "chip", type: "button", text: label, style: "margin:0",
      onclick: () => { state.ink = v; paint(); onPick(state); } });
    inkBtns[String(v)] = b;
    inkRow.appendChild(b);
  });
  wrap.appendChild(inkRow);

  const preview = el("div", { style: "display:flex;align-items:center;gap:12px;margin-top:14px" });
  wrap.appendChild(preview);

  function paint() {
    Array.prototype.forEach.call(grid.children, c => {
      c.style.boxShadow = (state.kit && c._hex === state.kit)
        ? "0 0 0 3px var(--card), 0 0 0 5px var(--brand)" : "none";
    });
    Object.keys(inkBtns).forEach(k => {
      if (k === String(state.ink)) inkBtns[k].classList.add("on");
      else inkBtns[k].classList.remove("on");
    });
    preview.innerHTML = "";
    preview.appendChild(kitSVG(9, state.kit, state.ink, 52));
    preview.appendChild(el("span", { class: "muted", style: "font-size:14px",
      text: state.kit ? "هكذا يظهر لاعبو الفريق" : "اختر لوناً" }));
  }
  paint();
  return wrap;
}

/* ============ الفرق واللاعبون ============ */
async function deleteTeam(t) {
  if (!confirm("حذف «" + t.name + "» و" + arNum(t.players) + " لاعباً؟")) return;

  let r = await call("admin_delete_team", { p_id: t.id, p_force: false }, true);
  if (!r) return;

  if (r.ok === false && r.needs_force) {
    if (!confirm("الفريق مرتبط بـ " + arNum(r.matches) + " مباراة.\n" +
                 "الحذف يمسح تلك المباريات وأصواتها نهائياً. أتابع؟")) return;
    r = await call("admin_delete_team", { p_id: t.id, p_force: true }, true);
    if (!r) return;
  }

  if (r.ok) {
    toast("حُذف الفريق" + (r.deleted_matches ? " و" + arNum(r.deleted_matches) + " مباراة" : ""));
    TEAMS = [];
    if (openTeamId === t.id) return navTo({ openTeam: null }, true);
    render();
  } else if (r.error) toast(r.error, "bad");
}

async function deletePlayer(p) {
  if (!confirm("حذف «" + p.name + "»؟")) return;

  let r = await call("admin_delete_player", { p_id: p.id, p_force: false }, true);
  if (!r) return;

  if (r.ok && r.archived) {
    if (confirm(r.note + "\n\nتبي تحذفه نهائياً مع سجل ترشيحاته؟")) {
      r = await call("admin_delete_player", { p_id: p.id, p_force: true }, true);
      if (!r) return;
    }
  }

  if (r.ok) { toast(r.archived ? "أُخفي اللاعب" : "حُذف اللاعب"); TEAMS = []; render(); }
  else if (r.error) toast(r.error, "bad");
}

async function viewTeams(box) {
  loading(box);
  TEAMS = await call("admin_teams") || [];
  box.innerHTML = "";

  if (openTeamId) {
    const t = TEAMS.filter(x => x.id === openTeamId)[0];
    if (t) return viewSquad(box, t);
    openTeamId = null;                          /* الفريق حُذف من جهاز آخر */
  }

  /* الألوان المحجوزة لبقية الفرق */
  const takenBy = (exceptId) => {
    const map = {};
    TEAMS.forEach(t => {
      if (t.kit_color && t.id !== exceptId) map[t.kit_color.toLowerCase()] = t.name;
    });
    return map;
  };

  const name = el("input", { type: "text", placeholder: "اسم الفريق" });
  const picked = { kit: null, ink: null };
  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "إضافة فريق" }),
    name,
    el("label", { text: "لون الفانلة" }),
    kitPalette(null, null, takenBy(null), s => { picked.kit = s.kit; picked.ink = s.ink; }),
    el("div", { style: "height:14px" }),
    el("button", { class: "btn", text: "أضف الفريق", onclick: async () => {
      if (!name.value.trim()) return toast("اكتب اسم الفريق", "bad");
      if (!picked.kit) return toast("اختر لون الفانلة", "bad");
      if (await call("admin_save_team", { p_id: null, p_name: name.value.trim(),
                                          p_kit_color: picked.kit, p_number_color: picked.ink })) {
        toast("أُضيف الفريق"); render();
      }
    }})
  ]));

  const card = el("div", { class: "card" }, [ el("h2", { text: "الفرق المسجّلة" }) ]);
  if (!TEAMS.length) card.appendChild(el("p", { class: "muted", text: "لا توجد فرق بعد." }));
  TEAMS.forEach(t => {
    const row = el("div", { class: "item" });
    row.appendChild(kitSVG(null, t.kit_color, t.number_color, 30));
    row.appendChild(el("div", { class: "grow" }, [
      el("b", { text: t.name }),
      el("span", { text: arNum(t.players) + " لاعباً" + (t.kit_color ? "" : " · بلا لون") })
    ]));
    row.appendChild(el("button", { class: "icon", text: "✎", title: "تعديل",
                                   onclick: () => editTeam(t, takenBy(t.id)) }));
    row.appendChild(el("button", { class: "icon", text: "🗑", title: "حذف",
                                   onclick: () => deleteTeam(t) }));
    row.appendChild(el("button", { class: "icon", text: "‹", title: "اللاعبون",
                                   onclick: () => navTo({ openTeam: t.id }) }));
    card.appendChild(row);
  });
  box.appendChild(card);
}

/* تعديل اسم الفريق ولونه */
function editTeam(t, taken) {
  const ov = el("div", { class: "qrfull", style: "align-items:start;overflow:auto;padding:24px 16px" });
  const name = el("input", { type: "text", value: t.name });
  const picked = { kit: t.kit_color || null, ink: t.number_color || null };

  const panel = el("div", { style: "width:min(92vw,520px);margin:0 auto" }, [
    el("h2", { style: "margin:0 0 12px", text: "تعديل الفريق" }),
    el("label", { text: "الاسم" }), name,
    el("label", { text: "لون الفانلة" }),
    kitPalette(picked.kit, picked.ink, taken, s => { picked.kit = s.kit; picked.ink = s.ink; }),
    el("div", { style: "height:16px" }),
    el("button", { class: "btn", text: "احفظ", onclick: async () => {
      if (!name.value.trim()) return toast("اكتب اسم الفريق", "bad");
      const r = await call("admin_save_team", { p_id: t.id, p_name: name.value.trim(),
                                                p_kit_color: picked.kit, p_number_color: picked.ink });
      if (r && r.ok) { ov.remove(); toast("حُفظ"); TEAMS = []; render(); }
    }}),
    el("div", { style: "height:8px" }),
    el("button", { class: "btn ghost", text: "إلغاء", onclick: () => ov.remove() })
  ]);

  ov.appendChild(panel);
  document.body.appendChild(ov);
}

async function viewSquad(box, team) {
  const players = await call("admin_players", { p_team_id: team.id }) || [];
  box.innerHTML = "";
  box.appendChild(el("button", { class: "btn ghost sm", text: "› رجوع للفرق",
    onclick: () => history.back() }));

  const pname = el("input", { type: "text", placeholder: "اسم اللاعب" });
  const pnum = el("input", { type: "number", min: "0", max: "999", placeholder: "الرقم (اختياري)" });
  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "لاعبو " + team.name }),
    el("div", { class: "split" }, [
      el("div", {}, [el("label", { text: "الاسم" }), pname]),
      el("div", {}, [el("label", { text: "رقم القميص" }), pnum])
    ]),
    el("div", { style: "height:12px" }),
    el("button", { class: "btn", text: "أضف اللاعب", onclick: async () => {
      if (!pname.value.trim()) return toast("اكتب اسم اللاعب", "bad");
      const r = await call("admin_save_player", {
        p_id: null, p_team_id: team.id, p_name: pname.value.trim(),
        p_number: pnum.value ? parseInt(pnum.value, 10) : null, p_active: true });
      if (r && r.ok) { toast("أُضيف اللاعب"); render(); }
    }})
  ]));

  const bulk = el("textarea", {
    placeholder: "سطر لكل لاعب، مثلاً:\n١ عبدالله الحارس\n7 سعد المطيري\nفهد القحطاني - 10\nتركي العتيبي" });
  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "لصق جماعي" }),
    el("p", { class: "muted", text: "الصق قائمة الأسماء دفعة واحدة. الرقم يُقرأ من أول السطر أو آخره، وتُقبل الأرقام العربية." }),
    bulk, el("div", { style: "height:12px" }),
    el("button", { class: "btn ghost", text: "احفظ القائمة", onclick: async () => {
      if (!bulk.value.trim()) return;
      const r = await call("admin_bulk_players", { p_team_id: team.id, p_text: bulk.value });
      if (r && r.ok) {
        toast("أُضيف " + arNum(r.added) + " لاعباً" +
              (r.skipped ? "، وتُخطّي " + arNum(r.skipped) + " مكرّراً" : ""));
        render();
      }
    }})
  ]));

  const card = el("div", { class: "card" }, [
    el("h2", { text: "القائمة (" + arNum(players.length) + ")" })
  ]);
  if (!players.length) card.appendChild(el("p", { class: "muted", text: "لا يوجد لاعبون بعد." }));
  players.forEach(p => {
    card.appendChild(el("div", { class: "item", style: p.is_active ? "" : "opacity:.5" }, [
      el("div", { class: "grow" }, [
        el("b", { text: (p.shirt_number === null || p.shirt_number === undefined
                         ? "" : arNum(p.shirt_number) + " · ") + p.name }),
        el("span", { text: p.is_active ? "" : "مخفي" })
      ]),
      el("button", { class: "icon", text: "✎", onclick: async () => {
        const nm = prompt("اسم اللاعب:", p.name);
        if (!nm || !nm.trim()) return;
        const nu = prompt("رقم القميص:", p.shirt_number === null ? "" : p.shirt_number);
        if (await call("admin_save_player", {
          p_id: p.id, p_team_id: team.id, p_name: nm.trim(),
          p_number: nu && nu.trim() ? parseInt(nu.trim(), 10) : null,
          p_active: p.is_active })) { toast("حُفظ"); render(); }
      }}),
      el("button", { class: "icon", text: "🗑", onclick: () => deletePlayer(p) })
    ]));
  });
  box.appendChild(card);
}

/* ============ الأرشيف ============ */
async function viewArchive(box) {
  loading(box);
  const a = await call("admin_archive");
  box.innerHTML = "";
  if (!a) return;

  const lb = el("div", { class: "card" }, [
    el("h2", { text: "ترتيب أفضل لاعبي البطولة" })
  ]);
  if (!a.leaderboard.length) {
    lb.appendChild(el("p", { class: "muted", text: "لم تُغلق أي مباراة بعد." }));
  }
  a.leaderboard.forEach((p, i) => {
    lb.appendChild(el("div", { class: "item" }, [
      el("div", { class: "grow" }, [
        el("b", { text: arNum(i + 1) + ". " + p.name }),
        el("span", { text: p.team })
      ]),
      el("span", { class: "badge", text: arNum(p.awards) + " جائزة" })
    ]));
  });
  box.appendChild(lb);

  const ms = el("div", { class: "card" }, [ el("h2", { text: "سجل المباريات" }) ]);
  if (!a.matches.length) ms.appendChild(el("p", { class: "muted", text: "لا يوجد سجل بعد." }));
  a.matches.forEach(m => {
    const r = m.results;
    const wid = r.committee_winner_id || (r.winner_player_ids || [])[0];
    const w = (r.nominees || []).find(n => n.player_id === wid);
    ms.appendChild(el("div", { class: "item" }, [
      el("div", { class: "grow" }, [
        el("b", { text: m.title }),
        el("span", { text: fmtDate(m.match_date) + " · " +
                           (w ? "الفائز: " + w.name : "بلا أصوات") +
                           " · " + arNum(r.total_voters) + " مصوّت" +
                           (r.tie_pending ? " · تعادل لم يُحسم" : "") })
      ]),
      el("button", { class: "icon", text: "‹", title: "فتح",
                     onclick: () => navTo({ tab: "matches", openMatch: m.id }) })
    ]));
  });
  box.appendChild(ms);
}

/* ============ الإعدادات ============ */
async function doReset(scope, what) {
  if (!confirm("سيُحذف نهائياً:\n" + what + "\n\nأتابع؟")) return;
  const typed = prompt("للتأكيد اكتب كلمة:  احذف");
  if (!typed || typed.trim() !== "احذف") return toast("أُلغي المسح", "bad");

  const r = await call("admin_reset", { p_scope: scope, p_confirm: typed.trim() });
  if (!r || !r.ok) return;

  toast("مُسح " + arNum(r.matches) + " مباراة و" + arNum(r.votes) + " صوتاً" +
        (scope === "all" ? " و" + arNum(r.teams) + " فريقاً" : ""));
  TEAMS = [];
  navTo({ tab: "matches", openMatch: null, openTeam: null });
}

function viewSettings(box) {
  box.innerHTML = "";
  const name  = el("input", { type: "text",  value: CFGS.tournament_name });
  const color = el("input", { type: "color", value: CFGS.brand_color });
  const note  = el("input", { type: "text",  value: CFGS.tie_rule_note });
  const iplim = el("input", { type: "number", min: "1", max: "200", value: CFGS.ip_vote_limit });
  const siglim= el("input", { type: "number", min: "1", max: "50",  value: CFGS.device_sig_limit });
  const pairlim = el("input", { type: "number", min: "1", max: "20", value: CFGS.pair_vote_limit });
  const logdef = el("select");
  [["false", "مفتوح للجميع بلا تسجيل"], ["true", "يتطلّب تسجيل Google"]]
    .forEach(([v, t]) => logdef.appendChild(el("option", { value: v, text: t })));
  logdef.value = String(CFGS.login_default);
  const tsOn  = el("select");
  [["false", "مطفأ — التصويت مباشر بلا تحقّق"], ["true", "مفعّل"]]
    .forEach(([v, t]) => tsOn.appendChild(el("option", { value: v, text: t })));
  tsOn.value = String(CFGS.turnstile_enabled);
  const tsKey = el("input", { type: "text", value: CFGS.turnstile_site_key || "",
                              placeholder: "مفتاح الموقع من Cloudflare" });

  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "إعدادات البطولة" }),
    el("label", { text: "اسم البطولة" }), name,
    el("label", { text: "اللون الأساسي" }), color,
    el("label", { text: "نص قاعدة التعادل المعروض للجمهور" }), note,
    el("label", { text: "الوضع الافتراضي لفتح المباريات" }), logdef,
    el("p", { class: "muted", style: "font-size:13px;margin:6px 0 0",
      text: "هذا مجرّد افتراضي يظهر لك عند فتح كل مباراة، وتقدر تغيّره لكل مباراة على حدة." }),
    el("label", { text: "حد الأصوات لكل جهاز على الشبكة نفسها" }), pairlim,
    el("p", { class: "muted", style: "font-size:13px;margin:6px 0 0",
      text: "هذا أقوى مانع للتكرار. اتركه على 1، وارفعه إلى 2 فقط لو شكا مصوّتون حقيقيون من الحجب." }),
    el("div", { class: "split" }, [
      el("div", {}, [el("label", { text: "حد الأصوات لكل شبكة" }), iplim]),
      el("div", {}, [el("label", { text: "حد الأصوات لكل جهاز متطابق" }), siglim])
    ]),
    el("label", { text: "حماية البوتات (Turnstile)" }), tsOn,
    el("label", { text: "مفتاح Turnstile العام" }), tsKey,
    el("div", { style: "height:14px" }),
    el("button", { class: "btn", text: "احفظ الإعدادات", onclick: async () => {
      const r = await call("admin_save_settings", {
        p_name: name.value, p_color: color.value, p_tie_note: note.value,
        p_ip_limit: parseInt(iplim.value, 10), p_sig_limit: parseInt(siglim.value, 10),
        p_pair_limit: parseInt(pairlim.value, 10),
        p_login_default: logdef.value === "true",
        p_turnstile_enabled: tsOn.value === "true",
        p_turnstile_site_key: tsKey.value.trim() || null });
      if (r && r.ok) {
        CFGS = r; setBrand(r.brand_color);
        document.getElementById("tname").textContent = r.tournament_name;
        toast("حُفظت الإعدادات");
      }
    }})
  ]));

  const nk = el("input", { type: "text", placeholder: "المفتاح الجديد — ٢٤ حرفاً فأكثر" });
  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "تغيير المفتاح السري" }),
    el("p", { class: "muted", text: "استخدمه لو تسرّب رابط الإدارة. بعد التغيير يتوقف الرابط القديم فوراً." }),
    nk, el("div", { style: "height:12px" }),
    el("button", { class: "btn danger", text: "غيّر المفتاح", onclick: async () => {
      const v = nk.value.trim();
      if (v.length < 24) return toast("المفتاح قصير — ٢٤ حرفاً على الأقل", "bad");
      if (!confirm("تغيير المفتاح السري؟ الرابط الحالي سيتوقف.")) return;
      const r = await call("admin_rotate_key", { p_new_key: v });
      if (r && r.ok) {
        KEY = v;
        try { localStorage.setItem("motm_admin_key", v); } catch (e) { /* تجاهل */ }
        toast("تغيّر المفتاح — احفظ الرابط الجديد");
        history.replaceState({}, "", "admin.html?k=" + encodeURIComponent(v));
      }
    }})
  ]));

  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "تجهيز الرابط لدورة جديدة" }),
    el("p", { class: "muted", text: "مسح نهائي بلا رجعة. روابط المباريات الممسوحة تصير غير صالحة، ولن تُعرض نتائجها لأحد بعدها." }),
    el("button", { class: "btn ghost", text: "امسح المباريات والأصوات فقط",
      onclick: () => doReset("matches", "كل المباريات وأصواتها، مع بقاء الفرق واللاعبين") }),
    el("div", { style: "height:8px" }),
    el("button", { class: "btn danger", text: "امسح كل شيء — فرق ولاعبين ومباريات",
      onclick: () => doReset("all", "كل الفرق واللاعبين والمباريات والأصوات") })
  ]));

  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "الخروج من هذا الجهاز" }),
    el("p", { class: "muted", text: "يمسح المفتاح المحفوظ في هذا المتصفح فقط." }),
    el("button", { class: "btn ghost", text: "امسح المفتاح من هذا الجهاز", onclick: () => {
      try { localStorage.removeItem("motm_admin_key"); } catch (e) { /* تجاهل */ }
      location.href = "admin.html";
    }})
  ]));
}

boot();
