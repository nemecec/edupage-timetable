"use strict";
const DATA = JSON.parse(document.getElementById("data").textContent);
const SCHOOLS = DATA.schools;
const KEY = "tt:" + DATA.edupage + ":" + DATA.year;

const defaults = () => ({
  school: DATA.initialSchool, klass: DATA.initialClass,
  lang: DATA.lang, picks: {}, colors: {}, who: {}, events: {},
  titleSchool: {}, titleClass: {},
  showWho: false, showSchool: true, showClass: true,
  showTeacher: true, teacherName: "short",
  showRoom: true, showGroup: true,
  showSubject: true, subjectName: "full",
  schoolColors: false, customColours: true,
});
/* Settings arrive from localStorage, from a link, or from a pasted backup — all
   of them outside this page's control. Anything of the wrong shape is replaced
   by its default rather than allowed to break the render. */
/* A colour and nothing else. Everything that sets one writes a hex code, and
   these values are concatenated into style attributes — so a link carrying
   anything else is a link trying to write markup, not to pick a colour. */
const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function onlyColours(bag) {
  const out = {};
  for (const [subject, value] of Object.entries(bag)) {
    if (typeof value === "string" && HEX.test(value.trim())) out[subject] = value.trim();
  }
  return out;
}

function normalise(saved) {
  const base = defaults();
  const out = Object.assign({}, base);
  const was = (saved && typeof saved === "object" && !Array.isArray(saved)) ? saved : {};
  for (const key of Object.keys(base)) {
    const value = was[key];
    if (value === undefined) continue;
    if (typeof base[key] === "object") {
      if (value && typeof value === "object" && !Array.isArray(value)) out[key] = value;
    } else if (typeof value === typeof base[key]) {
      out[key] = value;
    }
  }
  for (const [key, allowed] of [["teacherName", ["short", "full"]],
                                ["subjectName", ["short", "full"]]]) {
    if (!allowed.includes(out[key])) out[key] = base[key];
  }
  if (!DATA.languages.some(l => l[0] === out.lang)) out.lang = DATA.lang;
  out.colors = onlyColours(out.colors);
  return out;
}

let state = defaults();
try {
  state = normalise(JSON.parse(localStorage.getItem(KEY) || "null"));
} catch (e) { /* corrupt or unavailable storage: fall back to defaults */ }
/* A link wins over what this browser had, since following one is a request to
   see that. The per-class bags merge rather than replace, so a link for one
   class does not wipe the choices made for a sibling's. */
{
  const shared = readUrl();
  if (shared) {
    const merged = normalise(Object.assign({}, state, shared));
    for (const bag of ["picks", "colors", "who", "events", "titleSchool", "titleClass"]) {
      if (shared[bag]) merged[bag] = Object.assign({}, state[bag], shared[bag]);
    }
    /* The per-bag merge runs after normalise, so the colours it brings in have
       not been through it. Nothing hostile survives the escaping at the sinks
       either way, but a link's junk should not end up saved. */
    merged.colors = onlyColours(merged.colors);
    state = merged;
    /* Keep what the link brought, so closing it and coming back later still
       shows the same timetable. */
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
}

/* ----- the address bar carries the settings -------------------------------
   Everything chosen lives in the fragment, so a bookmark keeps it and a link
   hands it to someone else. Only what differs from the defaults goes in, which
   keeps a typical link short — short enough to put in a QR code. The fragment
   never leaves the browser, so nothing is sent anywhere by carrying it. */
/* Declarations, not arrow constants: the state is read out of the address bar
   before this point in the file, and a const would still be in its dead zone. */
function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).split("+").join("-").split("/").join("_").split("=").join("");
}
function unb64url(code) {
  const padded = code.split("-").join("+").split("_").join("/");
  const binary = atob(padded + "===".slice((padded.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

function changedFromDefaults() {
  const base = defaults(), out = {};
  for (const key of Object.keys(base)) {
    if (JSON.stringify(state[key]) !== JSON.stringify(base[key])) out[key] = state[key];
  }
  return out;
}

function shareUrl() {
  const changed = changedFromDefaults();
  const bare = location.href.split("#")[0];
  return Object.keys(changed).length
    ? bare + "#s=" + b64url(JSON.stringify(changed)) : bare;
}

function readUrl() {
  const hash = location.hash.slice(1);
  if (!hash.startsWith("s=")) return null;
  try {
    const parsed = JSON.parse(unb64url(hash.slice(2)));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  try {
    const url = shareUrl();
    if (url !== location.href) history.replaceState(null, "", url);
  } catch (e) { /* a browser that will not rewrite the address bar: no matter */ }
};

/* Whose timetable this is: the name if one has been given, then the school and
   class. Shared by the heading, the browser tab and both print layouts so they
   can never drift apart. */
/* Provenance, and the fact that this is nobody's official page. Printed as well
   as shown: a sheet handed to someone else should say where it came from. */
function sourceUrl(school) {
  return "https://" + DATA.edupage + ".edupage.org/timetable/view.php?num=" + school.n;
}

/* Where this came from and when, next to what it is: all of it belongs in the
   heading rather than at the bottom of the page. */
function renderSubtitle(school) {
  const stamp = DATA.built ? esc(t("footer.built", DATA.built)) : "";
  const link = '<a href="' + esc(sourceUrl(school)) + '">' + esc(t("sourceLink")) + "</a>";
  /* school.v is the line the school configured to print under its own
     timetable — "Kehtivus: 24/08/2026-18/12/2026". Their text, so it stays in
     their language; the build drops it where they set a label and left it
     blank, so nothing shows a heading with nothing under it. */
  document.getElementById("subtitle").innerHTML =
    [esc(school.t), esc(school.v), link, stamp].filter(Boolean).join(" · ") +
    '<div class="unofficial">' + esc(t("footer.disclaimer")) + "</div>";
}

function renderFooter(school) {
  const stamp = DATA.built ? esc(t("footer.built", DATA.built)) : "";
  /* On paper the heading is gone, so the date it was read comes down here with
     the code that leads back to the page. On screen both live in the heading and
     the footer says only what the page is. */
  const bits = printing ? (stamp ? [stamp] : []) : [];
  /* Say so where it is true. A page that counts its readers should admit it,
     and this one only counts when it was built for a public address. */
  if (DATA.counts && !printing) bits.push(esc(t("footer.counts")));
  /* 36mm keeps a typical link at about half a millimetre per module, which a
     phone reads without ceremony. A link carrying many custom colours gets
     denser; it still scans, just less forgivingly. */
  const code = printing ? qrSvg(shareUrl(), "36mm") : "";
  document.getElementById("foot").innerHTML =
    '<div class="lines">' + bits.join("<br>") + "</div>" +
    (code ? '<div class="qrbox">' + code +
            '<div class="qrhint">' + esc(t("qrHint")) + "</div></div>" : "");
  document.getElementById("foot").classList.toggle("bare", printing && !bits.length);
}

/* What the heading and both printouts call this timetable. Each part can be
   switched off or written differently — a school's official name is not always
   the one a family uses — and the heading updates as it is typed, so the effect
   is visible before anything is printed. */
function titleParts(school, cls) {
  return {
    who: (perClass("who") || "").trim(),
    school: (perClass("titleSchool") || "").trim() || school.l,
    klass: (perClass("titleClass") || "").trim() || t("classN", cls.n),
  };
}

function displayTitle(school, cls) {
  const part = titleParts(school, cls);
  const right = [state.showSchool ? part.school : "", state.showClass ? part.klass : ""]
                  .filter(Boolean).join(", ");
  return [state.showWho ? part.who : "", right].filter(Boolean).join(" — ");
}

/* Interface strings only; anything from the timetable stays in the language
   the school entered it in. */
function t(key) {
  const table = DATA.strings[state.lang] || DATA.strings.en;
  let out = table[key];
  if (out === undefined) out = DATA.strings.en[key];
  if (out === undefined) return key;
  for (let i = 1; i < arguments.length; i++) {
    out = out.split("{" + (i - 1) + "}").join(arguments[i]);
  }
  return out;
}
/* Weekday names follow the interface language; the timetable only supplies
   its own, so fall back to those when a translation is missing. */
function dayLabel(school, idx) {
  const table = DATA.strings[state.lang] || DATA.strings.en;
  const own = (school.d.find(d => d.i === idx) || {}).n;
  if (state.lang === "et" && own) return own;
  return (table.days || [])[idx] || own || String(idx);
}

function applyStrings() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}

const esc = (s) => String(s).replace(/[&<>"'`]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
     "'": "&#39;", "`": "&#96;" }[c]));

function currentSchool() {
  return SCHOOLS.find(s => s.n === state.school) || SCHOOLS[0];
}
function currentClass() {
  const school = currentSchool();
  return school.c.find(c => c.n === state.klass) || school.c[0];
}
/* Group choices belong to a class, not to the reader, so they are stored per
   school+class and survive switching back and forth. */
function picksKey() { return currentSchool().n + "/" + currentClass().n; }
function picks() { return perClass("picks"); }
function pickable() { return perClassBag("picks"); }

function readable(bg) {
  /* Three, four, six or eight digits — a short hex is a colour like any other,
     and treating it as unreadable put dark text on a dark box. */
  let hex = String(bg || "").trim().replace("#", "");
  if (/^[0-9a-f]{3,4}$/i.test(hex)) hex = hex.split("").map(c => c + c).join("");
  const m = /^([0-9a-f]{6})/i.exec(hex);
  if (!m) return "#14171A";
  const n = parseInt(m[1], 16);
  const ch = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * ch(n >> 16 & 255) + 0.7152 * ch(n >> 8 & 255) + 0.0722 * ch(n & 255);
  const dark = 0.00778;   // luminance of #14171A
  const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return cr(L, dark) >= cr(L, 1) ? "#14171A" : "#FFFFFF";
}
function colorFor(subject) {
  if (state.customColours && state.colors[subject]) {
    const bg = state.colors[subject];
    return { bg: bg, fg: readable(bg) };
  }
  if (state.schoolColors) {
    const bg = (DATA.subjects[subject] || {}).color;
    if (bg) return { bg: bg, fg: readable(bg) };
  }
  return DATA.palette[subject] || { bg: "#EEEEEE", fg: "#14171A" };
}

/* A lesson is mine when every division it belongs to matches one of my picks.
   Whole-class lessons carry no groups and are always mine. */
function visible(entry, mine, divisions) {
  if (!entry.g.length) return true;
  if (!Object.values(mine).filter(Boolean).length) return true;
  for (const div of divisions) {
    if (!entry.g.some(g => div.groups.includes(g))) continue;
    const pick = mine[div.id];
    if (pick && !entry.g.includes(pick)) return false;
  }
  return true;
}

/* ----- my own events -------------------------------------------------------
   One per line: <weekday> <start>-<end> <colour> <label>
       Mon 17:15-18:15 orange Dance training                                  */
const WEEKDAYS = {};
[["mon","monday","esmaspäev","esmaspaev","es","e","m","mo"],
 ["tue","tues","tuesday","teisipäev","teisipaev","te","t","tu"],
 ["wed","wednesday","kolmapäev","kolmapaev","ko","k","w","we"],
 ["thu","thur","thurs","thursday","neljapäev","neljapaev","ne","n","th"],
 ["fri","friday","reede","re","r","f","fr"],
 ["sat","saturday","laupäev","laupaev","la","l","sa"],
 ["sun","sunday","pühapäev","puhapaev","pü","py","p","su"]]
  .forEach((names, i) => names.forEach(n => { WEEKDAYS[n] = i; }));

const DAY_NAMES_ET = ["Esmaspäev","Teisipäev","Kolmapäev","Neljapäev","Reede",
                      "Laupäev","Pühapäev"];
const LINE_RE = /^(\S+)\s+(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})\s+(\S+)\s+(.+?)\s*$/;

const isColour = (c) => !!(window.CSS && CSS.supports && CSS.supports("color", c));

/* The colour column is either a background on its own, or a foreground and a
   background split by a slash: "#333333/#dddddd". Only a slash between whole
   colours counts, so the one inside "rgb(0,0,0/50%)" is left alone. */
function splitColours(token) {
  let depth = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "/" && depth === 0) return [token.slice(0, i), token.slice(i + 1)];
  }
  return [null, token];
}

/* What an event writes with: its own foreground if it named one, otherwise
   whichever of black or white reads better on its background. */
function eventFg(ev) { return ev.fg || readable(cssColour(ev.bg)); }

function parseEvents(text) {
  const out = [], errors = [];
  String(text == null ? "" : text).split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = LINE_RE.exec(line);
    if (!m) { errors.push(t("events.line", i + 1, t("events.syntax"))); return; }
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day === undefined) {
      errors.push(t("events.line", i + 1, t("events.badDay", JSON.stringify(m[1])))); return;
    }
    const h1 = +m[2], n1 = +m[3], h2 = +m[4], n2 = +m[5];
    if (h1 > 23 || h2 > 23 || n1 > 59 || n2 > 59) {
      errors.push(t("events.line", i + 1, t("events.badRange"))); return;
    }
    const start = h1 * 60 + n1, end = h2 * 60 + n2;
    if (!(end > start)) { errors.push(t("events.line", i + 1, t("events.backwards"))); return; }
    const pair = splitColours(m[6]);
    const bad = pair.filter(c => c !== null).find(c => !isColour(c));
    if (bad !== undefined) {
      errors.push(t("events.line", i + 1, t("events.badColour", JSON.stringify(bad))));
      return;
    }
    out.push({ day: day, a: start, z: end, fg: pair[0], bg: pair[1],
               label: m[7], mine: true });
  });
  return { events: out, errors: errors };
}

/* Overlapping boxes share the column's width, the way a calendar does. */
function pack(items) {
  const sorted = items.slice().sort((p, q) => p.a - q.a || q.z - p.z);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const lanes = [];
    for (const it of cluster) {
      let lane = lanes.findIndex(end => end <= it.a);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = it.z;
      it._lane = lane;
    }
    for (const it of cluster) it._lanes = lanes.length;
    cluster = [];
  };
  for (const it of sorted) {
    if (it.a >= clusterEnd && cluster.length) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.z);
  }
  flush();
  return sorted;
}

const hhmm = (m) => Math.floor(m / 60) + "." + String(m % 60).padStart(2, "0");

/* The days a view shows: the ones the timetable has, plus any weekend a
   personal event lands on. */
function daysWith(school, mine) {
  const idx = school.d.map(d => d.i);
  for (const ev of mine) if (!idx.includes(ev.day)) idx.push(ev.day);
  return idx.sort((a, b) => a - b);
}

function renderTimeline(school, cls, shown, mine, scale) {
  const dayIdx = daysWith(school, mine);

  const perDay = new Map(dayIdx.map(i => [i, []]));
  for (const e of shown) {
    if (e.a == null) continue;
    perDay.get(e.d).push({ a: e.a, z: e.z, lesson: e });
  }
  for (const ev of mine) perDay.get(ev.day).push(ev);
  if (school.b) {
    for (const i of dayIdx) {
      const shape = cls.h[i];
      if (!shape) continue;
      for (const b of shape.b) {
        if (shape.s.length > b.a) perDay.get(i).push({ a: b.m, z: b.x, brk: b.n });
      }
    }
  }

  const all = [].concat(...[...perDay.values()]);
  if (!all.length) return '<p style="color:#6b7280">' + esc(t("nothing")) + "</p>";
  let lo = Math.min(...all.map(x => x.a)), hi = Math.max(...all.map(x => x.z));
  lo = Math.floor(lo / 30) * 30; hi = Math.ceil(hi / 30) * 30;
  const span = hi - lo;
  /* Pixels per minute. On screen a fixed, readable scale; on paper whatever
     fills the sheet, which the caller finds by measuring. */
  const ppm = scale || 1.05;
  const H = Math.round(span * ppm);

  /* Over the timetable rather than at the top of the page, and drawn the same
     way on screen as on paper: whatever is typed into the title fields shows up
     here at once, which is the only way to see what will print. */
  const named = displayTitle(school, cls);
  let h = named ? '<div class="ptitle sheet">' + esc(named) + "</div>" : "";
  h += '<div class="tl" style="--ppm:' + ppm + ";--half:" + (30 * ppm) +
          "px;--hour:" + (60 * ppm) + 'px">';
  h += '<div class="tlhead"><div class="cell gut"></div>' +
       dayIdx.map(i => '<div class="cell">' + esc(dayLabel(school, i)) + "</div>").join("") +
       "</div>";
  /* height covers the padding too, so the ruled area is exactly H tall and the
     first and last labels have somewhere to hang. */
  h += '<div class="tlbody" style="height:' + (H + 20) + 'px">';
  h += '<div class="tlaxis">';
  for (let t = lo; t <= hi; t += 30) {
    const cls2 = t % 60 === 0 ? "t hour" : "t";
    h += '<div class="' + cls2 + '" style="top:' + Math.round((t - lo) * ppm) + 'px">' +
         esc(hhmm(t)) + "</div>";
  }
  h += "</div>";

  /* Where a box sits in its column. Lessons and breaks share the full width
     between them; a personal event is drawn afterwards, over the top, so it
     never squeezes the timetable — which is what makes it usable for marking
     something out inside a break.
     It is inset only where there is something underneath worth glimpsing. An
     event in an empty evening covers nothing, so narrowing it there would look
     like a mistake rather than a layer. */
  const place = (it, inset) => {
    const lanes = it._lanes || 1, lane = it._lane || 0;
    const each = (100 - inset) / lanes;
    return "top:" + Math.round((it.a - lo) * ppm) +
           "px;height:" + Math.max(14, Math.round((it.z - it.a) * ppm) - 1) +
           "px;left:calc(" + (inset + lane * each) + "% + 2px);width:calc(" + each + "% - 4px);";
  };

  for (const i of dayIdx) {
    h += '<div class="tlcol">';
    const items = perDay.get(i);
    for (const it of pack(items.filter(x => !x.mine))) {
      const height = Math.max(14, Math.round((it.z - it.a) * ppm) - 1);
      const geom = place(it, 0);
      const when = hhmm(it.a) + "–" + hhmm(it.z);
      if (it.brk) {
        h += '<div class="ev brk" style="' + geom + '" title="' +
             esc(it.brk + "\n" + when) +
             '"><div class="what">' + esc(it.brk.split(",")[0]) + "</div>" +
             (height >= 30 ? '<div class="when">' + esc(when) + "</div>" : "") + "</div>";
        continue;
      }
      const e = it.lesson, col = colorFor(e.s), info = DATA.subjects[e.s] || {};
      const meta = detailLine(e);
      const tip = [subjectName(e, false), e.g.join("/"), e.T.join(" / "),
                   e.r.join(" / "), when, e.u > 1 ? t("paired") : t("single"),
                   e.o ? t("noExactTime") : ""].filter(Boolean).join("\n");
      const name = lessonTitle(e);
      let body = '<div class="when">' + esc(when) + (e.o ? " ?" : "") + "</div>" +
                 '<div class="what">' + esc(name) + "</div>";
      if (height >= 54 && meta.length) {
        body += '<div class="who2">' + esc(meta.join(" · ")) + "</div>";
      }
      h += '<div class="ev' + (height < 40 ? " tight" : "") + (e.o ? " approx" : "") +
           '" data-subject="' + esc(e.s) + '" style="' + geom + "background:" + esc(col.bg) +
           ";color:" + esc(col.fg) + '" title="' + esc(tip) + '">' + body + "</div>";
    }
    /* The layer on top. Events are packed among themselves, so two of them at
       once still sit side by side rather than hiding one another. */
    const base = items.filter(x => !x.mine);
    for (const it of pack(items.filter(x => x.mine))) {
      const over = base.some(x => x.a < it.z && it.a < x.z);
      const height = Math.max(14, Math.round((it.z - it.a) * ppm) - 1);
      const when = hhmm(it.a) + "–" + hhmm(it.z);
      const fg = eventFg(it);
      /* A twenty-minute box has room for one line, so the time joins the label
         rather than pushing it out of sight. */
      const body = height >= 30
        ? '<div class="when">' + esc(when) + "</div>" +
          '<div class="what">' + esc(it.label) + "</div>"
        : '<div class="what">' + esc(when + " " + it.label) + "</div>";
      h += '<div class="ev mine' + (it.fg ? " outlined" : "") +
           (height < 40 ? " tight" : "") + '" style="' + place(it, over ? 16 : 0) +
           "background:" + esc(it.bg) + ";color:" + esc(fg) +
           (it.fg ? ";border-color:" + esc(fg) : "") + '" title="' +
           esc(it.label + "\n" + when) + '">' + body + "</div>";
    }
    h += "</div>";
  }
  return h + "</div></div>";
}

/* The link as a QR code, so a printed sheet can be picked back up on a phone
   with every choice still on it. Drawn as squares rather than an image: it has
   to survive a printer at whatever size the sheet allows. */
function qrSvg(text, side) {
  let code;
  try {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    code = qrcode(0, "M");
    code.addData(text);
    code.make();
  } catch (e) {
    return "";                    // too long to encode: the link still works
  }
  const n = code.getModuleCount(), quiet = 4, span = n + quiet * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (code.isDark(r, c)) path += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
    }
  }
  return '<svg class="qr" width="' + side + '" height="' + side + '" viewBox="0 0 ' +
         span + " " + span + '" shape-rendering="crispEdges" role="img">' +
         '<rect width="' + span + '" height="' + span + '" fill="#fff"/>' +
         '<path d="' + path + '" fill="#000"/></svg>';
}

/* A typed colour, as hex, or nothing if it is not one yet. Anything CSS knows
   is allowed — "orange" and "#f80" both land on a colour the picker can show. */
function asHex(text) {
  const want = (text || "").trim();
  if (!want || !(window.CSS && CSS.supports && CSS.supports("color", want))) return "";
  return cssColour(want).toUpperCase();
}

/* Named CSS colours have to become hex before luminance can be measured. */
const _swatch = document.createElement("span");
function cssColour(value) {
  _swatch.style.color = "";
  _swatch.style.color = value;
  document.body.appendChild(_swatch);
  const rgb = getComputedStyle(_swatch).color;
  document.body.removeChild(_swatch);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return "#888888";
  return "#" + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, "0")).join("");
}

/* Slot view is the school's own day plan: one cell per lesson however many
   periods it spans, with the named breaks in fixed columns. Period view is the
   raw aSc grid, where a paired lesson repeats with its continuation dimmed. */
/* The timeline is the view. A school with no day plan has no times to draw one
   from — three of the four here publish none — so those fall back to the aSc
   period grid rather than rendering nothing. Nothing to choose; the data
   decides. */
function onTimeline() {
  if (!currentSchool().b) return false;
  /* A day plan the class is not covered by leaves its lessons untimed, and a
     timeline of untimed lessons is a blank page. Better the grid, which needs
     no times, than nothing at all. */
  return currentClass().e.some(e => e.a != null);
}
/* What goes on a lesson's second line: room, teacher and group are each
   independently switchable, so the box can be as dense or as bare as wanted. */
function detailLine(e) {
  const bits = [];
  if (state.showRoom && e.r.length) bits.push(e.r.join(" / "));
  const who3 = teacherText(e);
  if (who3) bits.push(who3);
  if (state.showGroup && e.g.length) bits.push(e.g.join("/"));
  return bits;
}

/* What to call a lesson. A block the school publishes as one but which holds
   two subjects in sequence names both, in the order they run; the colour and the
   legend still follow the one subject the box is keyed to. */
function subjectName(e, short) {
  const one = (name) => short ? ((DATA.subjects[name] || {}).short || name) : name;
  return (e.S && e.S.length ? e.S : [e.s]).map(one).join(" + ");
}

/* The subject as the reader asked to see it, or nothing at all. */
function lessonTitle(e) {
  if (!state.showSubject) return "";
  return subjectName(e, state.subjectName === "short");
}

/* Teacher names: the school's abbreviation, the full name, or neither. */
function teacherText(e) {
  if (!state.showTeacher) return "";
  const names = state.teacherName === "full" ? e.T : e.t;
  return (names || []).join(" / ");
}

/* Reading must not write. Creating the entry on read put an empty bag for every
   class ever looked at into the share link — a few hundred characters of
   nothing, which makes the printed QR code denser for no reason. */
const perClass = (bag) => {
  if (!state[bag] || typeof state[bag] !== "object") state[bag] = {};
  const got = state[bag][picksKey()];
  const ok = bag === "picks" ? (got && typeof got === "object") : typeof got === "string";
  return ok ? got : (bag === "picks" ? {} : "");
};

/* Where a value is about to be written, the entry does have to exist. */
const perClassBag = (bag) => {
  const key = picksKey();
  if (!state[bag] || typeof state[bag] !== "object") state[bag] = {};
  const got = state[bag][key];
  if (!got || typeof got !== "object") state[bag][key] = {};
  return state[bag][key];
};

/* A personal event belongs to no slot, so the table gives it a column of its
   own rather than pretending it is a lesson. */
function mineCell(list) {
  if (!list.length) return "<td></td>";
  return "<td>" + list.slice().sort((p, q) => p.a - q.a).map(ev =>
    '<div class="lesson" style="background:' + esc(ev.bg) + ";color:" + esc(eventFg(ev)) +
    (ev.fg ? ";border:1px solid " + esc(ev.fg) : "") +
    '"><div class="name">' + esc(ev.label) + "</div>" +
    '<div class="time">' + esc(hhmm(ev.a) + "–" + hhmm(ev.z)) +
    "</div></div>").join("") + "</td>";
}

function lessonHtml(e, time) {
  const meta = detailLine(e);
  const label = lessonTitle(e);
  const note = e.o ? t("noExactTime") : "";
  const tip = [subjectName(e, false), e.g.join("/"), e.T.join(" / "), e.r.join(" / "),
               time, e.u > 1 ? t("paired") : t("single"), note]
              .filter(Boolean).join("\n");
  const col = colorFor(e.s);
  return '<div class="lesson' + (e.c ? " cont" : "") + '" data-subject="' + esc(e.s) +
    '" style="background:' + esc(col.bg) + ";color:" + esc(col.fg) +
    '" title="' + esc(tip) + '">' +
    '<div class="name">' + esc(label) + "</div>" +
    ((time || e.o)
        ? '<div class="time">' + (e.o ? esc(t("noTimeShort")) : esc(time)) + "</div>" : "") +
    (meta.length ? '<div class="meta">' + esc(meta.join(" · ")) + "</div>" : "") +
    "</div>";
}

/* Columns are slots plus the named breaks that sit between them, or aSc
   periods when slot mode is off. */
/* Columns of the fallback grid. Only a school with no usable day plan gets
   here, so these are always aSc's raw periods. */
function columnModel(school, cls) {
  return school.p.map(p => ({ kind: "period", p: p }));
}

function columnLabel(school, cls, col) {
  if (!school.ts) return esc(col.p.l);
  return esc(col.p.l) + '<br><span class="slottime">' + esc(col.p.s + "–" + col.p.e) + "</span>";
}

function bodyCell(cls, dayIdx, col, bucket) {
  return "<td>" + (bucket.get(dayIdx + ":p" + col.p.n) || [])
    .map(e => lessonHtml(e, e.c ? "" : e.w)).join("") + "</td>";
}

/* One landscape sheet is the whole point of this view, and how tall a row
   wants to be depends on the class — several lessons in one cell, a canteen
   sitting spelled out inside a break, a row of personal events. So the rows are
   measured as they lie on screen and the padding that still fits the sheet is
   solved for, rather than guessed from how many rows there are. */
const SHEET_H = 726;              // 210mm less two 9mm margins, at 96dpi

/* Keep the printout on one landscape sheet whatever the class throws at it —
   several lessons in one cell, a canteen sitting spelled out inside a break, a
   row of personal events. Air goes first: the rows give up their padding down
   to a floor, and only then does the type step down. The view on screen is laid
   out at the size of the sheet, so this measures the real thing. */
/* The largest scale at which the day still fits one sheet, footer and all.
   Found by drawing it and measuring rather than by arithmetic on constants: the
   footer changes size with the QR code and the language, and a guess that was
   right once quietly stops being right. */
function fitTimeline(school, cls, shown, mine) {
  const grid = document.getElementById("grid");
  const keep = grid.innerHTML;
  let small = 0.4, big = 3.0;
  for (let step = 0; step < 9; step++) {
    const mid = (small + big) / 2;
    grid.innerHTML = renderTimeline(school, cls, shown, mine, mid);
    const used = grid.getBoundingClientRect().height + footHeight();
    /* A few pixels in hand: the print layout rounds differently from the screen
       one, and landing exactly on the limit means landing just past it. */
    if (used <= SHEET_H - 8) small = mid; else big = mid;
  }
  grid.innerHTML = keep;
  return small;
}

/* Outer height of the footer, margins included: the sheet has to hold it, and
   getBoundingClientRect leaves margins out. */
function footHeight() {
  const f = document.getElementById("foot");
  if (!f) return 0;
  const s = getComputedStyle(f);
  return f.getBoundingClientRect().height +
         (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0);
}

/* Repaint the grid but leave the legend alone. Its colour inputs are live DOM
   nodes, and replacing one while the native picker is open closes the picker —
   which made the swatches impossible to use. */
let keepLegend = false;
let printing = false;
function paint() {
  keepLegend = true;
  try { render(); } finally { keepLegend = false; }
}

function render() {
  const school = currentSchool(), cls = currentClass();
  state.school = school.n; state.klass = cls.n;
  syncDisplayControls();
  syncPerClassInputs();

  renderFooter(school);
  document.title = displayTitle(school, cls) || t("classN", cls.n);
  renderSubtitle(school);

  const mine = picks();
  const timeline = onTimeline();
  const shown = cls.e.filter(e => visible(e, mine, cls.v))
                     .filter(e => !timeline || !e.c);   // one box per lesson
  const bucket = new Map();
  for (const e of shown) {
    const k = timeline ? e.d + ":s" + e.k : e.d + ":p" + e.p;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(e);
  }

  const parsed = parseEvents(perClass("events"));
  document.getElementById("evwarn").textContent = parsed.errors.join("\n");

  if (printing && timeline) document.body.classList.add("printview");
  else document.body.classList.remove("printview");

  if (timeline) {
    document.getElementById("grid").innerHTML =
      renderTimeline(school, cls, shown, parsed.events,
                     printing ? fitTimeline(school, cls, shown, parsed.events) : 0);
    document.getElementById("count").textContent =
      t("lessonCount", shown.length) + (parsed.events.length ?
        " · " + t("mineCount", parsed.events.length) : "");
    if (!keepLegend) renderLegend(shown);
    return;
  }

  const cols = columnModel(school, cls);
  const dayIdx = daysWith(school, parsed.events);
  const anyMine = parsed.events.length > 0;
  let h = "<table><thead><tr><th></th>";
  {
    for (const col of cols) {
      h += "<th>" + columnLabel(school, cls, col) + "</th>";
    }
    if (anyMine) h += "<th>" + esc(t("mineCol")) + "</th>";
    h += "</tr></thead><tbody>";
    for (const i of dayIdx) {
      h += "<tr><th>" + esc(dayLabel(school, i)) + "</th>";
      for (const col of cols) h += bodyCell(cls, i, col, bucket);
      if (anyMine) h += mineCell(parsed.events.filter(ev => ev.day === i));
      h += "</tr>";
    }
  }
  document.getElementById("grid").innerHTML = h + "</tbody></table>";

  const total = cls.e.filter(e => !timeline || !e.c).length;
  document.getElementById("count").textContent =
    t("slotsShown", shown.length, total) +
    (shown.length === total ? " " + t("noFilter") : "") +
    (parsed.events.length ? " · " + t("mineCount", parsed.events.length) : "") +
    (school.b ? "" : " · " + t("noBells"));
  if (!keepLegend) renderLegend(shown);
}

function setColour(subject, value) {
  state.colors[subject] = value;
  state.customColours = true;      // choosing one is asking for them
  document.getElementById("customColours").checked = true;
  save();
  paint();
  const swatch = [...document.querySelectorAll("#legend input[type=color]")]
                   .find(x => x.dataset.subject === subject);
  if (swatch && swatch.value !== value) swatch.value = value;
  const code = [...document.querySelectorAll("#legend .hex")]
                 .find(x => x.dataset.subject === subject);
  if (code && code !== document.activeElement) code.value = value;
}

function renderLegend(shown) {
  document.getElementById("colourHint").textContent = t("colourHint");
  document.getElementById("share").title = t("shareHint");
  const used = [...new Set(shown.map(e => e.s))].sort();
  /* The code beside each swatch is the one the events box takes, so a colour
     seen here can be reused there without going hunting for it. */
  document.getElementById("legend").innerHTML = used.map(s =>
    '<span class="item"><input type="color" data-subject="' + esc(s) + '" value="' +
    esc(colorFor(s).bg) + '">' + esc(s) +
    '<input type="text" class="hex" spellcheck="false" data-subject="' + esc(s) +
    '" value="' + esc(colorFor(s).bg) + '" size="8" title="' +
    esc(t("colourCode")) + '"></span>').join("");
  document.querySelectorAll("#legend input[type=color]").forEach(inp => {
    inp.addEventListener("input", () => {
      setColour(inp.dataset.subject, inp.value);
    });
  });
  /* The code is the control, not a caption: focusing it selects the whole
     value so it can be copied straight into an event, and typing or pasting a
     new one sets the colour. The system colour panel behind the swatch is a
     different program's window and cannot be given a field like this. */
  document.querySelectorAll("#legend .hex").forEach(field => {
    field.addEventListener("focus", () => field.select());
    field.addEventListener("input", () => {
      const hex = asHex(field.value);
      if (hex) setColour(field.dataset.subject, hex);
    });
    field.addEventListener("blur", () => {
      field.value = colorFor(field.dataset.subject).bg;
    });
  });
}

function renderLanguages() {
  const sel = document.getElementById("lang");
  sel.innerHTML = DATA.languages.map(l =>
    '<option value="' + esc(l[0]) + '"' + (l[0] === state.lang ? " selected" : "") +
    ">" + esc(l[1]) + "</option>").join("");
}

function renderSchools() {
  const sel = document.getElementById("school");
  sel.innerHTML = SCHOOLS.map(s =>
    '<option value="' + esc(s.n) + '"' + (s.n === currentSchool().n ? " selected" : "") +
    ' title="' + esc(s.t) + '">' + esc(s.l) + "</option>").join("");
}

function renderClasses() {
  const sel = document.getElementById("klass");
  sel.innerHTML = currentSchool().c.map(c =>
    '<option value="' + esc(c.n) + '"' + (c.n === currentClass().n ? " selected" : "") +
    ">" + esc(c.n) + "</option>").join("");
}

function renderDivisions() {
  const host = document.getElementById("divisions");
  const cls = currentClass(), mine = picks();
  document.getElementById("groupsRow").hidden = !cls.v.length;
  if (!cls.v.length) {
    host.innerHTML = "";
    return;
  }
  /* The heading says what is taught in the group. Divisions carrying more
     subjects than fit are shortened with an ellipsis, and the whole list is the
     label's tooltip. */
  host.innerHTML = cls.v.map(d => {
    const head = d.l || d.groups.join(" / ");
    const full = (d.sj || []).join(", ");
    return '<div class="field"><label' + (full ? ' title="' + esc(full) + '"' : "") + ">" +
    esc(head) +
    (d.l ? '<br><span class="divsub">' + esc(d.groups.join(" / ")) + "</span>" : "") +
    "</label>" +
    '<select data-div="' + esc(d.id) + '"><option value="">' + esc(t("all")) + "</option>" +
    d.groups.map(g => '<option value="' + esc(g) + '"' +
      (mine[d.id] === g ? " selected" : "") + ">" + esc(g) + "</option>").join("") +
    "</select></div>";
  }).join("");
  host.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", () => {
      pickable()[sel.dataset.div] = sel.value;
      save(); render();
    });
  });
}

document.getElementById("school").addEventListener("change", (ev) => {
  state.school = ev.target.value;
  state.klass = currentSchool().c[0].n;   // class lists differ between schools
  save(); renderClasses(); renderDivisions(); syncPerClassInputs(); render();
});
document.getElementById("klass").addEventListener("change", (ev) => {
  state.klass = ev.target.value;
  save(); renderDivisions(); syncPerClassInputs(); render();
});

function bindToggle(id, key) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => { state[key] = el.checked; save(); render(); });
}
function bindChoice(name, key) {
  document.querySelectorAll('input[name="' + name + '"]').forEach(radio => {
    radio.addEventListener("change", () => {
      if (radio.checked) { state[key] = radio.value; save(); render(); }
    });
  });
}
["showWho", "showSchool", "showClass",
 "showTeacher", "showRoom", "showGroup", "showSubject",
 "schoolColors", "customColours"].forEach(key => bindToggle(key, key));
bindChoice("teacherName", "teacherName");
bindChoice("subjectName", "subjectName");

/* The controls follow the state, and the two that only make sense alongside
   something else — how to write a name, which colours to pick — dim or vanish
   when that something is switched off. */
function syncDisplayControls() {
  for (const key of ["showWho", "showSchool", "showClass",
                     "showTeacher", "showRoom", "showGroup", "showSubject",
                     "schoolColors", "customColours"]) {
    document.getElementById(key).checked = !!state[key];
  }
  for (const [name, key] of [["teacherName", "teacherName"], ["subjectName", "subjectName"]]) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(radio => {
      radio.checked = radio.value === state[key];
    });
  }
  document.getElementById("teacherChoice").classList.toggle("off", !state.showTeacher);
  document.getElementById("subjectChoice").classList.toggle("off", !state.showSubject);
  document.getElementById("colourPicker").classList.toggle("off", !state.customColours);
}
/* Clicking a lesson opens a colour picker anchored under it. The input is a
   permanent hidden node, so nothing rebuilds it while the picker is open. */
const pick = document.getElementById("pick");
document.getElementById("grid").addEventListener("click", (ev) => {
  const box = ev.target.closest("[data-subject]");
  if (!box) return;
  const subject = box.dataset.subject;
  const rect = box.getBoundingClientRect();
  pick.style.left = (rect.left + window.scrollX) + "px";
  pick.style.top = (rect.bottom + window.scrollY) + "px";
  pick.dataset.subject = subject;
  pick.value = colorFor(subject).bg;
  pick.click();
});
pick.addEventListener("input", () => setColour(pick.dataset.subject, pick.value));
/* The colour panel keeps the keyboard while it is open. Hand focus back when it
   closes, so the next thing typed goes to the page and not into a dead input. */
pick.addEventListener("change", () => pick.blur());

document.getElementById("lang").addEventListener("change", (ev) => {
  state.lang = ev.target.value;
  save(); applyStrings(); renderDivisions(); render();
});

document.getElementById("reset").addEventListener("click", () => {
  const { school, klass, lang } = state;
  state = Object.assign(defaults(), { school, klass, lang });
  save();
  renderDivisions(); render();
});

/* Everything the reader has customised — group picks, colours, personal
   events, names, display options — is just `state`, so a backup is that object.
   It is filled in when the section is opened, not kept in step continuously. */
const advancedPanel = document.getElementById("advancedPanel");
const settingsText = document.getElementById("settingsText");
const settingsMsg = document.getElementById("settingsMsg");

advancedPanel.addEventListener("toggle", () => {
  if (advancedPanel.open) {
    settingsText.value = JSON.stringify(state, null, 2);
    settingsMsg.textContent = "";
  }
});
/* Sharing is copying the address, since the address is the whole configuration. */
document.getElementById("share").addEventListener("click", async () => {
  const button = document.getElementById("share");
  try {
    await navigator.clipboard.writeText(shareUrl());
    button.textContent = t("shared");
  } catch (e) {
    button.textContent = t("settings.selected");
  }
  button.title = t("shareHint");
  setTimeout(() => { button.textContent = t("share"); }, 2500);
});
document.getElementById("copySettings").addEventListener("click", async () => {
  settingsText.value = JSON.stringify(state, null, 2);
  try {
    await navigator.clipboard.writeText(settingsText.value);
    settingsMsg.textContent = t("settings.copied");
  } catch (e) {
    settingsText.select();
    settingsMsg.textContent = t("settings.selected");
  }
});
document.getElementById("applySettings").addEventListener("click", () => {
  let incoming;
  try {
    incoming = JSON.parse(settingsText.value);
  } catch (e) {
    settingsMsg.textContent = t("settings.badJson", e.message);
    return;
  }
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    settingsMsg.textContent = t("settings.notObject");
    return;
  }
  state = normalise(incoming);
  if (!SCHOOLS.some(x => x.n === state.school)) state.school = DATA.initialSchool;
  if (!currentSchool().c.some(c => c.n === state.klass)) state.klass = currentSchool().c[0].n;
  save();
  renderLanguages(); renderSchools(); renderClasses();
  applyStrings(); renderDivisions(); syncPerClassInputs(); render();
  settingsMsg.textContent = t("settings.applied");
});

/* Text fields keep the state up to date on every keystroke but only repaint on
   a short timer, so a long line is never typed against a redraw. The redraw
   leaves the legend alone as well: rebuilding it would close an open picker. */
/* Typing into a field whose line is switched off would do nothing visible, so
   writing something turns it back on. Clearing it does not turn it off again:
   emptying a box is not the same as asking for the line to go away. */
function reveal(key) {
  if (!key || state[key]) return;
  state[key] = true;
  const box = document.getElementById(key);
  if (box) box.checked = true;
}

function typed(el, bag, shows) {
  let timer = 0;
  el.addEventListener("input", () => {
    state[bag][picksKey()] = el.value;
    if (el.value.trim()) reveal(shows);
    save();
    clearTimeout(timer);
    timer = setTimeout(paint, 150);
  });
}
const who = document.getElementById("who");
const eventsBox = document.getElementById("events");
const titleSchool = document.getElementById("titleSchool");
const titleClass = document.getElementById("titleClass");
typed(who, "who", "showWho");
typed(eventsBox, "events");
typed(titleSchool, "titleSchool", "showSchool");
typed(titleClass, "titleClass", "showClass");

/* These two show what the timetable calls itself until someone types over it.
   An empty box would mean retyping the whole name to change one word, so
   entering the field fills in what is currently shown; leaving it having
   changed nothing empties it again, so the setting stays unset and the shared
   link stays short. */
for (const [field, key, shows] of [[titleSchool, "titleSchool", "showSchool"],
                                   [titleClass, "titleClass", "showClass"]]) {
  field.addEventListener("focus", () => {
    if (!field.value) field.value = field.placeholder;
  });
  field.addEventListener("blur", () => {
    if (field.value.trim() === field.placeholder.trim()) field.value = "";
    if (field.value !== perClass(key)) {
      state[key][picksKey()] = field.value;
      if (field.value.trim()) reveal(shows);
      save();
      paint();
    }
  });
}
/* Never write over a field the reader is in the middle of typing into. The two
   title fields show what the timetable calls itself until someone types over
   it, so an empty box and the school's own wording look the same. */
function syncPerClassInputs() {
  const school = currentSchool(), cls = currentClass();
  if (document.activeElement !== who) who.value = perClass("who");
  if (document.activeElement !== eventsBox) eventsBox.value = perClass("events");
  if (document.activeElement !== titleSchool) {
    titleSchool.value = perClass("titleSchool");
    titleSchool.placeholder = school.l;
  }
  if (document.activeElement !== titleClass) {
    titleClass.value = perClass("titleClass");
    titleClass.placeholder = t("classN", cls.n);
  }
}
/* Printing is a moment, not a setting: lay the page out for paper, print it,
   put it back. Nothing about it is worth remembering between visits. */
document.getElementById("doprint").addEventListener("click", () => {
  printing = true;
  try {
    render();
    window.print();
  } finally {
    printing = false;
    render();
  }
});

/* ----- counting the visit ------------------------------------------------
   The counter is told what to record rather than left to read the page, because
   what it would read is the heading, and the heading can hold a child's name.
   What goes out is the school's own name for this timetable and nothing else:
   never `titleParts`, which folds in whatever the reader typed.

   It is sent as a path as well as a title. The counter keeps one title per
   path, so a varying title on a fixed path would collapse every class into one
   row labelled by whichever visit happened last. The reader's address bar is
   not involved — this is a string in a beacon.

   Once per load, on the timetable that was open when the page came up: the one
   restored from last time, or the one a shared link asked for. Switching class
   afterwards is not another visit. */
function countVisit() {
  const tag = document.getElementById("gc");
  if (!tag) return;                       // built without a counter: nothing to do
  const school = currentSchool(), cls = currentClass();
  if (!school || !cls) return;
  /* One address whichever way it was reached, so /timetable/ and
     /timetable/index.html do not become two rows. */
  const here = location.pathname.replace(/\/*(index\.html)?\/*$/, "");
  const klass = String(cls.n).trim();
  /* Always English, whatever the reader picked: the title is stored per path
     and the last visit wins, so a label that followed the interface language
     would flip between "class 8" and "8. klass" for the same row. The school's
     own name is left as the school writes it. */
  const fixed = DATA.strings.en || {};
  const label = {
    path: here + "/" + school.n + "/" + klass,
    title: school.l + ", " + (fixed.classN || "{0}").split("{0}").join(klass),
    referrer: "",
  };
  const send = () => {
    try { window.goatcounter.count(label); } catch (e) {}
  };
  if (window.goatcounter && typeof window.goatcounter.count === "function") send();
  else tag.addEventListener("load", send, { once: true });
}

renderLanguages();
renderSchools();
renderClasses();
applyStrings();
renderDivisions();
syncPerClassInputs();
render();
countVisit();
