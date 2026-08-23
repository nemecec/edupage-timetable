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
