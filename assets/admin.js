/* لوحة الإدارة — رابط سري واحد للبطولة كلها */

const app = document.getElementById("app");
let KEY = null, CFGS = null, TEAMS = [], tab = "matches", openMatch = null;
let refresher = null, clockTimer = null;

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

async function call(fn, args) {
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
    toast("تعذّر الاتصال بالخادم. تحقّق من الإنترنت.", "bad");
    return null;
  }
  if (r && r.ok === false && r.error) { toast(r.error, "bad"); return null; }
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
    render();
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
        onclick: () => { tab = id; openMatch = null; render(); }
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
            if (r && r.ok) { openMatch = r.id; toast("أُنشئت المباراة"); render(); }
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
                     onclick: () => { openMatch = m.id; render(); } })
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
  if (!d) { openMatch = null; return render(); }
  box.innerHTML = "";
  const [label, cls] = STATE_LABEL[d.state] || ["—", "grey"];

  box.appendChild(el("button", { class: "btn ghost sm", text: "› رجوع للقائمة",
    onclick: () => { openMatch = null; render(); } }));

  /* الترويسة والرابط */
  const link = linkFor(d.code);
  box.appendChild(el("div", { class: "card" }, [
    el("div", { class: "item", style: "border:0;padding:0;margin-bottom:8px" }, [
      el("div", { class: "grow" }, [
        el("b", { text: d.title }),
        el("span", { text: fmtDate(d.match_date) })
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
  if (d.total_votes === 0) {
    danger.appendChild(el("button", { class: "btn ghost sm", text: "حذف المباراة",
      onclick: async () => {
        if (!confirm("حذف المباراة نهائياً؟")) return;
        if (await call("admin_delete_match", { p_match_id: d.id })) {
          toast("حُذفت"); openMatch = null; render();
        }
      }}));
  }
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
  ov.addEventListener("click", () => ov.remove());
  document.body.appendChild(ov);
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

/* اختيار المرشّحين */
function nomineePicker(box, d) {
  const chosen = new Set(d.nominees.map(n => n.player_id));
  const card = el("div", { class: "card" }, [
    el("h2", { text: "اختر المرشّحين" }),
    el("p", { class: "muted", text: "من ٢ إلى ٥ لاعبين. اضغط على اللاعب لاختياره." })
  ]);

  d.squads.forEach(sq => {
    card.appendChild(el("h3", { style: "font-size:15px;margin:14px 0 8px", text: sq.team }));
    const wrap = el("div");
    sq.players.forEach(p => {
      const chip = el("button", {
        class: "chip" + (chosen.has(p.id) ? " on" : ""), type: "button",
        onclick: () => {
          if (chosen.has(p.id)) chosen.delete(p.id);
          else if (chosen.size >= 5) return toast("الحد الأقصى خمسة مرشّحين", "bad");
          else chosen.add(p.id);
          chip.classList.toggle("on");
          count.textContent = "المختارون: " + arNum(chosen.size);
        }
      }, [
        el("span", { text: p.name }),
        el("span", { class: "n", text: p.shirt_number === null || p.shirt_number === undefined
                                       ? "" : arNum(p.shirt_number) })
      ]);
      wrap.appendChild(chip);
    });

    /* إضافة لاعب سريعة داخل نفس الشاشة */
    wrap.appendChild(el("button", { class: "chip", type: "button", text: "＋ لاعب جديد",
      onclick: async () => {
        const name = prompt("اسم اللاعب:");
        if (!name || !name.trim()) return;
        const num = prompt("رقم القميص (اتركه فارغاً إن لم يوجد):");
        const r = await call("admin_save_player", {
          p_id: null, p_team_id: sq.team_id, p_name: name.trim(),
          p_number: num && num.trim() ? parseInt(num.trim(), 10) : null, p_active: true });
        if (r && r.ok) { toast("أُضيف اللاعب"); TEAMS = []; render(); }
      }}));
    card.appendChild(wrap);
  });

  const count = el("p", { class: "muted", text: "المختارون: " + arNum(chosen.size) });
  card.appendChild(count);
  card.appendChild(el("button", { class: "btn ghost", text: "احفظ المرشّحين", onclick: async () => {
    if (chosen.size < 2) return toast("اختر مرشّحَين على الأقل", "bad");
    if (await call("admin_set_nominees", {
      p_match_id: d.id, p_player_ids: Array.from(chosen) })) { toast("حُفظ"); render(); }
  }}));
  box.appendChild(card);

  /* الفتح */
  const mins = el("select");
  [["10", "١٠ دقائق"], ["5", "٥ دقائق"], ["15", "١٥ دقيقة"], ["30", "٣٠ دقيقة"], ["0", "بلا مؤقّت"]]
    .forEach(([v, t]) => mins.appendChild(el("option", { value: v, text: t })));

  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "افتح التصويت" }),
    el("label", { text: "مدة التصويت" }), mins,
    el("div", { style: "height:12px" }),
    el("button", { class: "btn", text: "افتح التصويت الآن", onclick: async () => {
      if (d.nominees.length < 2) return toast("احفظ المرشّحين أولاً", "bad");
      if (await call("admin_open_voting", {
        p_match_id: d.id, p_minutes: parseInt(mins.value, 10) })) { toast("فُتح التصويت"); render(); }
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
  const timer = el("p", { class: "timer" });

  const paint = data => {
    total.textContent = arNum(data.total_votes);
    rows.innerHTML = "";
    const t = data.total_votes || 0;
    data.nominees.forEach(n => {
      const pct = t ? Math.round(n.votes * 1000 / t) / 10 : 0;
      rows.appendChild(el("div", { class: "res" }, [
        el("div", { class: "line" }, [
          el("b", { text: n.name }),
          el("span", { class: "pct", text: arNum(n.votes) + " (" + arNum(pct) + "٪)" })
        ]),
        el("div", { class: "bar" }, [ el("i", { style: "width:" + pct + "%" }) ])
      ]));
    });
  };
  paint(d);

  card.appendChild(total); card.appendChild(totalLbl); card.appendChild(rows);
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
  }, 5000);
}

/* النتيجة بعد الإغلاق */
function resultPanel(box, d) {
  const r = d.results;
  const winners = r.committee_winner_id ? [r.committee_winner_id] : (r.winner_player_ids || []);
  const card = el("div", { class: "card" }, [ el("h2", { text: "النتيجة" }) ]);

  if (r.total_voters === 0) {
    card.appendChild(el("p", { class: "muted", text: "لم يُسجَّل أي صوت." }));
    box.appendChild(card);
    return;
  }

  r.nominees.forEach(n => {
    const win = winners.indexOf(n.player_id) !== -1;
    card.appendChild(el("div", { class: "res" + (win ? " win" : "") }, [
      el("div", { class: "line" }, [
        el("b", { text: n.name }),
        el("span", { class: "pct", text: arNum(n.percent) + "٪" })
      ]),
      el("div", { class: "bar" }, [ el("i", { style: "width:" + n.percent + "%" }) ]),
      el("div", { class: "muted", style: "font-size:13px", text: arNum(n.votes) + " صوت" })
    ]));
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
  box.appendChild(card);
}

/* ============ الفرق واللاعبون ============ */
let openTeam = null;

async function viewTeams(box) {
  loading(box);
  TEAMS = await call("admin_teams") || [];
  box.innerHTML = "";

  if (openTeam) return viewSquad(box, openTeam);

  const name = el("input", { type: "text", placeholder: "اسم الفريق" });
  box.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "إضافة فريق" }),
    name, el("div", { style: "height:12px" }),
    el("button", { class: "btn", text: "أضف الفريق", onclick: async () => {
      if (!name.value.trim()) return toast("اكتب اسم الفريق", "bad");
      if (await call("admin_save_team", { p_id: null, p_name: name.value.trim() })) {
        toast("أُضيف الفريق"); render();
      }
    }})
  ]));

  const card = el("div", { class: "card" }, [ el("h2", { text: "الفرق المسجّلة" }) ]);
  if (!TEAMS.length) card.appendChild(el("p", { class: "muted", text: "لا توجد فرق بعد." }));
  TEAMS.forEach(t => {
    card.appendChild(el("div", { class: "item" }, [
      el("div", { class: "grow" }, [
        el("b", { text: t.name }),
        el("span", { text: arNum(t.players) + " لاعباً" })
      ]),
      el("button", { class: "icon", text: "✎", title: "تعديل الاسم", onclick: async () => {
        const v = prompt("اسم الفريق:", t.name);
        if (!v || !v.trim()) return;
        if (await call("admin_save_team", { p_id: t.id, p_name: v.trim() })) { toast("حُفظ"); render(); }
      }}),
      el("button", { class: "icon", text: "🗑", title: "حذف", onclick: async () => {
        if (!confirm("حذف «" + t.name + "» بكل لاعبيه؟")) return;
        if (await call("admin_delete_team", { p_id: t.id })) { toast("حُذف"); render(); }
      }}),
      el("button", { class: "icon", text: "‹", title: "اللاعبون",
                     onclick: () => { openTeam = t; render(); } })
    ]));
  });
  box.appendChild(card);
}

async function viewSquad(box, team) {
  const players = await call("admin_players", { p_team_id: team.id }) || [];
  box.innerHTML = "";
  box.appendChild(el("button", { class: "btn ghost sm", text: "› رجوع للفرق",
    onclick: () => { openTeam = null; render(); } }));

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
      el("button", { class: "icon", text: "🗑", onclick: async () => {
        if (!confirm("حذف «" + p.name + "»؟")) return;
        const r = await call("admin_delete_player", { p_id: p.id });
        if (r && r.ok) { toast(r.note || "حُذف"); render(); }
      }})
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
                     onclick: () => { tab = "matches"; openMatch = m.id; render(); } })
    ]));
  });
  box.appendChild(ms);
}

/* ============ الإعدادات ============ */
function viewSettings(box) {
  box.innerHTML = "";
  const name  = el("input", { type: "text",  value: CFGS.tournament_name });
  const color = el("input", { type: "color", value: CFGS.brand_color });
  const note  = el("input", { type: "text",  value: CFGS.tie_rule_note });
  const iplim = el("input", { type: "number", min: "1", max: "200", value: CFGS.ip_vote_limit });
  const siglim= el("input", { type: "number", min: "1", max: "50",  value: CFGS.device_sig_limit });
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
    el("h2", { text: "الخروج من هذا الجهاز" }),
    el("p", { class: "muted", text: "يمسح المفتاح المحفوظ في هذا المتصفح فقط." }),
    el("button", { class: "btn ghost", text: "امسح المفتاح من هذا الجهاز", onclick: () => {
      try { localStorage.removeItem("motm_admin_key"); } catch (e) { /* تجاهل */ }
      location.href = "admin.html";
    }})
  ]));
}

boot();
