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

test("a saved event is read into a day, a span, a color and a label", () => {
  const parsed = json(`readEvents([{day: "Mon", startTime: "17:15", endTime: "18:15",
                                    backgroundColor: "#F6F2C1", textColor: "",
                                    label: "Dance training"}])`);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.events[0], { day: 0, a: 1035, z: 1095, fg: null,
                                       bg: "#F6F2C1", label: "Dance training", mine: true });
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
  assert.deepEqual(
    json(`oneEvent({day: "Fri", startTime: "9:00", endTime: "10:00", backgroundColor: "nonsense",
                    textColor: "#123", label: 7})`),
    { day: "Fri", startTime: "09:00", endTime: "10:00", backgroundColor: "#DDDDDD",
      textColor: "#123", label: "" });
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
  assert.equal(got.teacherNameStyle, "short");
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
  const hatched = json(`sampleBox("#123456", "#fff", "9.00–9.45", "Free time", "", true)`);
  const plain = json(`sampleBox("#123456", "#fff", "9.00–9.45", "Maths", "", false)`);
  assert.match(hatched, /class="ev brk"/);
  assert.doesNotMatch(plain, /brk/);
  // The color is named on its own, or the shorthand wipes the stripes out.
  assert.match(hatched, /background-color:#123456/);
  assert.doesNotMatch(hatched, /background:#/);
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
  assert.deepEqual(names.slice(breakAt), ["Break, and more", "Amps"]);
  // Everything before the heading is a lesson.
  for (const row of rows.slice(0, breakAt - 1)) {
    assert.ok(subjectOf(row), "a row with no subject before the heading");
  }
});
