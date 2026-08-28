/* The page's own logic, run outside a browser. See harness.mjs for what a
   browser provides and what is stubbed in its place. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load } from "./harness.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const run = load();
const json = (expression) => JSON.parse(run(`JSON.stringify(${expression})`));

test("a saved event is read into a day, a span, a color and two lines", () => {
  const parsed = json(`readEvents([{day: "Mon", startTime: "17:15", endTime: "18:15",
                                    backgroundColor: "#F6F2C1", textColor: "",
                                    label: "Dance training", note: "Studio 2 · Maret"}])`);
  assert.equal(parsed.errors.length, 0);
  /* The id is the event's own and is not in what was handed in, so it is
     checked for shape and then set aside. */
  const read = parsed.events[0];
  assert.equal(read.id, "", "an event given no id is read without one");
  delete read.id;
  assert.deepEqual(read, { day: 0, a: 1035, z: 1095, fg: null,
                           bg: "#F6F2C1", label: "Dance training",
                           note: "Studio 2 · Maret", mine: true });
  // One that carries an id keeps it, because the calendar names it by that.
  assert.equal(json(`readEvents([{id: "abc123", day: "Mon", startTime: "17:15",
                                  endTime: "18:15", label: "x"}]).events[0].id`),
               "abc123");
  // The second line is the reader's to leave out.
  const bare = json(`readEvents([{day: "Mon", startTime: "17:15", endTime: "18:15",
                                  backgroundColor: "#F6F2C1", label: "Dance"}])`);
  assert.equal(bare.events[0].note, "");
});

test("every weekday key lands on the right day", () => {
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((key, i) => {
    const parsed = json(`readEvents([{day: ${JSON.stringify(key)},
                                      startTime: "9:00", endTime: "10:00", backgroundColor: "#ff0000"}])`);
    assert.equal(parsed.errors.length, 0, key);
    assert.equal(parsed.events[0].day, i, key);
  });
});

test("an event that cannot be drawn is reported, not dropped in silence", () => {
  const bad = [{ day: "Xxx", startTime: "9:00", endTime: "10:00" },
               { day: "Mon", startTime: "25:00", endTime: "26:00" },
               { day: "Mon", startTime: "18:00", endTime: "17:00" },
               { day: "Mon", startTime: "9:00", endTime: "9:00" },
               { day: "Mon", startTime: "9:00", endTime: "10:00", backgroundColor: "notacolor" }];
  for (const ev of bad) {
    const parsed = json(`readEvents([${JSON.stringify(ev)}])`);
    assert.equal(parsed.events.length, 0, JSON.stringify(ev));
    assert.equal(parsed.errors.length, 1, JSON.stringify(ev));
  }
});

test("a saved event of the wrong shape is dropped on the way in", () => {
  /* readEvents complains about what the table could have produced; oneEvent
     throws out what could only come from a hand-edited file or a link. */
  for (const raw of [null, "Mon 9:00", 42, [], { day: "Mon" },
                     { day: "Mon", startTime: "9:00" }]) {
    assert.equal(json(`oneEvent(${JSON.stringify(raw)})`), null, JSON.stringify(raw));
  }
  assert.deepEqual(json(`oneEvent({day: "Fri", startTime: "9:0", endTime: "10:00"})`), null);
  const kept = json(`oneEvent({day: "Fri", startTime: "9:00", endTime: "10:00",
                               backgroundColor: "nonsense", textColor: "#123",
                               label: 7})`);
  /* An event with no id of its own is given one here, once, and keeps it. */
  assert.match(kept.id, /^[a-z0-9]{8}$/, "no id was given: " + kept.id);
  delete kept.id;
  assert.deepEqual(kept,
    { day: "Fri", startTime: "09:00", endTime: "10:00", backgroundColor: "#DDDDDD",
      textColor: "#123", label: "", note: "" });
});

test("an event keeps the name it was given, and refuses a silly one", () => {
  /* The whole point of the id: it survives the reader editing the event, and
     every edit around it. A hand-edited file or an old link can carry anything
     in that field, and "undefined" is a string like any other — which is how a
     first attempt at this gave every event the same name. */
  const id = (raw) => json(`oneEvent(Object.assign(
      {day: "Fri", startTime: "9:00", endTime: "10:00"}, ${raw})).id`);
  assert.equal(id(`{id: "kept0001"}`), "kept0001");
  for (const silly of [`{}`, `{id: undefined}`, `{id: null}`, `{id: 7}`,
                       `{id: ""}`, `{id: "has spaces"}`, `{id: "UPPER"}`,
                       `{id: "x".repeat(40)}`, `{id: {}}`]) {
    assert.match(id(silly), /^[a-z0-9]{8}$/, silly);
  }
  // Two events made at once do not share a name.
  assert.notEqual(json(`newEventId()`), json(`newEventId()`));
});

test("only something that is plainly a color can be stored as one", () => {
  assert.deepEqual(json(`onlyColors({a: "#fff", b: "#AABBCC", c: "#12345678"})`),
                   { a: "#fff", b: "#AABBCC", c: "#12345678" });
  // A share link is not a way to write markup into the page.
  assert.deepEqual(json(`onlyColors({a: 'x"><img src=x onerror=alert(1)>', b: "red", c: 5})`), {});
  // Nor by hiding a real color inside something longer: the whole value has
  // to be the color, not merely contain one.
  assert.deepEqual(json(`onlyColors({a: '#fff"><img src=x onerror=alert(1)>',
                                      b: 'url(#abc)', c: '#1234567', d: '#12'})`), {});
  // Stray spaces around one are just typing, and come off.
  assert.deepEqual(json(`onlyColors({a: "  #fff  "})`), { a: "#fff" });
});

test("the counter is told the school's own name, never the reader's", () => {
  // What a parent types is exactly what must not go out.
  run(`state.classes = {};
       myOwn().studentName = "Mari Maasikas";
       myOwn().schoolName = "Mari's school";
       myOwn().className = "Mari's class";
       state.showStudentName = true;
       window.goatcounter = { count: (label) => { globalThis.sent = label; } };
       globalThis.sent = null;
       countVisit();`);
  const sent = json(`sent`);
  const heading = json(`displayTitle(currentSchool(), currentClass())`);

  assert.ok(sent, "the visit was counted");
  assert.match(heading, /Mari Maasikas/);          // on screen, as asked
  assert.doesNotMatch(JSON.stringify(sent), /Mari/); // and nowhere in the beacon
  assert.equal(sent.referrer, "");

  // Enough to tell one class from another, since the counter keeps one title
  // per path and would otherwise show them all as one row.
  assert.match(sent.path, /^\/t\/[^/]+\/[^/]+$/);
  assert.ok(sent.title.includes(json(`currentSchool().l`)));

  // Same row whichever language the reader is in, or the label would flip.
  const inEnglish = run(`state.lang = "en"; globalThis.sent = null;
                         countVisit(); JSON.stringify(sent)`);
  const inEstonian = run(`state.lang = "et"; globalThis.sent = null;
                          countVisit(); JSON.stringify(sent)`);
  assert.equal(inEnglish, inEstonian);
  // English is the fixed one, even when the interface is not.
  assert.match(JSON.parse(inEstonian).title, /class /);
  assert.doesNotMatch(JSON.parse(inEstonian).title, /klass/);
});

test("one address however it was reached", () => {
  run(`window.goatcounter = { count: (o) => { globalThis.sent = o; } };`);
  const seen = new Set();
  for (const path of ["/t/", "/t", "/t/index.html", "/t/index.html/"]) {
    run(`location.pathname = ${JSON.stringify(path)}; countVisit();`);
    seen.add(json(`sent.path`));
  }
  run(`location.pathname = "/t/";`);
  assert.equal(seen.size, 1, [...seen].join(" vs "));
});

test("a build with no counter in it counts nothing", () => {
  run(`window.goatcounter = { count: () => { globalThis.sent = "sent"; } };
       globalThis.sent = null;
       const real = document.getElementById;
       document.getElementById = (id) => (id === "gc" ? null : real(id));
       try { countVisit(); } finally { document.getElementById = real; }`);
  assert.equal(json(`sent`), null);
});

test("nothing reaches the page as markup, in either view", () => {
  /* esc() sits at more than fifty call sites and was only ever tested on its
     own, so it could be deleted from any one of them unnoticed. This drives
     every channel that carries text — the school's own data, what the reader
     typed, and what a link can bring — through both renderers and looks at the
     result. state.subjects is written to directly on purpose: normalise and
     onlyColors keep it clean in real use, and esc() is what stands behind
     them if they ever stop. */
  const bad = 'x"><img src=x onerror=alert(1)>';
  const q = JSON.stringify(bad);
  for (const [school, klass] of [["68", "8"], ["99", "3.a"]]) {
    run(`state.school = ${JSON.stringify(school)}; state.class = ${JSON.stringify(klass)};
         state.subjectColorStyle = "custom";
         state.subjects = {Matemaatika: ${q}, Kunst: ${q}};
         state.classes = {};
         myOwn().studentName = ${q};
         myOwn().schoolName = ${q};
         myOwn().className = ${q};
         /* One long, one short: a short box draws its time and label together
            through a different line than a tall one. */
         myOwn().events = [
           {day: "Mon", startTime: "09:00", endTime: "10:00", backgroundColor: "#ff0000", textColor: "", label: ${q}},
           {day: "Mon", startTime: "11:00", endTime: "11:10", backgroundColor: "#0000ff", textColor: "", label: ${q}}];
         state.showStudentName = true; state.showSchool = true; state.showClass = true;
         printing = false; render(); renderLegend(currentClass().e);`);
    for (const id of ["grid", "foot", "subtitle", "legend"]) {
      const html = json(`(document.getElementById(${JSON.stringify(id)}).innerHTML || "")`);
      assert.doesNotMatch(html, /<img/, `${id} in school ${school} took markup`);
    }
    /* document.title is not markup — a browser shows it as text — so it is
       deliberately not escaped and not checked here. */
  }
  run(`state.school = "68"; state.class = "8"; state.subjects = {};
       state.classes = {}; state.showStudentName = false;
       state.subjectColorStyle = "custom"; render();`);
});

test("the school's own words are text too, everywhere they are shown", () => {
 for (const which of [0, 1]) {
  /* Day names, period labels, division and group names, the school's name and
     the line it prints under its timetable — all typed into aSc by someone at
     the school, all rendered into places the lesson boxes never reach. Made
     hostile for one pass and put back, so the ordinary fixture stays readable. */
  const bad = '<img src=x id=school>';
  const kept = json(`(() => {
    const s = DATA.schools[${which}], c = s.c[0];
    globalThis.saved = JSON.stringify([s.l, s.t, s.v, s.d, s.p, c.v, c.h, c.n]);
    /* The class name is school-typed too — one real class is called "Silva "
       — and it is put into option values and the picker key. */
    c.n = ${JSON.stringify(bad)} + "-cls";
    s.l = s.t = s.v = ${JSON.stringify(bad)};
    s.d = [{ i: 0, n: ${JSON.stringify(bad)} }];
    s.p = s.p.map(p => Object.assign({}, p, { l: ${JSON.stringify(bad)} }));
    s.ts = true; s.p[0].s = ${JSON.stringify(bad)}; s.p[0].e = ${JSON.stringify(bad)};
    c.v = [{ id: ${JSON.stringify(bad)}, groups: [${JSON.stringify(bad)}],
             l: ${JSON.stringify(bad)}, sj: [${JSON.stringify(bad)}] }];
    c.h["0"].b = [{ a: 1, n: ${JSON.stringify(bad)}, s: "10.20", e: "10.30",
                    m: 620, x: 630 }];
    state.school = s.n; state.class = c.n; printing = false;
    renderSchools(); renderClasses(); renderDivisions(); render();
    return ["grid", "divisions", "school", "klass", "subtitle", "foot"]
      .map(id => document.getElementById(id).innerHTML || "").join("|||");
  })()`);
  assert.doesNotMatch(kept, /<img/, "the school's own text reached the page as markup");
  assert.match(kept, /&lt;img/, "and it is there, escaped");
  run(`(() => {
    const s = DATA.schools[${which}], saved = JSON.parse(globalThis.saved);
    [s.l, s.t, s.v, s.d, s.p, s.c[0].v, s.c[0].h, s.c[0].n] = saved;
    state.class = s.c[0].n;
    s.ts = false;
    renderSchools(); renderClasses(); renderDivisions(); render();
  })()`);
 }
 run(`state.school = "68"; state.class = "8"; renderClasses(); renderDivisions(); render();`);
});

test("the fallback grid escapes everything it draws", () => {
  /* Two of the four real schools have no times and get this view, and none of
     it had ever been executed by a test — every esc() in it could be deleted
     unnoticed. Drive it with markup in each thing it renders. */
  const bad = 'x"><img src=x onerror=alert(1)>';
  run(`state.school = "99"; state.class = "3.a";
       state.subjectColorStyle = "custom"; state.subjects = {Matemaatika: ${JSON.stringify(bad)}};
       state.classes = {};
       myOwn().events = [{day: "Mon", startTime: "09:00", endTime: "10:00",
                          backgroundColor: "#ff0000", textColor: "", label: ${JSON.stringify(bad)}}];
       myOwn().studentName = ${JSON.stringify(bad)};
       state.showStudentName = true; printing = false; render();`);
  const html = json(`document.getElementById("grid").innerHTML`);
  assert.ok(html.includes("<table"), "the grid view really did render");
  assert.doesNotMatch(html, /<img/, "markup reached the page unescaped");
  assert.match(html, /&lt;img|&amp;lt;img/, "the payload is there, escaped");
  run(`state.school = "68"; state.class = "8"; state.subjects = {};
       state.classes = {}; state.showStudentName = false;
       state.subjectColorStyle = "custom"; render();`);
});

test("a link is read back exactly as it was written", () => {
  /* shareUrl and readUrl were never called by any test: renaming the fragment
     key in one of them broke every shared link with the suite still green. */
  run(`state.lang = "et"; state.showRoom = false;
       state.classes = {}; myOwn().studentName = "Mari";`);
  const link = json(`shareUrl()`);
  assert.match(link, /#s=/);
  const readBack = json(`(() => {
      // With the "#", as a browser has it: readUrl slices it off.
      location.hash = "#" + (shareUrl().split("#")[1] || "");
      return readUrl();
    })()`);
  assert.equal(readBack.lang, "et");
  assert.equal(readBack.showRoom, false);
  assert.deepEqual(readBack.classes, json(`({[classKey()]: {studentName: "Mari"}})`));
  run(`state.lang = "en"; state.showRoom = true; state.classes = {}; location.hash = "";`);
});

test("a link carries this class and no other", () => {
  run(`state.classes = {};
       for (const [key, name] of [["68/8", "Mari"], ["68/7", "Jaan"], ["99/3.a", "Liis"]]) {
         state.classes[key] = Object.assign(classDefaults(), {studentName: name});
       }
       state.school = "68"; state.class = "8";`);
  const carried = json(`JSON.parse(unb64url(shareUrl().split("#s=")[1])).classes`);
  assert.deepEqual(carried, { "68/8": { studentName: "Mari" } });
  // Emptied fields leave nothing behind at all.
  run(`state.classes = {}; myOwn().studentName = "   "; tidy();`);
  assert.equal(json(`("classes" in changedFromDefaults())`), false);
  run(`state.classes = {};`);
});

test("a hostile color in a link is dropped before it is stored", () => {
  /* Through the real ingestion path, not by calling the filter directly: the
     filter was tested and the call to it was not, so removing the call left
     markup sitting in localStorage with the suite green. */
  const hostile = JSON.stringify({ subjects: {
    Matemaatika: { style: "custom", backgroundColor: 'x"><img src=x>' },
    Bioloogia: { style: 'x"><img src=x>' },
    Kunst: { style: "school", backgroundColor: "#abc" } } });
  const merged = json(`applyShared(JSON.parse(${JSON.stringify(hostile)}), defaults())`);
  assert.deepEqual(merged.subjects, { Matemaatika: { style: "custom" },
                                      Kunst: { style: "school", backgroundColor: "#abc" } });
});

test("a link adds to the other classes rather than replacing them", () => {
  const link = JSON.stringify({ classes: { "68/8": { studentName: "Mari" } } });
  const merged = json(`applyShared(JSON.parse(${JSON.stringify(link)}),
      Object.assign(defaults(),
        {classes: {"68/7": Object.assign(classDefaults(), {studentName: "Jaan"})}}))`);
  assert.equal(merged.classes["68/7"].studentName, "Jaan");
  assert.equal(merged.classes["68/8"].studentName, "Mari");
});

test("a big link is compressed, a small one is left alone", () => {
  /* Not compression for its own sake: past about 2 kB there is no QR code that
     will hold the link, and a family that recolors a lot of subjects gets
     there. Small links gain nothing and are left plain, because gzip's header
     would make them longer. */
  const small = json(`packSettings(JSON.stringify({lang: "et"}))`);
  assert.match(small, /^s=/);
  assert.equal(json(`unpackSettings(${JSON.stringify(small)})`), '{"lang":"et"}');

  const heavy = JSON.stringify({ subjects: Object.fromEntries(
    Array.from({ length: 70 }, (_, i) =>
      ["Subject number " + i, { style: "custom", backgroundColor: "#0000" + (i % 90 + 10) }])) });
  const packed = json(`packSettings(${JSON.stringify(heavy)})`);
  assert.match(packed, /^z=/);
  assert.ok(packed.length < heavy.length / 3, `only got down to ${packed.length}`);
  assert.equal(json(`unpackSettings(${JSON.stringify(packed)})`), heavy);
});

test("a link written by the page is read back by the page", () => {
  // Both forms, through the real functions rather than the codec on its own.
  for (const name of ["Eva", "Eva".repeat(400)]) {
    run(`state.classes = {}; myOwn().studentName = ${JSON.stringify(name)};`);
    const link = json(`shareUrl()`);
    run(`location.hash = "#" + link.split("#")[1];`.replace("link", JSON.stringify(link)));
    assert.equal(json(`readUrl().classes[classKey()].studentName`), name,
                 `${name.length}-character name did not survive`);
  }
  run(`state.classes = {}; location.hash = "";`);
});

test("a fragment that is not ours is ignored, not thrown", () => {
  for (const hash of ["", "#", "#anchor", "#s=!!!!", "#z=notgzip", "#z=", "#s="]) {
    run(`location.hash = ${JSON.stringify(hash)};`);
    assert.equal(json(`readUrl()`), null, hash);
  }
  run(`location.hash = "";`);
});

test("the address the link uses survives a round trip through base64", () => {
  // The "url" in b64url: + / = have no business in a fragment.
  const encoded = json(`b64url("~~~\u00fc\u00e4>>>???")`);
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.equal(json(`unb64url(${JSON.stringify(encoded)})`), "~~~üä>>>???");
});

test("a short color is still readable text on top of it", () => {
  // #000 is black; before it was understood, the label came out black on black.
  assert.equal(json(`readable("#000")`), "#FFFFFF");
  assert.equal(json(`readable("#fff")`), json(`readable("#ffffff")`));
  assert.equal(json(`readable("#000f")`), json(`readable("#000000")`));
  assert.equal(json(`readable("#000000ff")`), json(`readable("#000000")`));
  assert.equal(json(`readable("nonsense")`), "#14171A");
});

test("looking at a class does not add an empty note about it to the link", () => {
  run(`state.classes = {}; mine(); mine().studentName; mine().events;`);
  assert.deepEqual(json(`state.classes`), {});
  // Choosing something does record it, under this class and no other.
  run(`myOwn().studyGroups["Alfa/Beeta"] = "Alfa";`);
  assert.deepEqual(json(`Object.keys(state.classes)`), [json(`classKey()`)]);
  run(`state.classes = {};`);
});

test("settings of the wrong shape fall back to their defaults", () => {
  const got = json(`normalise({lang: "zz", showRoom: "yes", classes: [1, 2],
                               teacherNameStyle: "LOUD", subjectNameStyle: "short",
                               subjectColorStyle: "rainbow", showGroup: false})`);
  assert.equal(got.lang, "en");
  assert.equal(got.showRoom, true, "a string is not a checkbox");
  assert.deepEqual(got.classes, {}, "an array is not a map of classes");
  assert.equal(got.teacherNameStyle, "full", "a nonsense style falls back");
  assert.equal(got.subjectColorStyle, "custom", "an unknown style is not a style");
  assert.equal(got.subjectNameStyle, "short", "a valid value is kept");
  assert.equal(got.showGroup, false, "and so is a valid false");
});

test("a link survives the round trip, accents and all", () => {
  const original = '{"who":{"68/8":"Ere Õunapuu"},"lang":"et"}';
  assert.equal(run(`unb64url(b64url(${JSON.stringify(original)}))`), original);
});

test("overlapping boxes divide the column between them", () => {
  const packed = json(`pack([{a: 0, z: 60}, {a: 30, z: 90}, {a: 120, z: 180}])`);
  assert.deepEqual(packed.map(x => [x._lane, x._lanes]), [[0, 2], [1, 2], [0, 1]]);
});

test("a box that touches the one before it still gets the full width", () => {
  /* Ending exactly where the next begins is not an overlap. With a preceding
     overlap in the same cluster, treating it as one drew a box that clashes
     with nothing at half width. */
  const packed = json(`pack([{a: 0, z: 60}, {a: 30, z: 90}, {a: 90, z: 150}])`);
  assert.deepEqual(packed.map(x => [x._lane, x._lanes]), [[0, 2], [1, 2], [0, 1]]);
});

test("a whole-class lesson is mine because it says so, not by falling through", () => {
  /* The guard and the loop's own fallthrough give the same answer for an empty
     group list, so the test that named the guard did not exercise it. Give it
     a division whose groups it is not in, and only the guard can save it. */
  assert.equal(run(`visible({g: []}, {"A/B": "A"}, [{id: "d1", groups: ["A", "B"]}])`),
               true);
});

test("a lesson is mine when every division it belongs to matches a pick", () => {
  /* Keyed by the choice as the reader sees it — "A/B" — not by aSc's own
     division id, which means nothing to anyone reading the saved settings. */
  const divisions = `[{id: "d1", groups: ["A", "B"]}, {id: "d2", groups: ["X", "Y"]}]`;
  assert.equal(run(`visible({g: []}, {"A/B": "A"}, ${divisions})`), true,
               "a whole-class lesson is always mine");
  assert.equal(run(`visible({g: ["A"]}, {"A/B": "A"}, ${divisions})`), true);
  assert.equal(run(`visible({g: ["B"]}, {"A/B": "A"}, ${divisions})`), false);
  assert.equal(run(`visible({g: ["B"]}, {}, ${divisions})`), true,
               "with nothing picked, everything shows");
});

test("two pickers over one set of groups are answered apart", () => {
  /* A division the build split per subject offers the same codes twice, so
     neither the group list nor the groups on a lesson say which picker it
     answers to. The subject does, and the second half carries a key of its
     own. See split_by_subject in tt.py. */
  const divisions = `[{id: "d/E", groups: ["I A", "I B"], sj: ["Eesti keel"]},
                      {id: "d/I", groups: ["I A", "I B"], sj: ["Inglise keel"],
                       k: "Inglise keel: I A/I B"}]`;
  const picks = `{"I A/I B": "II", "Inglise keel: I A/I B": "I B"}`;
  assert.equal(run(`choiceKey({groups: ["I A", "I B"]})`), "I A/I B",
               "a division with no key of its own is filed under its groups");
  assert.equal(run(`choiceKey({groups: ["I A", "I B"], k: "x"})`), "x");
  // Estonian answers to the first pick, English to the second, and neither
  // pick reaches across.
  const shown = (subject, group) =>
    run(`visible({s: ${JSON.stringify(subject)}, g: [${JSON.stringify(group)}]},
                 ${picks}, ${divisions})`);
  assert.equal(shown("Eesti keel", "I A"), false, "not the Estonian pick");
  assert.equal(shown("Inglise keel", "I A"), false, "not the English pick");
  assert.equal(shown("Inglise keel", "I B"), true, "the English pick");
});

test("a division carrying several subjects still filters all of them", () => {
  /* The subject check must not narrow an ordinary division. Its subject list
     is built from the very lessons its groups carry, so every one of them is
     in it. */
  const divisions = `[{id: "d1", groups: ["HK1", "PK"],
                       sj: ["Hispaania keel", "Prantsuse keel"]}]`;
  const picks = `{"HK1/PK": "HK1"}`;
  assert.equal(run(`visible({s: "Hispaania keel", g: ["HK1"]}, ${picks}, ${divisions})`), true);
  assert.equal(run(`visible({s: "Prantsuse keel", g: ["PK"]}, ${picks}, ${divisions})`), false);
});

test("a link written before a school was split still finds its class", () => {
  /* ProTERA and the gümnaasium came out of one timetable and one entry in the
     dropdown. Every link shared before the split names the old entry, and the
     class is the half of it that still means something. */
  /* SCHOOLS is the array the page was loaded with, so the stand-in goes into
     it rather than over it, and the real one goes back at the end. */
  run(`globalThis.wasSchools = SCHOOLS.slice();
       SCHOOLS.length = 0;
       SCHOOLS.push(
         {n: "68", tt: "68", l: "ProTERA", b: true, sj: {},
          c: [{n: "8", e: [], v: [], h: {}, m: 0}]},
         {n: "68G", tt: "68", l: "TERA gümnaasium", b: true, sj: {},
          c: [{n: "G1K", e: [], v: [], h: {}, m: 0}]});`);
  run(`state.school = "68"; state.class = "G1K";`);
  assert.equal(json(`currentSchool().l`), "TERA gümnaasium",
               "the class did not carry the reader across");
  assert.equal(json(`currentClass().n`), "G1K");
  // A class the named school does hold is left exactly where it is.
  run(`state.school = "68"; state.class = "8";`);
  assert.equal(json(`currentSchool().l`), "ProTERA");
  // And a name nothing holds falls back rather than throwing.
  run(`state.school = "68"; state.class = "nope";`);
  assert.equal(json(`currentSchool().l`), "ProTERA");
  assert.equal(json(`currentClass().n`), "8");

  // Filed under the timetable, so the split renames nothing already saved.
  run(`state.school = "68G"; state.class = "G1K";`);
  assert.equal(json(`classKey()`), "68/G1K");
  run(`state.school = "68"; state.class = "8";`);
  assert.equal(json(`classKey()`), "68/8");

  run(`SCHOOLS.length = 0; SCHOOLS.push.apply(SCHOOLS, wasSchools);
       state.school = SCHOOLS[0].n; state.class = SCHOOLS[0].c[0].n;`);
});

test("an hour the school fills takes only the lessons it covers", () => {
  /* A concert is not a day off. TäheTERA's runs 9.15 to 10.15 and the school
     counts it as the first two lessons, which for most classes is one paired
     block and for the first years two singles — so the rule is overlap and not
     a count. */
  const instead = `[{d: "2026-12-16", a: 555, z: 615, n: "Jõulukontsert"}]`;
  const args = (a, z) => `icsRepeat(2, icsDay("2026-08-27"), icsDay("2026-12-18"),
                                    [], ${instead}, ${a}, ${z})`;
  const paired = json(args(540, 620));       // 9.00-10.20, one block of two
  assert.deepEqual(paired.skip.map(d => d.slice(0, 10)), ["2026-12-16"]);
  const early = json(args(540, 585));        // 9.00-9.45, a single
  assert.deepEqual(early.skip.map(d => d.slice(0, 10)), ["2026-12-16"]);
  const later = json(args(645, 690));        // 10.45-11.30, after it ends
  assert.deepEqual(later.skip, [], "a lesson after the hour was cancelled too");
  // Two reasons to skip a week do not skip it twice.
  const both = json(`icsRepeat(2, icsDay("2026-08-27"), icsDay("2026-12-18"),
                               ["2026-12-16"], ${instead}, 540, 620)`);
  assert.equal(both.skip.length, 1, "the same day was excluded twice");
});

const BS = String.fromCharCode(92);   // one backslash, unambiguously
const CRLF = "\r\n";

test("an event keeps its calendar name through every edit around it", () => {
  /* The reason the id exists, driven through the file the reader downloads and
     not through a name rebuilt here — an earlier version of this test built the
     identifier itself, so it went on passing with the old positional naming
     still in place and proved nothing. */
  const names = (ics, label) => ics.split("BEGIN:VEVENT")
    .filter(b => b.includes("SUMMARY:" + label))
    .map(b => b.match(/UID:(.*)/)[1].trim());
  run(`myOwn().events = [
         {id: "aaaa1111", day: "Mon", startTime: "16:00", endTime: "17:00",
          backgroundColor: "#DDDDDD", textColor: "", label: "Ujumine", note: ""},
         {id: "bbbb2222", day: "Mon", startTime: "18:00", endTime: "19:00",
          backgroundColor: "#DDDDDD", textColor: "", label: "Trenn", note: ""}];`);
  const before = json(`icsFile(true)`);
  assert.ok(before.includes("SUMMARY:Trenn"), "no events reached the file");
  const trenn = names(before, "Trenn");
  assert.equal(trenn.length, 1);

  /* The reader tidies up: the row above goes, and this one is renamed. Under
     the old naming both of those moved it. */
  run(`myOwn().events.shift();
       myOwn().events[0].label = "Trenn (uus)";
       myOwn().events[0].startTime = "18:30";`);
  const after = json(`icsFile(true)`);
  assert.deepEqual(names(after, "Trenn (uus)"), trenn,
                   "the event was renamed by an edit to its neighbour");
  assert.equal(names(after, "SUMMARY:Ujumine").length, 0);
  run(`myOwn().events = [];`);
});

test("the calendar leaves out what the reader does not want in it", () => {
  run(`myOwn().events = [
         {id: "cccc3333", day: "Mon", startTime: "16:00", endTime: "17:00",
          backgroundColor: "#DDDDDD", textColor: "", label: "Ujumine", note: ""}];`);
  assert.ok(json(`icsFile(true)`).includes("SUMMARY:Ujumine"));
  assert.ok(!json(`icsFile(false)`).includes("SUMMARY:Ujumine"),
            "an event was exported after the reader said not to");
  // And the school's own hours are in it either way.
  assert.ok(json(`icsFile(false)`).includes("SUMMARY:Jõulukontsert"));
  run(`myOwn().events = [];`);
});

test("a lesson repeats weekly and stops at the end of the term", () => {
  /* The whole of the calendar export in one shape: when the first sitting is,
     when the last one is, and which weeks it skips. */
  const term = `{a: "2026-08-27", z: "2026-12-18",
                 x: ["2026-09-21", "2026-10-26", "2026-10-27", "2026-10-28",
                     "2026-10-29", "2026-10-30"]}`;
  // Monday. The term opens on a Thursday, so the first Monday is the 31st.
  const mon = json(`icsRepeat(0, icsDay("2026-08-27"), icsDay("2026-12-18"),
                              ${term}.x)`);
  assert.equal(json(`stampLocal(icsDay("${mon.first.slice(0,10)}"), 540)`),
               "20260831T090000", "the first Monday of the term");
  // Only the Mondays are skipped, and only the ones inside the term.
  assert.deepEqual(mon.skip.map(d => d.slice(0, 10)),
                   ["2026-09-21", "2026-10-26"]);
  // Friday: its last sitting is the term's own last day.
  const fri = json(`icsRepeat(4, icsDay("2026-08-27"), icsDay("2026-12-18"),
                              ${term}.x)`);
  assert.equal(fri.last.slice(0, 10), "2026-12-18");
  assert.deepEqual(fri.skip.map(d => d.slice(0, 10)), ["2026-10-30"],
                   "the Friday of the break week, and nothing else");
});

test("a lesson that never sits inside the term is not an event", () => {
  /* A one-day term on a Wednesday holds no Monday at all, and an event with
     no occurrence is a line in the file that no calendar can draw. */
  assert.equal(json(`icsRepeat(0, icsDay("2026-09-02"), icsDay("2026-09-02"), [])`),
               null);
});

test("a recurrence stops at a UTC instant, and the clocks change inside a term", () => {
  /* Estonia is +3 in September and +2 in December, and the autumn term crosses
     the change. A recurrence may only stop in UTC, so this is the one place
     the page has to know the offset — get it wrong and every lesson after
     October is an hour out. */
  assert.equal(json(`stampUtc(icsDay("2026-09-14"), 540)`), "20260914T060000Z",
               "September is summer time, +3");
  assert.equal(json(`stampUtc(icsDay("2026-12-14"), 540)`), "20261214T070000Z",
               "December is not, +2");
  // The clocks go back on the last Sunday of October, the day before the break.
  assert.equal(json(`lastSunday(2026, 10)`), 25);
  assert.equal(json(`summerTime(icsDay("2026-10-23"))`), true);
  assert.equal(json(`summerTime(icsDay("2026-10-27"))`), false);
});

test("the file escapes what the format reserves and folds by octets", () => {
  /* A subject can carry a comma and a room a semicolon, and both mean
     something else in a calendar file. */
  const esc = (input) => json(`icsText(${JSON.stringify(input)})`);
  assert.equal(esc("Kunst; ja, joonistamine"),
               "Kunst" + BS + "; ja" + BS + ", joonistamine");
  assert.equal(esc("kaks\nrida"), "kaks" + BS + "nrida");
  assert.equal(esc("pool" + BS + "pool"), "pool" + BS + BS + "pool");

  /* Folding counts octets, not letters. Estonian names are two octets each, so
     a line folded by length can break inside a letter and arrive as two
     broken ones. */
  const long = json(`icsFold("SUMMARY:" + "\u00fc".repeat(60))`);
  assert.ok(long.includes(CRLF + " "), "a long line was not folded at all");
  assert.equal(long.split(CRLF + " ").join(""),
               "SUMMARY:" + "\u00fc".repeat(60),
               "unfolding does not give back what went in");
  for (const line of long.split(CRLF + " ")) {
    assert.ok(new TextEncoder().encode(line).length <= 75,
              "a folded line is still too long: " + line);
  }
  // A line that fits is left exactly as it is.
  assert.equal(json(`icsFold("SUMMARY:Kunst")`), "SUMMARY:Kunst");
});

test("the same lesson keeps one name however the file is built again", () => {
  /* Why a second import corrects the week instead of drawing it twice. The
     name is the school's own id for the placed lesson, so it survives the
     lesson moving to another hour — which is the change most likely to happen
     mid-year. */
  const school = `{n: "103", tt: "103"}`, cls = `{n: "5.l"}`;
  const monday = `{i: "*117", d: 0, s: "Matemaatika", p: 7}`;
  const moved = `{i: "*117", d: 0, s: "Matemaatika", p: 3}`;
  assert.equal(json(`icsUid(${school}, ${cls}, ${monday})`),
               "117-0-103-5-l@little.tools");
  assert.equal(json(`icsUid(${school}, ${cls}, ${moved})`),
               json(`icsUid(${school}, ${cls}, ${monday})`),
               "an hour is not an identity");
  // A different day of the same card is a different event.
  assert.notEqual(json(`icsUid(${school}, ${cls}, {i: "*117", d: 2})`),
                  json(`icsUid(${school}, ${cls}, ${monday})`));
  // And so is the same card in another class: one aSc lesson serves several,
  // and a parent with two children may put both in one calendar.
  assert.notEqual(json(`icsUid(${school}, {n: "5.t"}, ${monday})`),
                  json(`icsUid(${school}, ${cls}, ${monday})`));
  /* Named after the timetable, not after the entry in the picker. Offering one
     timetable as two schools must not rename a reader's whole calendar. */
  assert.equal(json(`icsUid({n: "68G", tt: "68"}, {n: "G1K"}, ${monday})`),
               json(`icsUid({n: "68", tt: "68"}, {n: "G1K"}, ${monday})`));
});

test("minutes read back as the clock", () => {
  assert.equal(run(`hhmm(540)`), "9.00");
  assert.equal(run(`hhmm(1095)`), "18.15");
});

test("markup characters in school data cannot escape their attribute", () => {
  assert.equal(run(`esc('<b>"x"</b>')`), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  assert.equal(run(`esc("it's \\u0060quoted\\u0060")`), "it&#39;s &#96;quoted&#96;");
  assert.equal(run(`esc("A & B")`), "A &amp; B");
});

test("text is black or white, whichever can be read on the color", () => {
  assert.equal(run(`readable("#FFFFFF")`), "#14171A");
  assert.equal(run(`readable("#000000")`), "#FFFFFF");
  assert.equal(run(`readable("#83EC9B")`), "#14171A", "a light green takes dark text");
  assert.equal(run(`readable("#12345")`), "#14171A", "and nonsense does not throw");
});

test("boxes that merely touch do not fight for the column", () => {
  // 9-10 then 10-11 is not an overlap; giving them separate lanes would halve both.
  const packed = json(`pack([{a: 540, z: 600}, {a: 600, z: 660}])`);
  assert.deepEqual(packed.map(x => x._lanes), [1, 1]);
});

test("a lane is reused once it is free", () => {
  const packed = json(`pack([{a: 0, z: 60}, {a: 0, z: 120}, {a: 60, z: 90}])`);
  assert.equal(Math.max(...packed.map(x => x._lanes)), 2,
               "three boxes, but only two are ever concurrent");
});

test("the clock reads the way the timetable prints it", () => {
  assert.equal(run(`hhmm(570)`), "9.30");
  assert.equal(run(`hhmm(600)`), "10.00");
  assert.equal(run(`hhmm(0)`), "0.00");
});

test("a minute out of range is rejected, not rounded", () => {
  for (const ev of [{ day: "Mon", startTime: "9:99", endTime: "10:00" },
                    { day: "Mon", startTime: "9:00", endTime: "10:99" }]) {
    assert.equal(json(`readEvents([${JSON.stringify(ev)}])`).errors.length, 1,
                 JSON.stringify(ev));
  }
});

test("an event with no name is still an event", () => {
  /* Unlike the old typed lines, a row with an empty name is a perfectly good
     block of time — someone marking out a gap does not have to name it. */
  const parsed = json(`readEvents([{day: "Mon", startTime: "9:00", endTime: "10:00",
                                    backgroundColor: "#DDDDDD", label: ""}])`);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.events.length, 1);
});

test("a settings bag reaches normalise with its colors filtered", () => {
  const got = json(`normalise({subjects: {A: {backgroundColor: "#fff"},
                                          B: {backgroundColor: 'x"><img src=x>'},
                                          C: {style: "school"},
                                          D: {style: "nonsense"},
                                          E: "not an object"}})`);
  assert.deepEqual(got.subjects, { A: { backgroundColor: "#fff" }, C: { style: "school" } });
});

test("a subject can differ from what every other subject is doing", () => {
  /* The gap the per-subject entry exists to close: the school's own colors
     throughout, with one subject pulled out. */
  run(`state.subjectColorStyle = "school";
       state.subjects = {Matemaatika: {style: "custom", backgroundColor: "#123456"}};`);
  assert.equal(json(`colorFor("Matemaatika").bg`), "#123456");
  assert.equal(json(`styleFor("Ajalugu")`), "school");
  // And the radios mean every subject, so they clear the exception.
  run(`(() => { state.subjectColorStyle = "palette";
       for (const e of Object.values(state.subjects)) delete e.style;
       tidySubjects(); })()`);
  assert.equal(json(`styleFor("Matemaatika")`), "palette");
  assert.deepEqual(json(`state.subjects`), { Matemaatika: { backgroundColor: "#123456" } },
                   "the color survives so switching back restores it");
  run(`state.subjects = {}; state.subjectColorStyle = "custom";`);
});

test("a color the reader picks is the color the box gets", () => {
  /* A row pinned to one of the other two answers kept that pin when a color
     was picked, so the color was stored and never drawn: the radio said "own
     colour" and the box stayed the school's. Picking a color is asking for
     that color, whatever the row said before. */
  for (const pinned of ["school", "palette"]) {
    run(`state.subjectColorStyle = "custom";
         state.subjects = {Matemaatika: {style: ${JSON.stringify(pinned)}}};
         setColor("Matemaatika", "#123456");`);
    assert.equal(json(`colorFor("Matemaatika").bg`), "#123456", pinned);
  }
  /* And the pin goes, because "custom" is what every subject is already
     doing. An entry that says what the switch says is an entry saying
     nothing. */
  assert.deepEqual(json(`state.subjects.Matemaatika`), { backgroundColor: "#123456" });
  run(`state.subjects = {}; state.subjectColorStyle = "custom";`);
});

test("the README describes the settings that actually exist", () => {
  /* The shape is what a reader sees in the Advanced box, so the documented
     version has to be the real one — a renamed field with the old name still
     written down is worse than no documentation. */
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const block = /## The settings, as they are stored[\s\S]*?```json\n([\s\S]*?)```/
                  .exec(readme);
  assert.ok(block, "the settings section has gone");
  const shown = JSON.parse(block[1]);
  assert.deepEqual(Object.keys(shown).sort(), json(`Object.keys(defaults())`).sort());
  /* The written form leaves empty fields out, so the example shows a subset —
     but never a field that does not exist. */
  const real = json(`Object.keys(classDefaults())`);
  for (const key of Object.keys(shown.classes["68/8"])) {
    assert.ok(real.includes(key), `no such per-class setting: ${key}`);
  }
  // And it survives being read back in as settings.
  const back = json(`normalise(${JSON.stringify(shown)})`);
  assert.equal(back.subjectColorStyle, shown.subjectColorStyle);
  assert.deepEqual(back.subjects, shown.subjects);
  assert.equal(back.classes["68/8"].studentName, "Eva");
  assert.equal(back.classes["68/8"].events.length, 1);
  assert.deepEqual(back.classes["68/8"].studyGroups,
                   { "Alfa/Beeta/Gamma": "Beeta", "8.1/8.2/8.3/8.4": "8.1" });
});

test("nothing empty is written down", () => {
  /* In memory every field is there so no reader has to check; on the way out
     the empty ones go, because a file full of "" and {} is harder to read. */
  const written = json(`slim(Object.assign(defaults(), {
    classes: {"68/8": Object.assign(classDefaults(), {studentName: "Eva"})},
    subjects: {Ajalugu: {style: "custom", backgroundColor: "#123456", textColor: ""}}
  }))`);
  assert.deepEqual(Object.keys(written.classes["68/8"]), ["studentName"]);
  assert.deepEqual(written.subjects.Ajalugu,
                   { style: "custom", backgroundColor: "#123456" });
  assert.ok(!("classes" in json(`slim({classes: {}})`)));
  // false and 0 are values, not emptiness.
  assert.deepEqual(json(`slim({showRoom: false, n: 0})`), { showRoom: false, n: 0 });
  // And it survives being read back.
  const back = json(`normalise(${JSON.stringify(written)})`);
  assert.equal(back.classes["68/8"].schoolName, "", "the default is put back");
  assert.deepEqual(back.classes["68/8"].studyGroups, {});
});

test("a class is offered under its label and filed under its name", () => {
  /* A school that names its classes after their teacher carries a label saying
     the year as well. The reader picks the label, but everything the page files
     under a class — the link, their own settings, the visit count — has to keep
     using the name, or a label added later loses all of it. */
  const own = load();
  const pick = (expression) =>
    JSON.parse(own(`JSON.stringify(${expression})`));
  own(`currentSchool().c[0].d = "1. Maarja"; renderClasses();`);
  const html = pick(`document.getElementById("klass").innerHTML`);
  const first = html.split("</option>")[0];
  assert.match(first, />1\. Maarja$/, "the picker did not show the label");
  assert.match(first, new RegExp('value="' + pick(`currentSchool().c[0].n`) + '"'),
               "the picker did not carry the name");
  // And the key the settings are filed under is the name, label or no label.
  assert.doesNotMatch(pick(`classKey()`), /1\. Maarja/);
});

test("a sheet the reader types is held inside the paper edge", () => {
  /* The number is typed, not picked, so it is the one setting a reader can put
     nonsense into. Nought millimetres would leave the fitter nothing to fit
     into, and a sheet wider than the paper edge leaves would print off the page
     — which cost a second sheet of paper before this held it in.

     The paper edge caps the sheet without ever shrinking one that already fits:
     that is the whole difference between the two settings. */
  assert.equal(json(`defaults().printSheet`), "a4", "a sheet is cut by default");
  assert.equal(json(`normalise({printSheet: "ipad11a16"}).printSheet`), "ipad11a16");
  assert.equal(json(`normalise({printSheet: "nosuchthing"}).printSheet`), "a4");

  // At the narrowest edge, the A4 page less 5mm at each end.
  const at = (margin, extra) => json(
    `JSON.stringify(normalise({printMargin: ${margin}, ${extra}}))`);
  assert.equal(JSON.parse(at(5, `printWidth: 287`)).printWidth, 287);
  assert.equal(JSON.parse(at(5, `printHeight: 200`)).printHeight, 200);
  // Past it, brought back to the largest that fits rather than refused.
  assert.equal(JSON.parse(at(5, `printWidth: 400`)).printWidth, 287);
  assert.equal(JSON.parse(at(5, `printHeight: 999`)).printHeight, 200);
  // A wider edge leaves less paper, so the same number is held to less.
  assert.equal(JSON.parse(at(14, `printWidth: 287`)).printWidth, 269);
  assert.equal(JSON.parse(at(14, `printHeight: 200`)).printHeight, 182);
  // And too small to hold a week comes up to the smallest that can. A week
  // fits in 60mm of height at about eight point, so the floor is 50.
  assert.equal(JSON.parse(at(5, `printWidth: 4`)).printWidth, 50);
  assert.equal(JSON.parse(at(5, `printHeight: -5`)).printHeight, 50);
  // An emptied box keeps the size that was in force.
  assert.equal(JSON.parse(at(5, `printWidth: null`)).printWidth, 210);
});

test("every sheet on offer fits the paper at the widest edge", () => {
  /* A named sheet is a real object's size, so it is never trimmed to fit — a
     line drawn short of an iPad would cut a sheet that does not go where the
     iPad goes. Which means a sheet that cannot fit must not be offered at all,
     and this is where a new one that cannot gets caught. */
  const own = load();
  const widest = JSON.parse(own(`JSON.stringify(Math.max(...MARGINS))`));
  const room = [297 - 2 * widest, 210 - 2 * widest];
  const sizes = JSON.parse(own(`JSON.stringify(SHEET_MM)`));
  assert.ok(Object.keys(sizes).length, "no named sheets to check");
  for (const [name, [w, h]] of Object.entries(sizes)) {
    assert.ok(w <= room[0], `${name} is ${w}mm wide, the paper leaves ${room[0]}`);
    assert.ok(h <= room[1], `${name} is ${h}mm tall, the paper leaves ${room[1]}`);
  }
});

test("only a sheet smaller than the page is cut out of it", () => {
  /* The A4 setting is the page itself, so there is nothing to cut and no line
     to draw. Anything else is a box on that page. */
  const own = load();
  const cut = (sheet) => {
    own(`state.printSheet = ${JSON.stringify(sheet)};`);
    return JSON.parse(own(`JSON.stringify(cutSheet())`));
  };
  assert.equal(cut("a4"), null, "A4 is the page, not a sheet cut out of it");
  assert.deepEqual(cut("ipad11a16"), [248.6, 179.5]);
  // Their own size is whatever the two boxes say.
  own(`state.printWidth = 200; state.printHeight = 120;`);
  assert.deepEqual(cut("custom"), [200, 120]);
});

test("the picker offers every sheet the settings accept", () => {
  /* The list and the values normalise takes are one list, so a sheet cannot be
     offered that a saved link would then refuse. */
  const own = load();
  own(`renderSheets();`);
  const html = own(`document.getElementById("printSheet").innerHTML`);
  const values = [...html.matchAll(/value="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(values, JSON.parse(own(`JSON.stringify(SHEETS)`)));
  assert.equal(values.length, 3);
  // Whether the two millimetre boxes are dimmed is a real class on a real
  // element, which the stub does not keep. A browser test checks that.
});

test("the type can be asked for smaller than the page draws it", () => {
  /* The steps under a hundred are what a small sheet needs. A name the box
     cannot fit is cut with an ellipsis, and on a 100 by 60 card twelve of the
     thirty-three names were cut at 90% against six at 70%. Sixty is the floor:
     under that a room number is a smudge rather than small print. */
  const sizes = json(`SIZES`).map(Number);
  assert.ok(Math.min(...sizes) <= 70, "the type cannot be asked for smaller");
  assert.equal(Math.min(...sizes), 60, "the floor moved");
  assert.equal(Math.max(...sizes), 150);
  // Ordered, so the picker reads as a scale rather than a bag of numbers.
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
  // And every one of them is a size the settings will take back.
  for (const size of json(`SIZES`)) {
    assert.equal(json(`normalise({nameSize: ${JSON.stringify(size)}}).nameSize`),
                 size, size);
  }
});

test("a sheet smaller than the page is copied to fill it", () => {
  /* Somebody who asks for a card a third the size of the paper wants more than
     one card, and the rest of the sheet would go in the bin. So the page is
     filled, and the paper is turned when turning it fits more. */
  const own = load();
  const tiles = (w, h, margin) => JSON.parse(own(
    `state.printSheet = "custom"; state.printWidth = ${w};
     state.printHeight = ${h}; state.printMargin = ${margin || 5};
     JSON.stringify(tiling())`));

  // 100 by 60 gets six across a landscape page and eight down a portrait one.
  assert.deepEqual(tiles(100, 60), {portrait: true, cols: 2, rows: 4, count: 8});
  // And neither way round always wins.
  assert.deepEqual(tiles(90, 50), {portrait: false, cols: 3, rows: 4, count: 12});
  assert.deepEqual(tiles(105, 74), {portrait: false, cols: 2, rows: 2, count: 4});
  // A wider paper edge leaves less to fill, and can turn the sheet back.
  assert.equal(tiles(100, 60, 14).count, 6);
  assert.equal(tiles(100, 60, 14).portrait, false);
  // A sheet that fills the page on its own is drawn once, as it always was.
  assert.deepEqual(tiles(287, 200), {portrait: false, cols: 1, rows: 1, count: 1});
  // A4 itself is not a sheet cut out of anything.
  own(`state.printSheet = "a4";`);
  assert.equal(JSON.parse(own(`JSON.stringify(tiling())`)).count, 1);
});

test("the printer is never asked for paper it does not hold", () => {
  /* Every sheet is drawn on an A4 page. The rule the browser prints by says so
     whatever sheet is chosen, which is what keeps a home printer out of the
     argument — no custom paper size, and nothing to scale. The page can be
     turned to fit more copies on it, but it is still A4 either way round. */
  const own = load();
  const rule = () => own(`document.getElementById("pagerule").textContent`);
  for (const sheet of ["a4", "ipad11a16", "custom"]) {
    own(`state.printSheet = ${JSON.stringify(sheet)}; applyPageMargin();`);
    assert.match(rule(), /size: A4 (landscape|portrait)/, sheet);
  }
  // Turned only to fit more, and named rather than measured.
  own(`state.printSheet = "custom"; state.printWidth = 100;
       state.printHeight = 60; applyPageMargin();`);
  assert.match(rule(), /size: A4 portrait/, "the page did not turn to fit more");
  own(`state.printSheet = "a4"; applyPageMargin();`);
  assert.match(rule(), /size: A4 landscape/, "a whole page turned for nothing");
});

test("a group is offered by its teacher and filed under its code", () => {
  /* A reader knows who teaches them, not that the school calls them "HK1". So
     the option says the teacher — but the value has to stay the code, because
     that is what the pick is stored under and what a shared link carries. */
  const own = load();
  own(`currentClass().v[0].w = [[["Tamm Mari", ""]], [["Kask Kati", ""]]];
       renderDivisions();`);
  const html = own(`document.getElementById("divisions").innerHTML`);
  assert.match(html, />A \(Mari Tamm\)</, "the option did not name the teacher");
  assert.match(html, /value="A"/, "the option did not carry the code");

  // The name goes the way round the reader asked for, as in a lesson box.
  own(`state.teacherNameOrder = "last"; renderDivisions();`);
  assert.match(own(`document.getElementById("divisions").innerHTML`),
               />A \(Tamm Mari\)</, "the picker ignored the name order");
});

test("a group with no teacher to name is offered by its code alone", () => {
  /* Past a few names the list stops being a hint, and the generator sends
     nothing rather than a class register. The option is then the bare code. */
  const own = load();
  own(`currentClass().v[0].w = 0; renderDivisions();`);
  assert.match(own(`document.getElementById("divisions").innerHTML`),
               />A</, "the bare code went missing");
  assert.equal(own(`String(document.getElementById("divisions").innerHTML
                           .indexOf("("))`), "-1", "something was said anyway");
});

test("a group taught by two says which of them takes what", () => {
  const own = load();
  own(`currentClass().v[0].w = [[["Tamm Mari", "Mat"], ["Kask Kati", "Kun"]], []];
       renderDivisions();`);
  assert.match(own(`document.getElementById("divisions").innerHTML`),
               />A \(Mat: Mari Tamm, Kun: Kati Kask\)</);
});

test("a pick left over from a renamed group hides nothing", () => {
  /* Renaming a study group renames the key its pick is filed under, because the
     key is the list of groups in the division. A pick under the old key matches
     no division, and the reader is shown every group until they pick again.
     There is nothing to migrate it to: TäheTERA's old "HK" was a placeholder
     covering half of each group that replaced it. Showing everything is the only
     safe answer — an empty timetable would look like a school with no lessons. */
  const own = load();
  const shown = (expression) => JSON.parse(own(`JSON.stringify(${expression})`));
  const groupsDrawn = () => shown(`currentClass().e
      .filter(e => visible(e, mine().studyGroups, currentClass().v))
      .map(e => e.g.join("/"))`);

  own(`myOwn().studyGroups = {"HK/HK1/PK/SK": "HK"};`);
  assert.ok(groupsDrawn().includes("A"), "a group lesson went missing");

  // A pick that does match a division still rules the other groups out.
  own(`myOwn().studyGroups = {"A/B": "B"};`);
  assert.ok(!groupsDrawn().includes("A"), "the pick stopped filtering");
});

test("a class with no label of its own is called by its name", () => {
  assert.equal(json(`classLabel({n: "8"})`), "8");
  assert.equal(json(`classLabel({n: "8", d: ""})`), "8");
  assert.equal(json(`classLabel(null)`), "");
});

test("the two swatches in a legend row set different things", () => {
  /* Both are input[type=color] in the same row, and a handler bound by that
     alone caught the text one as well — picking a text color rewrote the
     background. They are told apart by class, and this is why. */
  run(`state.subjects = {}; state.subjectColorStyle = "custom";
       renderLegend(currentClass().e);`);
  const html = json(`document.getElementById("legend").innerHTML`);
  const swatches = (html.match(/type="color"/g) || []).length;
  const named = (html.match(/class="bgpick"|class="fgpick"/g) || []).length;
  assert.ok(swatches > 0, "the legend drew no swatches");
  assert.equal(named, swatches, "a color input in the legend with no class on it");

  // And each writes only its own field.
  run(`setColor("Ajalugu", "#123456");`);
  assert.deepEqual(json(`state.subjects.Ajalugu`), { backgroundColor: "#123456" });
  run(`setTextColor("Ajalugu", "#ff00ff");`);
  assert.deepEqual(json(`state.subjects.Ajalugu`),
                   { backgroundColor: "#123456", textColor: "#ff00ff" });
  run(`setTextColor("Ajalugu", "");`);
  assert.deepEqual(json(`state.subjects.Ajalugu`), { backgroundColor: "#123456" });
  run(`state.subjects = {};`);
});

test("every column has a heading and every heading a column", () => {
  /* The headings are markup in tt.py and the cells are built here, so the two
     can drift apart without either file looking wrong on its own. This reads
     the real headings and counts the cells the renderer actually produces. */
  const source = readFileSync(join(root, "tt.py"), "utf8");
  const heads = (id) => {
    const table = new RegExp("<tbody id=\"" + id + "\"", "");
    const upto = source.slice(0, source.search(table));
    const thead = upto.slice(upto.lastIndexOf("<thead>"));
    return (thead.match(/<th\b/g) || []).length;
  };

  run(`state.classes = {};
       myOwn().events = [{day: "Mon", startTime: "09:00", endTime: "10:00",
                          backgroundColor: "#DDDDDD", textColor: "", label: "x"}];
       renderEvents(); renderLegend(currentClass().e);`);

  for (const [id, what] of [["evrows", "my own events"], ["legend", "subjects"]]) {
    /* One row's worth: the stub keeps innerHTML as a string, so this counts
       from the markup rather than walking a DOM that is not there. */
    const cells = json(`document.getElementById(${JSON.stringify(id)})`
                       + `.innerHTML.split("<tr")[1].match(/<td\\b/g).length`);
    assert.equal(cells, heads(id), `${what}: ${cells} cells under ${heads(id)} headings`);
  }
  run(`state.classes = {};`);
});

test("changing a color redraws the sample beside it", () => {
  /* Neither table may be re-rendered while it is in use — the events table
     leaves itself alone while focus is inside it, the legend is skipped by
     paint() so an open color panel survives — so the sample has to be redrawn
     on its own. It was not, and sat showing the color before last. */
  const cell = `(() => {
    const host = {innerHTML: ""};
    globalThis.host = host;
    return {dataset: {i: "0"},
            querySelector: (s) => (s === ".sample" ? host : null)};
  })()`;

  run(`state.classes = {};
       myOwn().events = [{day: "Mon", startTime: "09:00", endTime: "10:00",
                          backgroundColor: "#DDDDDD", textColor: "", label: "x"}];
       globalThis.tr = ${cell};`);

  run(`rowChanged(tr, (ev) => { ev.backgroundColor = "#102030"; });`);
  assert.match(json(`host.innerHTML`), /#102030/, "the background did not reach the sample");

  run(`rowChanged(tr, (ev) => { ev.textColor = "#00ff00"; });`);
  const withText = json(`host.innerHTML`);
  assert.match(withText, /#00ff00/, "the text color did not reach the sample");

  run(`rowChanged(tr, (ev) => { ev.label = "Trenn"; ev.startTime = "07:30"; });`);
  const now = json(`host.innerHTML`);
  assert.match(now, /Trenn/, "the label did not reach the sample");
  assert.match(now, /7\.30/, "the time did not reach the sample");
  run(`state.classes = {};`);
});

test("a box looks the same however its text color was arrived at", () => {
  /* Choosing a text color is a choice about text. It used to draw a heavier
     border as well, so the same event changed shape depending on whether its
     color was picked or worked out. */
  const chosen = json(`sampleBox("#DDDDDD", "#333333", "9.00–9.45", "x", "")`);
  const worked = json(`sampleBox("#DDDDDD", readable("#DDDDDD"), "9.00–9.45", "x", "")`);
  const shape = (html) => html.replace(/color:#[0-9a-f]{3,8}/gi, "color:X");
  assert.equal(shape(chosen), shape(worked),
               "the two differ by more than the text color");
  assert.doesNotMatch(chosen, /border|outlined/);
});

test("a subject can be given a name of the reader's own", () => {
  /* The school's word for a subject is not always the word a family uses. The
     override wins over both the full name and the abbreviation, and an empty
     one means "use the school's". */
  run(`state.subjects = {}; state.subjectNameStyle = "full";`);
  assert.equal(json(`subjectLabel("Matemaatika", false)`), "Matemaatika");
  assert.equal(json(`subjectLabel("Matemaatika", true)`), "Mat", "the school's short form");

  run(`setSubjectLabel("Matemaatika", "Maths");`);
  assert.equal(json(`subjectLabel("Matemaatika", false)`), "Maths");
  assert.equal(json(`subjectLabel("Matemaatika", true)`), "Maths",
               "a name of your own is never abbreviated");
  assert.deepEqual(json(`state.subjects.Matemaatika`), { label: "Maths" });

  // A merged box renames each of its parts.
  assert.equal(json(`subjectName({s: "Matemaatika", S: ["Matemaatika", "Kunst"]}, false)`),
               "Maths + Kunst");

  run(`setSubjectLabel("Matemaatika", "   ");`);
  assert.deepEqual(json(`state.subjects`), {}, "an empty name leaves nothing behind");
});

test("a break is renamed and recolored like a subject", () => {
  /* Breaks are drawn on the timetable, so they are the reader's to change too.
     They carry no groups and no room, but everything else is the same. */
  run(`state.subjects = {};`);
  assert.equal(json(`breakLabel("Vaba aeg")`), "Vaba aeg");
  // A school that writes a break as a list gets only the part before the comma.
  assert.equal(json(`breakLabel("Söömine, tiimitund, vaba aeg")`), "Söömine");
  run(`setSubjectLabel("Vaba aeg", "Free time");`);
  assert.equal(json(`breakLabel("Vaba aeg")`), "Free time");
  run(`setColor("Vaba aeg", "#123456");`);
  assert.equal(json(`colorFor("Vaba aeg").bg`), "#123456");
  run(`state.subjects = {}; state.subjectColorStyle = "custom";`);
});

test("a break keeps its hatch when it takes a color", () => {
  /* The stripes say "not a lesson". They are translucent now, so a color can
     sit under them, and the sample in the table wears the same class. */
  const hatched = json(`sampleBox("#123456", "#fff", "9.00–9.45", "Free time", "", "brk")`);
  const plain = json(`sampleBox("#123456", "#fff", "9.00–9.45", "Maths", "", "")`);
  assert.match(hatched, /class="ev brk"/);
  assert.doesNotMatch(plain, /brk/);
  // The color is named on its own, or the shorthand wipes the stripes out.
  assert.match(hatched, /background-color:#123456/);
  assert.doesNotMatch(hatched, /background:#/);
});

test("Cmd+P prepares the sheet, the same as the button does", () => {
  /* The print stylesheet applies either way. What did not happen on Cmd+P was
     the page switching into print mode, so the sheet went out with no QR code,
     no scaling, and the footer the screen uses. */
  const fire = (name) => run(
    `(window.__on[${JSON.stringify(name)}] || []).forEach(function (f) { f(); })`);

  assert.equal(json(`printing`), false);
  fire("beforeprint");
  assert.equal(json(`printing`), true, "the page did not enter print mode");
  fire("afterprint");
  assert.equal(json(`printing`), false, "the page stayed in print mode");

  // Firing it twice is not two renders, and it does not strand the page.
  fire("beforeprint");
  fire("beforeprint");
  assert.equal(json(`printing`), true);
  fire("afterprint");
  fire("afterprint");
  assert.equal(json(`printing`), false);
  assert.ok(json(`typeof enterPrint === "function" && typeof leavePrint === "function"`),
            "the button and the event share one path");
});

test("a link too long for a code leaves the corner empty", () => {
  /* It used to print the address as text instead. An address too long for a
     code is far too long for anybody to type, so that filled the corner with
     characters nobody would ever read. */
  run(`printing = true; qrSvg = function () { return ""; };
       renderFooter(DATA.schools[0]);`);
  const html = json(`document.getElementById("foot").innerHTML`);
  run(`printing = false;`);
  assert.ok(!html.includes("qrbox"), "no box with nothing in it");
  assert.ok(!html.includes("#s=") && !html.includes("#z="), "no address in the corner");
});

test("a subject shows the school's word for it, without the school's prefix", () => {
  run(`state.school = "68"; state.subjects = {};`);
  // Three strings, and they are not the same string.
  assert.equal(json(`subjectLabel("Gümn Matemaatika", false)`), "Matemaatika");
  assert.equal(json(`subjectLabel("Gümn Matemaatika", true)`), "Matem");
  // The twin taught in the grades below keeps its own abbreviation. This is
  // why the prefix comes off the name shown and not off the identity.
  assert.equal(json(`subjectLabel("Matemaatika", true)`), "Mat");
  assert.notEqual(json(`colorFor("Gümn Matemaatika").bg`),
                  json(`colorFor("Matemaatika").bg`));
  // A name of the reader's own beats both, and is keyed by the identity.
  run(`state.subjects = { "Gümn Matemaatika": { label: "Matsu" } };`);
  assert.equal(json(`subjectLabel("Gümn Matemaatika", false)`), "Matsu");
  assert.equal(json(`subjectLabel("Gümn Matemaatika", true)`), "Matsu");
  run(`state.subjects = {};`);
  // A subject with no prefix is untouched.
  assert.equal(json(`subjectLabel("Kunst", false)`), "Kunst");
});

test("the feedback panel sends exactly what it shows", () => {
  /* The one thing on this page that carries the reader's own words on
     purpose. What they are shown before pressing Send has to be what goes. */
  run(`state = defaults(); state.school = "68"; state.class = "8";
       myOwn().studentName = "Eva";
       document.getElementById("sayText").value = "Puder is hidden";
       document.getElementById("sayWithSettings").checked = true;
       refreshFeedbackPreview();`);
  const shown = json(`document.getElementById("sayShown").textContent`);
  assert.equal(shown, json(`JSON.stringify(feedbackPayload(), null, 2)`));
  assert.equal(json(`document.getElementById("sayPreview").hidden`), false);
  const body = JSON.parse(shown);
  assert.equal(body.kind, "feedback");
  assert.equal(body.text, "Puder is hidden");
  assert.equal(body.school, "68");
  /* Not scrubbed. They asked for their settings to go and can read every
     character of what goes, this name among them. */
  assert.equal(body.settings.classes["68/8"].studentName, "Eva");

  // Unchecked, the settings are not in it at all.
  run(`document.getElementById("sayWithSettings").checked = false;
       refreshFeedbackPreview();`);
  assert.equal(json(`document.getElementById("sayPreview").hidden`), true);
  assert.ok(!("settings" in JSON.parse(json(`JSON.stringify(feedbackPayload())`))),
            "the settings went without being asked for");
});

test("feedback with nothing written is not sent", async () => {
  run(`DATA.report = "/report"; window.__posted = null;
       document.getElementById("sayText").value = "   ";
       document.getElementById("sayMsg").textContent = "";`);
  await run(`sendFeedback()`);
  assert.equal(json(`window.__posted`), null);
  assert.equal(json(`document.getElementById("sayMsg").textContent`),
               json(`t("say.empty")`));
});

test("a very long message is cut before it leaves", () => {
  run(`document.getElementById("sayText").value = "x".repeat(5000);
       document.getElementById("sayWithSettings").checked = false;`);
  assert.equal(json(`feedbackPayload().text.length`), 2000);
});

test("a fault report carries the shape of the settings, not the words", () => {
  /* The whole reason a report is allowed to carry the settings at all. Every
     one of these strings is something a reader typed. */
  const typed = ["Eva", "Dance training", "Eva's school", "Eva's class",
                 "Maths with Mrs Tamm"];
  run(`DATA.report = "/report";
       state = defaults();
       state.school = "68"; state.class = "8"; state.showTeacher = false;
       state.subjects = { Matemaatika: { label: "Maths with Mrs Tamm",
                                         backgroundColor: "#ff0000" } };
       state.classes = { "68/8": {
         studentName: "Eva", schoolName: "Eva's school", className: "Eva's class",
         events: [{ day: "Mon", startTime: "17:15", endTime: "18:15",
                    label: "Dance training", backgroundColor: "#00ff00" }] } };
       reportsSent = 0; reportsSeen.clear();
       report("error", new Error("boom"));`);
  const posted = json(`window.__posted`);
  assert.equal(posted.url, "/report");
  for (const word of typed) {
    assert.ok(!posted.body.includes(word), "the report carries " + word);
  }
  const sent = JSON.parse(posted.body);
  // The shape is what a fault has to be read against, so it must survive.
  assert.equal(sent.message, "boom");
  assert.equal(sent.settings.showTeacher, false);
  assert.equal(sent.settings.class, "8");
  assert.equal(sent.settings.subjects.Matemaatika.backgroundColor, "#ff0000");
  assert.equal(sent.settings.classes["68/8"].events.length, 1);
  assert.equal(sent.settings.classes["68/8"].events[0].startTime, "17:15");
  // A typed word leaves its length behind, and nothing else. The same length,
  // so the report weighs what the real one weighs.
  assert.equal(sent.settings.classes["68/8"].studentName, "XXX");
  assert.equal(sent.settings.classes["68/8"].events[0].label, "X".repeat(14));
  assert.equal(sent.settings.subjects.Matemaatika.label, "X".repeat(19));
  // The address holds the settings, so the address is not in the report.
  assert.ok(!("href" in sent), "no address");
  assert.equal(sent.path, "/t/");
});

test("a fault report never carries the address's own tail", () => {
  /* A browser names the file the fault was in, and for an error in this page
     that file is this page — fragment and all, which is where every setting
     lives. One real report arrived with 269 characters of a reader's settings
     in it. */
  run(`DATA.report = "/report"; reportsSent = 0; reportsSeen.clear();
       report("error", new Error("boom"),
              "https://little.tools/timetable#z=H4sIAAAAsettings");`);
  const sent = JSON.parse(json(`window.__posted`).body);
  assert.equal(sent.where, "https://little.tools/timetable");
  assert.ok(!JSON.stringify(sent).includes("H4sIA"), "the fragment went along");

  // A query string is the same kind of tail.
  run(`reportsSent = 0; reportsSeen.clear();
       report("error", new Error("boom2"), "https://little.tools/t?k=v#frag");`);
  assert.equal(JSON.parse(json(`window.__posted`).body).where, "https://little.tools/t");
});

test("a wallet extension's error is not this page's fault", () => {
  /* window.ethereum comes from something the reader installed. It is logged,
     because it did happen, and it does not wake anybody. */
  run(`DATA.report = "/report"; reportsSent = 0; reportsSeen.clear();
       report("error", new Error("undefined is not an object (evaluating " +
              "'window.ethereum.selectedAddress = undefined')"),
              "https://little.tools/timetable");`);
  const sent = JSON.parse(json(`window.__posted`).body);
  assert.equal(sent.opaque, 1, "an extension's error would have raised an alarm");

  // A real fault in this page's own code still does.
  run(`reportsSent = 0; reportsSeen.clear();
       report("error", new Error("cannot read properties of null"),
              "https://little.tools/timetable");`);
  assert.ok(!("opaque" in JSON.parse(json(`window.__posted`).body)),
            "a real fault was written off");
});

test("an error the browser will not describe is logged, not alarmed on", () => {
  /* A script from another origin gives "Script error." and nothing else. It
     came from the counter's script, and it is not something to be woken for. */
  run(`DATA.report = "/report"; reportsSent = 0; reportsSeen.clear();
       window.__posted = null; report("error", "Script error.", "");`);
  const opaque = JSON.parse(json(`window.__posted`).body);
  assert.equal(opaque.opaque, 1);
  assert.equal(opaque.where, "");

  // One that says where it happened is a real one, and is not marked.
  run(`reportsSent = 0; reportsSeen.clear(); window.__posted = null;
       report("error", new Error("boom"), "https://little.tools/timetable/:12:3");`);
  const real = JSON.parse(json(`window.__posted`).body);
  assert.ok(!("opaque" in real), "a readable error was written off as opaque");
  assert.equal(real.where, "https://little.tools/timetable/:12:3");
});

test("one fault is reported once, and a storm has a ceiling", () => {
  run(`DATA.report = "/report"; reportsSent = 0; reportsSeen.clear();
       window.__posted = null;
       report("error", new Error("same"));`);
  assert.ok(json(`window.__posted`), "the first one goes");
  run(`window.__posted = null; report("error", new Error("same"));`);
  assert.equal(json(`window.__posted`), null, "the second one does not");
  run(`window.__posted = null;
       for (let i = 0; i < 20; i++) report("error", new Error("n" + i));`);
  assert.equal(json(`reportsSent`), 5, "the cap holds");
});

test("with no endpoint the page reports nothing", () => {
  run(`DATA.report = ""; reportsSent = 0; reportsSeen.clear();
       window.__posted = null; report("error", new Error("quiet"));`);
  assert.equal(json(`window.__posted`), null);
  run(`DATA.report = "/report";`);
});

test("the address bar holds the link the Share button copies", () => {
  /* The panel tells the reader to copy the address instead of pressing the
     button. That is only true while the two strings are the same one. */
  run(`state.school = "68"; state.class = "8"; state.showTeacher = false;
       state.classes = { "68/8": { studentName: "Eva" } }; save();`);
  const address = json(`window.__address`);
  const shared = json(`shareUrl()`);
  assert.equal(address, shared);
  assert.ok(address.includes("#"), "the settings are in it");
  // And a page with nothing changed keeps a clean address.
  run(`state = defaults(); save();`);
  assert.equal(json(`window.__address`), "https://example.test/t/");
});

test("how long a lesson lasts is spelled out, and an exact hour drops the minutes", () => {
  run(`state = defaults(); state.lang = "en"; applyStrings();`);
  assert.equal(json(`durationText(45)`), "45 min");
  assert.equal(json(`durationText(60)`), "1 hour", "an exact hour kept its 0 min");
  assert.equal(json(`durationText(80)`), "1 hour 20 min");
  assert.equal(json(`durationText(120)`), "2 hours", "one and many read alike");
  assert.equal(json(`durationText(135)`), "2 hours 15 min");
  // Estonian counts one differently from many, so this cannot be an added s.
  run(`state.lang = "et"; applyStrings();`);
  assert.equal(json(`durationText(60)`), "1 tund");
  assert.equal(json(`durationText(120)`), "2 tundi");

  // On by default, and the switch takes it away without touching the clock.
  run(`state = defaults(); state.lang = "en"; applyStrings();`);
  assert.equal(json(`state.showDuration`), true);
  assert.equal(json(`clockText(540, 620)`), "9.00–10.20 (1 hour 20 min)");
  run(`state.showDuration = false;`);
  assert.equal(json(`clockText(540, 620)`), "9.00–10.20");
});

test("a gap long enough to plan around is drawn, and belongs to the reader", () => {
  /* Fifteen minutes is where a hole stops being a corridor. The point is
     logistics: how long until the next thing. */
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8";`);
  assert.equal(json(`state.showGaps`), true);

  const draw = () => run(`renderTimeline(currentSchool(), currentClass(),
                                         currentClass().e, readEvents(myOwn().events).events, 0)`);
  /* The harness day has nothing loose in it: the school's own break fills the
     one space between its lessons, and a school that names a break has said
     what that time is for. */
  assert.ok(!draw().includes('class="ev gap"'), "a filled space became a break");

  /* Ten minutes is where a hole starts being worth drawing. It was fifteen
     while a box that short could not hold a line of type. The harness day runs
     to 12.10, its longest lesson and all, so an event says where the next
     thing is and the hole between them is exact. */
  run(`myOwn().events = [{day: "Mon", startTime: "12:19", endTime: "13:00",
                          label: "Nine", backgroundColor: "#00ff00"}];`);
  assert.ok(!draw().includes('class="ev gap"'), "nine minutes is still a corridor");
  run(`myOwn().events = [{day: "Mon", startTime: "12:20", endTime: "13:00",
                          label: "Ten", backgroundColor: "#00ff00"}];`);
  assert.match(draw(), /Break . 10 min/, "ten minutes was not drawn");
  assert.equal(json(`GAP_AT_LEAST`), 10);
  run(`myOwn().events = [];`);

  // An event in the evening leaves hours of it, and that is worth saying.
  run(`myOwn().events = [{day: "Mon", startTime: "17:15", endTime: "18:15",
                          label: "Dance", backgroundColor: "#00ff00"}];`);
  const html = draw();
  const band = html.split('class="ev gap"')[1] || "";
  assert.ok(band, "no gap before an evening event");
  assert.match(band, /Break . 5 hours/, "wrong length: " + band.slice(0, 120));

  // It is listed with the other breaks, so it can be renamed and recolored.
  run(`renderLegend(currentClass().e.filter(function (e) { return !e.c; }))`);
  const rows = json(`document.getElementById("legend").innerHTML`);
  assert.ok(rows.includes('data-subject="gap"'), "the gap is not in the table");
  run(`state.subjects = { gap: { label: "Waiting", backgroundColor: "#ffe0b2" } };`);
  assert.match(draw(), /Waiting . 5 hours/, "a name of the reader's own was ignored");
  assert.ok(draw().includes("#ffe0b2"), "a color of the reader's own was ignored");

  // And the switch removes it.
  run(`state.subjects = {}; state.showGaps = false;`);
  assert.ok(!draw().includes('class="ev gap"'));
  run(`state = defaults(); myOwn().events = [];`);
});

test("a hole in the middle of the day is called lunch where the school says so", () => {
  /* Some schools leave lunch to arithmetic: it is whatever the lessons leave,
     and at TäheTERA that is a different hour for each language group. The
     school says which holes count, and the page says what they are. */
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8";
       currentSchool().lg = { n: "Lõuna", a: 720, z: 780, m: 30 };`);
  assert.equal(json(`gapKind(755, 805)`), "lunch", "a 50-minute midday hole");
  assert.equal(json(`gapKind(725, 740)`), "gap", "15 minutes is not a meal");
  assert.equal(json(`gapKind(600, 660)`), "gap", "an hour in the morning is not lunch");
  assert.equal(json(`gapKind(790, 850)`), "gap", "an hour in the afternoon is not lunch");
  assert.equal(json(`breakName("lunch")`), "Lõuna");

  // A school that never says goes on saying gap, whatever the hour.
  run(`delete currentSchool().lg;`);
  assert.equal(json(`gapKind(755, 805)`), "gap");
  assert.equal(json(`breakName("lunch")`), json(`t("gap")`));
});

test("a lunch the page works out is drawn as the meal it is", () => {
  /* On the days a school publishes its lunch band the same meal was drawn as
     a hatched band, and on the days it does not it came out as a dashed
     corridor. One meal, two looks, and two rows in the table. */
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8";
       currentSchool().lg = { n: "Break, and more", a: 600, z: 780, m: 30 };
       myOwn().events = [{day: "Mon", startTime: "13:00", endTime: "14:00",
                          label: "Dance", backgroundColor: "#00ff00"}];`);
  const draw = () => run(`renderTimeline(currentSchool(), currentClass(),
                                         currentClass().e, readEvents(myOwn().events).events, 0)`);
  const html = draw();
  // The class already has a published band of that name, so it is that band.
  assert.ok(!html.includes('class="ev gap" data-subject="Break, and more"'),
            "the meal was drawn as a corridor");
  assert.equal(html.split('data-subject="Break, and more"').length - 1, 2,
               "the worked-out meal is not filed with the published one");

  // And one row in the table, not two.
  run(`renderLegend(currentClass().e.filter(function (e) { return !e.c; }))`);
  const rows = json(`document.getElementById("legend").innerHTML`);
  assert.equal(rows.split('data-subject="Break, and more"').length - 1, 1);
  assert.ok(!rows.includes('data-subject="lunch"'), "a second row for the same meal");

  // A school whose lunch is never published keeps a row of its own.
  run(`currentSchool().lg = { n: "Lounas", a: 600, z: 780, m: 30 };`);
  assert.equal(json(`lunchKey()`), "lunch");
  run(`delete currentSchool().lg; state = defaults(); myOwn().events = [];`);
});

test("the page loads with a link in the address without falling over", () => {
  /* Everything above runs the file with a bare address, so the code that reads
     a link is skipped and a fault in it goes unseen. Two have: a constant read
     before its own line, each time on this path, and each time silent because
     something swallowed it. Loading the file with a link in the address is one
     line and closes that off. */
  const withLink = load(undefined, "#s=" + Buffer.from(
    JSON.stringify({ showRoom: false, class: "8" })).toString("base64url"));
  const ask = (expression) => JSON.parse(withLink(`JSON.stringify(${expression})`));
  assert.equal(ask("state.showRoom"), false, "the link was not read");
  assert.equal(ask("state.class"), "8");
  assert.equal(ask("linkFault"), "", "a good link was called broken");
  assert.ok(ask(`document.getElementById("grid").innerHTML.length`) > 0,
            "the page drew nothing");

  // And with one it cannot read, it still comes up, and says so.
  const broken = load(undefined, "#z=this-is-not-gzip");
  const said = (expression) => JSON.parse(broken(`JSON.stringify(${expression})`));
  assert.ok(said("linkFault"), "an unreadable link said nothing");
  assert.ok(said(`document.getElementById("grid").innerHTML.length`) > 0,
            "an unreadable link took the page down");
  assert.equal(said(`document.getElementById("linkwarn").hidden`), false,
               "the reader was not told");
  assert.ok(said(`document.getElementById("linkwarn").textContent`).length > 20);
});

test("a link we wrote and cannot read says so, and one we did not stays quiet", () => {
  /* A link cut short on its way through a chat window drew the timetable as
     the page opens and said nothing, so the reader believed that was what was
     shared. An anchor somebody appended is a different thing and is not worth
     a word. */
  const fault = (hash) => json(
    `(function () { location.hash = ${JSON.stringify(hash)};
                    linkFault = ""; readUrl(); return linkFault; })()`);

  // Ours, and readable: nothing to say.
  const good = json(`(function () {
    state = defaults(); state.showRoom = false;
    return "#" + packSettings(JSON.stringify(slim(changedFromDefaults())));
  })()`);
  assert.equal(fault(good), "", "a good link was called broken");

  // Ours, and cut short. Both ways of writing one.
  assert.ok(fault(good.slice(0, good.length - 8)), "a truncated link said nothing");
  assert.ok(fault("#z=this-is-not-gzip"), "unreadable gzip said nothing");
  assert.ok(fault("#s=))))not base64(((("), "unreadable text said nothing");
  assert.ok(fault("#s=" + json(`packSettings("[1,2,3]")`).slice(2)) ||
            fault("#s=" + Buffer.from("[1,2,3]").toString("base64url")),
            "a link carrying the wrong shape said nothing");

  // Not ours: an anchor, or nothing at all.
  assert.equal(fault(""), "", "an empty fragment was called broken");
  assert.equal(fault("#somewhere"), "", "an anchor was called broken");
  assert.equal(fault("#z"), "", "a fragment that is not ours was called broken");
  run(`location.hash = ""; linkFault = ""; state = defaults();`);
});

test("a broken link is counted but never wakes anybody", () => {
  /* A handful a week is normal, and none of them is a fault in this page. A
     lot of them at once would say the links have grown too long for something
     to carry, which is worth being able to see. */
  const source = readFileSync(join(root, "page.js"), "utf8");
  assert.match(source, /if \(what === "link"\) body\.opaque = 1;/,
               "a cut-short link would ring the alarm");
  /* The other half of this — that the alarm's filter really does skip what is
     marked opaque — is in the site's repository, because the report endpoint
     and its alarms belong to the site rather than to any one tool. */
});

test("the fault reporter is armed before anything can break", () => {
  /* It used to be installed at the bottom of the file. A fault near the top
     then took the whole script down with it, including the line that would
     have installed this — so the page came up blank and nobody was told. The
     one page-breaking fault it exists for was the one it could not see. */
  const source = readFileSync(join(root, "page.js"), "utf8");
  const armed = source.indexOf('addEventListener("error"');
  assert.ok(armed > 0, "nothing listens for a fault");

  /* Everything below runs at load and any of it can throw. All of it has to
     come after the listener, or a fault in it is silent. */
  for (const later of ["let state = defaults()", "applyShared(shared, state)",
                       "function normalise", "renderLanguages()", "render()"]) {
    const at = source.indexOf(later);
    assert.ok(at > armed,
              `${later} is above the error listener, so a fault in it is silent`);
  }
  /* What comes first is only what the listener itself needs: the page's data,
     the storage key, and the reporter's own counters. Declarations, not work.
     Every call up there is a chance to fail while nothing is watching, so
     there are three, and all three are the browser's own. */
  const before = source.slice(0, armed)
    .replace(/\/\*[\s\S]*?\*\//g, "")          // block comments wrap without a *
    .replace(/\/\/.*/g, "");
  const allowed = ["JSON.parse", "document.getElementById", "Set",
                   "if", "typeof"];   // keywords, not calls
  for (const [, name] of before.matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)) {
    assert.ok(allowed.includes(name),
              `${name}() runs before anything is watching for a fault in it`);
  }

  // And the listener really is registered when the page loads.
  assert.ok(json(`Object.keys(window.__on)`).includes("error"));
  assert.ok(json(`Object.keys(window.__on)`).includes("unhandledrejection"));
});

test("what a browser stored is read back, and a fault reading it is reported", () => {
  /* Three things can go wrong and only one of them is ours. One blanket catch
     around all three is how a broken read went unnoticed while every
     returning reader quietly lost their settings. */
  const source = readFileSync(join(root, "page.js"), "utf8");
  const block = source.slice(source.indexOf("let state = defaults();"),
                             source.indexOf("function applyShared"));
  assert.match(block, /report\("settings"/,
               "a fault normalising stored settings is still swallowed");
  assert.ok((block.match(/catch/g) || []).length >= 3,
            "the three failures are still handled as one");
});

test("a teacher's name can be turned round, however many names there are", () => {
  /* A school writes a register family name first. Nobody says a name that way
     out loud. Only the first word moves: a person can have more than one given
     name, and the family name is the one at the front. */
  run(`state = defaults(); state.teacherNameOrder = "first";`);
  const turned = (text) => json(`teacherName(${JSON.stringify(text)})`);

  assert.equal(turned("Kask Mari"), "Mari Kask");
  assert.equal(turned("Kask Mari Liis"), "Mari Liis Kask", "a second given name moved");
  assert.equal(turned("MargeL"), "MargeL", "a one-word name was taken apart");
  assert.equal(turned(""), "");

  /* One entry can hold several people, and which separator a school uses is
     not consistent. Each name turns round on its own; the list comes back
     with the separators it went in with. */
  assert.equal(turned("Kask Mari / Tamm Jaan"), "Mari Kask / Jaan Tamm");
  assert.equal(turned("Kask Mari, Tamm Jaan"), "Mari Kask, Jaan Tamm");
  assert.equal(turned("Kask Mari; Tamm Jaan"), "Mari Kask; Jaan Tamm");
  assert.equal(turned("Kask Mari/Tamm Jaan"), "Mari Kask/Jaan Tamm",
               "a separator with no spaces lost them");
  assert.equal(turned("Kask Mari / Peedu / Tamm Jaan"),
               "Mari Kask / Peedu / Jaan Tamm");

  /* Turned round by default, and the register order is the reader's to put
     back. A school writes a name family-first to file it, not to say it. */
  assert.equal(json(`defaults().teacherNameOrder`), "first");
  assert.equal(json(`defaults().teacherNameStyle`), "full",
               "an abbreviation is how a school fits a name in a cell");
  run(`state.teacherNameOrder = "last";`);
  assert.equal(turned("Kask Mari / Tamm Jaan"), "Kask Mari / Tamm Jaan");
  run(`state = defaults();`);
});

test("the name order reaches the boxes and the tooltip", () => {
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8";
       state.teacherNameStyle = "full"; state.teacherNameOrder = "last";`);
  const draw = () => run(`renderTimeline(currentSchool(), currentClass(),
                                         currentClass().e, [], 0)`);
  const before = draw();
  assert.match(before, /Mari Tamm/, "the harness teacher is not written as expected");

  run(`state.teacherNameOrder = "first";`);
  const after = draw();
  assert.match(after, /Tamm Mari/, "the box kept the register order");
  assert.match(after, /title="[^"]*Tamm Mari/, "the tooltip kept the register order");
  run(`state = defaults();`);
});

test("the address in the corner stays when the code goes", () => {
  /* The code is off until a reader asks for it. The address is where anybody
     gets a timetable of their own, so it is not part of that choice.
     (The code itself needs the real encoder, so a browser test draws that.) */
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8";`);
  assert.equal(json(`defaults().showQr`), false, "the code is off to begin with");

  const footer = () => {
    run(`printing = true; renderFooter(currentSchool()); printing = false;`);
    return json(`document.getElementById("foot").innerHTML`);
  };
  run(`state.showQr = true;`);
  assert.match(footer(), /class="brand"/, "no address on the printed sheet");
  run(`state.showQr = false;`);
  assert.match(footer(), /class="brand"/, "the address went with the code");

  // It rides in the settings like the rest.
  assert.equal(json(`normalise({showQr: true}).showQr`), true);
  assert.equal(json(`normalise({}).showQr`), false);
  run(`state = defaults();`);
});

test("the name and the clock are asked for larger than the rest", () => {
  /* The two things a reader is looking for. The line of room and teacher is
     there to be checked rather than read, and stays the size it was. */
  run(`state = defaults();`);
  assert.equal(json(`askedGrow("name")`), 1.5);
  assert.equal(json(`askedGrow("time")`), 1.25);
  assert.equal(json(`askedGrow("detail")`), 1);

  // And the reader's own choice is a percentage of the page's own size.
  run(`state.nameSize = "150";`);
  assert.equal(json(`askedGrow("name")`), 1.5);
  run(`state.nameSize = "90";`);
  assert.equal(json(`askedGrow("name")`), 0.9);
  run(`state = defaults();`);
});

test("a box gives back what it has no room for", () => {
  /* A box gives its content its own height less the border and the padding,
     and every line costs its size times its leading. The page's own sizes fit
     by construction, so the only question is how far towards the asked size a
     box can go. Nothing is ever drawn smaller than it was before the setting
     existed. */
  run(`state = defaults(); state.nameSize = "150";`);
  const room = (height, cls, lines) =>
    json(`growRoom(${height}, ${JSON.stringify(cls)}, ${JSON.stringify(lines)})`);

  // Plenty of height: all of it.
  assert.equal(room(200, "", ["time", "name", "detail"]), 1);
  // None at all: the page's own sizes, and never less.
  assert.equal(room(20, "", ["time", "name", "detail"]), 0);
  // In between: some of it, and never outside nought and one.
  run(`state.timeSize = "100"; state.detailSize = "100";`);
  const part = room(48, " snug", ["time", "name", "detail"]);
  assert.ok(part > 0 && part < 1, "expected part of the growth, got " + part);

  /* Asking for smaller always fits, whatever the box. */
  run(`state.nameSize = "90"; state.timeSize = "90"; state.detailSize = "90";`);
  assert.equal(room(20, "", ["time", "name", "detail"]), 1);

  // What a box carries is the asked size scaled by what it could take.
  run(`state = defaults(); state.nameSize = "150";`);
  const wide = json(`growStyle(200, "", ["time", "name", "detail"])`);
  assert.match(wide, /--grow-name:1\.5;/);
  assert.match(wide, /--grow-time:1\.25;/, "the clock is asked for larger too");
  assert.match(wide, /--grow-detail:1;/, "the quiet line was grown");
  const tight = json(`growStyle(20, "", ["time", "name", "detail"])`);
  assert.match(tight, /--grow-name:1;/, "a full box was still grown");
  run(`state = defaults();`);
});

test("the page's own sizes are what a box falls back to", () => {
  /* The floor is not a guess. It is the size each line has always been, which
     is why every box fits today. */
  assert.deepEqual(json(`baseSizes("")`), { time: 10, name: 12, detail: 10.5 });
  assert.deepEqual(json(`baseSizes(" tight")`),
                   { time: 10, name: 11, detail: 10.5 });
});

test("a typeface is one of the three every machine has", () => {
  /* Nothing is fetched. A page that asks for a font from somewhere else is a
     page that does not open on a train. */
  run(`state = defaults();`);
  const stacks = json(`FACE_STACK`);
  assert.deepEqual(Object.keys(stacks).sort(), json(`FACES`).slice().sort());
  for (const [name, stack] of Object.entries(stacks)) {
    assert.ok(!/https?:|url\(|@import/.test(stack),
              `${name} reaches outside the page: ${stack}`);
  }

  /* And no "automatic" among them. It would resolve to the page's own font,
     which is the first of the three, so it would be a fourth entry that draws
     exactly like one of the other three — a choice that is not one. The page's
     own is simply the one selected. */
  assert.ok(!json(`FACES`).includes("auto"), "a choice that is not a choice");
  assert.equal(json(`defaults().nameFace`), "sans");
  assert.ok(!json(`SIZES`).includes("auto"), "the same for the size");
  assert.ok(json(`SIZES`).includes(json(`defaults().nameSize`)),
            "the size the page chooses is not on the list it offers");
  assert.ok(json(`SIZES`).includes(json(`defaults().timeSize`)));

  // A face this page does not know is refused rather than written out.
  assert.equal(json(`normalise({nameFace: "Comic Sans"}).nameFace`), "sans");
  assert.equal(json(`normalise({nameSize: "900"}).nameSize`), "150");
  assert.equal(json(`normalise({nameFace: "serif"}).nameFace`), "serif");
  /* A link written before this list lost its "automatic" still opens, and on
     the same typeface it drew then. */
  assert.equal(json(`normalise({nameFace: "auto"}).nameFace`), "sans");
  assert.equal(json(`normalise({nameSize: "auto"}).nameSize`), "150");
});

test("the tear is drawn the width of the strip it tears", () => {
  /* The strip's width lives in the stylesheet and the tear is drawn in the
     page's own script. A tear narrower than the strip leaves a sliver of it
     standing; a wider one spills into the first day. */
  const css = readFileSync(join(root, "tt.py"), "utf8");
  /* The strip shrinks with the sheet, so the stylesheet says a floor and a
     full-size width. The tear is drawn to the full-size one and stretched with
     the strip by the viewBox, so that is the number the script has to match. */
  const said = /--gut:[^;]*?calc\((\d+)px \* var\(--sheetscale/.exec(css);
  assert.ok(said, "the stylesheet no longer says how wide the strip is");
  assert.equal(json(`GUTTER`), Number(said[1]),
               "the strip and the tear across it are different widths");

  // And the strip is really there to be torn.
  assert.match(css, /\.tlbody \{[^}]*var\(--panel\) 0 var\(--gut\)/s,
               "the clock has no strip, so a tear in it says nothing");
});

test("the link on its own keeps other classes but not this one's leftovers", () => {
  /* What the person who sent it sees. Every display setting is the link's, and
     one it does not carry goes back to what the page opens with rather than to
     whatever this browser had. The class it is about is the link's too, name
     and events and all — mixing one child's after-school events into another
     child's week is not a merge. Every other class is left alone. */
  run(`state = defaults(); state.school = "68"; state.class = "8";
       state.showRoom = false; state.showGroup = false;
       state.classes = {
         "68/8": { studentName: "Mine", studyGroups: {}, schoolName: "",
                   className: "", events: [] },
         "68/7": { studentName: "Sibling", studyGroups: {}, schoolName: "",
                   className: "", events: [] } };`);
  const sent = { class: "8", showRoom: true,
                 classes: { "68/8": { studentName: "Theirs" } } };
  const theirs = json(`linkOnly(${JSON.stringify(sent)}, state)`);

  assert.equal(theirs.showRoom, true, "the link's setting was not taken");
  assert.equal(theirs.showGroup, true, "a setting the link is silent on kept mine");
  assert.equal(theirs.classes["68/8"].studentName, "Theirs",
               "the class the link is about is not the link's");
  assert.equal(theirs.classes["68/7"].studentName, "Sibling",
               "a link for one child threw away a sibling's setup");

  // Merge is the other answer: the link's where it speaks, mine where it does not.
  const merged = json(`applyShared(${JSON.stringify(sent)}, state)`);
  assert.equal(merged.showRoom, true);
  assert.equal(merged.showGroup, false, "merge did not keep mine");
  run(`state = defaults();`);
});

test("only what the link names counts as a disagreement", () => {
  /* Storage keeps every setting, including the ones that were the page's own
     answer on the day they were saved. So the moment a default moves, no
     stored copy can match a link again — and a reader opening their own
     bookmark a month later would be asked about a setting neither they nor the
     sender ever chose. Only what the link says is compared. */
  const asks = (mine, sent) => json(`(function () {
    state = defaults();
    ${mine}
    var theirs = linkOnly(${JSON.stringify(sent)}, state);
    return linkDisagrees(${JSON.stringify(sent)}, state, theirs);
  })()`);

  /* The class the harness carries. It has to be a real one: the per-class bag
     is filed under the class on screen, and asking for one that is not there
     files it somewhere else. */
  const here = `state.school = "68"; state.class = "8";`;

  // Quiet: the link says nothing this browser does not already say.
  assert.equal(asks(here + `state.nameSize = "115";`, { class: "8" }), false,
               "a default that moved since was called a disagreement");
  assert.equal(asks(here, { class: "8" }), false, "the same link asked again");
  /* Both sides holding the same value is nothing to choose between, and why
     either of them holds it never comes into it. One may have chosen it and
     the other inherited it from a default that has since moved; the value is
     the same either way, so there is no question to ask. */
  assert.equal(asks(here + `state.nameSize = "125";`,
                    { class: "8", nameSize: "125" }), false,
               "the same value on both sides was called a disagreement");
  assert.equal(asks(here + `state.nameSize = "115";`,
                    { class: "8", nameSize: "115" }), false,
               "a value that used to be a default, agreed on by both");
  // Different values are a real difference, whatever put them there.
  assert.equal(asks(here + `state.nameSize = "115";`,
                    { class: "8", nameSize: "150" }), true,
               "the reader would have seen their type change size in silence");
  assert.equal(asks(here + `state.subjects = {Ajalugu: {label: "X"}};`,
                    { class: "8" }), false,
               "a colour of my own the link never mentions");
  assert.equal(asks(here + `myOwn().studentName = "Karen";
                            myOwn().events = [{day: "Mon", startTime: "16:00",
                              endTime: "17:00", label: "K",
                              backgroundColor: "#DDDDDD"}];`,
                    { class: "8", classes: { "68/8": { studentName: "Karen" } } }),
               false, "my own events, which the link never mentions");

  // Asked: the link and this browser both say something, and it is not the same.
  assert.equal(asks(here, { class: "7" }), true,
               "a link for another class went through in silence");
  assert.equal(asks(here + `state.subjects = {Matemaatika: {label: "MINE"}};`,
                    { class: "8", subjects: { Matemaatika: { label: "THEIRS" } } }),
               true, "two names for one subject");
  assert.equal(asks(here + `myOwn().studentName = "Karen";`,
                    { class: "8", classes: { "68/8": { studentName: "Kaarel" } } }),
               true, "two children in one class");
  assert.equal(asks(here, { class: "8", showRoom: false }), true,
               "a switch the link turns off and this browser has on");
  run(`state = defaults();`);
});

test("a link and a browser that disagree are put to the reader", () => {
  /* Two answers and no way to tell which was meant. The link's is shown, and
     nothing of the reader's is written down until they say. */
  const source = readFileSync(join(root, "page.js"), "utf8");
  const block = source.slice(source.indexOf("const shared = readUrl();"),
                             source.indexOf("----- the address bar carries"));
  assert.match(block, /clash = \{ mine: stash, theirs: theirs, merged: merged \}/,
               "the two answers are not kept for the reader to pick from");
  /* The save is inside the branch where there is nothing to ask, and only
     there: saving first is what would make "keep mine" impossible. */
  const asked = block.slice(block.indexOf("if (stash && linkDisagrees("));
  assert.ok(!asked.slice(0, asked.indexOf("} else {")).includes("localStorage.setItem"),
            "the reader's own settings were written over before they answered");
  assert.match(asked, /\} else \{[\s\S]*localStorage\.setItem/,
               "an agreeing link is no longer saved");

  // And the question is asked in the language the reader was reading in.
  assert.match(block, /lang: stash\.lang/,
               "the question would be asked in whatever the link says");
});

test("a link says which class it is about, and an old one still can", () => {
  /* Which class the page opens on comes out of the school's own timetable, and
     it moves when the school moves one. A link written without a class of its
     own then showed a different week than the one that was shared. */
  run(`state = defaults(); state.school = "68"; state.class = "8";
       myOwn().studentName = "Eva";`);
  const carried = json(`JSON.parse(unpackSettings(shareUrl().split("#")[1]))`);
  assert.equal(carried.class, "8", "the link does not say which class");
  assert.equal(carried.school, "68");

  // A page with nothing chosen still has a clean address: no week to promise.
  run(`state = defaults();`);
  assert.ok(!json(`shareUrl()`).includes("#"), "an untouched page grew a link");

  /* And a link written before that: no class, but one per-class bag, which
     names the class it is about. */
  const old = { teacherNameStyle: "full",
                classes: { "68/8": { studentName: "Eva" } } };
  run(`state = defaults(); state.school = "68"; state.class = "7";`);
  const back = json(`applyShared(${JSON.stringify(old)}, state)`);
  assert.equal(back.class, "8", "an old link showed the wrong class");
  assert.equal(back.school, "68");
  assert.equal(back.classes["68/8"].studentName, "Eva");

  // A link that does say which class is never second-guessed.
  const said = json(`applyShared(${JSON.stringify(
    { class: "7", classes: { "68/8": { studentName: "Eva" } } })}, state)`);
  assert.equal(said.class, "7", "a link that named a class was overruled");

  /* Nor is one naming a class this page does not carry: the school it came
     from is not this one, and switching to nothing draws nothing. */
  const elsewhere = json(`applyShared(${JSON.stringify(
    { classes: { "99/nope": { studentName: "Eva" } } })}, state)`);
  assert.equal(elsewhere.class, "7");
  assert.equal(elsewhere.school, "68");

  // Two classes is not one class, so there is nothing to infer.
  const both = json(`applyShared(${JSON.stringify(
    { classes: { "68/8": { studentName: "A" }, "68/9": { studentName: "B" } } })}, state)`);
  assert.equal(both.class, "7");
  run(`state = defaults();`);
});

test("a class key splits on the school, not on the class name", () => {
  /* A school number never holds a slash. A class name can. */
  assert.deepEqual(json(`splitClassKey("68/8")`), ["68", "8"]);
  assert.deepEqual(json(`splitClassKey("105/Maarja / Silva")`),
                   ["105", "Maarja / Silva"]);
  assert.deepEqual(json(`splitClassKey("nothing")`), ["nothing", ""]);
});

test("the settings box follows the settings", () => {
  /* It used to be filled once, when the panel was opened, and went stale under
     every control touched afterwards. Not only a stale display: Apply reads
     from this box, so pressing it put the older settings back — the button
     undid the change instead of keeping it. */
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8";
       document.getElementById("advancedPanel").open = true;
       render();`);
  const shown = () => JSON.parse(json(`document.getElementById("settingsText").value`));
  assert.equal(shown().subjectColorStyle, json(`defaults().subjectColorStyle`));

  run(`state.subjectColorStyle = "palette"; render();`);
  assert.equal(shown().subjectColorStyle, "palette", "the box went stale");
  assert.deepEqual(shown(), json(`slim(state)`), "the box is not what is stored");

  // A closed panel is not written to: there is nothing there to read.
  const closed = json(`document.getElementById("settingsText").value`);
  run(`document.getElementById("advancedPanel").open = false;
       state.showRoom = false; render();`);
  assert.equal(json(`document.getElementById("settingsText").value`), closed,
               "a closed panel was rewritten");

  /* And not while somebody is typing into it. A reader pasting a backup is
     mid-edit, and the box is where the paste lands. */
  run(`document.getElementById("advancedPanel").open = true; render();
       document.activeElement = document.getElementById("settingsText");
       document.getElementById("settingsText").value = "half a paste";
       state.showGroup = false; render();`);
  assert.equal(json(`document.getElementById("settingsText").value`), "half a paste",
               "a paste in progress was overwritten");

  /* Opening the panel fills it whatever is in there, since a half-typed paste
     is not something the reader can be in the middle of before it is open.
     That is what the toggle listener does, in one line. */
  run(`refreshSettingsBox(true);`);
  assert.equal(shown().showGroup, false,
               "opening the panel showed the old state");
  assert.deepEqual(shown(), json(`slim(state)`));
  run(`document.activeElement = null; state = defaults();`);
});

test("pasted settings are taken, or refused with a reason", () => {
  /* The one place a whole state arrives at once, and the one place a bad value
     could take the page down with it. It is typed or pasted by whoever has the
     page open, so it is untrusted like a link is. */
  run(`state = defaults(); state.lang = "en"; applyStrings();`);
  const apply = (text) => json(`applySettingsText(${JSON.stringify(text)})`);

  assert.match(apply("{not json"), /JSON|json/i, "bad JSON said nothing useful");
  assert.equal(apply("[1, 2]"), json(`t("settings.notObject")`), "a list was taken");
  assert.equal(apply("null"), json(`t("settings.notObject")`), "null was taken");
  assert.equal(apply('"a string"'), json(`t("settings.notObject")`));
  // And the page is still standing after each of them.
  assert.equal(json(`state.school`), json(`DATA.initialSchool`));

  assert.equal(apply('{"showRoom": false}'), json(`t("settings.applied")`));
  assert.equal(json(`state.showRoom`), false);

  /* A school or a class this page does not carry — an older link, or another
     school's file — would otherwise leave it with nothing at all to draw. */
  apply('{"school": "no such school", "class": "no such class"}');
  assert.equal(json(`state.school`), json(`DATA.initialSchool`));
  assert.equal(json(`state.class`), json(`currentSchool().c[0].n`));
  assert.ok(json(`currentClass()`), "the page was left with nothing to draw");
  run(`state = defaults();`);
});

test("a reset keeps the reader where they are", () => {
  /* Clearing the colours is not a request to be sent to another class. This
     used to read `klass` off the state, which has no such key — the state
     calls it `class` — so a reset dropped the reader back to the class the
     page opens on. */
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8";
       state.showRoom = false; state.subjects = { Matemaatika: { hide: true } };
       myOwn().studentName = "Eva";`);
  const shown = json(`resetSettings()`);

  assert.equal(json(`state.class`), "8", "the reset moved the reader");
  assert.equal(json(`state.school`), "68");
  assert.equal(json(`state.lang`), "en", "the reset changed the language");
  assert.equal(json(`state.showRoom`), true, "a display setting survived");
  assert.deepEqual(json(`state.subjects`), {}, "a hidden subject survived");
  assert.equal(json(`myOwn().studentName`), "", "the child's name survived");
  assert.ok(!("klass" in JSON.parse(shown)), "an undefined klass was written down");

  /* And the box beside the button shows what is now stored, not what was
     cleared — a press of Apply there would put all of it back otherwise. */
  assert.deepEqual(JSON.parse(shown), json(`slim(state)`));
  run(`state = defaults();`);
});

test("one control in an event row writes to one field of the event", () => {
  /* A table rather than a chain of branches, so a control added to the row
     with no field behind it shows up as a missing entry rather than as a
     control that quietly does nothing. */
  run(`state = defaults(); state.school = "68"; state.class = "8";
       myOwn().events = [{day: "Mon", startTime: "17:15", endTime: "18:15",
                          label: "Dance", backgroundColor: "#F6F2C1"}];`);
  assert.equal(json(`eventFieldFor("evstart")`), "startTime");
  assert.equal(json(`eventFieldFor("evend")`), "endTime");
  assert.equal(json(`eventFieldFor("evlabel")`), "label");
  assert.equal(json(`eventFieldFor("evday")`), "day");
  // Real markup carries more than one class on a control.
  assert.equal(json(`eventFieldFor("wide evlabel typed")`), "label");
  // And a control that writes to nothing says so rather than guessing.
  assert.equal(json(`eventFieldFor("bgpick")`), "");
  assert.equal(json(`eventFieldFor("")`), "");

  run(`editEvent(0, function (ev) { ev.label = "Karate"; })`);
  assert.equal(json(`myOwn().events[0].label`), "Karate");
  // A row number with no event behind it is a no-op, not a crash.
  assert.equal(json(`editEvent(9, function (ev) { ev.label = "x"; })`), null);
  assert.equal(json(`myOwn().events.length`), 1);
  run(`state = defaults(); myOwn().events = [];`);
});

test("a subject the reader does not take can be switched off", () => {
  /* Not every subject in a timetable is every child's: a choir sits in the
     class's week and in nobody else's afternoon. */
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8"; render();`);
  const day = () => json(`document.getElementById("grid").innerHTML`);
  assert.ok(day().includes("Matemaatika"), "nothing to switch off");

  run(`setSubjectShown("Matemaatika", false);`);
  assert.ok(!day().includes(">Matemaatika<"), "the subject is still drawn");

  // Its row stays, unticked, or there is no way back.
  const rows = json(`document.getElementById("legend").innerHTML`);
  const row = rows.slice(rows.indexOf('data-subject="Matemaatika"'));
  assert.ok(row.includes("subjshow"), "no switch on the row");
  assert.ok(!row.slice(0, 200).includes("checked"), "the switch is still on");
  assert.ok(rows.includes('data-subject="Matemaatika"'), "the row went with it");

  /* It rides in the settings, so a shared link carries it — which means
     surviving the reader that guards against a hand-edited file. Written down
     and read straight back is what a shared link does. */
  assert.equal(json(`state.subjects["Matemaatika"].hide`), true);
  assert.deepEqual(json(`normalise(JSON.parse(JSON.stringify(slim(state)))).subjects`),
                   { Matemaatika: { hide: true } });
  assert.deepEqual(json(`onlySubjects({ A: { hide: false }, B: { hide: "yes" } })`), {},
                   "anything but true was kept");
  run(`setSubjectShown("Matemaatika", true);`);
  assert.ok(day().includes("Matemaatika"), "switching it back on did nothing");
  assert.equal(json(`Object.keys(state.subjects)`).length, 0,
               "an entry that says nothing was kept");
  run(`state = defaults();`);
});

test("a sample looks like the thing it stands for", () => {
  /* Three kinds of row, three ways the day draws them. A sample that shows a
     hatched two-line box for something the day draws as a dashed one-liner is
     worth less than no sample. */
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8";
       renderLegend(currentClass().e.filter(function (e) { return !e.c; }));`);
  const row = (name) => {
    const html = json(`document.getElementById("legend").innerHTML`);
    const at = html.indexOf('data-subject="' + name + '"');
    return at < 0 ? "" : html.slice(at, at + 1400);
  };
  assert.match(row("gap"), /class="ev gap"/, "the gap sample is not drawn as a gap");
  assert.match(row("gap"), /Break . 45 min/, "the gap sample lost its length");
  assert.ok(!/class="ev gap"/.test(row("Matemaatika")), "a lesson drawn as a gap");
  assert.match(row("Break, and more"), /class="ev brk"/, "a break lost its hatch");
});

test("the hatch carries no transparency onto the paper", () => {
  /* A printer turned the translucent half of the hatch into solid black — on
     paper only, never in a PDF. So both stripes are mixed here and written
     out opaque, and nothing is left for a driver to composite. */
  const style = json(`hatch("#EDEFF2")`);
  assert.ok(!/rgba|transparent/i.test(style), "alpha went out to the printer");
  // The same two colors the translucent pair used to composite to.
  assert.match(style, /#f8f9fa/i);
  assert.match(style, /#f1f3f5/i);

  // Mixed against whatever color the band carries, not against one fixed grey.
  const dark = json(`hatch("#2e7d32")`);
  assert.ok(!/rgba/i.test(dark));
  assert.notEqual(dark, style, "a recolored band got the default hatch");

  // A band drawn in the day says so on the box, not in the stylesheet.
  run(`state = defaults(); state.school = "68"; state.class = "8";`);
  const html = run(`renderTimeline(currentSchool(), currentClass(),
                                   currentClass().e, [], 0)`);
  const band = html.split('class="ev brk')[1].slice(0, 400);
  assert.match(band, /repeating-linear-gradient/, "the band has no hatch of its own");
});

test("an hour where nothing happens is cut out of the axis", () => {
  /* An evening event otherwise pushes the whole afternoon off the screen, and
     the emptiness it pushes it with says nothing. So the empty stretch is
     drawn short and marked, and everything with something in it keeps the
     scale it had. */
  run(`state = defaults(); state.lang = "en"; applyStrings();
       state.school = "68"; state.class = "8"; myOwn().events = [];`);
  const draw = () => run(`renderTimeline(currentSchool(), currentClass(),
                                         currentClass().e, readEvents(myOwn().events).events, 0)`);
  const boxHeight = (html, name) => {
    const at = html.indexOf(">" + name + "<");
    const box = html.lastIndexOf("height:", at);
    return Number(/height:([\d.]+)px/.exec(html.slice(box))[1]);
  };
  const bodyHeight = (html) => Number(/class="tlbody" style="height:(\d+)px/.exec(html)[1]);

  const plain = draw();
  assert.ok(!plain.includes("tlbreak"), "a school day with no holes was cut");
  const lesson = boxHeight(plain, "Matemaatika");

  run(`myOwn().events = [{day: "Mon", startTime: "18:00", endTime: "19:00",
                          label: "Training", backgroundColor: "#00ff00"}];`);
  const late = draw();
  assert.equal(late.split('class="tlbreak"').length - 1, 1, "no cut for the empty evening");

  /* The clock strip is torn across, and the two edges left behind match the
     way the two halves of a torn sheet do. Drawn as two unrelated wiggles it
     reads as decoration rather than as one piece lifted out. */
  const edges = [...late.matchAll(/class="edge" d="M([^"]*)"/g)].map(m => m[1]);
  assert.equal(edges.length, 2, "a tear with one edge");
  const ys = (edge) => edge.split("L").map(p => Number(p.split(" ")[1]));
  const [top, bottom] = edges.map(ys);
  assert.equal(top.length, bottom.length);
  const drop = bottom[0] - top[0];
  assert.ok(drop > 0, "the second edge is not below the first");
  for (let i = 0; i < top.length; i++) {
    assert.ok(Math.abs((bottom[i] - top[i]) - drop) < 0.01,
              "the two edges of the tear do not match at point " + i);
  }
  // And the piece lifted out is filled with the page, so the strip is missing.
  assert.match(late, /class="gap" d="M/);

  /* The lesson is the same height it was, and the event is drawn to the same
     scale: eighty minutes and sixty minutes, at the same pixels per minute. */
  assert.equal(boxHeight(late, "Matemaatika"), lesson, "a lesson was squeezed");
  const perMinute = (px, minutes) => Math.round((px / minutes) * 10) / 10;
  assert.equal(perMinute(boxHeight(late, "Training"), 60),
               perMinute(lesson, 80), "the event lost its scale");

  /* And the cut is worth having: the empty stretch costs a fraction of what it
     would, so the sheet grows by far less than the hours added to it. */
  const grew = bodyHeight(late) - bodyHeight(plain);
  assert.ok(grew > 0 && grew < 200, "the evening cost " + grew + "px");
  run(`state = defaults(); myOwn().events = [];`);
});

test("a short break keeps its clock, on one line", () => {
  /* A twenty-minute band has room for one line. Stacked, the clock was simply
     dropped — and the times either side of a break are the one thing a reader
     cannot work out from the lessons around it. ProTERA's Amps is twenty
     minutes; a SädeTERA Tuesday lunch is twenty-five. */
  run(`state.school = "68"; state.class = "8"; state.subjects = {};`);
  const html = run(`renderTimeline(currentSchool(), currentClass(),
                                   currentClass().e, [], 0)`);
  const band = html.split('class="ev brk')[1] || "";
  assert.ok(band.includes("oneline"), "the band stacked its two lines");
  /* The harness band is ten minutes, the shortest anything is written in.
     There the padding is the difference between a line and a cut line. */
  assert.match(band, /^ tiny/, "a ten-minute band kept its padding");
  assert.ok(band.includes("Break"), "no name on the band");
  assert.ok(/10\.20.10\.30/.test(band), "no clock on the band: " + band.slice(0, 160));
});

test("the breaks come last, under a heading of their own", () => {
  /* A gap is a different kind of thing from a lesson, so the two do not read
     as one list. The harness break is named with a comma, which is how a
     school writes a list of what the gap is for. */
  run(`state.subjects = {}; state.school = "68"; state.class = "8";
       renderLegend(currentClass().e);`);
  const html = json(`document.getElementById("legend").innerHTML`);
  const rows = html.split("<tr").slice(1);
  const subjectOf = (row) => (/data-subject="([^"]*)"/.exec(row) || [])[1];

  const heads = rows.filter(r => r.includes("grouphead"));
  assert.equal(heads.length, 1, "one heading, above the first break");

  const names = rows.map(subjectOf);
  const breakAt = names.indexOf("Break, and more");
  assert.ok(breakAt >= 0, "the break has a row");
  assert.ok(rows[breakAt - 1].includes("grouphead"), "the heading sits above it");
  /* The day runs the long break first and the snack after it. Sorted by name
     the snack would come first, which is not how anybody reads a day. */
  /* The gap the page works out for itself comes after the school's own, and
     is listed like them so it can be renamed and recolored. */
  assert.deepEqual(names.slice(breakAt), ["Break, and more", "Amps", "gap"]);
  // Everything before the heading is a lesson.
  for (const row of rows.slice(0, breakAt - 1)) {
    assert.ok(subjectOf(row), "a row with no subject before the heading");
  }
});
