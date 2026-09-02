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
/* Globals a browser puts into every page it can reach, or an extension the
   reader installed does. A wallet extension failing to set window.ethereum has
   nothing to do with a timetable and nothing here can fix it, so it is logged
   and not alarmed on.

   __gCrWeb is the bridge Chromium on iOS talks to its own page through, the
   way __firefox__ is Firefox's. Its script is evaluated in the page and the
   browser attributes the fault to this address, so a bridge that is not ready
   yet reads exactly like a fault of ours. Brave on an iPhone raised the
   page-broke alarm that way. */
const INJECTED = ["ethereum", "solana", "web3", "tronWeb", "keplr",
                  "__firefox__", "__gCrWeb", "webkit.messageHandlers"];

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

  /* The clock ruled down the side of the timeline. On, because it is the scale
     every box is positioned against and a week with no scale is a week of
     colored blocks.

     Off is for a card. The strip costs a fixed slice of the width whatever the
     sheet, which on a 100 by 60 card is room five days could have used — and a
     reader who has asked for the start time inside each box has already said
     where they want the clock. */
  showAxis: true,
  /* The two ends of a lesson, each the reader's to drop. Both on, because a
     timetable says when a lesson starts and when it stops. A card the size of a
     bus ticket has room for one of them, and the start is the end somebody
     reads a timetable for — so this is two checkboxes rather than one. */
  showStart: true, showEnd: true,
  /* The code in the corner of the printed sheet, off until it is asked for.
     Most sheets are read as paper on a wall, and the corner is room the
     timetable could have used. A reader who wants to pick the sheet back up on
     a phone switches it on. The address in the other corner stays either way:
     that is where anybody gets a timetable of their own. */
  showQr: false,

  /* Whether the calendar file carries the reader's own events as well as the
     school's lessons. On, because somebody who has written them down wants
     them where their week is. */
  calMine: true,

  /* And whether those events ring beforehand. Off until it is asked for: a
     reminder is a thing that goes off in a pocket, and nobody should find one
     they did not ask for. The lessons never get one — a phone that rings
     thirty times a week is a phone with notifications turned off. */
  calAlarm: false,
  calAlarmMinutes: 30,

  /* Millimetres of paper left blank around the sheet. Five is about as narrow
     as a laser printer will take without clipping, and every millimetre saved
     is a millimetre the timetable can use — which on a tight class is the
     difference between a readable box and a cut line. */
  printMargin: 5,

  /* Which sheet the timetable is laid out for. Almost every printout is the A4
     page itself, so that is what this says until a reader asks for a sheet to
     cut out of it. The two millimetre figures are the reader's own size, and
     they only count when the sheet is "custom" — A5 landscape to begin with,
     because it is a size somebody can hold up against a sheet of A4 and see. */
  printSheet: "a4", printWidth: 210, printHeight: 148,
  showSubject: true, subjectNameStyle: "full",

  /* How the parts of a lesson box are laid out. Stacked is a line each, which
     is what a box with room for three lines wants. Packed puts the clock, the
     name and the room on one line together: on a 100 by 60 card a box is one
     line tall, and stacked, the room and the teacher fall off the bottom and
     are not drawn at all. Packed, all three fit on the line that is there. */
  boxLayout: "stacked",                 // "stacked" | "packed"

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
/* How large a reader asks their type to be, as a percentage of the size the
   page draws by default. The steps below a hundred are the useful ones on a
   small sheet: a name the box cannot fit is cut with an ellipsis, and a size
   down costs nothing but reading distance while it buys whole words. Fifty is
   the floor. It is six point rather than a smudge, and on a card the size of a
   bus ticket it is the step that fits a room number beside the name instead of
   cutting one of the two. */
const SIZES = ["50", "60", "70", "80", "90", "100", "115", "125", "150"];

const MARGINS = [5, 9, 14];

/* How long before one of the reader's own events a reminder can be set for.
   Half an hour is the default: long enough to leave the house for a training
   session, short enough that the reader is still thinking about the day. */
const LEAD_MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120];
/* The sheet a printout is laid out for. "a4" is the sheet itself, and the
   timetable is fitted to all of it. The other two are smaller than an A4 page
   and are cut out of one: the printer still gets an ordinary A4 page, and the
   printout carries the line to cut along. So a reader with nothing but an A4
   printer can still end up with a sheet of any size that fits on it.

   Millimetres, landscape. The iPad figures are Apple's own for the device, not
   for its screen: the sheet is meant to go where the iPad goes. */
const SHEETS = ["a4", "ipad11a16", "custom"];
const SHEET_MM = { ipad11a16: [248.6, 179.5] };
/* Nothing can be cut out of A4 that is larger than the A4 page, and nothing can
   be printed outside the paper edge. So the largest sheet is the page less that
   edge at each end, which means the paper edge caps the sheet without ever
   shrinking one that already fits: a line at 248.6mm stays 248.6mm whatever the
   edge is set to, and only moves further in from the paper.

   Fifty at the small end. A week fits in 60mm of height at about eight point,
   which is a wallet card rather than a smudge, and the preview says plainly
   what anything smaller looks like. */
const SHEET_MIN = 50;
const sheetLimit = () => [297 - 2 * state.printMargin, 210 - 2 * state.printMargin];

/* How many copies of the sheet fit on one page, and which way round to turn
   the paper for it.

   A sheet smaller than the page leaves the rest of it blank, and somebody who
   asked for a card a third the size of the paper wants more than one card. So
   the page is filled, and the paper is turned when turning it fits more:
   100 by 60 gets six copies across a landscape page and eight down a portrait
   one. Neither way round always wins, which is why this counts both.

   A tie keeps landscape, which is the timetable's own shape and what a page
   with nothing to tile has always used. */
function tiling() {
  const cut = cutSheet();
  if (!cut) return { cols: 1, rows: 1, count: 1, portrait: false };
  const [w, h] = cut, edge = 2 * state.printMargin;
  const grid = (pw, ph) => {
    const cols = Math.floor((pw - edge) / w), rows = Math.floor((ph - edge) / h);
    return { cols, rows, count: Math.max(0, cols) * Math.max(0, rows) };
  };
  const flat = grid(297, 210), tall = grid(210, 297);
  const best = tall.count > flat.count ? tall : flat;
  /* A sheet that fits neither way round is still drawn once, so the reader
     sees what they asked for rather than an empty page. */
  if (!best.count) return { cols: 1, rows: 1, count: 1, portrait: false };
  return Object.assign({ portrait: best === tall }, best);
}
/* Millimetres of white kept between the type and the cut line, so a scissors
   that wanders by a hair does not take a room number with it. */
const CUT_PAD = 2.5;

/* Clamped into range rather than refused. A reader who asks for more than the
   paper edge leaves gets the largest sheet that fits, which is what they were
   reaching for. Only something that is not a number at all — an emptied box —
   goes back to the size that was in force. */
const sheetMm = (value, most, fallback) => {
  const mm = Math.round(Number(value));
  if (!Number.isFinite(mm) || String(value).trim() === "") return fallback;
  return Math.min(Math.max(mm, SHEET_MIN), most);
};

/* The sheet in millimetres, or nothing at all when the timetable fills the
   A4 page. Everything that has to agree about the size reads this. */
function cutSheet() {
  if (state.printSheet === "custom") return [state.printWidth, state.printHeight];
  return SHEET_MM[state.printSheet] || null;
}
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
    /* A name of the reader's own, long and short. Blank means "use the
       school's". The two are asked for separately because one word cannot be
       both: a reader who writes "Maths" for a wall chart wants "Ma" on a
       card. */
    for (const field of ["label", "short"]) {
      if (typeof value[field] === "string" && value[field].trim()) {
        kept[field] = value[field];
      }
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
/* A name for one of the reader's own events, which nothing shows and only the
   calendar reads.

   The events table has no key of its own, so an event used to be identified by
   where it sat in the list. That is not an identity: deleting the row above it,
   reordering, or repairing a typo in somebody else's row all renamed it, and a
   calendar told an event has a new name keeps the old one as well. An id given
   once and kept survives every edit, including changing the event's own hour.

   Eight characters of base 36. Two events would have to collide inside one
   class for it to matter, and a collision costs one merged entry. */
function newEventId() {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

const EVENT_ID = /^[a-z0-9]{1,16}$/;

function oneEvent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const day = DAY_KEYS.indexOf(String(raw.day));
  const a = clock(raw.startTime), z = clock(raw.endTime);
  if (day < 0 || a === null || z === null || z <= a) return null;
  const color = (v) => (typeof v === "string" && HEX.test(v.trim())) ? v.trim() : "";
  return {
    /* Kept where there is one, and given where there is not: events written
       before this existed are named on the first read and keep that name. */
    id: (typeof raw.id === "string" && EVENT_ID.test(raw.id))
        ? raw.id : newEventId(),
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
                                ["printMargin", MARGINS],
                                ["calAlarmMinutes", LEAD_MINUTES],
                                ["printSheet", SHEETS],
                                ["boxLayout", ["stacked", "packed"]]]) {
    if (!allowed.includes(out[key])) out[key] = base[key];
  }
  /* Free numbers rather than one of a list, so they are checked rather than
     matched. A saved sheet of nought millimetres would leave the fitter
     nothing to fit into and the printout empty. */
  /* After the margin, because the margin is what bounds these. */
  const [mostW, mostH] = [297 - 2 * out.printMargin, 210 - 2 * out.printMargin];
  out.printWidth = sheetMm(out.printWidth, mostW, base.printWidth);
  out.printHeight = sheetMm(out.printHeight, mostH, base.printHeight);
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
  /* The same for the setting that puts the address on paper. The corner is
     empty until a reader asks for the code, so the note has to say where to
     ask, in the words the checkbox itself carries. */
  const printedNote = document.getElementById("printedNote");
  if (printedNote) printedNote.textContent = t("settings.printed", t("showQr"));
  /* A control with no visible label still has to say what it is out loud. */
  document.querySelectorAll("[data-i18n-aria]").forEach(el => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
}

const esc = (s) => String(s).replace(/[&<>"'`]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
     "'": "&#39;", "`": "&#96;" }[c]));

function currentSchool() {
  const named = SCHOOLS.find(s => s.n === state.school);
  /* One timetable can be offered as two schools — ProTERA and the gümnaasium
     share a file and nothing else — and a link written before that split names
     the school that no longer holds its class. The class is the more specific
     of the two, so it decides: a sibling out of the same timetable that has it
     is the one meant. Without this the reader lands silently on the first
     class of the wrong half. */
  if (named && state.class && !named.c.some(c => c.n === state.class)) {
    const sibling = SCHOOLS.find(s => s !== named && s.tt && s.tt === named.tt &&
                                      s.c.some(c => c.n === state.class));
    if (sibling) return sibling;
  }
  return named || SCHOOLS[0];
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

/* Filed under the timetable and not under the entry in the dropdown. The two
   are the same until a timetable is offered as two schools, and then keying by
   the dropdown would rename every setting the gümnaasium's readers had saved.
   The timetable a class came out of never changes. */
function classKey() {
  const school = currentSchool();
  return (school.tt || school.n) + "/" + currentClass().n;
}

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
   The division's own id is aSc's ("*5:1") and means nothing to anyone.

   A division the build split into one picker per subject carries a key of its
   own, because both halves offer the same group list and would otherwise share
   one answer. The half that kept the group list keeps the saved pick. */
const choiceKey = (division) => division.k || division.groups.join("/");

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
    if (!entry.label && !entry.short && !entry.style && !entry.backgroundColor &&
        !entry.textColor && !entry.hide) {
      delete state.subjects[subject];
    }
  }
}

/* A band too short to be the thing it is named after.
 *
 * The day plan's hour is Proaeg, and what is left of it after a sitting is
 * still Proaeg — until the leavings are five minutes, which is not an hour of
 * anything. ProTERA's Friday makes one: eat until 12.10, bus at 12.15.
 *
 * Ten minutes is where the page already draws the line, and it draws it for the
 * same reason: under that a space is a corridor rather than time you can plan
 * around. So a short piece is handed to the box that says exactly that, with
 * the page's own word on it and the outline that says nobody named it.
 *
 * A band the school really does write that short keeps its name. TäheTERA has
 * a ten-minute one between its second and third lessons, and ten is not under
 * ten. */
function shortIsACorridor(item) {
  if (!item.brk || item.ride) return item;
  if (item.z - item.a >= GAP_AT_LEAST) return item;
  return { a: item.a, z: item.z, gap: GAP };
}

/* A break gives way to the things the same day plan puts inside it.
 *
 * ProTERA's Friday is why. A reader whose Praktikum is out of the schoolhouse
 * eats at 11.50, takes the 12.15 bus and is gone at 12.30; the rest of the
 * Proaeg hour is not theirs, and it is only on the day at all because the other
 * group's sitting fell back to it. Left whole it would run under the bus and
 * under the lesson, and the three would be packed side by side saying the
 * reader is in all of them.
 *
 * Only the plan's own: a bus, and a lesson whose hours the plan gave rather than
 * aSc. Where aSc and the plan disagree — TäheTERA has a two-hour Loovloodus
 * with the school's lunch band sitting inside it — that is the school's
 * disagreement and not ours to settle by deleting one of them.
 *
 * And only what the reader has answered for. Before they answer, both groups'
 * Fridays are on the screen at once and the page draws alternatives side by
 * side, which is what it does everywhere two groups share an hour. Trimming
 * then would take one group's meal away because the other group's lesson runs
 * across it.
 *
 * The band can come out in pieces, so the subtraction is a real one rather than
 * a trim at each end. Nothing here reorders or drops a lesson. */
function trimBands(items, answered) {
  const chosen = (groups) => (groups || []).some(g => answered.has(g));
  const solid = items.filter(x => x.ride ||
                                  (x.lesson && x.lesson.D && chosen(x.lesson.g)))
                     .map(x => [x.a, x.z]);
  if (!solid.length) return items;
  const out = [];
  for (const item of items) {
    if (!item.brk || item.ride) { out.push(item); continue; }
    let pieces = [[item.a, item.z]];
    for (const [a, z] of solid) {
      const kept = [];
      for (const [from, to] of pieces) {
        if (z <= from || a >= to) { kept.push([from, to]); continue; }
        if (from < a) kept.push([from, a]);
        if (z < to) kept.push([z, to]);
      }
      pieces = kept;
    }
    for (const [from, to] of pieces) {
      out.push(Object.assign({}, item, { a: from, z: to }));
    }
  }
  return out;
}

/* A band is mine the same way a lesson is, where the school splits one.
   ProTERA's eighth year eats in two sittings on a Friday and the timetable
   cannot say which is whose — everybody has Praktikum at that hour, and only
   whether it is inside the schoolhouse or outside decides. So the page asks,
   and this is the answer being applied.

   A band with no group belongs to the whole class. A band whose group nobody
   has answered for yet is drawn too: before a reader picks, every group's
   lessons are on the screen, and their sittings belong there with them. */
function bandIsMine(band, picked, divisions) {
  /* Every group the band belongs to, because a lesson can have more than one
     and the ride to it belongs to all of them. */
  const groups = band.g || [];
  if (!groups.length) return true;
  for (const div of divisions) {
    if (!groups.some(g => div.groups.includes(g))) continue;
    const pick = picked[choiceKey(div)];
    /* Some bands wait to be asked for. Two sittings can stand on one day
       because they follow one another, so both are drawn until the reader says
       which is theirs. A bus that leaves in the middle of the other group's
       meal cannot: drawn beside it the two would be half a column each, and the
       day would be saying the class is doing both. */
    if (band.o) return groups.includes(pick);
    if (pick && !groups.includes(pick)) return false;
  }
  return true;
}

/* A lesson is mine when every division it belongs to matches one of my picks.
   Whole-class lessons carry no groups and are always mine. */
function visible(entry, picked, divisions) {
  /* A lesson in no group is the whole class's, and a lesson is shown until a
     pick rules it out — both fall out of the loop below reaching its end, so
     neither needs a guard of its own. One was here, and no test can tell
     whether it works, because its removal changes nothing. */
  /* Some lessons wait to be asked for, and that is asked before anything else
     — including before the shortcut below, which is what "nothing picked yet"
     means for every other lesson.

     ProTERA's Friday Praktikum is one lesson the school runs twice: the same
     hour in aSc, and in the Päevakava a bus at 12.15 and the other building
     from 12.30. Drawn side by side the two are half a column each, and a day
     showing both alternatives has no room left to say which is which. So until
     the reader answers, the day keeps the one aSc published. */
  if (entry.A) {
    return divisions.some(div => entry.g.some(g => div.groups.includes(g)) &&
                                 entry.g.includes(picked[choiceKey(div)]));
  }
  if (!Object.values(picked).filter(Boolean).length) return true;
  for (const div of divisions) {
    /* A division split per subject offers every one of the same groups, so the
       groups alone no longer say which picker a lesson answers to. Its subject
       does. Where a division was never split this changes nothing: the list is
       built from the very lessons its groups carry. */
    if (div.sj && div.sj.length && !div.sj.includes(entry.s)) continue;
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
               /* Carried through for the calendar, which is the only thing
                  that asks. A row typed just now has none until it is saved. */
               id: (typeof ev.id === "string" && EVENT_ID.test(ev.id)) ? ev.id : "",
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
   more. They depend on how tall the box is and on what kind of box it is,
   which is why this takes a box and not just a role.
 *
 * A break is set smaller than a lesson at every height, and a worked-out gap
 * smaller again. The stylesheet says the same numbers, and a test holds the two
 * together — measuring a break as though it were a lesson gave every break
 * room it did not have. */
function baseSizes(cls) {
  return {
    time: cls.includes("squeeze") ? 8.5 : 10,
    name: cls.includes("gap") ? 9.5
        : cls.includes("squeeze") ? 9
        : cls.includes("tiny") ? 10.5
        : cls.includes("brk") || cls.includes("tight") ? 11
        : 12,
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
 * existed.
 *
 * `packed` says the parts share one line rather than take one each. Then the
 * line costs the largest of them and not the sum of them, which is the whole
 * reason a packed box has room the same box stacked does not. */
function growRoom(height, cls, lines, packed) {
  const base = baseSizes(cls);
  /* Each of these is the line height the stylesheet gives that box. */
  const leading = cls.includes("squeeze") ? 1
                : cls.includes("tiny") ? 1.2
                : cls.includes("gap") ? 1.15
                : cls.includes("snug") ? 1.1
                : 1.25;
  /* The border is 1px each side and the padding 2px each side. A dashed box
     draws 2px, and half a pixel of slack is cheaper than a second branch. */
  const room = height - 2 - 4 - 1;
  let now = 0, want = 0;
  for (const role of lines) {
    const was = base[role] * leading, asked = was * askedGrow(role);
    if (packed) {
      now = Math.max(now, was);
      want = Math.max(want, asked);
    } else {
      now += was;
      want += asked;
    }
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

/* How far a line may be set down to keep all of it. An ellipsis is about a
   character wide, so cutting a line that is a character too long spends as much
   width as it saves and loses a fact for nothing. A line within this much of
   fitting is drawn smaller instead and says everything.
 *
 * Fifteen per cent. It is a step the reader can see if they look for it and not
 * one they notice in a week of boxes, and it is about two characters on a card
 * — past that the box is asking for a size its reader did not choose, and the
 * ellipsis is the honest answer. */
const SQUEEZE_FLOOR = 0.85;

/* A pixel of daylight left at the end of a line that was set down to fit.
   Landing exactly on the edge is landing just past it: the width of a run of
   text is not a round number and neither is the box, and a line that measures
   equal to its box is one rounding away from an ellipsis.
 *
 * A whole pixel rather than a half, because the box this is measured on is not
 * quite the box it is printed in. A card that tiles a page is measured on the
 * original and drawn from a copy of it, and the two come out a fifth of a pixel
 * apart — which was enough to put the ellipsis back on a line that had just
 * been made to fit. */
const LINE_CLEAR = 1;

/* How far the text runs past the end of its line, in real pixels.
 *
 * Not `scrollWidth` against `clientWidth`. Those are whole numbers, and the
 * line that started all this was 54.250 wide in a box of 54.203 — both report
 * 54, so the arithmetic said it fitted while the browser drew an ellipsis over
 * a twentieth of a pixel. A range over the content measures what was actually
 * laid out, ellipsis or no ellipsis. */
function lineOver(line) {
  const range = document.createRange();
  range.selectNodeContents(line);
  const laid = range.getBoundingClientRect().width -
               line.getBoundingClientRect().width;
  /* A label that wraps lays out inside its box, so the range says it fits even
     where one word does not — "(praktikum" is wider than half a Friday column.
     The browser's own count catches that, in whole pixels, and the wider of the
     two answers is the one to act on. */
  return Math.max(laid, line.scrollWidth - line.clientWidth);
}

/* A packed line the box cannot fit on one line, in a box with room for a second
   one, is given the second line rather than an ellipsis.
 *
 * Measured rather than worked out. Whether "9.00 Eesti k A212" fits 64 pixels is
 * a question about the font the reader's machine has and the size they asked
 * for, and only the browser knows the answer. It runs after the type has given
 * back whatever the box had no room for, so it measures what is drawn.
 *
 * A second line costs the sheet nothing. Every box is positioned by the clock
 * and its height is fixed before any of this, so the space under the first line
 * is space the box already owns and was leaving empty.
 *
 * A box with room for one line is left alone, and that is the point of the
 * measurement rather than an omission. Told it may wrap, such a box breaks at
 * the space before the part that does not fit and then has nowhere to put it:
 * "9.00…" where it had shown "9.00 Ees…", which is less of the lesson and not
 * more. */
/* The three sizes a box carried before any line of it was set down, written on
   the box itself so a second pass can find them.
 *
 * There is a second pass. A card that tiles a page is drawn from copies, and
 * the copies are a fraction narrower than the original they were measured on —
 * so they are measured again once they exist. Without a fixed starting point
 * each pass would set the box down from wherever the last one left it, and a
 * floor of fifteen per cent would be fifteen per cent of fifteen per cent.
 *
 * Taken the first time it is asked for, which is after the type has given back
 * whatever the box had no room for. That give-back is a decision about height
 * and it is the same on a copy as on the original, so it belongs in the base
 * rather than under it. */
function baseGrow(box) {
  const roles = ["time", "name", "detail"];
  if (box.dataset && box.dataset.grow) return box.dataset.grow.split(",").map(Number);
  const now = roles.map(role =>
    Number(box.style.getPropertyValue("--grow-" + role)) || 1);
  if (box.dataset) box.dataset.grow = now.join(",");
  return now;
}

function restoreGrow(box) {
  if (!box.dataset || !box.dataset.grow || !box.style) return;
  const was = box.dataset.grow.split(",");
  ["time", "name", "detail"].forEach((role, i) =>
    box.style.setProperty("--grow-" + role, was[i]));
}

function wrapPacked(root) {
  if (!root || !root.querySelectorAll) return;
  for (const line of root.querySelectorAll(".ev .what.oneline")) {
    /* Cleared first, so a second pass over the same boxes asks the same
       question rather than measuring its own last answer. */
    line.classList.remove("wrap");
    if (line.style && line.style.removeProperty) line.style.removeProperty("--lines");
    const box = line.parentElement;
    if (!box) continue;
    restoreGrow(box);
    if (lineOver(line) <= 0) continue;                        // it fits as it is
    const face = getComputedStyle(line), edge = getComputedStyle(box);
    const step = parseFloat(face.lineHeight) || 1.25 * parseFloat(face.fontSize);
    const room = box.clientHeight - parseFloat(edge.paddingTop) -
                 parseFloat(edge.paddingBottom);
    const lines = step > 0 && room > 0 ? Math.floor(room / step) : 1;
    if (lines >= 2) {
      line.style.setProperty("--lines", String(lines));
      line.classList.add("wrap");
      continue;
    }
    /* One line and not enough of it. A small step down in size keeps the whole
       line where an ellipsis would have spent the same width hiding it. */
    squeezeToFit(box, line);
  }
  /* And a stacked label, which wraps rather than running on but can still have
     one word too wide for the box. The same answer: a step down in size beats
     a word with its end cut off. */
  for (const label of root.querySelectorAll(".ev .what:not(.oneline)")) {
    const box = label.parentElement;
    if (!box) continue;
    restoreGrow(box);
    if (lineOver(label) <= 0) continue;
    squeezeToFit(box, label);
  }
}

/* Set the box down until its one line fits, or put it back.
 *
 * Down through the three sizes together, so the box keeps the proportions the
 * reader asked for and only gets quieter. Measured between steps rather than
 * solved: text does not scale exactly with its size, and two passes land closer
 * than any arithmetic here would.
 *
 * Either the whole line fits or nothing changes. A box set smaller and still
 * cut is a box that gave up its size and got nothing for it, and it would sit
 * among its neighbours looking like a different kind of thing for no reason a
 * reader could see. */
function squeezeToFit(box, line) {
  if (!box.style || !box.style.getPropertyValue) return;
  const roles = ["time", "name", "detail"];
  const asked = baseGrow(box);
  const write = (by) => roles.forEach((role, i) =>
    box.style.setProperty("--grow-" + role,
                          String(Math.round(asked[i] * by * 1000) / 1000)));
  let total = 1;
  for (let pass = 0; pass < 4 && lineOver(line) > 0; pass++) {
    const have = line.getBoundingClientRect().width - LINE_CLEAR;
    const text = have + lineOver(line) + LINE_CLEAR;
    const want = have / text;
    if (!(want > 0)) break;
    /* Held at the floor rather than abandoned there. Text does not scale
       exactly with its size, so a line can need a second small step after the
       first — and a step that would cross the floor used to end the whole
       attempt, which threw away the ground already gained and put the ellipsis
       back on a box that was a fraction from fitting. */
    const next = Math.max(SQUEEZE_FLOOR, total * want);
    if (!(next < total)) break;                 // no ground left to gain
    total = next;
    write(total);
  }
  if (lineOver(line) > 0) write(1);
}

/* Both passes, in the order they have to run: the type settles first, and what
   wraps is then measured against the size it ended up at. Every caller wants
   both, and one that remembered only the first left the rooms cut. */
function fitBoxes(root) {
  shrinkOverfull(root);
  wrapPacked(root);
}

/* The inside of one box: the parts the reader left switched on, in the order
   the box draws them, and nothing where a part is switched off.
 *
 * Two layouts. Stacked is a line each, which is what a box tall enough for
 * three lines wants. Packed is one line for all of them — the clock, the name
 * and the quiet line of room and teacher, side by side. A box on a 100 by 60
 * card is one line tall, and stacked, everything under the first line falls off
 * the bottom and is not drawn at all. Packed, all of it fits on the line the
 * box has.
 *
 * A box too short for two lines packs itself whatever the reader asked for. It
 * has no second line to stack anything on.
 *
 * The parts are whatever the checkboxes above left standing. Nothing here
 * decides that a room belongs on the line and a teacher does not: an empty part
 * is left out rather than drawn empty, so a reader who switched the clock off
 * gets the name where the clock was and not a blank line above it.
 *
 * Hands back the markup, the roles that ended up on the box — which is what
 * says how much larger type it can take — and whether they share a line. */
function boxBody(height, parts) {
  const packed = state.boxLayout === "packed";
  const one = packed || height < 30;
  /* The quiet line is the first thing a stacked box gives up. Three tight lines
     come to 36, and 46 is where all three fit. Packed, it costs no height at
     all, so it stays. */
  const keep = parts.filter(p => p.text &&
                                 (p.role !== "detail" || packed || height >= 46));
  const lines = keep.map(p => p.role);
  if (!keep.length) return { html: "", lines: lines, packed: one };
  if (one) {
    const inline = { time: "clock", detail: "who3" };
    const bits = keep.map(p => inline[p.role]
      ? '<span class="' + inline[p.role] + '">' + esc(p.text) + "</span>"
      : esc(p.text));
    return { html: '<div class="what oneline">' + bits.join(" ") + "</div>",
             lines: lines, packed: true };
  }
  const stacked = { time: "when", name: "what", detail: "who2" };
  return { html: keep.map(p => '<div class="' + stacked[p.role] + '">' +
                               esc(p.text) + "</div>").join(""),
           lines: lines, packed: false };
}

/* The three numbers a box carries, written where the stylesheet reads them. */
function growStyle(height, cls, lines, packed) {
  const room = growRoom(height, cls, lines, packed);
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
      const bands = [];
      for (const b of shape.b) {
        /* A sitting that is not this reader's does not leave a hole. It leaves
           the stretch it stood in, under the name the plan gave that stretch
           before the sitting was cut out of it.
         *
           Dropped outright it read as a hole, and the day drew a worked-out
           "Paus · 20 min" over the very minutes every other day of the week
           calls Vaba aeg. Same plan, same hour, two different words for it. */
        const ours = bandIsMine(b, myPicks(), cls.v);
        const name = ours ? b.n : (b.f || "");
        if (!name || hidden(name)) continue;
        bands.push({ band: b, name: name, ours: ours });
      }
      for (const it of bands) {
        /* The note is only worth its width while there is something to tell
           apart. Two sittings on one day need it; once the reader has answered,
           theirs is the only one there and says what it says on every other day
           of the week. */
        const twin = bands.some(other => other !== it && other.name === it.name);
        perDay.get(i).push({ a: it.band.m, z: it.band.x, brk: it.name,
                             ride: !!it.band.o, g: it.band.g || [],
                             note: it.ours && twin ? (it.band.q || "") : "" });
      }
      perDay.set(i, trimBands(perDay.get(i),
                             new Set(Object.values(myPicks()).filter(Boolean))));
      perDay.set(i, perDay.get(i).map(shortIsACorridor));
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
  h += '<div class="tl' + (state.showAxis ? "" : " noaxis") +
          '" style="--ppm:' + ppm + ";--half:" + (30 * ppm) +
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
    /* A band a lesson runs straight across is not that lesson's neighbour.
       Packed beside it the two are half a column each, which is how the day
       says "two groups, one hour" everywhere else — and a reader wrote in to
       say that is exactly how it read: lunch and handicraft as two groups'
       lessons. TäheTERA's 4.a has the case, a two-hour Loovloodus on Thursday
       with the plan's Lõuna inside it.

       So it is drawn over the lesson instead, the way the reader's own events
       are: a layer, and the lesson keeps its full width.

       Only where one reader can have both. A band and a lesson of two
       different groups are alternatives, not layers, and side by side is
       exactly what the day should say about them — ProTERA's Friday bus sits
       across the hour another group spends in Bioloogia. Whole-class on either
       side means one reader has both, and so does any shared group. */
    const together = (band, lesson) => {
      const mine = band.g || [], theirs = lesson.g || [];
      return !mine.length || !theirs.length ||
             mine.some(g => theirs.includes(g));
    };
    const layered = items.filter(x => x.brk && items.some(
      other => other.lesson && other.a < x.z && x.a < other.z &&
               together(x, other.lesson)));
    const packed = pack(items.filter(x => !x.mine && !layered.includes(x)));
    for (const it of packed.concat(layered)) {
      const height = Math.max(14, Math.round(y(it.z) - y(it.a)) - 1);
      /* A layer is inset, so what it sits on is visible either side of it and
         the two read as one on top of the other rather than as two of a kind.
         The same inset a personal event over a lesson gets, for the same
         reason. */
      const geom = place(it, layered.includes(it) ? 16 : 0);
      const when = clockText(it.a, it.z);
      if (it.gap === GAP) {
        /* Worked out here rather than published, so it says only the one thing
           the lessons around it do not: how long it is. The outline is what
           says it was inferred; the color is the reader's like any other, and so
           is the size — a reader who asks for half-size type on a card means
           this box too.
         *
         * And so is the duration. "How long it lasts" is one checkbox and it
         * governs every box, this one included: it read as dead against a day
         * full of gaps still carrying "· 10 min". The box is then the word
         * alone, which is all a reader asked to be told. The tooltip keeps the
         * figure either way. */
        const kind = it.gap, col = colorFor(kind), how = durationText(it.z - it.a);
        const label = breakLabel(kind) + (state.showDuration ? " · " + how : "");
        h += '<div class="ev gap" data-subject="' + esc(kind) + '" style="' +
             growStyle(height, "gap", ["name"]) + geom +
             "background-color:" + esc(col.bg) + ";color:" + esc(col.fg) +
             '" title="' + esc(breakLabel(kind) + " " + how) +
             '"><div class="what">' + esc(label) + "</div></div>";
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
        const label = breakLabel(band) + (it.note ? " (" + it.note + ")" : "");
        /* The name first and the clock under it, which is the other way round
           from a lesson: a band is read for what it is, and a lesson for when
           it is. */
        const inside = boxBody(height, [{ role: "name", text: label },
                                        { role: "time", text: when }]);
        /* Ten minutes is the shortest band anything is written in — TäheTERA
           has one between its second and third lessons — and at that height
           the padding is the difference between a line and a cut line. */
        const brkCls = height < 17 ? " tiny squeeze" : height < 22 ? " tiny" : "";
        h += '<div class="ev brk' + brkCls +
             (layered.includes(it) ? " layer" : "") + '" style="' +
             growStyle(height, "brk" + brkCls, inside.lines, inside.packed) +
             geom + "background-color:" + esc(col.bg) +
             ";color:" + esc(col.fg) + ";" + hatch(col.bg) +
             '" data-subject="' + esc(band) + '" title="' +
             esc([label, when].filter(Boolean).join("\n")) +
             '">' + inside.html + "</div>";
        continue;
      }
      const e = it.lesson, col = colorFor(e.s), info = subjectFacts()[e.s] || {};
      const meta = detailLine(e);
      const tip = [subjectName(e, false), e.g.join("/"),
                   teacherNames(e, "full").join(" / "),
                   e.r.join(" / "), when, e.u > 1 ? t("paired") : t("single"),
                   e.o ? t("noExactTime") : ""].filter(Boolean).join("\n");
      const name = lessonTitle(e);
      /* A lesson the school gave no minutes for says so on its clock, and says
         it there even where the reader switched both ends of the clock off. The
         dashed border alone is not a sentence. */
      const clock = e.o ? (when ? when + " ?" : t("noTimeShort")) : when;
      /* A school that writes its breaks as lessons still gets breaks. The
         hatch is what says "not a lesson", whatever the timetable calls it. */
      /* A box only just tall enough for three lines gets them only if the
         name stays on one. Left to wrap, a long subject took two lines and the
         bottom of the box cut it — which it did long before the detail line
         was let in here. */
      const lessonCls = (e.B ? " brk" : "") + (height < 40 ? " tight" : "") +
                        (height < 62 ? " snug" : "");
      const body = boxBody(height, [{ role: "time", text: clock },
                                    { role: "name", text: name },
                                    { role: "detail", text: meta.join(" · ") }]);
      h += '<div class="ev' + lessonCls + (e.o ? " approx" : "") +
           '" data-subject="' + esc(e.s) + '" style="' +
           growStyle(height, lessonCls, body.lines, body.packed) + geom +
           "background-color:" + esc(col.bg) +
           ";color:" + esc(col.fg) + '" title="' + esc(tip) + '">' + body.html +
           "</div>";
    }
    /* The layer on top. Events are packed among themselves, so two of them at
       once still sit side by side rather than hiding one another. */
    const base = items.filter(x => !x.mine && !layered.includes(x));
    for (const it of pack(items.filter(x => x.mine))) {
      const over = base.some(x => x.a < it.z && it.a < x.z);
      const height = Math.max(14, Math.round(y(it.z) - y(it.a)) - 1);
      const when = clockText(it.a, it.z);
      const fg = eventFg(it);
      /* A note goes where a lesson puts its room and teacher, and is given up
         the same way when the box is too short to hold it. */
      const body = boxBody(height, [{ role: "time", text: when },
                                    { role: "name", text: it.label },
                                    { role: "detail", text: it.note || "" }]);
      const mineCls = height < 40 ? " tight" : "";
      h += '<div class="ev mine' + mineCls + '" style="' +
           growStyle(height, mineCls, body.lines, body.packed) +
           place(it, over ? 16 : 0) +
           "background-color:" + esc(it.bg) + ";color:" + esc(fg) + '" title="' +
           esc([it.label, it.note, when].filter(Boolean).join("\n")) + '">' +
           body.html + "</div>";
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
   reader should not have to do to find out whether a lesson is a single.
 *
 * Each end is the reader's to drop. The end kept on its own keeps its dash: a
 * bare "10.20" reads as a start, and a sheet that says only when lessons stop
 * gives a reader nothing to read it against. With both ends gone the duration
 * stands on its own, so it loses brackets it has nothing left to sit beside. */
function clockText(from, to) {
  const when = state.showStart && state.showEnd ? hhmm(from) + "–" + hhmm(to)
             : state.showStart ? hhmm(from)
             : state.showEnd ? "–" + hhmm(to)
             : "";
  if (!state.showDuration) return when;
  const how = durationText(to - from);
  return when ? when + " (" + how + ")" : how;
}

/* The same two ends, taken off a string. The fallback grid is drawn for a
   school that published no minutes, so its only clock is the one the generator
   wrote out — there are no numbers here to count with. Anything not shaped like
   two ends is passed through whole rather than cut in a guessed-at place. */
function slotClock(text) {
  const ends = String(text).split("–");
  if (state.showStart && state.showEnd) return text;
  if (ends.length !== 2) return state.showStart || state.showEnd ? text : "";
  if (state.showStart) return ends[0];
  if (state.showEnd) return "–" + ends[1];
  return "";
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

/* A name of the reader's own, or the school's. The long name and the short one
   are asked for separately, so a reader can leave the long one alone and still
   write a short one that fits a card.
 *
 * A long name of your own still stands in where the short one is wanted and
 * none was given. You already wrote it as short as you wanted it, and the
 * school's abbreviation of a word the school does not use would be a name from
 * neither. */
function subjectLabel(name, short) {
  const own = (state.subjects || {})[name] || {};
  const plain = plainSubject(name);
  if (!short) return own.label || plain;
  return own.short || own.label || (subjectFacts()[name] || {}).short || plain;
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

/* The reader's picks, as a function rather than through `mine()` at the call
   site: `renderTimeline` takes a parameter called `mine`, and inside it the
   name is the parameter and not this. Resolved here, where it is not. */
function myPicks() {
  return mine().studyGroups || {};
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

/* The inside of one cell of the fallback grid. A table cell grows with what is
   in it, so nothing is ever given up here for want of height — the only
   question is whether the parts take a line each or share one.

   The classes are the grid's own. It is a different box from a timeline box and
   has always been drawn from its own rules, but the two answer to the one
   setting: a reader who asked for everything on one line asked it of the page,
   not of one of its two views. */
function gridBody(parts) {
  const keep = parts.filter(p => p.text);
  if (!keep.length) return { html: "", packed: false };
  if (state.boxLayout !== "packed") {
    return { html: keep.map(p => '<div class="' + p.role + '">' + esc(p.text) +
                                 "</div>").join(""), packed: false };
  }
  const inline = { time: "clock", meta: "who3", who: "who3" };
  return { html: '<div class="name">' + keep.map(p => inline[p.role]
             ? '<span class="' + inline[p.role] + '">' + esc(p.text) + "</span>"
             : esc(p.text)).join(" ") + "</div>",
           packed: true };
}

/* A personal event belongs to no slot, so the table gives it a column of its
   own rather than pretending it is a lesson. */
function mineCell(list) {
  if (!list.length) return "<td></td>";
  return "<td>" + list.slice().sort((p, q) => p.a - q.a).map(ev => {
    const body = gridBody([{ role: "name", text: ev.label },
                           { role: "who", text: ev.note || "" },
                           { role: "time", text: clockText(ev.a, ev.z) }]);
    return '<div class="lesson' + (body.packed ? " packed" : "") +
      '" style="background-color:' + esc(ev.bg) + ";color:" + esc(eventFg(ev)) +
      (ev.fg ? ";border:1px solid " + esc(ev.fg) : "") + '">' + body.html +
      "</div>";
  }).join("") + "</td>";
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
  /* The clock the generator wrote, cut to whichever ends the reader asked for.
     A lesson the school gave no time for says so instead, and says it whatever
     the clock is set to. */
  const clock = e.o ? t("noTimeShort") : slotClock(time);
  const body = gridBody([{ role: "name", text: label },
                         { role: "time", text: clock },
                         { role: "meta", text: meta.join(" · ") }]);
  return '<div class="lesson' + (e.c ? " cont" : "") + (e.B ? " brk" : "") +
    (body.packed ? " packed" : "") + '" data-subject="' + esc(e.s) +
    '" style="background-color:' + esc(col.bg) + ";color:" + esc(col.fg) +
    '" title="' + esc(tip) + '">' + body.html + "</div>";
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
/* How tall the printed block may be. On the A4 page that is the sheet less the
   margin at each end. On a sheet cut out of A4 it is the cut box itself, less
   the white that keeps type off the line. The paper edge does not come into
   that one: it is the printer's own margin, outside the sheet being cut. */
function sheetHeight() {
  const cut = cutSheet();
  if (cut) return Math.round((cut[1] - 2 * CUT_PAD) * MM);
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
    fitBoxes(grid);
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

/* ----- the calendar file ---------------------------------------------------
   The reader's own week as one .ics they import. Everything here is text: no
   account, no key, nothing running nightly, and the same file opens in Google
   Calendar, Apple Calendar and Outlook.

   The timetable is a repeating week and carries no dates of its own, so the
   window comes from the school's `cal` — see SCHOOL_YEAR in tt.py. A school
   with none is offered no export.

   An import is not a sync. It can add an event and it can correct one, but
   nothing in the format says "this lesson is gone", so a lesson the school
   drops stays until somebody removes it. That is why every recurrence stops at
   the end of the published term, and why the panel asks for a calendar of its
   own: replacing one is two clicks, weeding one is not.                     */

const ICS_TZ = "Europe/Tallinn";

/* The last Sunday of a month, which is where the EU moves its clocks. */
function lastSunday(year, month) {
  const end = new Date(Date.UTC(year, month, 0));   // day 0 is the month's last
  return end.getUTCDate() - end.getUTCDay();
}

/* Whether a school day is on summer time. Estonia goes forward on the last
   Sunday of March and back on the last Sunday of October, and the file carries
   the same rule as a VTIMEZONE. A lesson never falls on either Sunday, so the
   boundary needs no care about the hour. The autumn term straddles the change
   — the clocks go back the day before the autumn break — so this is not
   theoretical: without it every lesson after October is an hour out. */
function summerTime(day) {
  const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1;
  if (m > 3 && m < 10) return true;
  if (m === 3) return day.getUTCDate() >= lastSunday(y, 3);
  if (m === 10) return day.getUTCDate() < lastSunday(y, 10);
  return false;
}

/* Dates are held at UTC midnight and read with getUTC*, never with the local
   accessors: the reader's browser can be in any zone, and a page opened in
   Perth must write the same file as one opened in Tartu. */
function icsDay(iso) {
  const parts = String(iso).split("-").map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => String(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) +
                   pad2(d.getUTCDate());

/* A local wall-clock stamp, which is what a TZID value carries. */
function stampLocal(day, minutes) {
  return ymd(day) + "T" + pad2(Math.floor(minutes / 60)) + pad2(minutes % 60) + "00";
}

/* The same instant in UTC, which is the only form a recurrence may stop at. */
function stampUtc(day, minutes) {
  const z = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(),
                              day.getUTCDate(), 0,
                              minutes - (summerTime(day) ? 180 : 120)));
  return ymd(z) + "T" + pad2(z.getUTCHours()) + pad2(z.getUTCMinutes()) + "00Z";
}

/* Monday is day 0 here and 1 in getUTCDay, which is the only place the two
   disagree. */
const weekdayOf = (dayIdx) => (dayIdx + 1) % 7;

function firstOnOrAfter(from, dayIdx) {
  const out = new Date(from.getTime());
  out.setUTCDate(out.getUTCDate() + (weekdayOf(dayIdx) - out.getUTCDay() + 7) % 7);
  return out;
}

function lastOnOrBefore(until, dayIdx) {
  const out = new Date(until.getTime());
  out.setUTCDate(out.getUTCDate() - (out.getUTCDay() - weekdayOf(dayIdx) + 7) % 7);
  return out;
}

/* A list of names as one field. The school's rooms and teachers carry stray
   spaces — "406 ", "Öebius  Sandra-Ly" — which the sheet hides and a calendar
   field would keep. */
const icsList = (values, join) =>
  (values || []).map(x => String(x).replace(/\s+/g, " ").trim())
                .filter(Boolean).join(join);

/* A value, with the four characters the format reserves taken out of it. */
function icsText(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;")
    .replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/* A line is at most 75 octets, and what will not fit goes on continuation
   lines that open with a space. The count is of octets and never of
   characters: Estonian subject names are multi-byte, and folded by character a
   line can break inside a letter and arrive as two broken ones. */
function icsFold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder(), out = [];
  let at = 0, room = 75;
  while (at < bytes.length) {
    let take = Math.min(room, bytes.length - at);
    /* Back off to the start of a character. A continuation octet is 10xxxxxx,
       so step back while the next one is still inside a letter. */
    while (take > 1 && at + take < bytes.length &&
           (bytes[at + take] & 0xC0) === 0x80) take--;
    out.push(decoder.decode(bytes.slice(at, at + take)));
    at += take;
    room = 74;                   // a continuation gives one octet to its space
  }
  return out.join("\r\n ");
}

/* Something that survives being an identifier. aSc writes "*117" and a class
   can be "1. S", and neither belongs in a UID as it stands. */
const icsSafe = (value) => String(value).replace(/[^A-Za-z0-9]+/g, "-")
                                        .replace(/^-+|-+$/g, "") || "x";

/* Why importing the same file twice does not draw the week twice.

   The identifier is the school's own id for the placed lesson, so a lesson
   moved to another hour keeps it and a second import corrects the entry rather
   than adding one beside it. The class is in it as well, because one aSc
   lesson serves several classes at once and a parent with two children may put
   both in one calendar. */
function icsUid(school, cls, entry) {
  return icsSafe(entry.i || (entry.s + "-" + entry.d + "-" + entry.p)) +
         "-" + entry.d + "-" + icsTimetable(school) + "-" + icsSafe(cls.n) +
         "@little.tools";
}

/* The timetable a class came out of, which is what names an event here — not
   the entry in the picker. The two differ only once a timetable is offered as
   two schools, and then naming events after the picker would rename every one
   of them on a change the reader never asked for, and draw the week twice on
   their next import. Settings are keyed the same way, for the same reason. */
const icsTimetable = (school) => icsSafe(school.tt || school.n);

/* A number that goes up when the timetable is rebuilt, so a calendar takes the
   second file as a correction of the first rather than as old news. */
function icsSequence() {
  const built = icsDay(DATA.built || "");
  return isNaN(built.getTime()) ? 0
    : Math.max(0, Math.round((built.getTime() - Date.UTC(2026, 0, 1)) / 86400000));
}

/* One repeating lesson: its first sitting, and the weeks it skips.

   A week is skipped for two reasons. The day is not a school day at all, which
   is `off`. Or the school has put something else in that hour — a concert, an
   assembly — and `instead` says so; then only the lessons that hour actually
   covers are dropped, and the rest of the day stands. */
function icsRepeat(dayIdx, from, to, off, instead, a, z) {
  const first = firstOnOrAfter(from, dayIdx), last = lastOnOrBefore(to, dayIdx);
  if (first > last) return null;             // never sits inside the term
  const inTerm = (day) => day.getUTCDay() === weekdayOf(dayIdx) &&
                          day >= first && day <= last;
  const skip = off.map(icsDay).filter(inTerm);
  const seen = new Set(skip.map(day => day.getTime()));
  for (const one of instead || []) {
    const day = icsDay(one.d);
    /* Overlap, not a lesson count: what a class has at that hour is what it
       loses, and two classes rarely have the same thing there. */
    if (inTerm(day) && a < one.z && one.a < z && !seen.has(day.getTime())) {
      skip.push(day);
      seen.add(day.getTime());
    }
  }
  skip.sort((p, q) => p - q);
  return { first: first, last: last, skip: skip };
}

/* Whether a reminder set this far ahead is worth setting at all.

   The pause before the event has to be at least as long as the warning. A
   reminder that goes off in the middle of a lesson is one the reader cannot
   act on and will not see: the phone is in a bag, and by the time they look at
   it the thing has either started or is about to. Fifteen minutes between the
   end of school and a training session is not room for a half-hour warning.

   The pause is measured from whatever ends last before the event — a lesson or
   another of the reader's own events. Something still running when the event
   begins leaves no pause at all. With nothing before it the pause runs back to
   the start of the day, which is more than any warning on offer. */
function alarmIsUseful(day, start, lead, busy) {
  const before = busy.filter(x => x.day === day && x.a < start);
  const ends = before.map(x => Math.min(x.z, start));
  const pause = ends.length ? start - Math.max.apply(null, ends) : start;
  return pause >= lead;
}

/* Everything already on the reader's day, which is what a reminder has to
   dodge: the lessons they kept, and their own events including the one being
   reminded about — two events twenty minutes apart do not want a half-hour
   warning on the second. */
function busyDay(lessons, events) {
  return lessons.map(e => ({ day: e.d, a: e.a, z: e.z }))
    .concat(events.map(ev => ({ day: ev.day, a: ev.a, z: ev.z })));
}

/* One event, as the lines it is made of. Empty fields are left out rather than
   written blank: a calendar shows an empty LOCATION as an empty line. */
function icsEvent(uid, when, a, z, summary, where, note, stampNow, sequence, lead) {
  const lines = [
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + stampNow,
    "SEQUENCE:" + sequence,
    "DTSTART;TZID=" + ICS_TZ + ":" + stampLocal(when.first, a),
    "DTEND;TZID=" + ICS_TZ + ":" + stampLocal(when.first, z),
    "RRULE:FREQ=WEEKLY;UNTIL=" + stampUtc(when.last, a),
  ];
  if (when.skip.length) {
    lines.push("EXDATE;TZID=" + ICS_TZ + ":" +
               when.skip.map(day => stampLocal(day, a)).join(","));
  }
  lines.push("SUMMARY:" + icsText(summary));
  if (where) lines.push("LOCATION:" + icsText(where));
  if (note) lines.push("DESCRIPTION:" + icsText(note));
  /* A reminder rings this long before every sitting of the event. The
     description is the event's own name, because that is what a phone shows
     on the notification and "Reminder" tells nobody anything. */
  if (lead) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT" + lead + "M",
               "DESCRIPTION:" + icsText(summary), "END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines;
}

/* Estonia's clock rule, written the way a calendar reads it. Without this the
   file says "09:00 in Europe/Tallinn" to a program that may not know the zone,
   and the hour after October is anyone's guess. */
const ICS_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:" + ICS_TZ,
  "BEGIN:STANDARD",
  "DTSTART:19701025T040000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0200",
  "TZNAME:EET",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0300",
  "TZNAME:EEST",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

/* Which lessons go in: exactly the ones on screen. The reader's groups, and
   nothing they have turned off. A lesson with no clock cannot be an event, and
   a continuation row is the same lesson a second time. */
function icsLessons(school, cls) {
  const picked = mine().studyGroups;
  return cls.e.filter(e => !e.c && e.a != null && e.z != null &&
                           !hidden(e.s) && visible(e, picked, cls.v));
}

/* The whole file. Times come from the timetable, dates from the school's term,
   and the words from whatever the reader has renamed things to — a calendar
   they cannot read in their own words is no better than the sheet. */
function icsFile(withMine, lead) {
  const school = currentSchool(), cls = currentClass(), term = school.cal;
  if (!term) return "";
  const from = icsDay(term.a), to = icsDay(term.z), off = term.x || [];
  const now = new Date();
  const stampNow = ymd(now) + "T" + pad2(now.getUTCHours()) +
                   pad2(now.getUTCMinutes()) + pad2(now.getUTCSeconds()) + "Z";
  const sequence = icsSequence();
  let body = [];

  for (const e of icsLessons(school, cls)) {
    const when = icsRepeat(e.d, from, to, off, term.e, e.a, e.z);
    if (!when) continue;
    const note = [icsList(teacherNames(e, "full"), " / "), icsList(e.g, "/")]
                 .filter(Boolean).join(" · ");
    body = body.concat(icsEvent(icsUid(school, cls, e), when, e.a, e.z,
                                subjectName(e, false), icsList(e.r, " / "), note,
                                stampNow, sequence, 0));
  }

  if (withMine) {
    const own = readEvents(mine().events).events;
    /* What a reminder has to dodge: the lessons that reached the file, and the
       reader's own events. Worked out once rather than per event. */
    const busy = lead ? busyDay(icsLessons(school, cls), own) : [];
    own.forEach((ev, i) => {
      /* The reader's own events keep their hour whatever the school puts in
         it: a swimming lesson at five is not cancelled by an assembly at
         nine, and nobody but the reader can say otherwise. */
      const when = icsRepeat(ev.day, from, to, off, [], ev.a, ev.z);
      if (!when) return;
      /* By the event's own id, so moving it up the table or deleting the one
         above it does not make a second copy on the next import. A row typed
         in this very moment and not yet saved has none, and falls back to
         where it sits. */
      const uid = "own-" + icsSafe(ev.id || "row" + i) + "-" +
                  icsTimetable(school) + "-" + icsSafe(cls.n) + "@little.tools";
      const ring = (lead && alarmIsUseful(ev.day, ev.a, lead, busy)) ? lead : 0;
      body = body.concat(icsEvent(uid, when, ev.a, ev.z, ev.label, "",
                                  ev.note, stampNow, sequence, ring));
    });
  }

  /* And the hours the school put in place of those lessons. One date, one
     sitting, no recurrence — the only events in the file that happen once. */
  for (const one of term.e || []) {
    const day = icsDay(one.d);
    if (day < from || day > to) continue;
    body = body.concat([
      "BEGIN:VEVENT",
      "UID:instead-" + one.d.replace(/-/g, "") + "-" + one.a + "-" +
        icsTimetable(school) + "-" + icsSafe(cls.n) + "@little.tools",
      "DTSTAMP:" + stampNow,
      "SEQUENCE:" + sequence,
      "DTSTART;TZID=" + ICS_TZ + ":" + stampLocal(day, one.a),
      "DTEND;TZID=" + ICS_TZ + ":" + stampLocal(day, one.z),
      "SUMMARY:" + icsText(one.n),
      "END:VEVENT",
    ]);
  }

  const head = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//little.tools//timetable//ET",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + icsText(icsCalendarName()),
    "X-WR-TIMEZONE:" + ICS_TZ,
  ];
  return head.concat(ICS_VTIMEZONE, body, ["END:VCALENDAR"])
             .map(icsFold).join("\r\n") + "\r\n";
}

/* What the calendar and the file are called. Google offers the file's name when
   it makes a calendar, so this is what the reader ends up seeing in their list
   of calendars — and a household with two children has two of these to tell
   apart. The school, the class, and the child's name where one was given.

   The name is the reader's own and they typed it themselves; where they left it
   blank there is nothing to say and the part is dropped rather than left as a
   gap in the middle of a filename. */
function icsParts() {
  /* Trimmed: the school types "1. S " with the space and every one of these
     ends up in a name somebody reads. */
  return [currentSchool().l, classLabel(currentClass()), mine().studentName]
    .map(part => String(part || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function icsCalendarName() {
  return t("cal.name", icsParts().join(" · "));
}

/* Estonian letters a filename carries everywhere. Folding them is friendlier
   than dropping them: icsSafe alone turns "TERA gümnaasium" into
   "TERA-g-mnaasium", which is nobody's school. */
const FOLDED = { "ä": "a", "ö": "o", "õ": "o", "ü": "u", "š": "s", "ž": "z",
                 "Ä": "A", "Ö": "O", "Õ": "O", "Ü": "U", "Š": "S", "Ž": "Z" };

const plainName = (value) =>
  String(value).replace(/[äöõüšžÄÖÕÜŠŽ]/g, (c) => FOLDED[c]);

function icsFileName() {
  const term = currentSchool().cal || {};
  return [t("cal.file")].concat(icsParts()).concat(term.a ? [term.a] : [])
    .map(part => icsSafe(plainName(part))).filter(part => part !== "x")
    .join("-") + ".ics";
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
    fitBoxes(grid);
    document.getElementById("count").textContent =
      t("lessonCount", drawn.length) + (parsed.events.length ?
        " · " + t("mineCount", parsed.events.length) : "");
    if (!keepLegend) renderLegend(shown);
    layOutTiles();
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
  layOutTiles();
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
  /* Choosing a color is asking for it — for this subject, whatever the row was
     set to before. A row pinned to the timetable's own color kept that pin, so
     the color the reader then picked was stored and never drawn, and the radio
     said "own colour" while the box said otherwise. Where the pin now matches
     what every subject does, tidySubjects drops it again. */
  entry.style = "custom";
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
    /* And the school's abbreviation of it, which is what a card shows and what
       the reader is being asked whether to replace. A break has no abbreviation:
       it is drawn under one name whatever the subject setting says, so those two
       cells are left empty rather than filled with a field that does nothing. */
    const brief = isBreak ? "" : ((subjectFacts()[name] || {}).short || shown);
    /* One heading above the first break, so the two kinds do not read as one
       list. As many columns as the table has. */
    const head = (isBreak && name === breaks[0])
      ? '<tr class="grouphead"><td colspan="8">' + esc(t("breaks.heading")) + "</td></tr>"
      : "";
    return head + '<tr data-subject="' + esc(name) + '"' +
      (hidden(name) ? ' class="hide"' : "") + ">" +
      '<td class="show"><input type="checkbox" class="subjshow"' +
        (hidden(name) ? "" : " checked") + ' aria-label="' +
        esc(t("colShow")) + '"></td>' +
      '<td class="rowlabel">' + esc(shown) + "</td>" +
      '<td><input type="text" class="subjlabel" value="' + esc(own.label || "") +
        '" placeholder="' + esc(shown) + '"></td>' +
      '<td class="rowlabel">' + esc(brief) + "</td>" +
      '<td>' + (isBreak ? ""
        : '<input type="text" class="subjshort" value="' + esc(own.short || "") +
          '" placeholder="' + esc(brief) + '">') + "</td>" +
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
  setSubjectField(name, "label", value);
}

/* The short name of the reader's own, kept apart from the long one so that
   writing either leaves the other alone. */
function setSubjectShort(name, value) {
  setSubjectField(name, "short", value);
}

function setSubjectField(name, field, value) {
  const entry = state.subjects[name] || (state.subjects[name] = {});
  if (value.trim()) entry[field] = value; else delete entry[field];
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
  } else if (e.target.classList.contains("subjshort")) {
    setSubjectShort(name, e.target.value);
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

/* What to call one group in the picker. The code is the school's own — "HK1",
   "Grupp 1", "Mat 3" — and a reader knows who teaches them rather than which
   code that is. So the option says the teacher as well, and the value stays the
   code, which is what the pick is filed under.

   Where the division carries more than one subject and the group more than one
   teacher, each name says what that teacher takes. Otherwise the subject is
   already in the heading above the picker. See name_the_groups in tt.py, which
   decides where a list of names stops being a hint. */
function groupLabel(division, index) {
  const name = division.groups[index];
  const who = (division.w || [])[index] || [];
  if (!who.length) return name;
  return name + " (" + who.map(
    ([person, subject]) => (subject ? subject + ": " : "") + teacherName(person)
  ).join(", ") + ")";
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
    d.groups.map((g, i) => '<option value="' + esc(g) + '"' +
      (picked[choiceKey(d)] === g ? " selected" : "") + ">" +
      esc(groupLabel(d, i)) + "</option>").join("") +
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

/* Moving to a school the reader picked, which decides its own class.

   The class they were on belongs to the school they left and says nothing
   about this one. It has to go before the new school is asked anything: left
   in place it sends currentSchool() hunting for whichever half of a split
   timetable still holds it — and finding it, which walks the reader straight
   back to where they came from. Changing from ProTERA to the gümnaasium did
   exactly that, and the class list never moved. */
function goToSchool(key) {
  state.school = key;
  state.class = "";
  state.class = currentSchool().c[0].n;   // class lists differ between schools
}

document.getElementById("school").addEventListener("change", (ev) => {
  goToSchool(ev.target.value);
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
 "showStart", "showEnd", "showDuration", "showGaps", "showAxis",
 "showQr"].forEach(key => bindToggle(key, key));
/* Not through bindToggle: nothing on screen changes, so a redraw would be a
   redraw for nothing. */
document.getElementById("calMine").addEventListener("change", (ev) => {
  state.calMine = ev.target.checked;
  save();
  showCalendarPanel();
});
document.getElementById("calAlarm").addEventListener("change", (ev) => {
  state.calAlarm = ev.target.checked;
  save();
  showCalendarPanel();
});
document.getElementById("calAlarmMinutes").addEventListener("change", (ev) => {
  const minutes = Number(ev.target.value);
  if (LEAD_MINUTES.includes(minutes)) state.calAlarmMinutes = minutes;
  save();
});

/* The file is built when it is asked for, never before: it is the only thing
   on the page that costs anything to make and is wanted once a term. */
document.getElementById("calGet").addEventListener("click", () => {
  const text = icsFile(state.calMine !== false,
                       state.calAlarm ? state.calAlarmMinutes : 0);
  if (!text) return;
  /* A blob rather than a data: URL — a term of lessons runs past what some
     browsers will take in one. */
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = icsFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  /* Freed on the next turn of the loop, not this one: revoking it while the
     click is still being handled cancels the download in some browsers. */
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
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
  /* A wider edge leaves less paper to cut a sheet out of. One that no longer
     fits is brought back in, rather than printed off the page. */
  const limit = sheetLimit();
  state.printWidth = sheetMm(state.printWidth, limit[0], state.printWidth);
  state.printHeight = sheetMm(state.printHeight, limit[1], state.printHeight);
  save();
  render();
});
document.getElementById("printSheet").addEventListener("change", (ev) => {
  if (!SHEETS.includes(ev.target.value)) return;
  state.printSheet = ev.target.value;
  save();
  render();
});
/* Their own size is typed, because the sizes worth having are not a list
   anybody could write down: a tablet, a noticeboard, a folder pocket. A number
   larger than the paper it is cut from, or too small to hold a week, is put
   back to what it was and the box is redrawn saying so. Keeping it silently
   would leave the reader looking at a sheet that cannot be printed. */
["printWidth", "printHeight"].forEach((key, axis) => {
  document.getElementById(key).addEventListener("change", (ev) => {
    state[key] = sheetMm(ev.target.value, sheetLimit()[axis], state[key]);
    save();
    render();
  });
});
bindChoice("teacherNameStyle", "teacherNameStyle");
bindChoice("teacherNameOrder", "teacherNameOrder");
bindChoice("subjectNameStyle", "subjectNameStyle");
bindChoice("subjectColorStyle", "subjectColorStyle");
bindChoice("boxLayout", "boxLayout");

/* The controls follow the state, and the two that only make sense alongside
   something else — how to write a name, which colors to pick — dim or vanish
   when that something is switched off. */
/* The Calendar panel, and the dates it says it covers.

   A school that has published none gets no panel at all rather than a button
   that cannot do anything: an export with guessed dates would put a child in
   a lesson on a day nobody has said there is one. */
function showCalendarPanel() {
  const panel = document.getElementById("calendarPanel");
  const term = currentSchool().cal;
  panel.hidden = !term;
  if (!term) return;
  document.getElementById("calCovers").textContent =
    t("cal.covers", plainDate(term.a), plainDate(term.z));
  /* What this school does that the others do not. A reader who knows the week
     is missing on the twenty-first is a reader who trusts the rest of it — and
     one who does not is left wondering whether the file is broken. */
  const off = (term.o || []).map(x => x.n + " " + plainRange(x.a, x.z));
  const instead = (term.e || [])
    .map(x => x.n + " " + plainDate(x.d) + " " + hhmm(x.a) + "–" + hhmm(x.z));
  const line = (id, text) => {
    const node = document.getElementById(id);
    node.hidden = !text;
    if (text) node.textContent = text;
  };
  line("calOff", off.length ? t("cal.off", off.join(", ")) : "");
  line("calInstead", instead.length ? t("cal.instead", instead.join(", ")) : "");
  /* A reminder belongs to the reader's own events, so it goes with them: with
     those left out there is nothing for it to ring about. Dimmed rather than
     hidden, the way every other dependent control here behaves. */
  const box = document.getElementById("calAlarm");
  box.disabled = !state.calMine;
  document.getElementById("calAlarmRow")
          .classList.toggle("off", !state.calMine);
  document.getElementById("calLead")
          .classList.toggle("off", !state.calMine || !state.calAlarm);
  /* Built here rather than written into the page, so the list and the values
     the settings accept cannot drift — the same bargain the margins make. */
  fillOptions(document.getElementById("calAlarmMinutes"),
              LEAD_MINUTES.map(m => [String(m), t("cal.lead.min", m)]),
              String(state.calAlarmMinutes));
}

/* A stretch of days, as short as it can be said without becoming ambiguous.
   One day is one date. Two dates in the same year say the year once, at the
   end, the way a Estonian reader writes a range. Across a new year — the
   Christmas break runs into January — both say it. */
function plainRange(from, to) {
  if (from === to) return plainDate(from);
  const sameYear = String(from).slice(0, 4) === String(to).slice(0, 4);
  const first = sameYear ? plainDate(from).replace(/\.\d{4}$/, "") : plainDate(from);
  return first + "–" + plainDate(to);
}

/* An ISO date the way it is written in Estonia. Only the calendar panel says a
   date at all — everywhere else the page speaks in weekdays and clock times. */
function plainDate(iso) {
  const p = String(iso).split("-");
  return p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : String(iso);
}

function syncDisplayControls() {
  for (const key of ["showStudentName", "showSchoolName", "showClassName",
                     "showTeacher", "showRoom", "showGroup", "showSubject",
                     "showStart", "showEnd", "showDuration", "showGaps",
                     "showAxis", "showQr", "calMine", "calAlarm"]) {
    document.getElementById(key).checked = !!state[key];
  }
  showCalendarPanel();
  for (const name of ["teacherNameStyle", "teacherNameOrder",
                      "subjectNameStyle", "subjectColorStyle", "boxLayout"]) {
    const key = name;
    document.querySelectorAll('input[name="' + name + '"]').forEach(radio => {
      radio.checked = radio.value === state[key];
    });
  }
  document.getElementById("teacherChoice").classList.toggle("off", !state.showTeacher);
  document.getElementById("teacherOrder").classList.toggle("off", !state.showTeacher);
  document.getElementById("subjectChoice").classList.toggle("off", !state.showSubject);
  renderMargins();
  renderSheets();
  applyPageMargin();
  applyCutSheet();
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

/* One option per sheet, built here rather than written in the page, so the list
   and the values the settings accept cannot drift. The two millimetre boxes are
   dimmed rather than hidden while another sheet is chosen: a reader can see what
   their own size would be before asking for it. */
function renderSheets() {
  fillOptions(document.getElementById("printSheet"),
              SHEETS.map(key => [key, t("sheet." + key)]), state.printSheet);
  const limit = sheetLimit();
  ["printWidth", "printHeight"].forEach((key, axis) => {
    const box = document.getElementById(key);
    box.min = String(SHEET_MIN);
    box.max = String(limit[axis]);
    if (box.value !== String(state[key])) box.value = String(state[key]);
  });
  document.getElementById("sheetOwn")
          .classList.toggle("off", state.printSheet !== "custom");
  /* Said where the choice is made, because it is the whole answer to "my
     printer only holds A4" — and, where several fit, how many come out. */
  const note = document.getElementById("cutNote");
  const many = cutSheet() ? tiling().count : 0;
  note.hidden = !cutSheet();
  note.textContent = !cutSheet() ? ""
    : (many > 1 ? t("sheet.cutMany", many) : t("sheet.cut"));
}

/* An @page rule is not reachable through a class or a custom property, so the
   whole rule is written out. The sheet the fitter measures against has to
   agree with it, which is why both read the one setting. */
function applyPageMargin() {
  const rule = document.getElementById("pagerule");
  /* Still a named A4, only turned. So the printer is handed paper it holds
     whatever the sheet says, and nothing is ever scaled. */
  const want = "@page { size: A4 " + (tiling().portrait ? "portrait" : "landscape") +
               "; margin: " + state.printMargin + "mm; }";
  if (rule.textContent !== want) rule.textContent = want;
}

/* The sheet the printout is cut to. The page rule above stays on A4 whatever
   this says, because the printer is still fed an A4 page: the smaller sheet is
   drawn on it, with a line to cut along. So nothing here can hand the printer a
   paper size it does not hold.

   The two figures go out as custom properties, which the print stylesheet reads
   for both the width on screen and the width on paper. One number, so what the
   fitter measured is what comes out. */
function applyCutSheet() {
  const cut = cutSheet();
  const root = document.documentElement;
  root.style.setProperty("--cutw", cut ? cut[0] + "mm" : "");
  root.style.setProperty("--cuth", cut ? cut[1] + "mm" : "");
  root.style.setProperty("--cutpad", CUT_PAD + "mm");
  /* One copy is the page itself; several are a block of them laid on it. The
     two are different shapes, so they are different classes rather than one
     with a count. */
  const many = cut && tiling().count > 1;
  root.style.setProperty("--cols", many ? String(tiling().cols) : "");
  /* How much smaller the sheet is than a whole page, for the few things that
     are sized in points rather than fitted: the heading, and the space under
     it. A4 landscape less the narrowest paper edge is the full-size case. */
  root.style.setProperty("--sheetscale",
                         cut ? String(Math.min(1, cut[0] / 287)) : "");
  /* Too small for every label the page usually draws. */
  document.body.classList.toggle("tight", !!cut && cut[0] < 170);
  document.body.classList.toggle("cutsheet", !!cut && !many);
  document.body.classList.toggle("tiled", !!many);
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
/* Drawn 46 pixels tall, the same as the box in the stylesheet, so the sample
   gives up what a 45-minute lesson gives up and packs where a packed box packs.
   A break puts its name first here as it does in the day. */
function sampleBox(bg, fg, when, label, meta, kind) {
  const style = "background-color:" + esc(bg) + ";color:" + esc(fg) +
                (kind === "brk" ? ";" + hatch(bg) : "");
  const parts = kind === "brk"
    ? [{ role: "name", text: label }, { role: "time", text: when }]
    : [{ role: "time", text: when }, { role: "name", text: label },
       { role: "detail", text: meta }];
  const body = kind === "gap"
    ? '<div class="what">' +
      esc(label + (state.showDuration ? " · " + durationText(45) : "")) + "</div>"
    : boxBody(46, parts).html;
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
   without pretending to be the row's own. Written the way the day writes it: a
   sample showing a clock the day no longer draws is a sample of nothing. */
function sampleWhen(from) {
  const a = clock(from);
  return a === null ? "" : clockText(a, a + 45);
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
  myOwn().events.push({ id: newEventId(), day: "Mon", startTime: "16:00",
                        endTime: "17:00", note: "", backgroundColor: "#F6F2C1",
                        textColor: "", label: "" });
  save(); renderEventsSoon(); paint();
});

/* Printing is a moment, not a setting: lay the page out for paper, print it,
   put it back. Nothing about it is worth remembering between visits. */
/* Cmd+P has to give the same sheet as the button. It used to give a different
   one: the print stylesheet applied, but nothing had switched the page into
   print mode, so there was no QR code, no scaling to the sheet, and the screen
   footer. Both paths go through here now. */
/* The finished sheet, copied across the page.

   It runs after the fitter, on a box that is already the right size and scale,
   so nothing here is measured or drawn again — the copies are the original.
   Ids come off them: two nodes answering to `grid` would send every later
   getElementById to whichever came first.

   The originals stay in the document and are hidden, rather than moved into
   the first tile. Moving them would take the click handler's own element out
   from under it and put the page back together differently on every print. */
function layOutTiles() {
  const host = document.getElementById("tiles");
  if (!host) return;
  const many = printing && cutSheet() && tiling().count > 1;
  host.hidden = !many;
  /* Only now is the original safe to hide: the fitter has measured it, and the
     copies are about to stand in for it. */
  document.body.classList.toggle("copied", !!many);
  if (!many) {
    if (host.firstChild) host.textContent = "";
    return;
  }
  /* The week itself, not the box it scrolls in: three things on this page have
     the scroll class and the settings panel owns the first of them. Copying
     that put the subject table on every card. */
  const parts = [document.getElementById("grid"), document.getElementById("foot")];
  host.textContent = "";
  for (let n = 0; n < tiling().count; n++) {
    const tile = document.createElement("div");
    tile.className = "tile";
    for (const part of parts) {
      const copy = part.cloneNode(true);
      copy.removeAttribute("id");
      copy.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
      tile.appendChild(copy);
    }
    host.appendChild(tile);
  }
  /* Measured again now that they exist. A copy is a fraction narrower than the
     original it came from — a fifth of a pixel, on a card — and a line that
     fitted the original by less than that is cut here. This is the only place
     the printed width can be measured, because this is the first moment the
     printed thing is in the page. */
  wrapPacked(host);
}

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
