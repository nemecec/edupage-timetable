"use strict";
const DATA = JSON.parse(document.getElementById("data").textContent);
const SCHOOLS = DATA.schools;
const KEY = "tt:" + DATA.edupage + ":" + DATA.year;

/* The saved settings, and the names they go by.
 *
 * Two rules the shape follows. Names match what the interface calls things, so
 * a reader looking at the JSON in the Advanced panel can tell which control
 * each field belongs to. And everything that belongs to one class lives in that
 * class's own subtree under `classes`, rather than each setting holding its own
 * map of classes — one place to look, one place to copy.
 *
 * `classes` is a map rather than the class keys sitting at the top level, so a
 * class named "lang" cannot collide with a setting called that.
 */
const defaults = () => ({
  lang: DATA.lang,
  school: DATA.initialSchool,
  class: DATA.initialClass,

  showStudentName: false, showSchoolName: true, showClassName: true,
  showTeacher: true, teacherNameStyle: "short",
  showRoom: true, showGroup: true,
  showSubject: true, subjectNameStyle: "full",

  /* What every subject does unless it says otherwise. One question, three
     answers — it was two checkboxes that quietly layered on each other, which
     no one could have guessed from looking. */
  subjectColorStyle: "custom",          // "palette" | "school" | "custom"

  /* Per subject, and only where the reader has said something: a colour they
     chose, a style that differs from the one above, or both. This is what lets
     a timetable run on the school's own colours with one subject pulled out in
     a colour of your own — which the single global switch could not express.
     Not per class: a subject keeps its colour wherever it turns up. */
  subjectColors: {},

  classes: {},
});

/* What one class remembers. `studyGroups` is keyed by the choice on offer —
   "Alfa/Beeta/Gamma" — rather than by aSc's internal division id ("*5:1"),
   which is unreadable and means nothing outside the feed. */
const classDefaults = () => ({
  studyGroups: {},
  studentName: "",
  events: [],
  schoolName: "",
  className: "",
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

const STYLES = ["palette", "school", "custom"];

/* What one subject is allowed to say about itself: a colour, a style, or both.
   An entry saying neither is nothing at all and is dropped, which is what keeps
   the map to the handful of subjects somebody actually touched. */
function onlySubjectColours(bag) {
  const out = {};
  for (const [subject, value] of Object.entries(bag || {})) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const kept = {};
    if (STYLES.includes(value.style)) kept.style = value.style;
    for (const field of ["backgroundColor", "textColor"]) {
      if (typeof value[field] === "string" && HEX.test(value[field].trim())) {
        kept[field] = value[field].trim();
      }
    }
    if (Object.keys(kept).length) out[subject] = kept;
  }
  return out;
}

/* Three letters, English, in the JSON — short enough to read at a glance and
   the same whatever language the interface is in. The interface shows the
   reader's own language; only the stored form is fixed. */
const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const clock = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "").trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  return h < 24 && min < 60 ? h * 60 + min : null;
};

const asClock = (mins) =>
  String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");

/* One saved event, or null if it is not one. Everything here comes from a file
   someone edited or a link someone sent, so nothing is assumed. */
function oneEvent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const day = DAY_KEYS.indexOf(String(raw.day));
  const a = clock(raw.startTime), z = clock(raw.endTime);
  if (day < 0 || a === null || z === null || z <= a) return null;
  const colour = (v) => (typeof v === "string" && HEX.test(v.trim())) ? v.trim() : "";
  return {
    day: DAY_KEYS[day],
    startTime: asClock(a),
    endTime: asClock(z),
    backgroundColor: colour(raw.backgroundColor) || "#DDDDDD",
    textColor: colour(raw.textColor),      // empty means: work it out
    label: typeof raw.label === "string" ? raw.label : "",
  };
}

function oneClass(raw) {
  const base = classDefaults();
  const was = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  const out = Object.assign({}, base);
  if (was.studyGroups && typeof was.studyGroups === "object" &&
      !Array.isArray(was.studyGroups)) {
    for (const [choice, picked] of Object.entries(was.studyGroups)) {
      if (typeof picked === "string") out.studyGroups[choice] = picked;
    }
  }
  for (const key of ["studentName", "schoolName", "className"]) {
    if (typeof was[key] === "string") out[key] = was[key];
  }
  out.events = Array.isArray(was.events)
    ? was.events.map(oneEvent).filter(Boolean) : [];
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
  for (const [key, allowed] of [["teacherNameStyle", ["short", "full"]],
                                ["subjectNameStyle", ["short", "full"]],
                                ["subjectColorStyle", ["palette", "school", "custom"]]]) {
    if (!allowed.includes(out[key])) out[key] = base[key];
  }
  if (!DATA.languages.some(l => l[0] === out.lang)) out.lang = DATA.lang;
  out.subjectColors = onlySubjectColours(out.subjectColors);
  const classes = {};
  for (const [key, value] of Object.entries(out.classes)) classes[key] = oneClass(value);
  out.classes = classes;
  return out;
}

let state = defaults();
try {
  state = normalise(JSON.parse(localStorage.getItem(KEY) || "null"));
} catch (e) { /* corrupt or unavailable storage: fall back to defaults */ }
/* A link wins over what this browser had, since following one is a request to
   see that. The per-class bags merge rather than replace, so a link for one
   class does not wipe the choices made for a sibling's.

   A named function rather than a block, so a test can hand it a link and look
   at what comes out. This is the one place untrusted input reaches the page. */
function applyShared(shared, current) {
  const merged = normalise(Object.assign({}, current, shared));
  /* Classes merge rather than replace: a link for one class must not wipe what
     was set up for a sibling's. The link only ever carries one, and only the
     fields that were set, so the rest of that class's own settings survive. */
  if (shared.classes && typeof shared.classes === "object") {
    merged.classes = Object.assign({}, current.classes);
    for (const [key, sub] of Object.entries(shared.classes)) {
      merged.classes[key] = oneClass(Object.assign({}, current.classes[key], sub));
    }
  }
  if (shared.subjectColors && typeof shared.subjectColors === "object") {
    /* Merged after normalise, so these have not been through it. Nothing
       hostile survives the escaping at the sinks either way, but a link's junk
       should not end up saved. */
    merged.subjectColors = onlySubjectColours(
      Object.assign({}, current.subjectColors, shared.subjectColors));
  }
  return merged;
}

{
  const shared = readUrl();
  if (shared) {
    state = applyShared(shared, state);
    /* Keep what the link brought, so closing it and coming back later still
       shows the same timetable. */
    try { localStorage.setItem(KEY, JSON.stringify(slim(state))); } catch (e) {}
  }
}

/* ----- the address bar carries the settings -------------------------------
   Everything chosen lives in the fragment, so a bookmark keeps it and a link
   hands it to someone else. Only what differs from the defaults goes in, which
   keeps a typical link short — short enough to put in a QR code. The fragment
   never leaves the browser, so nothing is sent anywhere by carrying it. */
/* Declarations, not arrow constants: the state is read out of the address bar
   before this point in the file, and a const would still be in its dead zone. */
function toB64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).split("+").join("-").split("_").join("_")
                     .split("/").join("_").split("=").join("");
}
function b64url(text) { return toB64url(new TextEncoder().encode(text)); }
function fromB64url(code) {
  const padded = code.split("-").join("+").split("_").join("/");
  const binary = atob(padded + "===".slice((padded.length + 3) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function unb64url(code) { return new TextDecoder().decode(fromB64url(code)); }

/* ----- squeezing the settings into the fragment ---------------------------
   Settings are mostly repeated words — field names, class keys, hex codes — so
   they compress hard: a link carrying every subject recoloured goes from about
   4,800 characters to under 1,000. That is the difference between a printed QR
   code and none, since a code tops out around 2 kB.

   The browser has a gzip of its own in CompressionStream, but it is async, and
   this runs while the page is booting and again on every change. fflate does
   the same job in a function call, which keeps all of that as it was.

   Short settings gain nothing — gzip's header can even make them longer — so
   both forms are produced and the shorter wins. The prefix says which: `s=` is
   plain, `z=` is gzipped.                                                   */
function packSettings(text) {
  const plain = "s=" + b64url(text);
  try {
    const squeezed = "z=" + toB64url(fflate.gzipSync(fflate.strToU8(text), { level: 9 }));
    return squeezed.length < plain.length ? squeezed : plain;
  } catch (e) { return plain; }
}

function unpackSettings(hash) {
  if (hash.startsWith("s=")) return unb64url(hash.slice(2));
  if (hash.startsWith("z=")) return fflate.strFromU8(fflate.gunzipSync(fromB64url(hash.slice(2))));
  return null;
}

/* The written-down form. In memory every field is present, so nothing reading
   the settings has to check first; on the way out the empty ones are dropped,
   because a file full of "" and {} is harder to read than one without them.
   Coming back in, normalise puts them back. */
function slim(value) {
  if (Array.isArray(value)) return value.map(slim);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const kept = slim(raw);
    const empty = kept === "" || kept == null ||
      (typeof kept === "object" && !Object.keys(kept).length);
    if (!empty) out[key] = kept;
  }
  return out;
}

function changedFromDefaults() {
  const base = defaults(), out = {};
  for (const key of Object.keys(base)) {
    if (JSON.stringify(state[key]) !== JSON.stringify(base[key])) out[key] = state[key];
  }
  /* A link is for one class, so it carries that class and no other. It used to
     carry every class the browser had ever been set up for, which meant sharing
     one child's timetable handed over a sibling's name — and made the printed
     QR denser for a class the recipient will never look at. */
  if (out.classes) {
    const here = classKey(), sub = state.classes[here] || {};
    /* Only what was actually set. The subtree always holds all five fields so
       the code reading it never has to check; a link carrying three empty
       strings is just a denser QR code for nothing. */
    const base = classDefaults(), trimmed = {};
    for (const key of Object.keys(base)) {
      if (JSON.stringify(sub[key]) !== JSON.stringify(base[key])) trimmed[key] = sub[key];
    }
    if (Object.keys(trimmed).length) out.classes = { [here]: trimmed };
    else delete out.classes;
  }
  return out;
}

function shareUrl() {
  const changed = changedFromDefaults();
  const bare = location.href.split("#")[0];
  return Object.keys(changed).length
    ? bare + "#" + packSettings(JSON.stringify(slim(changed))) : bare;
}

function readUrl() {
  try {
    const text = unpackSettings(location.hash.slice(1));
    if (text === null) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(slim(state))); } catch (e) {}
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
     denser, and past roughly 2 kB there is no code that will hold it — the
     colours are shared across every class, so a family that has recoloured a
     lot of subjects can get there. Rather than let the code quietly not be
     there, print the address instead: longer to type, but it is the same link
     and it is on the page. */
  const link = printing ? shareUrl() : "";
  const code = link ? qrSvg(link, "36mm") : "";
  const corner = !link ? ""
    : code ? '<div class="qrbox">' + code +
             '<div class="qrhint">' + esc(t("qrHint")) + "</div></div>"
           : '<div class="qrbox"><div class="qrlong">' + esc(t("qrTooLong")) +
             '<br><span class="qraddr">' + esc(link) + "</span></div></div>";
  document.getElementById("foot").innerHTML =
    '<div class="lines">' + bits.join("<br>") + "</div>" + corner;
  document.getElementById("foot").classList.toggle("bare", printing && !bits.length);
}

/* What the heading and both printouts call this timetable. Each part can be
   switched off or written differently — a school's official name is not always
   the one a family uses — and the heading updates as it is typed, so the effect
   is visible before anything is printed. */
function titleParts(school, cls) {
  return {
    student: mine().studentName.trim(),
    school: mine().schoolName.trim() || school.l,
    klass: mine().className.trim() || t("classN", cls.n),
  };
}

function displayTitle(school, cls) {
  const part = titleParts(school, cls);
  const right = [state.showSchoolName ? part.school : "",
                 state.showClassName ? part.klass : ""]
                  .filter(Boolean).join(", ");
  return [state.showStudentName ? part.student : "", right].filter(Boolean).join(" — ");
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

/* A weekday in the reader's language, without a school to take it from — the
   events table is the reader's own, not the timetable's. */
function dayName(idx) {
  const table = DATA.strings[state.lang] || DATA.strings.en;
  return (table.days || [])[idx] || DAY_KEYS[idx];
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
  return school.c.find(c => c.n === state.class) || school.c[0];
}
/* Group choices belong to a class, not to the reader, so they are stored per
   school+class and survive switching back and forth. */
/* Abbreviations and the school's own colours, as this school writes them. The
   four timetables are separate documents that spell and colour the same subject
   differently, so this is per school and not one table for all of them. */
function subjectFacts() { return currentSchool().sj || {}; }

function classKey() { return currentSchool().n + "/" + currentClass().n; }

/* Which of a division's groups this reader is in, keyed by the choice on offer.
   The division's own id is aSc's ("*5:1") and means nothing to anyone. */
const choiceKey = (division) => division.groups.join("/");

function readable(bg) {
  /* Three, four, six or eight digits — a short hex is a colour like any other,
     and treating it as unreadable put dark text on a dark box.

     Four and eight carry alpha, and alpha is the whole difference between what
     the colour says and what the eye sees: #00000010 reads as black, so black
     would be given white text, and the box is in fact all but transparent —
     white on white. So the colour is composited over the sheet first, and the
     text is chosen against what will actually be behind it. */
  let hex = String(bg || "").trim().replace("#", "");
  if (/^[0-9a-f]{3,4}$/i.test(hex)) hex = hex.split("").map(c => c + c).join("");
  const m = /^([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) return "#14171A";
  const n = parseInt(m[1], 16);
  const a = m[2] === undefined ? 1 : parseInt(m[2], 16) / 255;
  const over = (c) => c * a + 255 * (1 - a);      // the sheet under it is white
  const ch = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * ch(over(n >> 16 & 255)) + 0.7152 * ch(over(n >> 8 & 255)) +
            0.0722 * ch(over(n & 255));
  const dark = 0.00778;   // luminance of #14171A
  const cr = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  return cr(L, dark) >= cr(L, 1) ? "#14171A" : "#FFFFFF";
}
/* What this subject is set to do — its own answer if it gave one, otherwise
   the one every subject follows. */
function styleFor(subject) {
  return ((state.subjectColors || {})[subject] || {}).style || state.subjectColorStyle;
}

function colorFor(subject) {
  const own = (state.subjectColors || {})[subject] || {};
  const style = own.style || state.subjectColorStyle;
  /* A chosen text colour holds whatever the background came from — the same
     rule the events table follows, and there is no reason for a subject to
     work differently from an event. Empty means: work it out. */
  const paint = (bg) => ({ bg: bg, fg: own.textColor || readable(bg) });
  if (style === "custom" && own.backgroundColor) return paint(own.backgroundColor);
  if (style === "school") {
    /* Only where the school set one. A subject it never coloured falls through
       to the palette rather than coming out blank. */
    const bg = (subjectFacts()[subject] || {}).color;
    if (bg) return paint(bg);
  }
  const base = DATA.palette[subject] || { bg: "#EEEEEE", fg: "#14171A" };
  return own.textColor ? paint(base.bg) : base;
}

/* An entry that says nothing is not worth keeping, in storage or in a link. */
function tidySubjects() {
  for (const [subject, entry] of Object.entries(state.subjectColors || {})) {
    if (entry.style === state.subjectColorStyle) delete entry.style;
    if (!entry.style && !entry.backgroundColor && !entry.textColor) {
      delete state.subjectColors[subject];
    }
  }
}

/* A lesson is mine when every division it belongs to matches one of my picks.
   Whole-class lessons carry no groups and are always mine. */
function visible(entry, picked, divisions) {
  /* A lesson in no group is the whole class's, and a lesson is shown until a
     pick rules it out — both fall out of the loop below reaching its end, so
     neither needs a guard of its own. One was here, and no test could tell
     whether it worked, because removing it changed nothing. */
  if (!Object.values(picked).filter(Boolean).length) return true;
  for (const div of divisions) {
    if (!entry.g.some(g => div.groups.includes(g))) continue;
    const pick = picked[choiceKey(div)];
    if (pick && !entry.g.includes(pick)) return false;
  }
  return true;
}

/* ----- my own events -------------------------------------------------------
   Filled in a row at a time in the panel, and stored as they are shown:
       { day: "Mon", startTime: "17:15", endTime: "18:15",
         backgroundColor: "#F6F2C1", textColor: "", label: "Dance training" }
   There was a line-by-line syntax here once. A table needs no syntax, cannot
   be mistyped, and gives the colours a picker instead of a spelling.        */

const isColour = (c) => !!(window.CSS && CSS.supports && CSS.supports("color", c));

/* What an event writes with: its own text colour if one was chosen, otherwise
   whichever of black or white reads better on its background. */
function eventFg(ev) { return ev.fg || readable(cssColour(ev.bg)); }

/* Saved events into the shape the timeline draws, complaining about any that
   cannot be drawn. The table keeps most nonsense out, but the same list can
   arrive from a pasted backup or a link, where nothing was validated. */
function readEvents(list) {
  const out = [], errors = [];
  (Array.isArray(list) ? list : []).forEach((ev, i) => {
    const row = i + 1;
    const a = clock(ev && ev.startTime), z = clock(ev && ev.endTime);
    const day = DAY_KEYS.indexOf(String(ev && ev.day));
    if (day < 0 || a === null || z === null) {
      errors.push(t("events.line", row, t("events.badRange"))); return;
    }
    if (!(z > a)) { errors.push(t("events.line", row, t("events.backwards"))); return; }
    for (const c of [ev.backgroundColor, ev.textColor]) {
      if (c && !isColour(c)) {
        errors.push(t("events.line", row, t("events.badColour", JSON.stringify(c))));
        return;
      }
    }
    out.push({ day: day, a: a, z: z, fg: ev.textColor || null,
               bg: ev.backgroundColor || "#DDDDDD",
               label: String(ev.label || ""), mine: true });
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
     here at once, which is the only way to see what will print. Both views draw
     it — a printed sheet with no school, class or name on it is of no use to
     anyone. */
  let h = sheetTitle(school, cls);
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
      const e = it.lesson, col = colorFor(e.s), info = subjectFacts()[e.s] || {};
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


/* Named CSS colours have to become hex before luminance can be measured. */
const _swatch = document.createElement("span");
function cssColour(value) {
  _swatch.style.color = "";
  _swatch.style.color = value;
  document.body.appendChild(_swatch);
  const rgb = getComputedStyle(_swatch).color;
  document.body.removeChild(_swatch);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(rgb);
  if (!m) return "#888888";
  const hex = "#" + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, "0")).join("");
  /* Keep the alpha. Dropping it turned `transparent` into solid black, which
     was then given white text and drawn as nothing at all. */
  const a = m[4] === undefined ? 1 : parseFloat(m[4]);
  return a >= 1 ? hex
    : hex + Math.round(a * 255).toString(16).padStart(2, "0");
}

/* The timeline is the view. A school with no times anywhere — no day plan
   written here, and none of its own in EduPage — has nothing to draw one from,
   so it falls back to the raw aSc period grid rather than rendering nothing.
   Nothing to choose; the data decides. */
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
  const facts = subjectFacts();
  const one = (name) => short ? ((facts[name] || {}).short || name) : name;
  return (e.S && e.S.length ? e.S : [e.s]).map(one).join(" + ");
}

/* The subject as the reader asked to see it, or nothing at all. */
function lessonTitle(e) {
  if (!state.showSubject) return "";
  return subjectName(e, state.subjectNameStyle === "short");
}

/* Teacher names: the school's abbreviation, the full name, or neither. */
function teacherText(e) {
  if (!state.showTeacher) return "";
  const names = state.teacherNameStyle === "full" ? e.T : e.t;
  return (names || []).join(" / ");
}

/* What this class remembers, read-only. Reading must not write: creating the
   subtree on read put an empty one for every class ever looked at into the
   share link, which makes the printed QR code denser for no reason. */
function mine() {
  const got = (state.classes || {})[classKey()];
  return (got && typeof got === "object") ? got : classDefaults();
}

/* The same subtree, to write into — so it has to exist. */
function myOwn() {
  const key = classKey();
  if (!state.classes || typeof state.classes !== "object") state.classes = {};
  if (!state.classes[key] || typeof state.classes[key] !== "object") {
    state.classes[key] = classDefaults();
  }
  return state.classes[key];
}

/* A class subtree with nothing in it is not worth keeping — in storage, in a
   link, or in the QR code that link is printed as. */
function tidy() {
  for (const [key, sub] of Object.entries(state.classes || {})) {
    const empty = !sub.studentName.trim() && !sub.schoolName.trim() &&
                  !sub.className.trim() && !sub.events.length &&
                  !Object.keys(sub.studyGroups).length;
    if (empty) delete state.classes[key];
  }
}

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

/* Columns of the fallback grid. Only a school with no usable day plan gets
   here, so these are always aSc's raw periods. */
function columnModel(school) {
  return school.p.map(p => ({ p: p }));
}

function columnLabel(school, cls, col) {
  if (!school.ts) return esc(col.p.l);
  return esc(col.p.l) + '<br><span class="slottime">' + esc(col.p.s + "–" + col.p.e) + "</span>";
}

function sheetTitle(school, cls) {
  const named = displayTitle(school, cls);
  return named ? '<div class="ptitle sheet">' + esc(named) + "</div>" : "";
}

function bodyCell(cls, dayIdx, col, bucket) {
  return "<td>" + (bucket.get(dayIdx + ":p" + col.p.n) || [])
    .map(e => lessonHtml(e, e.c ? "" : e.w)).join("") + "</td>";
}

/* One landscape sheet is the whole point of the printout, and how tall it
   wants to be depends on the class: several lessons in one cell, a canteen
   sitting spelled out inside a break, a row of personal events, a day that runs
   from seven in the morning to ten at night because someone added an entry
   there. So it is drawn and measured rather than guessed at from constants —
   the footer alone changes size with the QR code and the language, and a guess
   that was right once quietly stops being right. */
const SHEET_H = 726;              // 210mm less two 9mm margins, at 96dpi
const SHEET_BUDGET = SHEET_H - 8; /* a few pixels in hand: the print layout
   rounds differently from the screen one, and landing exactly on the limit
   means landing just past it. */

/* The largest scale at which everything still fits, footer and all.
   `draw(scale)` puts the page together at that scale; the answer is fed back to
   whichever renderer asked. Bisection alone is not enough — the smallest scale
   it will consider has to be measured too, or a day wide enough to defeat even
   that gets returned as if it fitted. */
function fitToSheet(draw, small, big) {
  const grid = document.getElementById("grid");
  const keep = grid.innerHTML;
  const fits = (scale) => {
    draw(scale);
    return grid.getBoundingClientRect().height + footHeight() <= SHEET_BUDGET;
  };
  let best = null;
  for (let step = 0; step < 9; step++) {
    const mid = (small + big) / 2;
    if (fits(mid)) { best = small = mid; } else big = mid;
  }
  /* Nothing in the range fitted. Take the floor anyway — one crowded class
     spilling onto a second sheet is better than refusing to print — but only
     after checking, so the floor is never returned untested. */
  if (best === null) best = small;
  /* Leave the page drawn at the scale that won, not at whichever one the last
     probe happened to try, and not at whatever was on screen before. */
  if (draw(best) === RESTORE_PREVIOUS) grid.innerHTML = keep;
  return best;
}

/* A renderer that only measures — its caller redraws afterwards — says so, and
   gets the previous markup put back instead. */
const RESTORE_PREVIOUS = "restore";

function fitTimeline(school, cls, shown, mine) {
  return fitToSheet((scale) => {
    document.getElementById("grid").innerHTML =
      renderTimeline(school, cls, shown, mine, scale);
    return RESTORE_PREVIOUS;      // render() draws the real one with the answer
  }, 0.25, 3.0);
}

/* The same for the plain grid, which a school with no day plan gets. It used to
   print at whatever size it happened to be, which for a class with many rows
   was two or three sheets. */
function fitGrid(html) {
  const grid = document.getElementById("grid");
  return fitToSheet((s) => {
    grid.innerHTML = html;
    grid.style.setProperty("--grid", s);
  }, 0.4, 1.0);
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
  state.school = school.n; state.class = cls.n;
  syncDisplayControls();
  syncPerClassInputs();

  renderFooter(school);
  document.title = displayTitle(school, cls) || t("classN", cls.n);
  renderSubtitle(school);

  const picked = mine().studyGroups;
  const timeline = onTimeline();
  const shown = cls.e.filter(e => visible(e, picked, cls.v))
                     .filter(e => !timeline || !e.c);   // one box per lesson
  const parsed = readEvents(mine().events);
  document.getElementById("evwarn").textContent = parsed.errors.join("\n");

  if (printing) document.body.classList.add("printview");
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

  /* Only the grid reads this, and only the grid gets this far. */
  const bucket = new Map();
  for (const e of shown) {
    const k = e.d + ":p" + e.p;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(e);
  }

  const cols = columnModel(school);
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
  const table = sheetTitle(school, cls) + h + "</tbody></table>";
  const grid = document.getElementById("grid");
  if (printing) {
    fitGrid(table);
  } else {
    grid.style.removeProperty("--grid");
    grid.innerHTML = table;
  }

  const total = cls.e.filter(e => !timeline || !e.c).length;
  document.getElementById("count").textContent =
    t("slotsShown", shown.length, total) +
    (shown.length === total ? " " + t("noFilter") : "") +
    (parsed.events.length ? " · " + t("mineCount", parsed.events.length) : "") +
    (school.b ? "" : " · " + t("noBells"));
  if (!keepLegend) renderLegend(shown);
}

function setTextColour(subject, value, redraw) {
  const entry = state.subjectColors[subject] || (state.subjectColors[subject] = {});
  if (value) entry.textColor = value; else delete entry.textColor;
  tidySubjects();
  save();
  /* Only the auto tick rebuilds the legend, because only it changes what the
     row looks like. Doing it on every colour picked would tear the row out from
     under the open colour panel, which is what `keepLegend` exists to avoid. */
  if (redraw) render(); else paint();
}

function setColour(subject, value) {
  const entry = state.subjectColors[subject] || (state.subjectColors[subject] = {});
  entry.backgroundColor = value;
  /* Choosing a colour is asking for it — for this subject, not for every one.
     If everything is already on its own colours there is nothing to say. */
  if (state.subjectColorStyle !== "custom") entry.style = "custom";
  tidySubjects();
  syncDisplayControls();
  save();
  paint();
  const row = document.querySelector('#legend tr[data-subject="' +
                                     cssQuote(subject) + '"]');
  const swatch = row && row.querySelector(".bgpick");
  if (swatch && swatch.value !== value) swatch.value = value;
}

/* A subject name goes into a selector, and aSc's names contain quotes and
   backslashes as readily as anything else. */
function cssQuote(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderLegend(shown) {
  document.getElementById("share").title = t("shareHint");
  const used = [...new Set(shown.map(e => e.s))].sort();
  /* One real lesson per subject, so the sample carries the room and teacher the
     boxes actually show rather than an empty shape. */
  const example = {};
  for (const e of shown) if (!example[e.s]) example[e.s] = e;
  /* A row per subject, in the same columns an event uses, so the two lists read
     the same way. The three ways a subject can get its background are the three
     the switch above offers, said per subject rather than through a dropdown
     whose entries meant nothing on their own. */
  document.getElementById("legend").innerHTML = used.map((name, i) => {
    const col = colorFor(name), own = (state.subjectColors || {})[name] || {};
    const row = "s" + i;
    return '<tr data-subject="' + esc(name) + '">' +
      '<td class="rowlabel">' + esc(name) + "</td>" +
      backgroundCell(row, subjectMode(name), col.bg,
        [["school", t("colour.fromTimetable"), ""],
         ["palette", t("colour.automatic"), ""]]) +
      textColourCell(row, col.fg, !own.textColor) +
      previewCell(col.bg, col.fg, false, sampleWhen("9:00"),
                  lessonTitle(example[name] || { s: name, S: 0 }),
                  (example[name] ? detailLine(example[name]) : []).join(" · ")) +
      "</tr>";
  }).join("");
}

/* Both lists behave the same, so both are driven from here. */
/* Which of the three a subject is really on. A style of "custom" with no
   colour behind it draws from the palette, so that is what it says. */
function subjectMode(name) {
  const own = (state.subjectColors || {})[name] || {};
  const style = styleFor(name);
  if (style === "school") return "school";
  if (style === "custom" && own.backgroundColor) return "own";
  return "palette";
}

function subjectOf(target) {
  const tr = target.closest("tr");
  return tr && tr.dataset.subject;
}

document.getElementById("legend").addEventListener("input", (e) => {
  const name = subjectOf(e.target);
  if (!name) return;
  const tr = e.target.closest("tr");
  if (e.target.classList.contains("bgpick")) {
    choose(tr, "bg", "own");
    setColour(name, e.target.value);
  } else if (e.target.classList.contains("fgpick")) {
    choose(tr, "fg", "own");
    setTextColour(name, e.target.value);
  }
});

document.getElementById("legend").addEventListener("change", (e) => {
  const name = subjectOf(e.target);
  if (!name || e.target.type !== "radio") return;
  const tr = e.target.closest("tr");
  if (e.target.name.startsWith("fg")) {
    setTextColour(name, e.target.value === "auto" ? "" : colorFor(name).fg, true);
    return;
  }
  if (e.target.value === "own") {
    const swatch = tr.querySelector(".bgpick");
    setColour(name, swatch ? swatch.value : colorFor(name).bg);
  } else {
    const entry = state.subjectColors[name] || (state.subjectColors[name] = {});
    entry.style = e.target.value;
    tidySubjects();
    save();
    paint();
  }
});

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
  const cls = currentClass(), picked = mine().studyGroups;
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
    '<select data-div="' + esc(choiceKey(d)) + '"><option value="">' + esc(t("all")) + "</option>" +
    d.groups.map(g => '<option value="' + esc(g) + '"' +
      (picked[choiceKey(d)] === g ? " selected" : "") + ">" + esc(g) + "</option>").join("") +
    "</select></div>";
  }).join("");
  host.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", () => {
      if (sel.value) myOwn().studyGroups[sel.dataset.div] = sel.value;
      else delete mine().studyGroups[sel.dataset.div];
      tidy(); save(); render();
    });
  });
}

document.getElementById("school").addEventListener("change", (ev) => {
  state.school = ev.target.value;
  state.class = currentSchool().c[0].n;   // class lists differ between schools
  save(); renderClasses(); renderDivisions(); syncPerClassInputs(); render();
});
document.getElementById("klass").addEventListener("change", (ev) => {
  state.class = ev.target.value;
  save(); renderDivisions(); syncPerClassInputs(); render();
});

function bindToggle(id, key) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => { state[key] = el.checked; save(); render(); });
}
function bindChoice(name, key) {
  document.querySelectorAll('input[name="' + name + '"]').forEach(radio => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      state[key] = radio.value;
      if (key === "subjectColorStyle") {
        /* This one says what every subject does, so it means every subject —
           a row still quietly doing its own thing would make the switch a lie.
           Chosen colours are kept, so turning "my own" back on restores them. */
        for (const entry of Object.values(state.subjectColors)) delete entry.style;
        tidySubjects();
      }
      save(); render();
    });
  });
}
["showStudentName", "showSchoolName", "showClassName",
 "showTeacher", "showRoom", "showGroup", "showSubject"].forEach(key => bindToggle(key, key));
bindChoice("teacherNameStyle", "teacherNameStyle");
bindChoice("subjectNameStyle", "subjectNameStyle");
bindChoice("subjectColorStyle", "subjectColorStyle");

/* The controls follow the state, and the two that only make sense alongside
   something else — how to write a name, which colours to pick — dim or vanish
   when that something is switched off. */
function syncDisplayControls() {
  for (const key of ["showStudentName", "showSchoolName", "showClassName",
                     "showTeacher", "showRoom", "showGroup", "showSubject"]) {
    document.getElementById(key).checked = !!state[key];
  }
  for (const name of ["teacherNameStyle", "subjectNameStyle", "subjectColorStyle"]) {
    const key = name;
    document.querySelectorAll('input[name="' + name + '"]').forEach(radio => {
      radio.checked = radio.value === state[key];
    });
  }
  document.getElementById("teacherChoice").classList.toggle("off", !state.showTeacher);
  document.getElementById("subjectChoice").classList.toggle("off", !state.showSubject);

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

/* Everything the reader has customised — group picks, colours, personal
   events, names, display options — is just `state`, so a backup is that object.
   It is filled in when the section is opened, and again by anything in the
   panel that changes what it is a backup of. */
const advancedPanel = document.getElementById("advancedPanel");
const settingsText = document.getElementById("settingsText");
const settingsMsg = document.getElementById("settingsMsg");

document.getElementById("lang").addEventListener("change", (ev) => {
  state.lang = ev.target.value;
  save(); applyStrings(); renderDivisions(); render();
});

document.getElementById("reset").addEventListener("click", () => {
  const { school, klass, lang } = state;
  state = Object.assign(defaults(), { school, klass, lang });
  save();
  /* The backup box sits in this same panel, a few centimetres from this button,
     and is only refilled when the panel is opened. Left alone it would still be
     showing everything that was just cleared — and pressing Apply beside it
     would put all of it back, the child's name included. */
  settingsText.value = JSON.stringify(slim(state), null, 2);
  settingsMsg.textContent = "";
  renderDivisions(); syncPerClassInputs(); render();
});

advancedPanel.addEventListener("toggle", () => {
  if (advancedPanel.open) {
    settingsText.value = JSON.stringify(slim(state), null, 2);
    settingsMsg.textContent = "";
  }
});
/* When the clipboard is unavailable, put the link on the page so it can be
   selected and copied by hand. Selecting it for the reader is as far as this
   can go — nothing but a real gesture may reach the clipboard. */
function showShareFallback(url) {
  const box = document.getElementById("shareBox");
  box.value = url;
  box.classList.remove("off");
  box.focus();
  box.select();
}

/* Sharing is copying the address, since the address is the whole configuration. */
document.getElementById("share").addEventListener("click", async () => {
  const button = document.getElementById("share");
  try {
    await navigator.clipboard.writeText(shareUrl());
    button.textContent = t("shared");
  } catch (e) {
    /* No clipboard — an insecure context, or a browser that refuses. Telling
       the reader to press Cmd/Ctrl+C would be telling them to copy nothing, so
       put the link somewhere it can be read and selected instead. */
    showShareFallback(shareUrl());
    button.textContent = t("shareManual");
  }
  button.title = t("shareHint");
  setTimeout(() => { button.textContent = t("share"); }, 2500);
});
document.getElementById("copySettings").addEventListener("click", async () => {
  settingsText.value = JSON.stringify(slim(state), null, 2);
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
  if (!currentSchool().c.some(c => c.n === state.class)) state.class = currentSchool().c[0].n;
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

function typed(el, field, shows) {
  let timer = 0;
  el.addEventListener("input", () => {
    myOwn()[field] = el.value;
    // Emptied means gone, not remembered as "": kept, empty subtrees pile up
    // one per class ever visited and ride along in every link and QR.
    tidy();
    if (el.value.trim()) reveal(shows);
    save();
    clearTimeout(timer);
    timer = setTimeout(paint, 150);
  });
}
const studentName = document.getElementById("studentName");
const schoolName = document.getElementById("schoolName");
const className = document.getElementById("className");
typed(studentName, "studentName", "showStudentName");
typed(schoolName, "schoolName", "showSchoolName");
typed(className, "className", "showClassName");

/* These two show what the timetable calls itself until someone types over it.
   An empty box would mean retyping the whole name to change one word, so
   entering the field fills in what is currently shown; leaving it having
   changed nothing empties it again, so the setting stays unset and the shared
   link stays short. */
for (const [field, key, shows] of [[schoolName, "schoolName", "showSchoolName"],
                                   [className, "className", "showClassName"]]) {
  field.addEventListener("focus", () => {
    if (!field.value) field.value = field.placeholder;
  });
  field.addEventListener("blur", () => {
    if (field.value.trim() === field.placeholder.trim()) field.value = "";
    if (field.value !== mine()[key]) {
      myOwn()[key] = field.value;
      tidy();
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
  const school = currentSchool(), cls = currentClass(), here = mine();
  if (document.activeElement !== studentName) studentName.value = here.studentName;
  if (document.activeElement !== schoolName) {
    schoolName.value = here.schoolName;
    schoolName.placeholder = school.l;
  }
  if (document.activeElement !== className) {
    className.value = here.className;
    className.placeholder = t("classN", cls.n);
  }
  renderEvents();
}
/* ----- the events table ---------------------------------------------------
   A row per event, and a colour that can be arrived at three ways: copied
   whole from a lesson already on the timetable, chosen as a background with
   the text colour worked out, or chosen as both. The "copy a lesson" control
   is a plain list of the subjects on screen — matching a lesson by eye and
   then hunting for its hex code is exactly the fiddly part. */
const evRows = document.getElementById("evrows");

function subjectsOnScreen() {
  const cls = currentClass();
  return [...new Set(cls.e.filter(e => !e.c).map(e => e.s))].sort();
}

/* One radio per way of arriving at a colour, and the control that goes with it
   beside the radio it belongs to. This was a dropdown with "own colour" as its
   first entry, which said nothing about what the other entries would do, and a
   disabled swatch that swallowed clicks. */
function pickOne(group, row, chosen, choices) {
  return choices.map(([value, label, control]) =>
    '<div class="pickrow"><label class="pick"><input type="radio" name="' +
    group + row + '" value="' + value + '" data-pick="' + value + '"' +
    (value === chosen ? " checked" : "") + ">" + esc(label) + "</label>" +
    (control || "") + "</div>").join("");
}

const swatch = (cls, value) =>
  '<input type="color" class="' + cls + '" value="' + esc(value) + '">';

/* What the choices in this row add up to, drawn the way the timetable draws
   it — same classes, same three lines. Reading a hex code and imagining the
   result is the part nobody can do; this shows it. Sized as a 45-minute lesson,
   which is the common case and tall enough for all three lines. */
function previewCell(bg, fg, outlined, when, label, meta) {
  const style = "background:" + esc(bg) + ";color:" + esc(fg) +
                (outlined ? ";border-color:" + esc(fg) : "");
  return '<td><div class="sample"><div class="ev' + (outlined ? " outlined" : "") +
    '" style="' + style + '">' +
    '<div class="when">' + esc(when) + "</div>" +
    '<div class="what">' + esc(label) + "</div>" +
    (meta ? '<div class="who2">' + esc(meta) + "</div>" : "") +
    "</div></div></td>";
}

/* The colour cells, shared by both tables so the two read the same way. */
function backgroundCell(row, mode, colour, extra) {
  return '<td class="colours"><div class="colcell">' +
    pickOne("bg", row, mode, [["own", t("colour.own"), swatch("bgpick", colour)]]
              .concat(extra)) + "</div></td>";
}

function textColourCell(row, colour, auto) {
  return '<td class="colours"><div class="colcell">' +
    pickOne("fg", row, auto ? "auto" : "own",
            [["own", t("colour.own"), swatch("fgpick", colour)],
             ["auto", t("colour.automatic"), ""]]) + "</div></td>";
}

/* 45 minutes from wherever the row starts, so the sample reads as a real span
   without pretending to be the row's own. */
function sampleWhen(from) {
  const a = clock(from);
  return a === null ? "" : hhmm(a) + "–" + hhmm(a + 45);
}

function eventRow(ev, i) {
  const days = DAY_KEYS.map((d, n) =>
    '<option value="' + d + '"' + (ev.day === d ? " selected" : "") + ">" +
    esc(dayName(n)) + "</option>").join("");
  /* Which subject this colour came from, if it came from one. Read back off
     the colour rather than remembered: one fewer thing to store, and it stays
     right if the subject is recoloured afterwards. */
  const from = subjectsOnScreen().find(name =>
    colorFor(name).bg.toLowerCase() === ev.backgroundColor.toLowerCase());
  /* No "own colour" entry in here: that is the radio above it now. */
  const lessons = subjectsOnScreen().map(name =>
    '<option value="' + esc(name) + '"' + (name === from ? " selected" : "") + ">" +
    esc(name) + "</option>").join("");
  /* Same order as the headings above: when, then what, then how it looks. */
  return '<tr data-i="' + i + '">' +
    '<td><select class="evday">' + days + "</select></td>" +
    '<td><input type="time" class="evstart" value="' + esc(ev.startTime) + '"></td>' +
    '<td><input type="time" class="evend" value="' + esc(ev.endTime) + '"></td>' +
    '<td><input type="text" class="evlabel" value="' + esc(ev.label) + '"></td>' +
    backgroundCell("e" + i, from ? "subject" : "own", ev.backgroundColor,
      [["subject", t("colour.fromSubject"),
        '<select class="evlike"><option value=""></option>' + lessons + "</select>"]]) +
    textColourCell("e" + i, ev.textColor || readable(ev.backgroundColor), !ev.textColor) +
    previewCell(ev.backgroundColor, ev.textColor || readable(ev.backgroundColor),
                !!ev.textColor, sampleWhen(ev.startTime), ev.label, "") +
    '<td><button class="drop" type="button" title="' + esc(t("events.remove")) +
      '">\u00d7</button></td>' +
    "</tr>";
}

function renderEvents() {
  if (evRows.contains(document.activeElement)) return;   // mid-edit: leave it
  evRows.innerHTML = mine().events.map(eventRow).join("");
}

/* One place where a row writes back, so every control behaves the same. */
function rowChanged(tr, change) {
  const list = myOwn().events;
  const ev = list[+tr.dataset.i];
  if (!ev) return;
  change(ev);
  tidy(); save(); paint();
}

/* Touching a control picks the radio it sits beside. Otherwise the swatch under
   "automatic" is a thing you can click that does nothing, which is what the
   disabled one was. */
function choose(tr, group, value) {
  const radio = tr.querySelector('input[name^="' + group + '"][data-pick="' + value + '"]');
  if (radio) radio.checked = true;
}

evRows.addEventListener("input", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const cls = e.target.classList;
  if (cls.contains("evstart")) rowChanged(tr, ev => { ev.startTime = e.target.value; });
  else if (cls.contains("evend")) rowChanged(tr, ev => { ev.endTime = e.target.value; });
  else if (cls.contains("evlabel")) rowChanged(tr, ev => { ev.label = e.target.value; });
  else if (cls.contains("bgpick")) {
    choose(tr, "bg", "own");
    rowChanged(tr, ev => { ev.backgroundColor = e.target.value; });
  } else if (cls.contains("fgpick")) {
    choose(tr, "fg", "own");
    rowChanged(tr, ev => { ev.textColor = e.target.value; });
  }
});

evRows.addEventListener("change", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const cls = e.target.classList, target = e.target;
  if (cls.contains("evday")) { rowChanged(tr, ev => { ev.day = target.value; }); return; }

  if (cls.contains("evlike")) {
    choose(tr, "bg", "subject");
    if (!target.value) return;
    /* The whole scheme, both colours, exactly as that lesson is drawn. */
    const col = colorFor(target.value);
    rowChanged(tr, ev => { ev.backgroundColor = col.bg; ev.textColor = col.fg; });
    renderEventsSoon();
    return;
  }

  if (target.type !== "radio") return;
  const group = target.name.startsWith("bg") ? "bg" : "fg";
  if (group === "fg") {
    rowChanged(tr, ev => {
      ev.textColor = target.value === "auto" ? "" : readable(ev.backgroundColor);
    });
    renderEventsSoon();
  } else if (target.value === "subject") {
    /* Nothing chosen from the list yet — wait for it rather than guessing. */
    const list = tr.querySelector(".evlike");
    if (list && list.value) list.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const own = tr.querySelector(".bgpick");
    if (own) rowChanged(tr, ev => { ev.backgroundColor = own.value; });
  }
});

evRows.addEventListener("click", (e) => {
  const button = e.target.closest("button.drop");
  if (!button) return;
  const tr = button.closest("tr");
  myOwn().events.splice(+tr.dataset.i, 1);
  tidy(); save(); renderEventsSoon(); paint();
});

/* Redrawing while the pointer is still inside the row that caused it loses
   focus mid-click, so it waits for the current event to finish. */
function renderEventsSoon() { setTimeout(() => { evRows.innerHTML = ""; renderEvents(); }, 0); }

document.getElementById("evadd").addEventListener("click", () => {
  myOwn().events.push({ day: "Mon", startTime: "16:00", endTime: "17:00",
                        backgroundColor: "#F6F2C1", textColor: "", label: "" });
  save(); renderEventsSoon(); paint();
});

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
