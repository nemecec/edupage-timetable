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
