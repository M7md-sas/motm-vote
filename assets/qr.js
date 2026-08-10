/* مولّد رمز QR — نمط البايت (UTF-8)، مستوى تصحيح الأخطاء M، الإصدارات ١..١٠
   لا مكتبة خارجية ولا اتصال بأي خدمة: كل الحساب يجري داخل متصفح الإداري. */

(function (global) {
  "use strict";

  /* [إجمالي الكلمات، كلمات التصحيح لكل كتلة، [[عدد الكتل، كلمات البيانات لكل كتلة], ...]] */
  const SPEC = {
    1:  [26,  10, [[1, 16]]],
    2:  [44,  16, [[1, 28]]],
    3:  [70,  26, [[1, 44]]],
    4:  [100, 18, [[2, 32]]],
    5:  [134, 24, [[2, 43]]],
    6:  [172, 16, [[4, 27]]],
    7:  [196, 18, [[4, 31]]],
    8:  [242, 22, [[2, 38], [2, 39]]],
    9:  [292, 22, [[3, 36], [2, 37]]],
    10: [346, 26, [[4, 43], [1, 44]]]
  };

  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  /* ===== حسابات الحقل GF(256) ===== */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  function genPoly(n) {
    let p = [1];
    for (let i = 0; i < n; i++) {
      const q = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) {
        q[j] ^= p[j];
        q[j + 1] ^= mul(p[j], EXP[i]);
      }
      p = q;
    }
    return p;
  }

  function eccOf(data, ecLen) {
    const g = genPoly(ecLen);
    const res = new Array(data.length + ecLen).fill(0);
    for (let i = 0; i < data.length; i++) res[i] = data[i];
    for (let i = 0; i < data.length; i++) {
      const f = res[i];
      if (f === 0) continue;
      for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], f);
    }
    return res.slice(data.length);
  }

  /* ===== أقنعة التمويه ===== */
  const MASK = [
    (r, c) => ((r + c) % 2) === 0,
    (r, c) => (r % 2) === 0,
    (r, c) => (c % 3) === 0,
    (r, c) => ((r + c) % 3) === 0,
    (r, c) => ((Math.floor(r / 2) + Math.floor(c / 3)) % 2) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) === 0,
    (r, c) => (((((r * c) % 2) + ((r * c) % 3)) % 2)) === 0,
    (r, c) => (((((r + c) % 2) + ((r * c) % 3)) % 2)) === 0
  ];

  function bch15(data) {                    /* معلومات التنسيق */
    let rem = data << 10;
    for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function bch18(v) {                       /* معلومات الإصدار (٧ فأعلى) */
    let rem = v << 12;
    for (let i = 17; i >= 12; i--) if (rem & (1 << i)) rem ^= 0x1F25 << (i - 12);
    return (v << 12) | rem;
  }

  /* ===== بناء المصفوفة ===== */
  function build(text) {
    const bytes = new TextEncoder().encode(text);

    let ver = 0, dataWords = 0;
    for (let v = 1; v <= 10; v++) {
      const groups = SPEC[v][2];
      let dw = 0;
      groups.forEach(g => { dw += g[0] * g[1]; });
      const cci = v <= 9 ? 8 : 16;
      if (4 + cci + bytes.length * 8 <= dw * 8) { ver = v; dataWords = dw; break; }
    }
    if (!ver) throw new Error("النص أطول من طاقة رمز QR المدعومة");

    /* ترميز البتات */
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    put(4, 4);                                    /* نمط البايت */
    put(bytes.length, ver <= 9 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) put(bytes[i], 8);

    const capBits = dataWords * 8;
    for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const PAD = [0xEC, 0x11];
    for (let k = 0; bits.length < capBits; k++) put(PAD[k % 2], 8);

    const dw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      dw.push(v);
    }

    /* تقسيم الكتل وتشابكها */
    const ecLen = SPEC[ver][1];
    const blocks = [];
    let pos = 0;
    SPEC[ver][2].forEach(g => {
      for (let i = 0; i < g[0]; i++) {
        const d = dw.slice(pos, pos + g[1]);
        pos += g[1];
        blocks.push({ d: d, e: eccOf(d, ecLen) });
      }
    });
    let maxD = 0;
    blocks.forEach(b => { if (b.d.length > maxD) maxD = b.d.length; });
    const out = [];
    for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach(b => out.push(b.e[i]));

    /* الأنماط الوظيفية */
    const size = ver * 4 + 17;
    const m  = Array.from({ length: size }, () => new Array(size).fill(0));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (r, c, v) => {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      m[r][c] = v; fn[r][c] = true;
    };

    const finder = (r, c) => {
      for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
        const ring = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                     (j >= 0 && j <= 6 && (i === 0 || i === 6));
        const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        setF(r + i, c + j, (ring || core) ? 1 : 0);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      const v = (i % 2 === 0) ? 1 : 0;
      setF(6, i, v); setF(i, 6, v);
    }

    const ap = ALIGN[ver];
    for (const r of ap) for (const c of ap) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        setF(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : 0);
      }
    }

    setF(size - 8, 8, 1);                       /* الوحدة الداكنة */

    for (let i = 0; i <= 8; i++) {              /* حجز مساحة التنسيق */
      if (i !== 6) { setF(8, i, 0); setF(i, 8, 0); }
    }
    for (let i = 0; i < 8; i++) { setF(8, size - 1 - i, 0); setF(size - 1 - i, 8, 0); }

    if (ver >= 7) {                             /* حجز مساحة الإصدار */
      for (let i = 0; i < 18; i++) {
        const a = Math.floor(i / 3), b = i % 3;
        setF(size - 11 + b, a, 0); setF(a, size - 11 + b, 0);
      }
    }

    /* وضع البيانات بالمسار المتعرّج */
    const totalBits = out.length * 8;
    let bi = 0;
    let up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (let n = 0; n < size; n++) {
        const row = up ? size - 1 - n : n;
        for (let k = 0; k < 2; k++) {
          const c = col - k;
          if (fn[row][c]) continue;
          m[row][c] = bi < totalBits ? ((out[bi >> 3] >> (7 - (bi & 7))) & 1) : 0;
          bi++;
        }
      }
      up = !up;
    }

    /* اختيار أفضل قناع */
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const g = m.map(row => row.slice());
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        if (!fn[r][c] && MASK[mask](r, c)) g[r][c] ^= 1;
      }
      const fmt = bch15(mask);                  /* المستوى M = 00 */
      for (let i = 0; i < 15; i++) {
        /* النسخة الأولى حول الزاوية العليا اليسرى: من أعلى بت إلى أدناه */
        const hi = (fmt >> (14 - i)) & 1;
        if (i < 6)        g[8][i] = hi;
        else if (i < 8)   g[8][i + 1] = hi;
        else if (i === 8) g[7][8] = hi;
        else              g[14 - i][8] = hi;

        /* النسخة الثانية: تُقرأ في الاتجاه المعاكس — من أدنى بت إلى أعلاه */
        const lo = (fmt >> i) & 1;
        if (i < 8) g[8][size - 1 - i] = lo;
        else       g[size - 15 + i][8] = lo;
      }
      g[size - 8][8] = 1;                       /* الوحدة الداكنة */
      if (ver >= 7) {
        const vb = bch18(ver);
        for (let i = 0; i < 18; i++) {
          const b = (vb >> i) & 1;
          const a = Math.floor(i / 3), t = i % 3;
          g[size - 11 + t][a] = b;
          g[a][size - 11 + t] = b;
        }
      }
      const s = penalty(g, size);
      if (s < bestScore) { bestScore = s; best = g; }
    }

    return { size: size, version: ver, modules: best };
  }

  /* ===== احتساب الغرامات لاختيار القناع ===== */
  function penalty(g, size) {
    let p = 0;

    /* ١ — تتابع خمس وحدات فأكثر بلون واحد */
    for (let i = 0; i < size; i++) {
      let runR = 1, runC = 1;
      for (let j = 1; j < size; j++) {
        runR = (g[i][j] === g[i][j - 1]) ? runR + 1 : 1;
        if (runR === 5) p += 3; else if (runR > 5) p += 1;
        runC = (g[j][i] === g[j - 1][i]) ? runC + 1 : 1;
        if (runC === 5) p += 3; else if (runC > 5) p += 1;
      }
    }

    /* ٢ — مربعات ٢×٢ بلون واحد */
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = g[r][c];
      if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) p += 3;
    }

    /* ٣ — النمط الشبيه بنمط البحث */
    const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const hit = (arr, pat) => {
      for (let i = 0; i < 11; i++) if (arr[i] !== pat[i]) return false;
      return true;
    };
    for (let i = 0; i < size; i++) for (let j = 0; j <= size - 11; j++) {
      const row = [], col = [];
      for (let k = 0; k < 11; k++) { row.push(g[i][j + k]); col.push(g[j + k][i]); }
      if (hit(row, A) || hit(row, B)) p += 40;
      if (hit(col, A) || hit(col, B)) p += 40;
    }

    /* ٤ — توازن الأسود والأبيض */
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += g[r][c];
    const pct = dark * 100 / (size * size);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return p;
  }

  /* ===== الإخراج ===== */
  function toSVG(text, opts) {
    opts = opts || {};
    const q = build(text);
    const quiet = opts.quiet === undefined ? 4 : opts.quiet;
    const dim = q.size + quiet * 2;
    const dark = opts.dark || "#111827";
    const light = opts.light || "#ffffff";

    let d = "";
    for (let r = 0; r < q.size; r++) {
      for (let c = 0; c < q.size; c++) {
        if (q.modules[r][c]) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
      }
    }
    /* مقاس صريح بالبكسل يلزم لتحويل الرمز إلى صورة PNG */
    const px = opts.px ? ' width="' + opts.px + '" height="' + opts.px + '"' : "";
    return '<svg xmlns="http://www.w3.org/2000/svg"' + px + ' viewBox="0 0 ' + dim + ' ' + dim +
           '" shape-rendering="crispEdges" role="img" aria-label="رمز QR لرابط المباراة">' +
           '<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>' +
           '<path d="' + d + '" fill="' + dark + '"/></svg>';
  }

  global.QR = { build: build, toSVG: toSVG };

  if (typeof module !== "undefined" && module.exports) module.exports = global.QR;
})(typeof window !== "undefined" ? window : globalThis);
