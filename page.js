"use strict";
const DATA = JSON.parse(document.getElementById("data").textContent);
const SCHOOLS = DATA.schools;
const KEY = "tt:" + DATA.edupage + ":" + DATA.year;

/* Before anything else, because anything else can be what breaks.
 *
 * This used to sit at the bottom of the file. A fault near the top then took
 * the whole script down with it — including the line that would have installed
 * this — so the page came up blank and nobody was told. The one page-breaking
 * fault this is for is exactly the one it could not see.
 *
 * `report` is a function declaration, so it is ready before its own line is
 * reached, and it swallows anything that goes wrong inside it. */
/* Globals a browser extension puts into every page it can reach. A wallet
   extension failing to set window.ethereum has nothing to do with a timetable
   and nothing here can fix it, so it is logged and not alarmed on. */
const INJECTED = ["ethereum", "solana", "web3", "tronWeb", "keplr",
                  "__firefox__", "webkit.messageHandlers"];

/* Why a link was not used, where there was one. Empty means there was nothing
   wrong: either the fragment was ours and readable, or it was not ours at all.
   An anchor somebody appended is not a fault and is not worth a word.

   A link this page wrote and cannot read is a different thing. Left silent, it
   drew the timetable as the page opens and let the reader believe that was
   what was shared — and the usual cause is a link cut short on its way through
   a chat window, which the reader can do something about. */
let linkFault = "";

/* Whether the page opened with a class already chosen — stored here from a
   previous visit, or carried in by a link. It decides one thing: whether the
   filter starts open.

   A reader arriving for the first time has one job, which is to say whose
   timetable this is, and the filter is where that is said. A reader coming
   back has done it, and the panel is then a header taking up the room the
   week wants. */
let cameSetUp = false;

/* A link and a browser that has been here before, saying different things.
 *
 * The link wins while this is unresolved, because following one is a request
 * to see what it carries. But it is not saved over the reader's own settings
 * until they say which they meant — so choosing to keep theirs is always still
 * possible, and nothing is lost by looking. */
let clash = null;                 // { mine, theirs } once there is one

/* What this browser had before any link was read. Declared up here with the
   rest, because the block that fills it runs above the block that reads it —
   and a `let` is not writable before its own line either. */
let stash = null;

/* One page, a handful of reports. A fault inside the drawing code fires on
   every repaint, and a reporter that reports its own reporting never stops.

   Here rather than beside the reporter, because a `const` is not readable
   before its own line runs and the reporter's very first line reads these. A
   fault early enough would otherwise throw inside the reporter, before the try
   that guards it — and an early fault is the one worth hearing about. */
const REPORT_CAP = 5;
let reportsSent = 0;
const reportsSeen = new Set();

if (typeof window.addEventListener === "function") {
  window.addEventListener("error", (ev) => report("error", ev.error || ev.message,
    ev.filename ? ev.filename + ":" + ev.lineno + ":" + ev.colno : ""));
  window.addEventListener("unhandledrejection", (ev) => report("rejection", ev.reason));
}

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
  showTeacher: true, teacherNameStyle: "full",
  showRoom: true, showGroup: true,
  showDuration: true, showGaps: true,
  /* The code in the corner of the printed sheet. Some readers want the sheet
     and not the corner. The address in the other corner stays either way:
     that is where anybody gets a timetable of their own. */
  showQr: true,

  /* Millimetres of paper left blank around the sheet. Five is about as narrow
     as a laser printer will take without clipping, and every millimetre saved
     is a millimetre the timetable can use — which on a tight class is the
     difference between a readable box and a cut line. */
  printMargin: 5,
  showSubject: true, subjectNameStyle: "full",

  /* The three kinds of type in a lesson box, each the reader's to set. The
     subject name is what a reader looks for first, so "automatic" already asks
     for it a little larger than the rest — and where a box has no room for
     that, the box gets what the page has always drawn instead. */
  timeFace: "sans", timeSize: "125",
  nameFace: "sans", nameSize: "150",
  detailFace: "sans", detailSize: "100",
  /* A school writes a register family name first. Nobody says a name that way
     out loud, so the page turns them round — and writes them out in full,
     because an abbreviation is a thing a school uses to fit a name in a cell,
     not a thing a family says. Both are the reader's to put back. */
  teacherNameOrder: "first",          // "last" | "first"

  /* What every subject does unless it says otherwise. One question, three
     answers. It was two checkboxes that quietly layered on each other. Nobody
     can guess that by looking. */
  subjectColorStyle: "custom",          // "palette" | "school" | "custom"

  /* Per subject, and only where the reader has said something: a name of
     their own, a color they chose, a style that differs from the one above, or
     any of those together. This is what lets a timetable run on the school's
     own colors with one subject pulled out in a color of your own. The single
     global switch cannot express that.

     Not per class. A subject keeps its name and its color wherever it turns
     up, which is the point of setting either. */
  subjects: {},

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
/* A color and nothing else. Everything that sets one writes a hex code, and
   these values are concatenated into style attributes — so a link carrying
   anything else is a link trying to write markup, not to pick a color. */
const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function onlyColors(bag) {
  const out = {};
  for (const [subject, value] of Object.entries(bag)) {
    if (typeof value === "string" && HEX.test(value.trim())) out[subject] = value.trim();
  }
  return out;
}

const STYLES = ["palette", "school", "custom"];

/* Millimetres of paper the reader can leave blank. Three is enough: as narrow
   as a printer will take, the usual, and roomy for a hole punch.

   Declared here, above everything, because `normalise` reads it and
   `normalise` is called on the third line of the page's life. A `const` is
   not readable before its own line runs, so declared further down it threw —
   inside the try that guards against unreadable storage, where it was
   swallowed, and then again out loud on the first draw. */
/* Typefaces the page can promise. Nothing is fetched — a page that asks for a
   font from somewhere else is a page that does not open on a train — so these
   are the three families every system has, under the names a reader would use
   rather than the stacks they resolve to.
 *
 * There is no "automatic" among them, because there would be nothing automatic
 * about it: it would resolve to the page's own font, which is the first of the
 * three. A fourth entry that draws exactly like one of the other three is a
 * choice that is not one. The page's own is simply the one selected. */
const FACES = ["sans", "serif", "mono"];
const FACE_STACK = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

/* How large, as a percentage of the size the page has always drawn. A scale
   rather than a size in pixels: the three lines are not the same size to begin
   with, and a printed sheet is drawn smaller than the screen, so a number of
   pixels would mean something different in each of the six places it landed.
 *
 * No "automatic" here either. What the page chooses is a value on this list,
 * and it is the one selected: 150 for the name and 125 for the clock, the two
 * things a reader is looking for, and 100 for the line of room and teacher,
 * which is there to be checked rather than read. A box with no room for that
 * much keeps the sizes the page has always drawn. */
const SIZES = ["90", "100", "115", "125", "150"];

const MARGINS = [5, 9, 14];
/* The clock strip is this wide, and the tear is drawn across it. The
   stylesheet says the same in --gut, and a test holds the two together. */
const GUTTER = 58;
const TEAR = 3;                   // how far the torn edge wanders, in pixels
const TEAR_CLEAR = 8;             // room left for the clock at either end
const TEAR_MIN = 2 * TEAR + 4;    // the shortest tear with a gap still in it
const MM = 96 / 25.4;             // CSS pixels per millimetre, at 96dpi

/* What one subject is allowed to say about itself: a color, a style, a name of
   the reader's own, or that it is not drawn at all. An entry saying none of
   those is nothing at all and is dropped, which is what keeps the map to the
   handful of subjects somebody actually touched. */
function onlySubjects(bag) {
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
    /* A name of the reader's own. Blank means "use the school's". */
    if (typeof value.label === "string" && value.label.trim()) {
      kept.label = value.label;
    }
    /* Only true is worth keeping. False is what every other row already says. */
    if (value.hide === true) kept.hide = true;
    if (Object.keys(kept).length) out[subject] = kept;
  }
  return out;
}

/* Three letters, English, in the JSON — short enough to read at a glance and
   the same whatever language the interface is in. The interface shows the
   reader's own language. Only the stored form is fixed. */
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
  const color = (v) => (typeof v === "string" && HEX.test(v.trim())) ? v.trim() : "";
  return {
    day: DAY_KEYS[day],
    startTime: asClock(a),
    endTime: asClock(z),
    backgroundColor: color(raw.backgroundColor) || "#DDDDDD",
    textColor: color(raw.textColor),      // empty means: work it out
    label: typeof raw.label === "string" ? raw.label : "",
    /* The line under the name, where a lesson shows its room and teacher. A
       training session has a hall and a coach too. */
    note: typeof raw.note === "string" ? raw.note : "",
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
                                ["subjectColorStyle", ["palette", "school", "custom"]],
                                ["teacherNameOrder", ["last", "first"]],
                                ["timeFace", FACES], ["nameFace", FACES],
                                ["detailFace", FACES],
                                ["timeSize", SIZES], ["nameSize", SIZES],
                                ["detailSize", SIZES],
                                ["printMargin", MARGINS]]) {
    if (!allowed.includes(out[key])) out[key] = base[key];
  }
  if (!DATA.languages.some(l => l[0] === out.lang)) out.lang = DATA.lang;
  out.subjects = onlySubjects(out.subjects);
  const classes = {};
  for (const [key, value] of Object.entries(out.classes)) classes[key] = oneClass(value);
  out.classes = classes;
  return out;
}

let state = defaults();
{
  /* Three things can go wrong here and only one of them is ours. A browser
     that refuses storage and a stored value that is not JSON are both normal
     and both mean "open on the defaults". A fault in `normalise` is a fault in
     this page, and one blanket catch around all three said nothing about any
     of them — which is how a broken read went unnoticed while every returning
     reader quietly lost their settings. */
  let stored = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch (e) { /* private window, or storage switched off */ }
  let saved = null;
  if (stored) {
    try {
      saved = JSON.parse(stored);
    } catch (e) { /* not ours to read, so the defaults stand */ }
  }
  if (saved) {
    cameSetUp = true;
    try {
      state = normalise(saved);
    } catch (e) {
      /* Ours. Say so, and open on the defaults rather than on nothing. */
      report("settings", e);
      state = defaults();
    }
  }
  stash = state;
}
/* A link wins over what this browser had, since following one is a request to
   see that. The per-class bags merge rather than replace, so a link for one
   class does not wipe the choices made for a sibling's.

   A named function rather than a block, so a test can hand it a link and look
   at what comes out. This is the one place untrusted input reaches the page. */
/* The link on its own, as the person who sent it has it.
 *
 * Every display setting is the link's, and one it does not carry goes back to
 * what the page opens with rather than to whatever this browser had. The class
 * the link is about is the link's too, name and events and all: mixing one
 * child's after-school events into another child's week is not a merge, it is
 * a mess. Every other class this browser knows about is left alone — a link
 * for one child must not throw away a sibling's setup. */
function linkOnly(shared, current) {
  const base = defaults();
  base.classes = Object.assign({}, current.classes);
  const named = Object.keys((shared && shared.classes) || {});
  for (const key of named) delete base.classes[key];
  return applyShared(shared, base);
}

/* Whether the link says anything this browser does not already say.
 *
 * Not a comparison of two whole states. Storage keeps every setting, including
 * the ones that were the page's own answer on the day they were saved — so the
 * moment a default moves, no stored copy can ever match a link again, and a
 * reader opening their own bookmark a month later would be asked about a
 * setting neither they nor the sender ever chose.
 *
 * Only the keys the link actually names are compared. Those are the only ones
 * there is anything to choose between: on everything else the link is silent,
 * and silence is not a disagreement. Which week is on screen is compared too,
 * however the link came to name it, because that is the one thing a reader
 * would notice immediately.
 *
 * A shallow value-by-value check and no more. What it is for is the common
 * case, not every case: where it says yes and there was nothing to ask, the
 * reader is asked one question they can answer in a click. */
function linkDisagrees(shared, mine, theirs) {
  const said = (value) => JSON.stringify(value === undefined ? null : value);
  const differs = (key) => said(mine[key]) !== said(theirs[key]);

  /* Which week. `linkOnly` can work this out from the one class the link
     carries even where the link never names it outright. */
  if (differs("school") || differs("class")) return true;

  for (const key of Object.keys(shared || {})) {
    if (key === "classes" || key === "subjects") continue;
    if (differs(key)) return true;
  }
  /* A subject the link renames or recolors, where this browser has its own
     answer for the same subject. The whole entry, because that is what one
     replaces: the link's colors do not land on top of the reader's name. */
  for (const name of Object.keys((shared || {}).subjects || {})) {
    if (said((mine.subjects || {})[name]) !==
        said((theirs.subjects || {})[name])) return true;
  }
  /* And a class the link carries, field by field — but only the fields it
     carries. A link that names a child says nothing about that child's
     after-school events. */
  for (const key of Object.keys((shared || {}).classes || {})) {
    const ours = (mine.classes || {})[key] || {};
    const sent = (theirs.classes || {})[key] || {};
    for (const field of Object.keys((shared.classes[key] || {}))) {
      if (said(ours[field]) !== said(sent[field])) return true;
    }
  }
  return false;
}

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
  if (shared.subjects && typeof shared.subjects === "object") {
    /* Merged after normalise, so these have not been through it. Nothing
       hostile survives the escaping at the sinks either way, but a link's junk
       must not end up saved. */
    merged.subjects = onlySubjects(
      Object.assign({}, current.subjects, shared.subjects));
  }
  /* A link written before this page changed which class it opens on carries no
     class of its own: at the time, the class it was about *was* the default,
     so there was nothing to write down. The school then moved a timetable, the
     default moved with it, and the link quietly showed the wrong week.

     It still says which class it is about, though, in the one per-class bag it
     carries. So where the link names exactly one class and does not say to
     show one, that is the class to show. No guessing: a link never carries a
     class it is not about. */
  if (!shared.class && shared.classes && typeof shared.classes === "object") {
    const named = Object.keys(shared.classes);
    if (named.length === 1) {
      const [school, klass] = splitClassKey(named[0]);
      const has = (DATA.schools.find(x => x.n === school) || {}).c || [];
      if (has.some(c => c.n === klass)) {
        merged.school = school;
        merged.class = klass;
      }
    }
  }
  return merged;
}

{
  const shared = readUrl();
  /* Logged, never alarmed on. A link cut short in a chat window is not a fault
     in this page, and a handful a week is normal. Seeing them counted is still
     worth having: a lot of them at once would say the links have grown too
     long for something to carry. */
  if (linkFault) report("link", new Error(linkFault));
  if (shared) {
    cameSetUp = true;
    const merged = applyShared(shared, state);
    const theirs = linkOnly(shared, state);
    if (stash && linkDisagrees(shared, stash, theirs)) {
      /* Two answers and no way to tell which was meant. The link's is shown,
         and the question is put where the reader can see it. Nothing is
         written down until they answer, so "keep mine" is still on the table
         however long they take. */
      clash = { mine: stash, theirs: theirs, merged: merged };
      /* Every setting the link carries, except the language it is read in.
         A question the reader cannot read is not a question, and a link that
         says nothing about language would otherwise put this one in whichever
         language the page opens in. A copy, because `theirs` is the answer
         kept for the button and must stay the link's own. */
      state = Object.assign({}, theirs, { lang: stash.lang });
    } else {
      state = merged;
      /* Keep what the link brought, so closing it and coming back later still
         shows the same timetable. */
      try { localStorage.setItem(KEY, JSON.stringify(slim(state))); } catch (e) {}
    }
  }
}

/* ----- the address bar carries the settings -------------------------------
   Everything chosen lives in the fragment, so a bookmark keeps it and a link
   hands it to someone else. Only what differs from the defaults goes in, which
   keeps a typical link short — short enough to put in a QR code. The fragment
   never leaves the browser, so nothing is sent anywhere by carrying it. */
/* Declarations, not arrow constants: the state is read out of the address bar
   before this point in the file, and a const is still in its dead zone. */
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
   they compress hard: a link carrying every subject recolored goes from about
   4,800 characters to under 1,000. That is the difference between a printed QR
   code and none, since a code tops out around 2 kB.

   The browser has a gzip of its own in CompressionStream. But that one is
   async, and this code runs while the page boots and again on every change. fflate does
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
   the settings has to check first. On the way out the empty ones are dropped,
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
  /* A link is for one class, so it carries that class and no other. It used to carry every class the browser had ever been set up for. So
     sharing one child's timetable handed over a sibling's name. It also made
     the printed QR denser for a class the recipient never looks at. */
  if (out.classes) {
    const here = classKey(), sub = state.classes[here] || {};
    /* Only what was actually set. The subtree always holds all five fields so
       the code reading it never has to check. A link that carries three empty
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
  if (!Object.keys(changed).length) return bare;
  /* Any link that carries anything carries the class too, even when it is the
     one the page opens on today. Which class that is comes out of the
     school's own timetable, and it moves when the school moves one — so a
     link written without it showed the wrong week from the day that happened.
     A few characters is a small price for a link that keeps its promise.

     A page with nothing chosen still has a clean address: there is no week to
     promise, so there is nothing to pin. */
  changed.school = state.school;
  changed.class = state.class;
  return bare + "#" + packSettings(JSON.stringify(slim(changed)));
}

function readUrl() {
  const hash = location.hash.slice(1);
  const ours = hash.startsWith("s=") || hash.startsWith("z=");
  try {
    const text = unpackSettings(hash);
    if (text === null) return null;
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    linkFault = "not a set of settings";
    return null;
  } catch (e) {
    if (ours) linkFault = String((e && e.message) || e).slice(0, 120);
    return null;
  }
}

const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(slim(state))); } catch (e) {}
  try {
    const url = shareUrl();
    if (url !== location.href) history.replaceState(null, "", url);
  } catch (e) { /* a browser that will not rewrite the address bar: no matter */ }
};

/* Whose timetable this is: the name if somebody gave one, then the school and
   class. Shared by the heading, the browser tab and both print layouts so they
   can never drift apart. */
/* Provenance, and the fact that this is nobody's official page. Printed as well
   as shown. A sheet handed to somebody else must say where it came from. */
function sourceUrl(school) {
  return "https://" + DATA.edupage + ".edupage.org/timetable/view.php?num=" + school.n;
}

/* Where this came from and when, next to what it is: all of it belongs in the
   heading rather than at the bottom of the page. */
function renderSubtitle(school) {
  const stamp = DATA.built ? esc(t("footer.built", DATA.built)) : "";
  const link = '<a href="' + esc(sourceUrl(school)) + '">' + esc(t("sourceLink")) + "</a>";
  /* Beside the source link, because that is the line this page keeps its own
     business on, and it is at the top where somebody who is annoyed already is.
     A panel four down the stack is somewhere nobody scrolls to on purpose. */
  const say = (DATA.report && !printing)
    ? '<a href="#" id="sayLink">' + esc(t("say.link")) + "</a>" : "";
  /* school.v is the line the school configured to print under its own
     timetable — "Kehtivus: 24/08/2026-18/12/2026". Their text, so it stays in
     their language. The build drops it where they set a label and left it
     blank, so nothing shows a heading with nothing under it. */
  document.getElementById("subtitle").innerHTML =
    [esc(school.t), esc(school.v), link, say, stamp].filter(Boolean).join(" · ") +
    '<div class="unofficial">' + esc(t("footer.disclaimer")) + "</div>";
}

/* Open on a first visit, closed once there is nothing left to ask. Written
   here rather than in the page so that a browser running no script at all
   still gets it open, which is the answer that helps somebody who cannot
   collapse it either. */
function openFilterIfNeeded() {
  const panel = document.getElementById("filterPanel");
  if (panel) panel.open = !cameSetUp;
}

/* The box holds the settings as they are stored, so it has to follow them.
   It used to be filled once, when the panel was opened, and went stale under
   every control the reader touched afterwards.
 *
 * That is not only a stale display. Apply reads from this box, so a reader who
 * changed something with the panel open and then pressed Apply put the older
 * settings back — the button undid the change instead of keeping it.
 *
 * Not while it is being typed into: somebody pasting a backup is mid-edit, and
 * the events table leaves its rows alone for the same reason. `force` is the
 * panel opening, where there is nothing yet to interrupt.
 *
 * Looked up by id rather than held in a constant, because this runs from the
 * first draw and a constant is not readable before its own line. */
function refreshSettingsBox(force) {
  const panel = document.getElementById("advancedPanel");
  const box = document.getElementById("settingsText");
  if (!panel || !box || !panel.open) return;
  if (!force && document.activeElement === box) return;
  const want = JSON.stringify(slim(state), null, 2);
  if (box.value !== want) box.value = want;
}

/* The question, put where the reader is looking. Shown until it is answered,
   and it goes for good once it is. */
function showLinkClash() {
  const box = document.getElementById("linkask");
  if (!box) return;
  box.hidden = !clash;
  if (!clash) return;
  const said = document.getElementById("linkasksays");
  if (said) said.textContent = t("clash.says") + " " + t("clash.merge.means");
  /* Written out one by one rather than looped over a table of keys: a key
     that only exists inside a variable is a key the check for strings nobody
     asks for cannot see, and an unused string is then never noticed. */
  const label = (id, text) => {
    const button = document.getElementById(id);
    if (button) button.textContent = text;
  };
  label("clashLink", t("clash.useLink"));
  label("clashMerge", t("clash.useMerge"));
  label("clashMine", t("clash.useMine"));
  label("clashCopy", t("clash.copy"));
}

/* One of the three, and then the question is over. This is the first time the
   reader's own settings are written over, which is the whole reason the
   question was asked before saving rather than after. */
function resolveClash(which) {
  if (!clash) return;
  state = which === "mine" ? clash.mine
        : which === "merge" ? clash.merged
        : clash.theirs;
  clash = null;
  save();
  renderLanguages(); renderSchools(); renderClasses();
  applyStrings(); renderDivisions(); syncPerClassInputs(); render();
}

/* A copy of what this browser had, before anything is written over it. The
   clipboard where there is one; the box under Advanced where there is not,
   which is the same place a backup is pasted back in. */
async function copyMySettings() {
  if (!clash) return "";
  const text = JSON.stringify(slim(clash.mine), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    return t("clash.copied");
  } catch (e) {
    const box = document.getElementById("settingsText");
    const panel = document.getElementById("advancedPanel");
    if (!box) return "";
    if (panel) panel.open = true;
    /* After the panel has finished opening. Opening it fires its own toggle,
       and that fills the box from the settings on screen — which are the
       link's. Written first, the backup was overwritten by the very thing it
       is a backup against. */
    setTimeout(() => {
      box.value = text;
      if (box.select) box.select();
    }, 0);
    return t("clash.inBox");
  }
}

/* Said once, where the reader is looking, and in their own language — which
   is why it is written at render rather than when the link was read. */
function showLinkFault() {
  const note = document.getElementById("linkwarn");
  if (!note) return;
  note.hidden = !linkFault;
  note.textContent = linkFault ? t("link.unreadable") : "";
}

function renderFooter(school) {
  const stamp = DATA.built ? esc(t("footer.built", DATA.built)) : "";
  /* On paper the heading is gone, so the date it was read comes down here with
     the code that leads back to the page. On screen both live in the heading and
     the footer says only what the page is. */
  const bits = printing ? (stamp ? [stamp] : []) : [];
  /* Say so where it is true. A page that counts its readers must admit it,
     and this one only counts when it was built for a public address. */
  if (DATA.counts && !printing) bits.push(esc(t("footer.counts")));
  if (DATA.report && !printing) bits.push(esc(t("footer.reports")));
  /* 36mm keeps a typical link at about half a millimetre per module, which a
     phone reads without ceremony. A link with many custom colors gets denser.
     Past roughly 2 kB no code holds it at all, and the colors are shared across
     every class, so a family that recolored a lot of subjects can reach that
     size. Then the corner is empty. Printing the address as text instead was
     worse than nothing: an address too long for a code is far too long to type,
     and it filled the corner with characters nobody would ever read. */
  const link = (printing && state.showQr) ? shareUrl() : "";
  const code = link ? qrSvg(link, "36mm") : "";
  const corner = code ? '<div class="qrbox">' + code +
                        '<div class="qrhint">' + esc(t("qrHint")) + "</div></div>"
                      : "";
  /* Where the sheet came from, in the corner opposite the code. The code goes
     to this reader's own timetable; this says where anybody can get one of
     their own. Taken from the address rather than written down, so it cannot
     name somewhere the page is not. */
  const here = location.host
    ? location.host + location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "")
    : "";
  const brand = (printing && here)
    ? '<div class="brand"><img alt="" src="' + esc(DATA.icon || "") + '">' +
      "<span>" + esc(here) + "</span></div>"
    : "";
  document.getElementById("foot").innerHTML =
    brand + '<div class="lines">' + bits.join("<br>") + "</div>" + corner;
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
    klass: mine().className.trim() || t("classN", classLabel(cls)),
  };
}

function displayTitle(school, cls) {
  const part = titleParts(school, cls);
  const right = [state.showSchoolName ? part.school : "",
                 state.showClassName ? part.klass : ""]
                  .filter(Boolean).join(", ");
  return [state.showStudentName ? part.student : "", right].filter(Boolean).join(" — ");
}

/* Interface strings only. Anything from the timetable stays in the language
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
/* Weekday names follow the interface language. The timetable only supplies
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
  /* Named after the button it points at, so the two never drift apart. */
  const shareNote = document.getElementById("shareNote");
  if (shareNote) shareNote.textContent = t("settings.share", t("share"));
  /* A control with no visible label still has to say what it is out loud. */
  document.querySelectorAll("[data-i18n-aria]").forEach(el => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
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
/* Abbreviations and the school's own colors, as this school writes them. The
   four timetables are separate documents that spell and color the same subject
   differently, so this is per school and not one table for all of them. */
function subjectFacts() { return currentSchool().sj || {}; }

function classKey() { return currentSchool().n + "/" + currentClass().n; }

/* What to call a class, which is not always its name. A school that names its
   classes after their teacher says the year in the order of its list, so the
   built page carries a label saying both. Everything that files something under
   a class — the link, the reader's own settings, the visit count — keeps using
   the name, so a label added or corrected later loses nobody's settings. */
function classLabel(cls) { return (cls && cls.d) || (cls && cls.n) || ""; }

/* The other way round. A school number never holds a slash and a class name
   can, so the first one is the seam. */
function splitClassKey(key) {
  const at = String(key).indexOf("/");
  return at < 0 ? [String(key), ""] : [key.slice(0, at), key.slice(at + 1)];
}

/* Which of a division's groups this reader is in, keyed by the choice on offer.
   The division's own id is aSc's ("*5:1") and means nothing to anyone. */
const choiceKey = (division) => division.groups.join("/");

function readable(bg) {
  /* Three, four, six or eight digits — a short hex is a color like any other,
     and treating it as unreadable put dark text on a dark box.

     Four and eight carry alpha, and alpha is the whole difference between what
     the color says and what the eye sees. #00000010 reads as black, so black
     gets white text, and the box is in fact all but transparent. That is
     white on white. So the color is composited over the sheet first, and the
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
/* The hatch that says "not a lesson", worked out here rather than left to CSS.
   It was a gradient of translucent white over whatever color the band had, and
   a printer turned the translucent part solid black — on paper only, never in
   a PDF, which is the sort of thing a driver does with alpha it does not want
   to composite. So the two stripe colors are mixed here and written out
   opaque. Nothing is left for a driver to blend. */
function hatch(bg) {
  const paler = (amount) => {
    let hex = String(bg || "").trim().replace("#", "");
    if (/^[0-9a-f]{3,4}$/i.test(hex)) hex = hex.split("").map(c => c + c).join("");
    const m = /^([0-9a-f]{6})/i.exec(hex);
    const n = m ? parseInt(m[1], 16) : 0xEDEFF2;
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return "#" + [n >> 16 & 255, n >> 8 & 255, n & 255]
      .map(c => mix(c).toString(16).padStart(2, "0")).join("");
  };
  const light = paler(0.62), dark = paler(0.22);
  return "background-image:repeating-linear-gradient(135deg," +
    light + " 0 6px," + dark + " 6px 12px);";
}

/* What this subject is set to do — its own answer if it gave one, otherwise
   the one every subject follows. */
function styleFor(subject) {
  return ((state.subjects || {})[subject] || {}).style || state.subjectColorStyle;
}

/* The worked-out break between two lessons. It is not a subject and no school
   published it, so it needs a name of its own to be filed under — and it is
   listed and recolored like any other break, because a reader who wants it in
   their own words should not have to care where it came from. */
/* How long a hole has to be before it is worth drawing. */
const GAP_AT_LEAST = 10;

const GAP = "gap";
/* The same thing at the middle of the day, where the school says a hole that
   size is lunch. It is worked out the same way and drawn the same way; it just
   knows what it is, and is listed and recolored on its own. */
const LUNCH = "lunch";
const GAP_COLOR = { bg: "#F7F8FA", fg: "#6b7280" };

/* Which of the two a hole is. A school that never says goes on saying gap. */
function gapKind(from, to) {
  const rule = currentSchool().lg;
  if (!rule) return GAP;
  return (to - from >= rule.m && from >= rule.a && from < rule.z)
    ? lunchKey() : GAP;
}

/* What the worked-out lunch is filed under. Where the class also has a
   published band of that name — TäheTERA prints one on the days without the
   language split — the two are the same meal, so they are one row in the
   table, one color and one name. Only a class whose lunch is never published
   gets a key of its own. */
function lunchKey() {
  const name = (currentSchool().lg || {}).n;
  if (!name) return LUNCH;
  for (const day of Object.values(currentClass().h || {})) {
    for (const band of (day.b || [])) if (band.n === name) return name;
  }
  return LUNCH;
}

function colorFor(subject) {
  const own = (state.subjects || {})[subject] || {};
  const style = own.style || state.subjectColorStyle;
  /* A chosen text color holds whatever the background came from — the same
     rule the events table follows, and there is no reason for a subject to
     work differently from an event. Empty means: work it out. */
  const paint = (bg) => ({ bg: bg, fg: own.textColor || readable(bg) });
  if (style === "custom" && own.backgroundColor) return paint(own.backgroundColor);
  if (style === "school") {
    /* Only where the school set one. A subject it never colored falls through
       to the palette rather than coming out blank. */
    const bg = (subjectFacts()[subject] || {}).color;
    if (bg) return paint(bg);
  }
  const base = DATA.palette[subject] ||
    (subject === GAP || subject === LUNCH ? GAP_COLOR
                                          : { bg: "#EEEEEE", fg: "#14171A" });
  return own.textColor ? paint(base.bg) : base;
}

/* A row the reader has turned off. Not every subject in a timetable is every
   child's: a choir sits in the class's week and in nobody else's afternoon.
   Turning one off leaves the hole it made, which the day then reads as a
   break or as time to go home, both of which are true. */
function hidden(name) {
  return ((state.subjects || {})[name] || {}).hide === true;
}

/* An entry that says nothing is not worth keeping, in storage or in a link. */
function tidySubjects() {
  for (const [subject, entry] of Object.entries(state.subjects || {})) {
    if (entry.style === state.subjectColorStyle) delete entry.style;
    if (!entry.label && !entry.style && !entry.backgroundColor &&
        !entry.textColor && !entry.hide) {
      delete state.subjects[subject];
    }
  }
}

/* A lesson is mine when every division it belongs to matches one of my picks.
   Whole-class lessons carry no groups and are always mine. */
function visible(entry, picked, divisions) {
  /* A lesson in no group is the whole class's, and a lesson is shown until a
     pick rules it out — both fall out of the loop below reaching its end, so
     neither needs a guard of its own. One was here, and no test can tell
     whether it works, because its removal changes nothing. */
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
   be mistyped, and gives the colors a picker instead of a spelling.        */

const isColor = (c) => !!(window.CSS && CSS.supports && CSS.supports("color", c));

/* What an event writes with: its own text color if one was chosen, otherwise
   whichever of black or white reads better on its background. */
function eventFg(ev) { return ev.fg || readable(cssColor(ev.bg)); }

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
      if (c && !isColor(c)) {
        errors.push(t("events.line", row, t("events.badColor", JSON.stringify(c))));
        return;
      }
    }
    out.push({ day: day, a: a, z: z, fg: ev.textColor || null,
               bg: ev.backgroundColor || "#DDDDDD",
               label: String(ev.label || ""), note: String(ev.note || ""),
               mine: true });
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

/* What was asked for, as a number: a percentage of the size the page has
   always drawn for that line. */
function askedGrow(role) {
  return Number(state[role + "Size"]) / 100;
}

/* The sizes the page has always drawn, per line, before anybody asked for
   more. Two of them depend on how tall the box is, which is why this takes a
   box and not just a role. */
function baseSizes(cls) {
  return {
    time: 10,
    name: cls.includes("tight") ? 11 : 12,
    detail: 10.5,
  };
}

/* How much of the reader's larger type one box can take.
 *
 * A box gives its content its own height less the border and the padding, and
 * every line costs its size times its leading. The page's own sizes fit by
 * construction — the layout was built around them — so the question is only
 * how far towards the asked size the box can go before the last line meets the
 * bottom edge. The cost is a straight line between the two, so the answer is
 * arithmetic rather than a search.
 *
 * Hands back a number from 0 to 1: 0 is the page's own sizes, 1 is everything
 * the reader asked for. A box with room to spare gets 1, a box with none gets
 * 0, and nothing is ever drawn smaller than it was before this setting
 * existed. */
function growRoom(height, cls, lines) {
  const base = baseSizes(cls);
  const leading = cls.includes("snug") ? 1.1 : 1.25;
  /* The border is 1px each side and the padding 2px each side. A dashed box
     draws 2px, and half a pixel of slack is cheaper than a second branch. */
  const room = height - 2 - 4 - 1;
  let now = 0, want = 0;
  for (const role of lines) {
    now += base[role] * leading;
    want += base[role] * askedGrow(role) * leading;
  }
  if (want <= room) return 1;
  if (want <= now) return 1;                  // asked for smaller: always fits
  return Math.max(0, Math.min(1, (room - now) / (want - now)));
}

/* And then the browser is asked.
 *
 * The arithmetic above counts one line per line. A name set larger can wrap
 * where it did not before — "Prantsuse keel" is one line at twelve pixels and
 * two at fourteen — and no arithmetic here knows how tall that made it. Only
 * the browser does, and only once the box is in the page.
 *
 * So every box that overflows gives its growth back, a step at a time, until
 * it fits or until it is back to the size the page has always drawn. Nothing
 * ends up smaller than it was before any of this existed. */
const GIVE_BACK = 0.92;

function shrinkOverfull(root) {
  if (!root || !root.querySelectorAll) return;
  for (const box of root.querySelectorAll(".ev")) {
    if (!box.style || !box.style.getPropertyValue) continue;
    let guard = 12;
    while (guard-- > 0 && box.scrollHeight > box.clientHeight + 1) {
      let moved = false;
      for (const role of ["time", "name", "detail"]) {
        const now = Number(box.style.getPropertyValue("--grow-" + role)) || 1;
        if (now <= 1) continue;
        box.style.setProperty("--grow-" + role,
                              String(Math.max(1, Math.round(now * GIVE_BACK * 1000) / 1000)));
        moved = true;
      }
      if (!moved) break;            // back to the page's own sizes, and still full
    }
  }
}

/* The three numbers a box carries, written where the stylesheet reads them. */
function growStyle(height, cls, lines) {
  const room = growRoom(height, cls, lines);
  return ["time", "name", "detail"]
    .map(role => "--grow-" + role + ":" +
                 Math.round((1 + (askedGrow(role) - 1) * room) * 1000) / 1000 + ";")
    .join("");
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
      /* Every break the day plan gives this day. Whether one belongs on a
         short day is a question about the plan, so the generator answers it
         and this draws what it is given. */
      for (const b of shape.b) {
        if (hidden(b.n)) continue;
        perDay.get(i).push({ a: b.m, z: b.x, brk: b.n });
      }
    }
  }

  /* The holes in a day, once everything drawn on it is laid end to end: the
     lessons, the school's own breaks, and whatever the reader added. Ten
     minutes is where a hole stops being a corridor and starts being time you
     can plan around — walking somewhere, or waiting. It was fifteen while a
     ten-minute box could not hold a line of type; a box that gives its type
     back until it fits can, so the shorter holes are drawn now too.

     Only where nothing already fills it. A school that names its breaks has
     said what that time is for, and this does not say it again. */
  if (state.showGaps) {
    for (const [day, items] of perDay) {
      const busy = items.filter(x => typeof x.a === "number" && typeof x.z === "number")
                        .slice().sort((p, q) => p.a - q.a);
      if (busy.length < 2) continue;
      const holes = [];
      let reach = busy[0].z;
      for (const item of busy.slice(1)) {
        if (item.a - reach >= GAP_AT_LEAST) {
          holes.push({ a: reach, z: item.a, gap: gapKind(reach, item.a) });
        }
        reach = Math.max(reach, item.z);
      }
      for (const hole of holes) if (!hidden(hole.gap)) items.push(hole);
    }
  }

  const all = [].concat(...[...perDay.values()]);
  if (!all.length) return '<p style="color:#6b7280">' + esc(t("nothing")) + "</p>";
  let lo = Math.min(...all.map(x => x.a)), hi = Math.max(...all.map(x => x.z));
  lo = Math.floor(lo / 30) * 30; hi = Math.ceil(hi / 30) * 30;
  const span = hi - lo;
  /* Pixels per minute. On screen a fixed, readable scale — it was 1.05, which
     put a ten-minute break under the height of one line of type. On paper
     whatever fills the sheet, which the caller finds by measuring. */
  const ppm = scale || 1.8;

  /* An hour where every day is empty is worth a fraction of an hour of
     lessons. A training session at six in the evening otherwise pushes the
     whole afternoon off the screen, and the emptiness it pushes it with says
     nothing. So the axis is cut there: the same scale everywhere anything
     happens, and a marked band where nothing does.

     Nothing else changes to make room. A lesson keeps the height it earns,
     because the alternative is squeezing what a reader came to read. */
  const CUT_AFTER = 45, CUT_RATE = 6, CUT_MIN = 26, CUT_MAX = 64;
  const cuts = [];
  {
    /* Not the worked-out breaks. Those were put there to fill the holes, and
       a hole filled by one is still a stretch where no lesson happens. */
    const spans = all.filter(x => typeof x.a === "number" && !x.gap)
                     .map(x => [x.a, x.z]).sort((p, q) => p[0] - q[0]);
    let reach = lo;
    for (const [a, z] of spans) {
      if (a - reach >= CUT_AFTER) cuts.push({ a: reach, z: a });
      reach = Math.max(reach, z);
    }
    if (hi - reach >= CUT_AFTER) cuts.push({ a: reach, z: hi });
    for (const cut of cuts) {
      const full = (cut.z - cut.a) * ppm;
      cut.h = Math.max(CUT_MIN, Math.min(CUT_MAX, full / CUT_RATE));
      cut.saved = full - cut.h;
    }
  }

  /* One wave of the tear, sampled rather than curved: at this size a polyline
   of fifty points is a smooth edge, and it needs no path arithmetic to keep
   the two sides of the tear identical. `shift` moves the same wave down, so
   the piece lifted out has matching edges — which is what makes it read as one
   tear rather than as two unrelated wiggles. */
function tearWave(width, shift, amp) {
  const steps = 48, waves = 3, out = [];
  for (let i = 0; i <= steps; i++) {
    const x = Math.round((width * i / steps) * 100) / 100;
    const at = amp + shift + amp * Math.sin(2 * Math.PI * waves * i / steps);
    out.push(x + " " + (Math.round(at * 100) / 100));
  }
  return out;
}

/* The piece of strip that is lifted out: down one wave, across, and back along
   the same wave lower down. */
function tornOut(width, height, amp) {
  const top = tearWave(width, 0, amp);
  const bottom = tearWave(width, height - 2 * amp, amp).reverse();
  return "M" + top.join("L") + "L" + bottom.join("L") + "Z";
}

/* And the line along one torn edge, so it reads as an edge rather than as the
   place two flat colors happen to meet. */
function tornEdge(width, shift, amp) {
  return "M" + tearWave(width, shift, amp).join("L");
}

/* Minutes to pixels, with every cut before that minute taken out. */
  const y = (t) => {
    let out = (t - lo) * ppm;
    for (const cut of cuts) {
      if (t <= cut.a) break;
      out -= (Math.min(t, cut.z) - cut.a) * ppm;
      if (t >= cut.z) out += cut.h;
      else out += cut.h * ((t - cut.a) / (cut.z - cut.a));
    }
    return out;
  };
  const H = Math.round(y(hi));

  /* Over the timetable rather than at the top of the page, and drawn the same
     way on screen as on paper. Whatever is typed into the title fields shows
     up here at once. That is the only way to see what will print. Both views draw
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
    /* Inside a cut the labels would sit on top of each other and claim a
       precision the axis no longer has. */
    if (cuts.some(cut => t > cut.a && t < cut.z)) continue;
    const cls2 = t % 60 === 0 ? "t hour" : "t";
    h += '<div class="' + cls2 + '" style="top:' + Math.round(y(t)) + 'px">' +
         esc(hhmm(t)) + "</div>";
  }
  /* Say where the axis was cut, on the axis. A band across the days was drawn
     here first, and it was wrong twice over: it wore the same hatch as a
     break, so it read as one, and the day's own boxes are drawn over the top
     of it — the worked-out break that fills the same hours hid it on every day
     that had one, leaving stripes only on the days that did not. It also
     covered the tick label at the top of the cut. A scale belongs beside the
     scale. */
  for (const cut of cuts) {
    /* Clear of the clock at either end of the cut. A label is centred on its
       own minute, so half of it hangs into the cut, and a tear drawn across
       the whole of the cut is drawn across the reading. */
    const tall = Math.max(TEAR_MIN, Math.round(cut.h) - 2 * TEAR_CLEAR);
    const at = Math.round(y(cut.a) + (cut.h - tall) / 2);
    h += '<svg class="tlbreak" viewBox="0 0 ' + GUTTER + " " + tall +
         '" preserveAspectRatio="none" style="top:' + at +
         "px;height:" + tall + 'px"><title>' +
         esc(hhmm(cut.a) + "–" + hhmm(cut.z)) + "</title>" +
         '<path class="gap" d="' + tornOut(GUTTER, tall, TEAR) + '"/>' +
         '<path class="edge" d="' + tornEdge(GUTTER, 0, TEAR) + '"/>' +
         '<path class="edge" d="' + tornEdge(GUTTER, tall - 2 * TEAR, TEAR) + '"/>' +
         "</svg>";
  }
  h += "</div>";

  /* Where a box sits in its column. Lessons and breaks share the full width
     between them. A personal event is drawn afterwards, over the top, so it
     never squeezes the timetable — which is what makes it usable for marking
     something out inside a break.
     It is inset only where there is something underneath worth glimpsing. An
     event in an empty evening covers nothing. An inset there reads as a
     mistake rather than as a layer. */
  const place = (it, inset) => {
    const lanes = it._lanes || 1, lane = it._lane || 0;
    const each = (100 - inset) / lanes;
    return "top:" + Math.round(y(it.a)) +
           "px;height:" + Math.max(14, Math.round(y(it.z) - y(it.a)) - 1) +
           "px;left:calc(" + (inset + lane * each) + "% + 2px);width:calc(" + each + "% - 4px);";
  };

  for (const i of dayIdx) {
    h += '<div class="tlcol">';
    const items = perDay.get(i);
    for (const it of pack(items.filter(x => !x.mine))) {
      const height = Math.max(14, Math.round(y(it.z) - y(it.a)) - 1);
      const geom = place(it, 0);
      const when = clockText(it.a, it.z);
      if (it.gap === GAP) {
        /* Worked out here rather than published, so it says only the one thing
           the lessons around it do not: how long it is. The outline is what
           says it was inferred; the color is the reader's like any other. */
        /* No growth here, and that is a decision rather than an omission. A
           worked-out hole is the least of what a day says — it is there to be
           counted, not read — and it is the one box whose whole content is a
           duration the lessons either side already imply. */
        const kind = it.gap, col = colorFor(kind), how = durationText(it.z - it.a);
        h += '<div class="ev gap" data-subject="' + esc(kind) + '" style="' + geom +
             "background-color:" + esc(col.bg) + ";color:" + esc(col.fg) +
             '" title="' + esc(breakLabel(kind) + " " + how) +
             '"><div class="what">' + esc(breakLabel(kind)) + " · " + esc(how) +
             "</div></div>";
        continue;
      }
      /* A worked-out lunch is still lunch. Drawn as a corridor it read as
         one, and on the days the school does publish the band the very same
         meal was drawn as a band. Same meal, same box. */
      const band = it.brk || (it.gap && it.gap !== GAP ? it.gap : "");
      if (band) {
        const col = colorFor(band);
        /* A short break has room for one line, and the clock joins the name
           on it rather than being dropped. Twenty minutes is a real break —
           ProTERA's Amps is one, and so is a SädeTERA Tuesday lunch — and a
           band with no times on it is the one thing a reader cannot work out
           from the lessons either side. */
        const label = breakLabel(band);
        const inside = height >= 30
          ? '<div class="what">' + esc(label) + "</div>" +
            '<div class="when">' + esc(when) + "</div>"
          : '<div class="what oneline">' + esc(label) +
            ' <span class="clock">' + esc(when) + "</span></div>";
        /* Ten minutes is the shortest band anything is written in — TäheTERA
           has one between its second and third lessons — and at that height
           the padding is the difference between a line and a cut line. */
        const brkCls = height < 17 ? " tiny squeeze" : height < 22 ? " tiny" : "";
        h += '<div class="ev brk' + brkCls + '" style="' +
             growStyle(height, brkCls, height >= 30 ? ["name", "time"] : ["name"]) +
             geom + "background-color:" + esc(col.bg) +
             ";color:" + esc(col.fg) + ";" + hatch(col.bg) +
             '" data-subject="' + esc(band) + '" title="' +
             esc(breakName(band) + "\n" + when) + '">' + inside + "</div>";
        continue;
      }
      const e = it.lesson, col = colorFor(e.s), info = subjectFacts()[e.s] || {};
      const meta = detailLine(e);
      const tip = [subjectName(e, false), e.g.join("/"),
                   teacherNames(e, "full").join(" / "),
                   e.r.join(" / "), when, e.u > 1 ? t("paired") : t("single"),
                   e.o ? t("noExactTime") : ""].filter(Boolean).join("\n");
      const name = lessonTitle(e);
      /* A twenty-minute box has room for one line. Stacked, the time takes it
         and the name falls off the bottom, so a short lesson showed a clock
         and nothing else. LõunaTERA writes its breaks as lessons, and Puder
         is twenty minutes. */
      let body = height >= 30
        ? '<div class="when">' + esc(when) + (e.o ? " ?" : "") + "</div>" +
          '<div class="what">' + esc(name) + "</div>"
        : '<div class="what oneline"><span class="clock">' +
          esc(when + (e.o ? " ?" : "")) + "</span> " + esc(name) + "</div>";
      /* Room, teacher and group are a third line. A box gives its content its
         height less 2px of border and 4px of padding, and three tight lines
         come to 36, so 46 is where all three fit — which is exactly a
         45-minute lesson. The old threshold of 54 refused those, and a
         SädeTERA week is mostly 45-minute lessons. */
      if (height >= 46 && meta.length) {
        body += '<div class="who2">' + esc(meta.join(" · ")) + "</div>";
      }
      /* A school that writes its breaks as lessons still gets breaks. The
         hatch is what says "not a lesson", whatever the timetable calls it. */
      /* A box only just tall enough for three lines gets them only if the
         name stays on one. Left to wrap, a long subject took two lines and the
         bottom of the box cut it — which it did long before the detail line
         was let in here. */
      const lessonCls = (e.B ? " brk" : "") + (height < 40 ? " tight" : "") +
                        (height < 62 ? " snug" : "");
      const lessonLines = height >= 30
        ? (height >= 46 && meta.length ? ["time", "name", "detail"] : ["time", "name"])
        : ["name"];
      h += '<div class="ev' + lessonCls + (e.o ? " approx" : "") +
           '" data-subject="' + esc(e.s) + '" style="' +
           growStyle(height, lessonCls, lessonLines) + geom +
           "background-color:" + esc(col.bg) +
           ";color:" + esc(col.fg) + '" title="' + esc(tip) + '">' + body + "</div>";
    }
    /* The layer on top. Events are packed among themselves, so two of them at
       once still sit side by side rather than hiding one another. */
    const base = items.filter(x => !x.mine);
    for (const it of pack(items.filter(x => x.mine))) {
      const over = base.some(x => x.a < it.z && it.a < x.z);
      const height = Math.max(14, Math.round(y(it.z) - y(it.a)) - 1);
      const when = clockText(it.a, it.z);
      const fg = eventFg(it);
      /* A twenty-minute box has room for one line, so the time joins the label
         rather than pushing it out of sight. */
      let body = height >= 30
        ? '<div class="when">' + esc(when) + "</div>" +
          '<div class="what">' + esc(it.label) + "</div>"
        : '<div class="what oneline"><span class="clock">' + esc(when) +
          "</span> " + esc(it.label) + "</div>";
      /* A third line, where a lesson puts its room and teacher. Same height to
         earn it: three tight lines come to 36, and 46 is where all three fit. */
      if (height >= 46 && it.note) {
        body += '<div class="who2">' + esc(it.note) + "</div>";
      }
      const mineCls = height < 40 ? " tight" : "";
      const mineLines = height >= 30
        ? (height >= 46 && it.note ? ["time", "name", "detail"] : ["time", "name"])
        : ["name"];
      h += '<div class="ev mine' + mineCls + '" style="' +
           growStyle(height, mineCls, mineLines) + place(it, over ? 16 : 0) +
           "background-color:" + esc(it.bg) + ";color:" + esc(fg) + '" title="' +
           esc([it.label, it.note, when].filter(Boolean).join("\n")) + '">' +
           body + "</div>";
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


/* Named CSS colors have to become hex before luminance can be measured. */
const _swatch = document.createElement("span");
function cssColor(value) {
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
   Nothing to choose. The data decides. */
function onTimeline() {
  if (!currentSchool().b) return false;
  /* A day plan the class is not covered by leaves its lessons untimed, and a
     timeline of untimed lessons is a blank page. Better the grid, which needs
     no times, than nothing at all. */
  return currentClass().e.some(e => e.a != null);
}
/* "1 tund 20 min". An exact hour drops the minutes, and under an hour there
   are no hours to drop. Estonian counts one differently from many, so the
   hours come from two strings rather than one with an s stuck on. */
function durationText(minutes) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const parts = [];
  if (hours) parts.push(hours === 1 ? t("dur.hour", hours) : t("dur.hours", hours));
  if (rest || !hours) parts.push(t("dur.min", rest));
  return parts.join(" ");
}

/* The clock, and how long that is. Subtracting one from the other is work a
   reader should not have to do to find out whether a lesson is a single. */
function clockText(from, to) {
  const when = hhmm(from) + "–" + hhmm(to);
  return state.showDuration ? when + " (" + durationText(to - from) + ")" : when;
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
   two subjects in sequence names both, in the order they run. The color and
   the legend still follow the one subject the box is keyed to. */
/* What to call a subject: the reader's own name for it if they gave one, and
   otherwise the school's, long or short as asked. A name of your own is never
   abbreviated. You already wrote it as short as you wanted it. */
/* A break carries its own name, and the reader can rename it like a subject.
   The school writes some of them as a list — "Söömine, tiimitund, vaba aeg" —
   and only the part before the comma fits a box. */
/* What a break is called before the reader renames it. The gap's name follows
   the interface language, since nobody wrote it down in a timetable; every
   other one is the school's word, cut at the first comma where the school
   wrote a list of what the break is for. */
function breakName(name) {
  if (name === GAP) return t("gap");
  if (name === LUNCH) return (currentSchool().lg || {}).n || t("gap");
  return String(name).split(",")[0];
}

function breakLabel(name) {
  return ((state.subjects || {})[name] || {}).label || breakName(name);
}

/* The school's own word for a subject, without the prefix its own timetable
   puts on it. The prefix says which of the two schools in one timetable a
   subject belongs to, which the reader of one class already knows. */
function plainSubject(name) {
  return (subjectFacts()[name] || {}).label || name;
}

function subjectLabel(name, short) {
  const own = ((state.subjects || {})[name] || {}).label;
  if (own) return own;
  const plain = plainSubject(name);
  return short ? ((subjectFacts()[name] || {}).short || plain) : plain;
}

function subjectName(e, short) {
  return (e.S && e.S.length ? e.S : [e.s]).map(n => subjectLabel(n, short)).join(" + ");
}

/* The subject as the reader asked to see it, or nothing at all. */
function lessonTitle(e) {
  if (!state.showSubject) return "";
  return subjectName(e, state.subjectNameStyle === "short");
}

/* Teacher names: the school's abbreviation, the full name, or neither. */
/* One name, turned round: the first word goes to the end and the rest stays
   where it is. A person can have more than one given name — "Kask Mari Liis"
   is one family name and two given ones — so only the first word moves. A name
   of one word is already whatever it is. */
function turnedRound(name) {
  const shape = /^(\s*)([\s\S]*?)(\s*)$/.exec(String(name));
  const words = shape[2].split(/\s+/).filter(Boolean);
  if (words.length < 2) return name;
  return shape[1] + words.slice(1).join(" ") + " " + words[0] + shape[3];
}

/* One entry can hold several people. A school separates them with a slash, a
   comma or a semicolon, and which one is not consistent. Each name is turned
   round on its own and the list is put back together with the separators it
   came with, so nothing about the list changes but the names in it. */
function teacherName(text) {
  if (state.teacherNameOrder !== "first") return text;
  return String(text).split(/([/,;])/)
    .map(part => (/^[/,;]$/.test(part) ? part : turnedRound(part)))
    .join("");
}

function teacherNames(e, style) {
  const names = (style || state.teacherNameStyle) === "full" ? e.T : e.t;
  return (names || []).map(teacherName);
}

function teacherText(e) {
  if (!state.showTeacher) return "";
  return teacherNames(e).join(" / ");
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
    '<div class="lesson" style="background-color:' + esc(ev.bg) + ";color:" + esc(eventFg(ev)) +
    (ev.fg ? ";border:1px solid " + esc(ev.fg) : "") +
    '"><div class="name">' + esc(ev.label) + "</div>" +
    (ev.note ? '<div class="who">' + esc(ev.note) + "</div>" : "") +
    '<div class="time">' + esc(hhmm(ev.a) + "–" + hhmm(ev.z)) +
    "</div></div>").join("") + "</td>";
}

function lessonHtml(e, time) {
  const meta = detailLine(e);
  const label = lessonTitle(e);
  const note = e.o ? t("noExactTime") : "";
  const tip = [subjectName(e, false), e.g.join("/"),
               teacherNames(e, "full").join(" / "), e.r.join(" / "),
               time, e.u > 1 ? t("paired") : t("single"), note]
              .filter(Boolean).join("\n");
  const col = colorFor(e.s);
  return '<div class="lesson' + (e.c ? " cont" : "") + (e.B ? " brk" : "") +
    '" data-subject="' + esc(e.s) +
    '" style="background-color:' + esc(col.bg) + ";color:" + esc(col.fg) +
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

/* One landscape sheet is the whole point of the printout. How tall the sheet
   wants to be depends on the class. It can hold several lessons in one cell. It can hold a canteen
   sitting spelled out inside a break, or a row of personal events. A day can
   run from seven in the morning to ten at night, because somebody added an
   entry there. So it is drawn and measured rather than guessed at from constants —
   the footer alone changes size with the QR code and the language, and a guess
   that was right once quietly stops being right. */
/* A4 landscape is 210mm tall, less the margin at each end. */
function sheetHeight() {
  return Math.round(210 * MM - 2 * state.printMargin * MM);
}
/* A few pixels in hand: the print layout rounds differently from the screen
   one, and landing exactly on the limit means landing just past it. */
function sheetBudget() {
  return sheetHeight() - 8;
}

/* The largest scale at which everything still fits, footer and all.
   `draw(scale)` puts the page together at that scale. The answer goes back to
   whichever renderer asked. Bisection alone is not enough. The smallest scale
   it considers has to be measured too, or a day wide enough to defeat even
   that comes back as if it fitted. */
function fitToSheet(draw, small, big) {
  const grid = document.getElementById("grid");
  const keep = grid.innerHTML;
  const fits = (scale) => {
    draw(scale);
    return grid.getBoundingClientRect().height + footHeight() <= sheetBudget();
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
    const grid = document.getElementById("grid");
    grid.innerHTML = renderTimeline(school, cls, shown, mine, scale);
    /* Measured before it is judged: a box that gave its growth back is shorter
       than the one the arithmetic drew, and the sheet is measured after. */
    shrinkOverfull(grid);
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
    /* The same floor the timeline has. 0.4 was enough while the grid ran days
       down the side — five rows. Turned round it has a row per period, and
       three TäheTERA classes came out six pixels past the sheet. */
  }, 0.25, 1.0);
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

/* Repaint the grid but leave the legend alone. Its color inputs are live DOM
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
  showLinkFault();
  showLinkClash();
  refreshSettingsBox();
  document.title = displayTitle(school, cls) || t("classN", classLabel(cls));
  renderSubtitle(school);

  const picked = mine().studyGroups;
  const timeline = onTimeline();
  const shown = cls.e.filter(e => visible(e, picked, cls.v))
                     .filter(e => !timeline || !e.c);   // one box per lesson
  /* The legend is given every row, so a subject turned off can be turned back
     on. Everything that draws is given what is left. */
  const drawn = shown.filter(e => !hidden(e.s));
  const parsed = readEvents(mine().events);
  document.getElementById("evwarn").textContent = parsed.errors.join("\n");

  if (printing) document.body.classList.add("printview");
  else document.body.classList.remove("printview");

  if (timeline) {
    const grid = document.getElementById("grid");
    grid.innerHTML =
      renderTimeline(school, cls, drawn, parsed.events,
                     printing ? fitTimeline(school, cls, drawn, parsed.events) : 0);
    shrinkOverfull(grid);
    document.getElementById("count").textContent =
      t("lessonCount", drawn.length) + (parsed.events.length ?
        " · " + t("mineCount", parsed.events.length) : "");
    if (!keepLegend) renderLegend(shown);
    return;
  }

  /* Only the grid reads this, and only the grid gets this far. */
  const bucket = new Map();
  for (const e of drawn) {
    const k = e.d + ":p" + e.p;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(e);
  }

  /* Weekdays across the top, periods down the side — the way the timeline
     reads, and the way a school prints one. It used to be the other way round,
     which meant the two views of the same week were transposed. */
  let cols = columnModel(school);
  /* Periods this class never reaches are dropped from the bottom, the way the
     timeline drops its trailing free slots. An empty period in the middle
     stays: it is a break, and the numbers either side of it say so. */
  const lastUsed = Math.max(0, ...drawn.map(e => e.p));
  cols = cols.filter(col => col.p.n <= lastUsed);
  const dayIdx = daysWith(school, parsed.events);
  const anyMine = parsed.events.length > 0;
  let h = "<table><thead><tr><th></th>";
  {
    for (const i of dayIdx) h += "<th>" + esc(dayLabel(school, i)) + "</th>";
    h += "</tr></thead><tbody>";
    for (const col of cols) {
      h += '<tr><th class="slot">' + columnLabel(school, cls, col) + "</th>";
      for (const i of dayIdx) h += bodyCell(cls, i, col, bucket);
      h += "</tr>";
    }
    /* One row for what the reader added. Their events carry a clock, and this
       view has none to hang them on, so they sit under the day they belong to. */
    if (anyMine) {
      h += '<tr><th class="slot">' + esc(t("mineCol")) + "</th>";
      for (const i of dayIdx) h += mineCell(parsed.events.filter(ev => ev.day === i));
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
    t("slotsShown", drawn.length, total) +
    (drawn.length === total ? " " + t("noFilter") : "") +
    (parsed.events.length ? " · " + t("mineCount", parsed.events.length) : "") +
    (school.b ? "" : " · " + t("noBells"));
  if (!keepLegend) renderLegend(shown);
}

function setTextColor(subject, value, redraw) {
  const entry = state.subjects[subject] || (state.subjects[subject] = {});
  if (value) entry.textColor = value; else delete entry.textColor;
  tidySubjects();
  save();
  /* Only the auto tick rebuilds the legend, because only it changes what the
     row looks like. A rebuild on every color picked tears the row out from
     under the open color panel. That is what `keepLegend` prevents. */
  if (redraw) render(); else { paint(); refreshSubjectSample(subject); }
}

function setColor(subject, value) {
  const entry = state.subjects[subject] || (state.subjects[subject] = {});
  entry.backgroundColor = value;
  /* Choosing a color is asking for it — for this subject, not for every one.
     If everything is already on its own colors there is nothing to say. */
  if (state.subjectColorStyle !== "custom") entry.style = "custom";
  tidySubjects();
  syncDisplayControls();
  save();
  paint();
  const row = document.querySelector('#legend tr[data-subject="' +
                                     cssQuote(subject) + '"]');
  const swatch = row && row.querySelector(".bgpick");
  if (swatch && swatch.value !== value) swatch.value = value;
  refreshSubjectSample(subject);
}

/* A subject name goes into a selector, and aSc's names contain quotes and
   backslashes as readily as anything else. */
function cssQuote(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderLegend(shown) {
  document.getElementById("share").title = t("shareHint");
  /* Breaks as well as lessons: both are drawn, so both are the reader's to
     rename and recolor. The breaks come after the subjects, under a heading of
     their own, because a gap is a different kind of thing from a lesson. */
  const breaks = breaksOnScreen();
  const lessons = [...new Set(shown.map(e => e.s))].sort()
                    .filter(name => !breaks.includes(name));
  const used = lessons.concat(breaks);
  /* One real lesson per subject, so the sample carries the room and teacher the
     boxes actually show rather than an empty shape. */
  example = {};
  for (const e of shown) if (!example[e.s]) example[e.s] = e;
  /* A row per subject, in the same columns an event uses, so the two lists read
     the same way. The three ways a subject can get its background are the three
     the switch above offers, said per subject rather than through a dropdown
     whose entries meant nothing on their own. */
  document.getElementById("legend").innerHTML = used.map((name, i) => {
    const col = colorFor(name), own = (state.subjects || {})[name] || {};
    const row = "s" + i, isBreak = breaks.includes(name);
    /* The school's word for it, then the reader's. The field shows the school's
       as a placeholder, so one word can be changed without retyping the rest,
       and an empty field means "use the school's" — the same bargain the title
       fields make. */
    const shown = isBreak ? breakName(name) : plainSubject(name);
    /* One heading above the first break, so the two kinds do not read as one
       list. Five columns, because the table has five. */
    const head = (isBreak && name === breaks[0])
      ? '<tr class="grouphead"><td colspan="6">' + esc(t("breaks.heading")) + "</td></tr>"
      : "";
    return head + '<tr data-subject="' + esc(name) + '"' +
      (hidden(name) ? ' class="hide"' : "") + ">" +
      '<td class="show"><input type="checkbox" class="subjshow"' +
        (hidden(name) ? "" : " checked") + ' aria-label="' +
        esc(t("colShow")) + '"></td>' +
      '<td class="rowlabel">' + esc(shown) + "</td>" +
      '<td><input type="text" class="subjlabel" value="' + esc(own.label || "") +
        '" placeholder="' + esc(shown) + '"></td>' +
      backgroundCell(row, subjectMode(name), col.bg,
        [["school", t("color.fromTimetable"), ""],
         ["palette", t("color.automatic"), ""]]) +
      textColorCell(row, col.fg, !own.textColor) +
            previewCell(col.bg, col.fg, sampleWhen("9:00"),
                  isBreak ? breakLabel(name)
                          : lessonTitle(example[name] || { s: name, S: 0 }),
                  (example[name] ? detailLine(example[name]) : []).join(" · "),
                  name === GAP ? "gap" : (isBreak ? "brk" : "")) +
      "</tr>";
  }).join("");
}

/* Both lists behave the same, so both are driven from here. */
/* Which of the three a subject is really on. A style of "custom" with no
   color behind it draws from the palette, so that is what it says. */
function subjectMode(name) {
  const own = (state.subjects || {})[name] || {};
  const style = styleFor(name);
  if (style === "school") return "school";
  if (style === "custom" && own.backgroundColor) return "own";
  return "palette";
}

let example = {};

/* The subject's sample, redrawn from whatever its colors are now. */
function refreshSubjectSample(name) {
  const row = document.querySelector('#legend tr[data-subject="' +
                                     cssQuote(name) + '"]');
  const col = colorFor(name), lesson = example[name];
  const isBreak = breaksOnScreen().includes(name);
  refreshSample(row, col.bg, col.fg, sampleWhen("9:00"),
                isBreak ? breakLabel(name)
                        : lessonTitle(lesson || { s: name, S: 0 }),
                (lesson ? detailLine(lesson) : []).join(" · "),
                name === GAP ? "gap" : (isBreak ? "brk" : ""));
}

/* On or off for one row. The legend is rebuilt with the rest of the page, so
   the row stays where it is and only its own look changes. */
function setSubjectShown(name, on) {
  const entry = state.subjects[name] || (state.subjects[name] = {});
  if (on) delete entry.hide; else entry.hide = true;
  tidySubjects();
  save();
  render();
}

/* A name of the reader's own for one subject or break. Empty means "use the
   school's", so the entry goes rather than holding an empty string. */
function setSubjectLabel(name, value) {
  const entry = state.subjects[name] || (state.subjects[name] = {});
  if (value.trim()) entry.label = value; else delete entry.label;
  tidySubjects();
  save();
  refreshSubjectSample(name);
  paint();
}

function subjectOf(target) {
  const tr = target.closest("tr");
  return tr && tr.dataset.subject;
}

document.getElementById("legend").addEventListener("input", (e) => {
  const name = subjectOf(e.target);
  if (!name) return;
  const tr = e.target.closest("tr");
  if (e.target.classList.contains("subjlabel")) {
    setSubjectLabel(name, e.target.value);
  } else if (e.target.classList.contains("bgpick")) {
    choose(tr, "bg", "own");
    setColor(name, e.target.value);
  } else if (e.target.classList.contains("fgpick")) {
    choose(tr, "fg", "own");
    setTextColor(name, e.target.value);
  }
});

document.getElementById("legend").addEventListener("change", (e) => {
  const name = subjectOf(e.target);
  if (!name) return;
  if (e.target.classList.contains("subjshow")) {
    setSubjectShown(name, e.target.checked);
    return;
  }
  if (e.target.type !== "radio") return;
  const tr = e.target.closest("tr");
  if (e.target.name.startsWith("fg")) {
    setTextColor(name, e.target.value === "auto" ? "" : colorFor(name).fg, true);
    return;
  }
  if (e.target.value === "own") {
    const swatch = tr.querySelector(".bgpick");
    setColor(name, swatch ? swatch.value : colorFor(name).bg);
  } else {
    const entry = state.subjects[name] || (state.subjects[name] = {});
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
    ">" + esc(classLabel(c)) + "</option>").join("");
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
           a row that quietly does its own thing makes the switch a lie.
           Chosen colors are kept, so turning "my own" back on restores them. */
        for (const entry of Object.values(state.subjects)) delete entry.style;
        tidySubjects();
      }
      save(); render();
    });
  });
}
["showStudentName", "showSchoolName", "showClassName",
 "showTeacher", "showRoom", "showGroup", "showSubject",
 "showDuration", "showGaps", "showQr"].forEach(key => bindToggle(key, key));
/* Six selects, two per kind of type. Every one of them writes one setting and
   redraws, so they are bound in a loop rather than one at a time. */
for (const role of ["time", "name", "detail"]) {
  for (const what of ["Face", "Size"]) {
    const box = document.getElementById(role + what);
    if (!box) continue;
    box.addEventListener("change", () => {
      const allowed = what === "Face" ? FACES : SIZES;
      if (!allowed.includes(box.value)) return;
      state[role + what] = box.value;
      save();
      render();
    });
  }
}

/* The one control that carries a number rather than a word. */
document.getElementById("printMargin").addEventListener("change", (ev) => {
  const mm = Number(ev.target.value);
  if (!MARGINS.includes(mm)) return;
  state.printMargin = mm;
  save();
  render();
});
bindChoice("teacherNameStyle", "teacherNameStyle");
bindChoice("teacherNameOrder", "teacherNameOrder");
bindChoice("subjectNameStyle", "subjectNameStyle");
bindChoice("subjectColorStyle", "subjectColorStyle");

/* The controls follow the state, and the two that only make sense alongside
   something else — how to write a name, which colors to pick — dim or vanish
   when that something is switched off. */
function syncDisplayControls() {
  for (const key of ["showStudentName", "showSchoolName", "showClassName",
                     "showTeacher", "showRoom", "showGroup", "showSubject",
                     "showDuration", "showGaps", "showQr"]) {
    document.getElementById(key).checked = !!state[key];
  }
  for (const name of ["teacherNameStyle", "teacherNameOrder",
                      "subjectNameStyle", "subjectColorStyle"]) {
    const key = name;
    document.querySelectorAll('input[name="' + name + '"]').forEach(radio => {
      radio.checked = radio.value === state[key];
    });
  }
  document.getElementById("teacherChoice").classList.toggle("off", !state.showTeacher);
  document.getElementById("teacherOrder").classList.toggle("off", !state.showTeacher);
  document.getElementById("subjectChoice").classList.toggle("off", !state.showSubject);
  renderMargins();
  applyPageMargin();
  renderFonts();
  applyFaces();
}

/* The typefaces, written where every view reads them: the timeline boxes, the
   fallback grid and the samples in the subject table. Sizes are not written
   here — how much larger a name can be is a question about the box it is in,
   and each box answers it for itself. */
function applyFaces() {
  const root = document.documentElement;
  if (!root || !root.style || !root.style.setProperty) return;
  for (const role of ["time", "name", "detail"]) {
    root.style.setProperty("--face-" + role,
                           FACE_STACK[state[role + "Face"]] || FACE_STACK.sans);
  }
  /* The grid has no box to measure against, so it takes the asked size as it
     stands: a table cell grows with what is in it and can cut nothing. */
  for (const role of ["time", "name", "detail"]) {
    root.style.setProperty("--grow-" + role, String(askedGrow(role)));
  }
}

/* One option per typeface and one per size, built here rather than written in
   the page, so the lists and the values the settings accept cannot drift. */
function renderFonts() {
  for (const role of ["time", "name", "detail"]) {
    const faces = document.getElementById(role + "Face");
    const sizes = document.getElementById(role + "Size");
    if (!faces || !sizes) continue;
    fillOptions(faces, FACES.map(face => [face, t("face." + face)]),
                state[role + "Face"]);
    fillOptions(sizes, SIZES.map(size => [size, t("size.percent", size)]),
                state[role + "Size"]);
  }
}

function fillOptions(box, pairs, picked) {
  const want = pairs.map(([value, label]) =>
    '<option value="' + esc(value) + '"' + (value === picked ? " selected" : "") +
    ">" + esc(label) + "</option>").join("");
  if (box.innerHTML !== want) box.innerHTML = want;
  box.value = picked;
}

/* One option per width the reader can pick. Built here rather than written in
   the page, so the list and the values the settings accept cannot drift. */
function renderMargins() {
  const box = document.getElementById("printMargin");
  const want = MARGINS.map(mm =>
    '<option value="' + mm + '"' + (mm === state.printMargin ? " selected" : "") +
    ">" + esc(t("printMargin.mm", mm)) + "</option>").join("");
  if (box.innerHTML !== want) box.innerHTML = want;
  box.value = String(state.printMargin);
}

/* An @page rule is not reachable through a class or a custom property, so the
   whole rule is written out. The sheet the fitter measures against has to
   agree with it, which is why both read the one setting. */
function applyPageMargin() {
  const rule = document.getElementById("pagerule");
  const want = "@page { size: A4 landscape; margin: " + state.printMargin + "mm; }";
  if (rule.textContent !== want) rule.textContent = want;
}
/* Clicking a lesson opens a color picker anchored under it. The input is a
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
pick.addEventListener("input", () => setColor(pick.dataset.subject, pick.value));
/* The color panel keeps the keyboard while it is open. Hand focus back when it
   closes, so the next thing typed goes to the page and not into a dead input. */
pick.addEventListener("change", () => pick.blur());

/* Everything the reader has customised — group picks, colors, personal
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

/* Everything back to how the page opens, except where the reader is: clearing
   the colors is not a request to be sent to another class.

   It used to read `klass` off the state, which has no such key — the state
   calls it `class`. So a reset dropped the reader back to the class the page
   opens on, and left an undefined `klass` behind in the settings. The button
   had no test, which is how that survived.

   Hands back what the backup box should now show. */
function resetSettings() {
  const { school, class: klass, lang } = state;
  state = Object.assign(defaults(), { school, class: klass, lang });
  save();
  renderDivisions(); syncPerClassInputs(); render();
  return JSON.stringify(slim(state), null, 2);
}

document.getElementById("reset").addEventListener("click", () => {
  /* The backup box sits in this same panel, a few centimetres from this button,
     and is only refilled when the panel is opened. Left alone it still shows
     everything that was just cleared. A press of Apply beside it then puts
     all of it back, the child's name included. */
  settingsText.value = resetSettings();
  settingsMsg.textContent = "";
});

advancedPanel.addEventListener("toggle", () => {
  if (advancedPanel.open) {
    refreshSettingsBox(true);
    settingsMsg.textContent = "";
  }
});
/* When the clipboard is unavailable, put the link on the page so it can be
   selected and copied by hand. Selecting it for the reader is as far as this
   can go. Nothing but a real gesture can reach the clipboard. */
function showShareFallback(url) {
  const box = document.getElementById("shareBox");
  box.value = url;
  box.classList.remove("off");
  box.focus();
  box.select();
}

/* Sharing is copying the address, since the address is the whole configuration. */
/* The subtitle is rebuilt on every render, so the link cannot hold its own
   listener. */
document.addEventListener("click", (ev) => {
  const hit = ev.target && ev.target.closest && ev.target.closest("#sayLink");
  if (!hit) return;
  ev.preventDefault();
  const panel = document.getElementById("sayPanel");
  if (!panel) return;
  panel.open = true;
  if (panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "center" });
  const box = document.getElementById("sayText");
  if (box && box.focus) box.focus();
});

for (const [id, event] of [["sayWithSettings", "change"], ["sayText", "input"]]) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, refreshFeedbackPreview);
}
{
  const send = document.getElementById("saySend");
  if (send) send.addEventListener("click", sendFeedback);
  /* No endpoint, nowhere to send: the panel would be a box that swallows what
     somebody took the trouble to write. */
  const panel = document.getElementById("sayPanel");
  if (panel && !DATA.report) panel.hidden = true;
}

document.getElementById("share").addEventListener("click", async () => {
  const button = document.getElementById("share");
  try {
    await navigator.clipboard.writeText(shareUrl());
    button.textContent = t("shared");
  } catch (e) {
    /* No clipboard — an insecure context, or a browser that refuses. Telling
       the reader to press Cmd/Ctrl+C tells them to copy nothing. So put the
       link somewhere it can be read and selected instead. */
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
/* A whole state arriving at once, typed or pasted by whoever has the page
   open. It is the one place where one bad value could take the page down with
   it, so it is a named function rather than the body of a button: a test can
   hand it anything, and does.

   Hands back the line to show under the box. */
function applySettingsText(text) {
  let incoming;
  try {
    incoming = JSON.parse(text);
  } catch (e) {
    return t("settings.badJson", e.message);
  }
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return t("settings.notObject");
  }
  state = normalise(incoming);
  /* A school or a class this page does not carry — an older link, or another
     school's file — would leave the page with nothing at all to draw. */
  if (!SCHOOLS.some(x => x.n === state.school)) state.school = DATA.initialSchool;
  if (!currentSchool().c.some(c => c.n === state.class)) state.class = currentSchool().c[0].n;
  save();
  renderLanguages(); renderSchools(); renderClasses();
  applyStrings(); renderDivisions(); syncPerClassInputs(); render();
  return t("settings.applied");
}

document.getElementById("applySettings").addEventListener("click", () => {
  settingsMsg.textContent = applySettingsText(settingsText.value);
});

/* Text fields keep the state up to date on every keystroke but only repaint on
   a short timer, so a long line is never typed against a redraw. The redraw
   leaves the legend alone as well, because a rebuild closes an open picker. */
/* Text in a field whose line is switched off shows nothing, so anything
   written there turns the line back on. An empty field does not turn it off
   again. An empty box is not a request for the line to go away. */
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
   An empty box means you retype the whole name to change one word. So the
   field fills in what it shows now when you enter it. If you leave it
   unchanged, it empties again, the setting stays unset, and the shared link
   stays short. */
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
    className.placeholder = t("classN", classLabel(cls));
  }
  renderEvents();
}
/* ----- the events table ---------------------------------------------------
   A row per event, and a color that can be arrived at three ways: copied
   whole from a lesson already on the timetable, chosen as a background with
   the text color worked out, or chosen as both. The "copy a lesson" control
   is a plain list of the subjects on screen — matching a lesson by eye and
   then hunting for its hex code is exactly the fiddly part. */
const evRows = document.getElementById("evrows");

/* Every named break the class has, on any day, in the order the day runs
   them. Alphabetical put the afternoon snack above the midday hour, which is
   not how anybody reads a day. */
function breaksOnScreen() {
  const shape = currentClass().h || {};
  const first = new Map();
  const note = (name, at) => {
    if (!name) return;
    if (!first.has(name) || at < first.get(name)) first.set(name, at);
  };
  for (const day of Object.values(shape)) {
    for (const b of (day.b || [])) note(b.n, typeof b.m === "number" ? b.m : 0);
  }
  /* A school that writes its breaks as lessons has them among the subjects.
     They belong under the same heading as everybody else's. */
  for (const e of currentClass().e) {
    if (e.B) note(e.s, typeof e.a === "number" ? e.a : 0);
  }
  /* And the one this page works out for itself, so it can be renamed and
     recolored like the rest. Last, because it is the least of them. */
  if (state.showGaps) {
    note(GAP, 24 * 60);
    if (currentSchool().lg) note(lunchKey(), 24 * 60 + 1);
  }
  return [...first.keys()].sort((p, q) => first.get(p) - first.get(q));
}

function subjectsOnScreen() {
  const cls = currentClass();
  return [...new Set(cls.e.filter(e => !e.c).map(e => e.s))].sort();
}

/* One radio per way of arriving at a color, and the control that goes with it
   beside the radio it belongs to. This was a dropdown with "own color" as its
   first entry. That entry said nothing about what the others do. The swatch
   beside it was disabled, and swallowed clicks. */
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
   result is the part nobody can do. This shows it. Sized as a 45-minute lesson,
   which is the common case and tall enough for all three lines. */
/* `kind` is what the day would draw this as: a lesson, one of the school's
   breaks, or a gap this page worked out. A sample that does not look like the
   thing it stands for is worth less than no sample. */
function sampleBox(bg, fg, when, label, meta, kind) {
  const style = "background-color:" + esc(bg) + ";color:" + esc(fg) +
                (kind === "brk" ? ";" + hatch(bg) : "");
  const body = kind === "gap"
    ? '<div class="what">' + esc(label) + " · " + esc(durationText(45)) + "</div>"
    : '<div class="when">' + esc(when) + "</div>" +
      '<div class="what">' + esc(label) + "</div>" +
      (meta ? '<div class="who2">' + esc(meta) + "</div>" : "");
  return '<div class="ev' + (kind ? " " + kind : "") + '" style="' + style + '">' +
    body + "</div>";
}

function previewCell(bg, fg, when, label, meta, kind) {
  return '<td><div class="sample">' +
    sampleBox(bg, fg, when, label, meta, kind) + "</div></td>";
}

/* Just the one cell, redrawn where it stands.
   Neither table can be re-rendered while somebody uses it. The events table
   leaves itself alone while the focus is inside it, so typing is not
   interrupted, and the legend is skipped by `paint` so an open color panel is
   not torn away. Both of those are right, and both meant the sample sat there
   showing the color before last. */
function refreshSample(tr, bg, fg, when, label, meta, kind) {
  const host = tr && tr.querySelector(".sample");
  if (host) host.innerHTML = sampleBox(bg, fg, when, label, meta, kind);
}

/* The color cells, shared by both tables so the two read the same way. */
function backgroundCell(row, mode, color, extra) {
  return '<td class="colors"><div class="colcell">' +
    pickOne("bg", row, mode, [["own", t("color.own"), swatch("bgpick", color)]]
              .concat(extra)) + "</div></td>";
}

function textColorCell(row, color, auto) {
  return '<td class="colors"><div class="colcell">' +
    pickOne("fg", row, auto ? "auto" : "own",
            [["own", t("color.own"), swatch("fgpick", color)],
             ["auto", t("color.automatic"), ""]]) + "</div></td>";
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
  /* Which subject this color came from, if it came from one. Read back off
     the color rather than remembered: one fewer thing to store, and it stays
     right if the subject is recolored afterwards. */
  const from = subjectsOnScreen().find(name =>
    colorFor(name).bg.toLowerCase() === ev.backgroundColor.toLowerCase());
  /* No "own color" entry in here: that is the radio above it now. */
  const lessons = subjectsOnScreen().map(name =>
    '<option value="' + esc(name) + '"' + (name === from ? " selected" : "") + ">" +
    esc(name) + "</option>").join("");
  /* Same order as the headings above: when, then what, then how it looks. */
  return '<tr data-i="' + i + '">' +
    '<td><select class="evday">' + days + "</select></td>" +
    '<td><input type="time" class="evstart" value="' + esc(ev.startTime) + '"></td>' +
    '<td><input type="time" class="evend" value="' + esc(ev.endTime) + '"></td>' +
    '<td><input type="text" class="evlabel" value="' + esc(ev.label) + '"></td>' +
    '<td><input type="text" class="evnote" value="' + esc(ev.note || "") + '"></td>' +
    backgroundCell("e" + i, from ? "subject" : "own", ev.backgroundColor,
      [["subject", t("color.fromSubject"),
        '<select class="evlike"><option value=""></option>' + lessons + "</select>"]]) +
    textColorCell("e" + i, ev.textColor || readable(ev.backgroundColor), !ev.textColor) +
    previewCell(ev.backgroundColor, ev.textColor || readable(ev.backgroundColor),
                sampleWhen(ev.startTime), ev.label, ev.note || "") +
    '<td><button class="drop" type="button" title="' + esc(t("events.remove")) +
      '">\u00d7</button></td>' +
    "</tr>";
}

function renderEvents() {
  if (evRows.contains(document.activeElement)) return;   // mid-edit: leave it
  evRows.innerHTML = mine().events.map(eventRow).join("");
}

/* One event changed and written down. Takes a number rather than a row, so
   what it does can be checked without a table to click on. */
function editEvent(index, change) {
  const ev = myOwn().events[index];
  if (!ev) return null;
  change(ev);
  tidy();
  save();
  return ev;
}

/* Which field of an event a control in the row writes to. A table rather than
   a chain of branches: a control added to the row with no field behind it then
   shows up as a missing entry, not as a control that quietly does nothing. */
const EVENT_FIELDS = { evday: "day", evstart: "startTime", evend: "endTime",
                       evlabel: "label", evnote: "note" };

function eventFieldFor(className) {
  for (const name of String(className).split(/\s+/)) {
    if (EVENT_FIELDS[name]) return EVENT_FIELDS[name];
  }
  return "";
}

/* One place where a row writes back, so every control behaves the same. */
function rowChanged(tr, change) {
  const ev = editEvent(+tr.dataset.i, change);
  if (!ev) return;
  const fg = ev.textColor || readable(ev.backgroundColor);
  refreshSample(tr, ev.backgroundColor, fg, sampleWhen(ev.startTime), ev.label,
                ev.note || "");
  paint();
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
  const field = eventFieldFor(e.target.className);
  if (field) rowChanged(tr, ev => { ev[field] = e.target.value; });
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
  const field = eventFieldFor(target.className);
  if (field) { rowChanged(tr, ev => { ev[field] = target.value; }); return; }

  if (cls.contains("evlike")) {
    choose(tr, "bg", "subject");
    if (!target.value) return;
    /* The whole scheme, both colors, exactly as that lesson is drawn. */
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
  myOwn().events.push({ day: "Mon", startTime: "16:00", endTime: "17:00", note: "",
                        backgroundColor: "#F6F2C1", textColor: "", label: "" });
  save(); renderEventsSoon(); paint();
});

/* Printing is a moment, not a setting: lay the page out for paper, print it,
   put it back. Nothing about it is worth remembering between visits. */
/* Cmd+P has to give the same sheet as the button. It used to give a different
   one: the print stylesheet applied, but nothing had switched the page into
   print mode, so there was no QR code, no scaling to the sheet, and the screen
   footer. Both paths go through here now. */
function enterPrint() {
  if (printing) return;
  printing = true;
  render();
}

function leavePrint() {
  if (!printing) return;
  printing = false;
  render();
}

if (typeof window.addEventListener === "function") {
  window.addEventListener("beforeprint", enterPrint);
  window.addEventListener("afterprint", leavePrint);
}

document.getElementById("doprint").addEventListener("click", () => {
  /* Still done by hand as well. A browser too old for beforeprint would
     otherwise print the screen, and where the event does fire this is a
     no-op — that is what the guards in the two are for. */
  enterPrint();
  try {
    window.print();
  } finally {
    leavePrint();
  }
});

/* ----- counting the visit ------------------------------------------------
   The counter is told what to record rather than left to read the page, because
   what it reads is the heading, and the heading can hold a child's name.
   What goes out is the school's own name for this timetable and nothing else:
   never `titleParts`, which folds in whatever the reader typed.

   It is sent as a path as well as a title. The counter keeps one title per
   path. A title that varies on a fixed path collapses every class into one
   row, labelled by whichever visit happened last. The reader's address bar is
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
     and the last visit wins. A label that followed the interface language
     flips between "class 8" and "8. klass" for the same row. The school's
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

/* ------------------------------------------------------------ faults -- */

/* Words the reader typed. Everything else in the settings is a switch, a code
   the school chose, or a color, and those are what a fault has to be read
   against. A typed word is replaced by as many X as it had characters. The
   length is what explains a broken layout, and a report then weighs what the
   real one weighs — which matters, because the page truncates at 4000 bytes. */
const TYPED = ["studentName", "schoolName", "className", "label"];

/* The settings with every typed word taken out, and nothing else moved. The
   shape is the point: which switches are on, how many events there are, which
   subjects carry a color of their own. */
function scrubbed(value, key) {
  if (typeof value === "string") {
    return TYPED.includes(key) ? "X".repeat(value.length) : value;
  }
  if (Array.isArray(value)) return value.map(v => scrubbed(v, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = scrubbed(value[k], k);
    return out;
  }
  return value;
}

/* Where a fault happened, with the address's own tail taken off. A browser
   reports the file it was in, and for an error in the page that file is the
   page — fragment and all, which is where every setting lives. `path` is sent
   deliberately and this must not undo it. */
function faultPlace(at) {
  return String(at || "").split("#")[0].split("?")[0];
}

for (const [id, which] of [["clashLink", "link"], ["clashMerge", "merge"],
                           ["clashMine", "mine"]]) {
  const button = document.getElementById(id);
  if (button) button.addEventListener("click", () => resolveClash(which));
}
{
  const button = document.getElementById("clashCopy");
  if (button) {
    button.addEventListener("click", async () => {
      const said = await copyMySettings();
      const note = document.getElementById("linkaskmsg");
      if (note) note.textContent = said;
    });
  }
}

/* Whether a fault may leave this page at all.
 *
 * The site is served over https, so anything else is a copy somebody saved to
 * disk — and a saved copy talks to nobody. A named rule rather than a line
 * inside the reporter, so a test can say what it is standing in for. */
function reportable() {
  return location.protocol === "https:";
}

function report(what, error, at) {
  if (!DATA.report || reportsSent >= REPORT_CAP) return;
  if (!reportable()) return;
  try {
    const message = String((error && error.message) || error || "").slice(0, 300);
    const seen = what + "|" + message;
    if (reportsSeen.has(seen)) return;
    reportsSeen.add(seen);
    reportsSent++;
    /* What every report carries, built from nothing but its own arguments.
       A fault stops the script where it stands, and everything declared below
       that point stays unreadable for the life of the page — so reaching for
       any of it here threw inside the reporter and lost the whole report. The
       fault worth hearing about most is the early one, and it was the one
       least likely to be sent. */
    const body = {
      kind: "page-error",
      what: what,
      message: message,
      stack: String((error && error.stack) || "").slice(0, 1200),
    };
    /* Everything else is an improvement on that, and each is allowed to fail
       without taking the report with it. */
    const add = (name, get) => {
      try {
        body[name] = get();
      } catch (e) { /* not readable here, so the report goes without it */ }
    };
    /* Which file, and where in it. A browser hides all of this for a script
       from another origin unless that script is loaded with crossorigin and
       serves the header for it. */
    add("where", () => faultPlace(at).slice(0, 300));
    /* Where in the code, not where the reader is: the address carries the
       settings, and the settings carry a name. */
    add("path", () => location.pathname);
    add("built", () => DATA.built || "");
    add("agent", () => String(navigator.userAgent || "").slice(0, 200));
    add("settings", () => scrubbed(slim(state)));
    /* "Script error." with no stack and no file is a browser refusing to say
       anything about a script from another origin — an extension, or a
       third-party script of ours before it was loaded with crossorigin. It is
       not readable and not actionable, so it is logged and not alarmed on. */
    if (!body.stack && !body.where && /^script error/i.test(body.message)) {
      body.opaque = 1;
    }
    /* Injected by something the reader installed, not by this page. */
    if (INJECTED.some(name => body.message.includes(name))) body.opaque = 1;
    /* A link cut short on its way through a chat window is not a fault here.
       Counted in the log, and never woken anybody up for. */
    if (what === "link") body.opaque = 1;
    /* keepalive, because a fault often arrives as the reader leaves. */
    fetch(DATA.report, {
      method: "POST", keepalive: true, mode: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body).slice(0, 4000),
    }).catch(() => {});
  } catch (e) { /* the reporter is the last thing allowed to break the page */ }
}

/* ------------------------------------------------------------ feedback -- */

/* What the reader typed, and their settings if they asked for those to go too.
   This is the one thing on the page that carries the reader's own words on
   purpose, so the panel shows the payload before it is sent — and shows this
   exact object, not a description of it. */
const SAY_CAP = 2000;

function feedbackPayload() {
  const text = (document.getElementById("sayText") || {}).value || "";
  const withSettings = !!(document.getElementById("sayWithSettings") || {}).checked;
  const cls = currentClass();
  const body = {
    kind: "feedback",
    text: text.slice(0, SAY_CAP),
    school: state.school,
    class: state.class,
    lang: state.lang,
    built: DATA.built || "",
    agent: String(navigator.userAgent || "").slice(0, 200),
  };
  /* Their settings as they are, not scrubbed: they asked for them to go, and
     they can read every character of what goes before they press Send. */
  if (withSettings) body.settings = slim(state);
  return body;
}

function refreshFeedbackPreview() {
  const box = document.getElementById("sayPreview");
  const shown = document.getElementById("sayShown");
  if (!box || !shown) return;
  const on = !!(document.getElementById("sayWithSettings") || {}).checked;
  box.hidden = !on;
  if (on) shown.textContent = JSON.stringify(feedbackPayload(), null, 2);
}

let saying = false;

async function sendFeedback() {
  const button = document.getElementById("saySend");
  const note = document.getElementById("sayMsg");
  const body = feedbackPayload();
  if (!body.text.trim()) { note.textContent = t("say.empty"); return; }
  if (saying || !DATA.report) return;
  saying = true;
  button.disabled = true;
  note.textContent = "";
  try {
    const answer = await fetch(DATA.report, {
      method: "POST", mode: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!answer.ok) throw new Error(String(answer.status));
    note.textContent = t("say.sent");
    document.getElementById("sayText").value = "";
    refreshFeedbackPreview();
  } catch (e) {
    note.textContent = t("say.failed");
    button.disabled = false;
  }
  saying = false;
}

renderLanguages();
renderSchools();
renderClasses();
applyStrings();
renderDivisions();
syncPerClassInputs();
openFilterIfNeeded();
render();
countVisit();
