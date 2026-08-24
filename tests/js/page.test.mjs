/* The page's own logic, run outside a browser. See harness.mjs for what a
   browser provides and what is stubbed in its place. */
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const run = load();
const json = (expression) => JSON.parse(run(`JSON.stringify(${expression})`));

test("a colour token splits into text and background", () => {
  assert.deepEqual(json(`splitColours("#333/#ddd")`), ["#333", "#ddd"]);
  assert.deepEqual(json(`splitColours("orange")`), [null, "orange"]);
  // The slash inside a colour function is part of the colour, not a separator.
  assert.deepEqual(json(`splitColours("rgb(0,0,0/50%)")`), [null, "rgb(0,0,0/50%)"]);
});

test("an event line is read into a day, a span, a colour and a label", () => {
  const parsed = json(`parseEvents("Mon 17:15-18:15 orange Dance training")`);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.events[0],
    { day: 0, a: 1035, z: 1095, fg: null, bg: "orange", label: "Dance training", mine: true });
});

test("weekdays are accepted in either language, long or short", () => {
  for (const [token, day] of [["Mon", 0], ["esmaspäev", 0], ["E", 0], ["T", 1],
                              ["teisipäev", 1], ["K", 2], ["wed", 2], ["N", 3],
                              ["R", 4], ["reede", 4], ["L", 5], ["P", 6]]) {
    const parsed = json(`parseEvents(${JSON.stringify(token + " 9:00-10:00 red X")})`);
    assert.equal(parsed.errors.length, 0, `${token} was not understood`);
    assert.equal(parsed.events[0].day, day, `${token} landed on the wrong day`);
  }
});

test("a line that cannot be read is reported, not dropped in silence", () => {
  for (const line of ["xxx 9:00-10:00 red X", "Mon 25:00-26:00 red X",
                      "Mon 18:00-17:00 red X", "Mon 9:00-10:00 notacolour X",
                      "gibberish"]) {
    const parsed = json(`parseEvents(${JSON.stringify(line)})`);
    assert.equal(parsed.events.length, 0, line);
    assert.equal(parsed.errors.length, 1, line);
  }
});

test("blank lines and comments are ignored", () => {
  const parsed = json(`parseEvents("\\n# a note\\nMon 9:00-10:00 red X\\n")`);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.events.length, 1);
});

test("only something that is plainly a colour can be stored as one", () => {
  assert.deepEqual(json(`onlyColours({a: "#fff", b: "#AABBCC", c: "#12345678"})`),
                   { a: "#fff", b: "#AABBCC", c: "#12345678" });
  // A share link is not a way to write markup into the page.
  assert.deepEqual(json(`onlyColours({a: 'x"><img src=x onerror=alert(1)>', b: "red", c: 5})`), {});
  // Nor by hiding a real colour inside something longer: the whole value has
  // to be the colour, not merely contain one.
  assert.deepEqual(json(`onlyColours({a: '#fff"><img src=x onerror=alert(1)>',
                                      b: 'url(#abc)', c: '#1234567', d: '#12'})`), {});
  // Stray spaces around one are just typing, and come off.
  assert.deepEqual(json(`onlyColours({a: "  #fff  "})`), { a: "#fff" });
});

test("the counter is told the school's own name, never the reader's", () => {
  // What a parent types is exactly what must not go out.
  run(`state.who = {}; state.titleSchool = {}; state.titleClass = {};
       state.who[picksKey()] = "Mari Maasikas";
       state.titleSchool[picksKey()] = "Mari's school";
       state.titleClass[picksKey()] = "Mari's class";
       state.showWho = true;
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
     result. state.colors is written to directly on purpose: normalise and
     onlyColours keep it clean in real use, and esc() is what stands behind
     them if they ever stop. */
  const bad = 'x"><img src=x onerror=alert(1)>';
  const q = JSON.stringify(bad);
  for (const [school, klass] of [["68", "8"], ["99", "3.a"]]) {
    run(`state.school = ${JSON.stringify(school)}; state.klass = ${JSON.stringify(klass)};
         state.customColours = true;
         state.colors = {Matemaatika: ${q}, Kunst: ${q}};
         state.who = {}; state.who[picksKey()] = ${q};
         state.titleSchool = {}; state.titleSchool[picksKey()] = ${q};
         state.titleClass = {}; state.titleClass[picksKey()] = ${q};
         state.events = {};
         /* One long, one short: a short box draws its time and label together
            through a different line than a tall one. */
         state.events[picksKey()] = "Mon 9:00-10:00 red " + ${q} +
                                    "\\nMon 11:00-11:10 blue " + ${q};
         state.showWho = true; state.showSchool = true; state.showClass = true;
         printing = false; render(); renderLegend(currentClass().e);`);
    for (const id of ["grid", "foot", "subtitle", "legend"]) {
      const html = json(`(document.getElementById(${JSON.stringify(id)}).innerHTML || "")`);
      assert.doesNotMatch(html, /<img/, `${id} in school ${school} took markup`);
    }
    /* document.title is not markup — a browser shows it as text — so it is
       deliberately not escaped and not checked here. */
  }
  run(`state.school = "68"; state.klass = "8"; state.colors = {};
       state.who = {}; state.titleSchool = {}; state.titleClass = {};
       state.events = {}; state.showWho = false; state.customColours = false;
       render();`);
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
    state.school = s.n; state.klass = c.n; printing = false;
    renderSchools(); renderClasses(); renderDivisions(); render();
    return ["grid", "divisions", "school", "klass", "subtitle", "foot"]
      .map(id => document.getElementById(id).innerHTML || "").join("|||");
  })()`);
  assert.doesNotMatch(kept, /<img/, "the school's own text reached the page as markup");
  assert.match(kept, /&lt;img/, "and it is there, escaped");
  run(`(() => {
    const s = DATA.schools[${which}], saved = JSON.parse(globalThis.saved);
    [s.l, s.t, s.v, s.d, s.p, s.c[0].v, s.c[0].h, s.c[0].n] = saved;
    state.klass = s.c[0].n;
    s.ts = false;
    renderSchools(); renderClasses(); renderDivisions(); render();
  })()`);
 }
 run(`state.school = "68"; state.klass = "8"; renderClasses(); renderDivisions(); render();`);
});

test("the fallback grid escapes everything it draws", () => {
  /* Two of the four real schools have no times and get this view, and none of
     it had ever been executed by a test — every esc() in it could be deleted
     unnoticed. Drive it with markup in each thing it renders. */
  const bad = 'x"><img src=x onerror=alert(1)>';
  run(`state.school = "99"; state.klass = "3.a";
       state.customColours = true; state.colors = {Matemaatika: ${JSON.stringify(bad)}};
       state.events = {}; state.events[picksKey()] = "Mon 9:00-10:00 red " + ${JSON.stringify(bad)};
       state.who = {}; state.who[picksKey()] = ${JSON.stringify(bad)};
       state.showWho = true; printing = false; render();`);
  const html = json(`document.getElementById("grid").innerHTML`);
  assert.ok(html.includes("<table"), "the grid view really did render");
  assert.doesNotMatch(html, /<img/, "markup reached the page unescaped");
  assert.match(html, /&lt;img|&amp;lt;img/, "the payload is there, escaped");
  run(`state.school = "68"; state.klass = "8"; state.colors = {};
       state.events = {}; state.who = {}; state.showWho = false;
       state.customColours = false; render();`);
});

test("a link is read back exactly as it was written", () => {
  /* shareUrl and readUrl were never called by any test: renaming the fragment
     key in one of them broke every shared link with the suite still green. */
  run(`state.lang = "et"; state.showRoom = false;
       state.who = {}; state.who[picksKey()] = "Mari";`);
  const link = json(`shareUrl()`);
  assert.match(link, /#s=/);
  const readBack = json(`(() => {
      // With the "#", as a browser has it: readUrl slices it off.
      location.hash = "#" + (shareUrl().split("#")[1] || "");
      return readUrl();
    })()`);
  assert.equal(readBack.lang, "et");
  assert.equal(readBack.showRoom, false);
  assert.deepEqual(readBack.who, json(`({[picksKey()]: "Mari"})`));
  run(`state.lang = "en"; state.showRoom = true; state.who = {}; location.hash = "";`);
});

test("a link carries this class and no other", () => {
  run(`state.who = {"68/8": "Mari", "68/7": "Jaan", "99/3.a": "Liis"};
       state.school = "68"; state.klass = "8";`);
  const carried = json(`JSON.parse(unb64url(shareUrl().split("#s=")[1])).who`);
  assert.deepEqual(carried, { "68/8": "Mari" });
  // Emptied fields leave nothing behind at all.
  run(`state.who = {"68/8": "   "};`);
  assert.equal(json(`("who" in changedFromDefaults())`), false);
  run(`state.who = {};`);
});

test("a hostile colour in a link is dropped before it is stored", () => {
  /* Through the real ingestion path, not by calling the filter directly: the
     filter was tested and the call to it was not, so removing the call left
     markup sitting in localStorage with the suite green. */
  const hostile = JSON.stringify({ colors: { Matemaatika: 'x"><img src=x>',
                                             Kunst: "#abc" } });
  const merged = json(`applyShared(JSON.parse(${JSON.stringify(hostile)}), defaults())`);
  assert.deepEqual(merged.colors, { Kunst: "#abc" });
});

test("a link adds to the other classes rather than replacing them", () => {
  const link = JSON.stringify({ who: { "68/8": "Mari" } });
  const merged = json(`applyShared(JSON.parse(${JSON.stringify(link)}),
                                   Object.assign(defaults(), {who: {"68/7": "Jaan"}}))`);
  assert.deepEqual(merged.who, { "68/7": "Jaan", "68/8": "Mari" });
});

test("the address the link uses survives a round trip through base64", () => {
  // The "url" in b64url: + / = have no business in a fragment.
  const encoded = json(`b64url("~~~\u00fc\u00e4>>>???")`);
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.equal(json(`unb64url(${JSON.stringify(encoded)})`), "~~~üä>>>???");
});

test("a short colour is still readable text on top of it", () => {
  // #000 is black; before it was understood, the label came out black on black.
  assert.equal(json(`readable("#000")`), "#FFFFFF");
  assert.equal(json(`readable("#fff")`), json(`readable("#ffffff")`));
  assert.equal(json(`readable("#000f")`), json(`readable("#000000")`));
  assert.equal(json(`readable("#000000ff")`), json(`readable("#000000")`));
  assert.equal(json(`readable("nonsense")`), "#14171A");
});

test("looking at a class does not add an empty note about it to the link", () => {
  run(`state.picks = {}; state.who = {}; state.events = {};
       picks(); perClass("who"); perClass("events");`);
  assert.deepEqual(json(`[state.picks, state.who, state.events]`), [{}, {}, {}]);
  // Choosing something does record it.
  run(`pickable()["7"] = "Alfa";`);
  assert.equal(json(`Object.keys(state.picks).length`), 1);
});

test("settings of the wrong shape fall back to their defaults", () => {
  const got = json(`normalise({lang: "zz", showRoom: "yes", picks: [1, 2],
                               teacherName: "LOUD", subjectName: "short", showGroup: false})`);
  assert.equal(got.lang, "en");
  assert.equal(got.showRoom, true, "a string is not a checkbox");
  assert.deepEqual(got.picks, {}, "an array is not a bag of picks");
  assert.equal(got.teacherName, "short");
  assert.equal(got.subjectName, "short", "a valid value is kept");
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
  assert.equal(run(`visible({g: []}, {d1: "A"}, [{id: "d1", groups: ["A", "B"]}])`),
               true);
});

test("a lesson is mine when every division it belongs to matches a pick", () => {
  const divisions = `[{id: "d1", groups: ["A", "B"]}, {id: "d2", groups: ["X", "Y"]}]`;
  assert.equal(run(`visible({g: []}, {d1: "A"}, ${divisions})`), true,
               "a whole-class lesson is always mine");
  assert.equal(run(`visible({g: ["A"]}, {d1: "A"}, ${divisions})`), true);
  assert.equal(run(`visible({g: ["B"]}, {d1: "A"}, ${divisions})`), false);
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

test("text is black or white, whichever can be read on the colour", () => {
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
  for (const line of ["Mon 9:99-10:00 red X", "Mon 9:00-10:99 red X"]) {
    assert.equal(json(`parseEvents(${JSON.stringify(line)})`).errors.length, 1, line);
  }
});

test("an event with no label is not an event", () => {
  assert.equal(json(`parseEvents("Mon 9:00-10:00 red")`).errors.length, 1);
});

test("a settings bag reaches normalise with its colours filtered", () => {
  const got = json(`normalise({colors: {A: "#fff", B: 'x"><img src=x>'}})`);
  assert.deepEqual(got.colors, { A: "#fff" });
});
