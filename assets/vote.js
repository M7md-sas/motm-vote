/* صفحة التصويت العامة — أربع حالات: لم يبدأ / مفتوح / صوّتت / مغلق */

const code = new URLSearchParams(location.search).get("m");
const app = document.getElementById("app");
let FP = null, SIG = null, DATA = null, picked = null, tick = null, poll = null;

const ERRORS = {
  BAD_DEVICE:         "تعذّر التعرّف على جهازك. جرّب متصفحاً آخر.",
  NOT_FOUND:          "رابط المباراة غير صحيح.",
  CLOSED:             "أُغلق التصويت لهذه المباراة.",
  BAD_TOKEN:          "انتهت صلاحية الصفحة. حدّثها وأعد المحاولة.",
  BAD_NOMINEE:        "المرشّح المختار غير صحيح.",
  ALREADY_VOTED:      "سبق أن صوّتّ من هذا الجهاز.",
  LOGIN_REQUIRED:     "هذه المباراة تتطلّب تسجيل الدخول قبل التصويت.",
  ACCOUNT_VOTED:      "سبق أن صوّتّ بهذا الحساب في هذه المباراة.",
  PAIR_LIMIT:         "سُجِّل صوت من هذا الجهاز على هذه الشبكة. لو لم تصوّت أنت، جرّب من بيانات جوّالك بدل الواي فاي.",
  IP_LIMIT:           "بلغت شبكتك الحد المسموح من الأصوات لهذه المباراة.",
  DEVICE_LIMIT:       "بلغ هذا الجهاز الحد المسموح من الأصوات لهذه المباراة.",
  TURNSTILE_REQUIRED: "تعذّر التحقّق الأمني. حدّث الصفحة وأعد المحاولة."
};

function head(d) {
  document.getElementById("tournament").textContent = d.tournament || "";
  document.getElementById("title").textContent = d.title || "أفضل لاعب في المباراة";
  document.getElementById("date").textContent = d.match_date ? fmtDate(d.match_date) : "";
  if (d.title) document.title = d.title + " — التصويت لأفضل لاعب";
  setBrand(d.brand_color);
}

function clearTimers() {
  if (tick) { clearInterval(tick); tick = null; }
  if (poll) { clearInterval(poll); poll = null; }
}

async function load() {
  try {
    DATA = await rpc("public_get_match", { p_code: code, p_fp: FP });
  } catch (e) {
    app.innerHTML = "";
    app.appendChild(el("div", { class: "card center" }, [
      el("h2", { text: "تعذّر الاتصال" }),
      el("p", { class: "muted", text: "تحقّق من اتصالك بالإنترنت وحدّث الصفحة." })
    ]));
    return;
  }
  render();
}

function render() {
  clearTimers();
  head(DATA);
  app.innerHTML = "";
  picked = null;

  switch (DATA.state) {
    case "not_found":   return viewMessage("رابط غير صحيح",
      "هذا الرابط لا يخص أي مباراة. تأكد من نسخه كاملاً.");
    case "cancelled":   return viewMessage("المباراة أُلغيت",
      "لن يُعلَن أفضل لاعب لهذه المباراة.");
    case "not_started": return viewNotStarted();
    case "open":        return viewOpen();
    case "voted":       return viewVoted();
    case "closed":      return viewClosed();
    default:            return viewMessage("حالة غير معروفة", "حدّث الصفحة.");
  }
}

function viewMessage(t, s) {
  app.appendChild(el("div", { class: "card center" }, [
    el("h2", { text: t }), el("p", { class: "muted", text: s })
  ]));
}

function viewNotStarted() {
  app.appendChild(el("div", { class: "card center" }, [
    el("p", { class: "badge grey", text: "لم يبدأ التصويت بعد" }),
    el("h2", { text: "انتظر قليلاً" }),
    el("p", { class: "muted", text: "سيُفتح التصويت قرب نهاية المباراة. أبقِ الصفحة مفتوحة وستتحدّث تلقائياً." })
  ]));
  poll = setInterval(load, 15000);
}

function nomineeButton(n, onPick) {
  const btn = el("button", { class: "nominee", type: "button",
                             "data-id": n.nominee_id, onclick: onPick });
  btn.appendChild(kitSVG(n.shirt_number, n.kit_color, n.number_color, 58));
  btn.appendChild(el("div", { class: "who" }, [
    el("b", { text: n.name }),
    el("span", { text: n.team })
  ]));
  btn.appendChild(el("div", { class: "tick", text: "✔" }));
  return btn;
}

function viewOpen() {
  /* مباراة تتطلّب تسجيلاً ولم يسجّل بعد: بوابة قبل عرض المرشّحين */
  if (DATA.require_login && !DATA.signed_in) {
    app.appendChild(el("div", { class: "card center" }, [
      el("p", { class: "badge", text: "تصويت موثّق" }),
      el("h2", { text: "سجّل دخولك للتصويت" }),
      el("p", { class: "muted", text: "هذه المباراة تتطلّب حساب Google لضمان صوت واحد لكل شخص. لن يُعرف لمن صوّتّ." }),
      el("div", { style: "height:12px" }),
      el("button", { class: "btn", text: "المتابعة بحساب Google", onclick: signInWithGoogle })
    ]));

    if (DATA.closes_at) {
      const t = el("p", { class: "timer" });
      app.appendChild(t);
      const end = new Date(DATA.closes_at).getTime();
      const upd = () => {
        const left = Math.round((end - Date.now()) / 1000);
        if (left <= 0) { clearTimers(); load(); return; }
        t.textContent = "يُغلق التصويت خلال " + fmtClock(left);
      };
      upd();
      tick = setInterval(upd, 1000);
    }
    return;
  }

  const card = el("div", { class: "card" }, [
    el("h2", { text: "اختر أفضل لاعب" }),
    el("p", { class: "muted", text: "صوت واحد فقط، ولا يمكن تغييره بعد الإرسال." })
  ]);

  const submit = el("button", { class: "btn", type: "button", disabled: "disabled", text: "أرسل صوتي" });

  DATA.nominees.forEach(n => {
    card.appendChild(nomineeButton(n, ev => {
      card.querySelectorAll(".nominee").forEach(b => b.classList.remove("sel"));
      ev.currentTarget.classList.add("sel");
      picked = n.nominee_id;
      submit.disabled = false;
    }));
  });

  submit.addEventListener("click", send);
  card.appendChild(submit);
  app.appendChild(card);

  if (DATA.closes_at) {
    const t = el("p", { class: "timer" });
    app.appendChild(t);
    const end = new Date(DATA.closes_at).getTime();
    const upd = () => {
      const left = Math.round((end - Date.now()) / 1000);
      if (left <= 0) { clearTimers(); load(); return; }
      t.textContent = "يُغلق التصويت خلال " + fmtClock(left);
    };
    upd();
    tick = setInterval(upd, 1000);
  }

  async function send(ev) {
    if (!picked) return;
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = "جارٍ الإرسال…";
    try {
      const r = await rpc("public_cast_vote", {
        p_code: code, p_nominee_id: picked, p_fp: FP,
        p_sig: SIG, p_token: DATA.vote_token, p_turnstile: null
      });
      if (r && r.ok) { await load(); toast("سُجّل صوتك"); return; }
      toast(ERRORS[r && r.error] || "تعذّر تسجيل الصوت", "bad");
      await load();
    } catch (e) {
      toast("تعذّر الإرسال. تحقّق من اتصالك.", "bad");
      btn.disabled = false;
      btn.textContent = "أرسل صوتي";
    }
  }
}

function viewVoted() {
  const mine = DATA.nominees.find(n => n.nominee_id === DATA.my_nominee_id);
  app.appendChild(el("div", { class: "card center" }, [
    el("p", { class: "badge", text: "تم تسجيل صوتك" }),
    el("h2", { text: "شكراً لك" }),
    mine ? el("p", { text: "صوّتّ لـ " }) : null,
    mine ? el("p", { style: "font-size:20px;font-weight:700;margin:0", text: mine.name }) : null,
    el("p", { class: "muted", text: "النتيجة تظهر هنا فور إغلاق التصويت. أبقِ الصفحة مفتوحة." })
  ]));
  poll = setInterval(load, 15000);
}

function viewClosed() {
  const r = DATA.results;
  const total = r.total_voters;
  const winners = r.committee_winner_id ? [r.committee_winner_id] : (r.winner_player_ids || []);

  const card = el("div", { class: "card" }, [
    el("p", { class: "badge grey", text: "أُغلق التصويت" }),
    el("h2", { text: "النتيجة النهائية" })
  ]);

  if (total === 0) {
    card.appendChild(el("p", { class: "muted", text: "لم يُسجَّل أي صوت في هذه المباراة." }));
    app.appendChild(card);
    return;
  }

  r.nominees.forEach(n => {
    const win = winners.indexOf(n.player_id) !== -1;
    const body = el("div", { style: "flex:1;min-width:0" }, [
      el("div", { class: "line" }, [
        el("b", { text: n.name }),
        el("span", { class: "pct", text: arNum(n.percent) + "٪" })
      ]),
      el("div", { class: "bar" }, [ el("i", { style: "width:" + n.percent + "%" }) ]),
      el("div", { class: "muted", style: "font-size:13px",
                  text: n.team + " · " + arNum(n.votes) + " صوت" })
    ]);
    const row = el("div", { class: "res" + (win ? " win" : ""),
                            style: "display:flex;align-items:center;gap:12px" });
    row.appendChild(kitSVG(n.shirt_number, n.kit_color, n.number_color, 46));
    row.appendChild(body);
    card.appendChild(row);
  });

  card.appendChild(el("p", { class: "muted center",
    text: "إجمالي المصوّتين: " + arNum(total) }));

  if (r.tie_pending) {
    card.appendChild(el("p", { class: "badge amber", text: "تعادل — بانتظار قرار اللجنة" }));
    card.appendChild(el("p", { class: "muted", text: DATA.tie_rule_note || "" }));
    poll = setInterval(load, 20000);
  } else if (r.committee_winner_id) {
    card.appendChild(el("p", { class: "muted center",
      text: "حُسم التعادل بقرار اللجنة المنظِّمة." }));
  }

  app.appendChild(card);
}

/* ---------- بدء التشغيل ---------- */
(async function () {
  if (!code) {
    document.getElementById("title").textContent = "رابط ناقص";
    app.innerHTML = "";
    viewMessage("الرابط ناقص", "افتح رابط المباراة كاملاً كما وصلك.");
    return;
  }
  loadSession();
  FP = await deviceId();
  SIG = await deviceSig();
  await load();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && DATA && DATA.state !== "closed") load();
  });
})();
