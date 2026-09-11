/* The daily check, checked.
 *
 * tests/js/live.mjs cannot be run here: it fetches from the school, and the
 * whole point of the fixtures is that this suite does not. So the two things
 * it decides with are exercised on their own — what counts as a page that
 * cannot draw, and what counts as something having moved.
 *
 * The known-good capture is tests/golden: a capture that somebody read and
 * committed, which is the only answer in this repository that is known to be
 * right. A check that never fires is worth nothing, so every rule below is
 * shown failing on one damaged line and passing on the same line left alone.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { goldenDir } from "./render.mjs";
import { differences, firstDifferences, problems } from "./sane.mjs";

/* Read afresh every time, so no test can damage the next one's copy. */
function known() {
  const shot = {};
  for (const file of readdirSync(goldenDir).filter(name => name.endsWith(".json")))
    shot[file.replace(/\.json$/, "")] =
      JSON.parse(readFileSync(join(goldenDir, file), "utf8"));
  return shot;
}

/* Where each number sits in a box's line. */
const TOP = 3, HEIGHT = 4, LEFT = 5, WIDTH = 6, TEXT = 7;

const isBox = (line) => !/^(axis|cut|body|empty|r\d+) \| /.test(line);

/* Damage one class of one school, and say what the checks then make of it. */
function afterDamage(damage) {
  const shot = known();
  const record = Object.values(shot)[0];
  const name = Object.keys(record.classes)[0];
  record.classes[name] = damage(record.classes[name].slice());
  return { found: problems(shot), where: record.school + " " + name };
}

/* Rewrite one field of the first box, leaving everything else alone. */
const bend = (field, value) => (lines) => {
  const at = lines.findIndex(isBox);
  const part = lines[at].split(" | ");
  part[field] = value;
  lines[at] = part.join(" | ");
  return lines;
};

function complainsAbout(damage, pattern) {
  const { found, where } = afterDamage(damage);
  assert.ok(found.length, "nothing was said about " + where);
  assert.match(found.join("\n"), pattern);
  assert.ok(found.every(line => line.startsWith(where.split(" ")[0])) ||
            found.some(line => line.includes(where)),
            "the complaint does not say which class:\n" + found.join("\n"));
}

test("the records this repository holds have nothing wrong with them", () => {
  /* If this ever fails, either the page draws something it should not, or a
     rule below is stricter than the page has ever been. */
  assert.deepEqual(problems(known()), []);
});

test("a box the renderer could not place is named", () => {
  complainsAbout(bend(TOP, "tnull"), /no top/);
  complainsAbout(bend(HEIGHT, "hnull"), /no height/);
  complainsAbout(bend(LEFT, "lnull"), /no left/);
  complainsAbout(bend(WIDTH, "wnull"), /no width/);
});

test("two numbers lost at once are said in one breath", () => {
  const { found } = afterDamage(lines => bend(LEFT, "lnull")(bend(TOP, "tnull")(lines)));
  assert.equal(found.length, 1, "one box, one complaint:\n" + found.join("\n"));
  assert.match(found[0], /no top and no left/);
});

test("a box with no height at all is a box nobody can read", () => {
  complainsAbout(bend(HEIGHT, "h0"), /0px tall/);
  complainsAbout(bend(HEIGHT, "h-40"), /-40px tall/);
  complainsAbout(bend(WIDTH, "w0"), /0% wide/);
});

test("a lesson that hangs off the day is caught at either end", () => {
  complainsAbout(bend(TOP, "t-20"), /starts 20px above the day/);
  complainsAbout(bend(HEIGHT, "h9000"), /past the foot of the day/);
});

test("a lesson wider than the column it is in is caught", () => {
  complainsAbout(bend(WIDTH, "w200"), /across a column that is 100% wide/);
  complainsAbout(bend(LEFT, "l90"), /across a column that is 100% wide/);
  complainsAbout(bend(LEFT, "l-10"), /left of the column/);
});

/* One class, built by hand, so a boundary can be put exactly where it is
   wanted. The records hold no box that sits on one. */
function week(box, body = 600) {
  return { 1: { school: "Test", classes: { "a · full": [
    "axis | t hour | t0 | 9.00", "Monday | ev | Maths | " + box + " | 9.00 Maths",
    "body | h" + body,
  ] } } };
}

test("the give in the edges is exactly one pixel and a fifth of a percent", () => {
  /* Tops, heights and the body are whole pixels and lanes are tenths of a
     percent, all rounded. So a box can read as a pixel past the foot of a day
     it exactly fills, and a lane can read as a tenth past the edge. More than
     that is layout rather than arithmetic. Both sides are pinned here: with no
     give these fire on correct pages, and with too much give they never fire. */
  assert.deepEqual(problems(week("t521 | h80 | l0 | w100", 600)), []);
  assert.match(problems(week("t522 | h80 | l0 | w100", 600)).join("\n"),
               /runs 2px past the foot of the day/);

  assert.deepEqual(problems(week("t0 | h80 | l50 | w50.2")), []);
  assert.match(problems(week("t0 | h80 | l50 | w50.3")).join("\n"),
               /across a column that is 100% wide/);
});

test("rounding is not mistaken for a lesson hanging off the day", () => {
  /* Tops and heights are whole pixels and lanes are tenths of a percent, so a
     rule with no give in it would fire on arithmetic rather than on layout. */
  const one = Object.values(known())[0];
  const lines = one.classes[Object.keys(one.classes)[0]];
  const box = lines.find(isBox).split(" | ");
  const body = Number(lines.find(line => line.startsWith("body")).split("h")[1]);
  assert.deepEqual(afterDamage(bend(TOP, "t" + (body - Number(box[HEIGHT].slice(1))))).found, []);
  assert.deepEqual(afterDamage(bend(WIDTH, "w100.1")).found, []);
});

test("an empty box is caught", () => {
  complainsAbout(bend(TEXT, "  "), /an empty box/);
});

test("a class that draws nothing is caught", () => {
  complainsAbout(() => [], /no lessons drawn/);
  complainsAbout(() => ["empty | "], /drew nothing at all/);
});

test("lessons drawn with no clock beside them are caught", () => {
  complainsAbout(lines => lines.filter(line => !line.startsWith("axis")),
                 /no clock beside them/);
});

test("a school with no classes is caught", () => {
  const shot = known();
  const number = Object.keys(shot)[0];
  shot[number].classes = {};
  assert.match(problems(shot).join("\n"), /not one class/);
});

test("a table has no coordinates and is not asked for any", () => {
  /* A class the school gives no times falls back to a grid. It is not broken,
     and a rule written for boxes must not say that it is. */
  const { found } = afterDamage(() => ["r0 | Monday | Tuesday", "r1 | Maths | Art"]);
  assert.deepEqual(found, []);
});

test("the checks read the lines the records are written in", () => {
  /* The rules above all read a box line apart. If that ever stops working —
     a changed separator, a renamed field — every class looks empty, and this
     says so rather than passing in silence. */
  const shot = known();
  for (const record of Object.values(shot))
    for (const name of Object.keys(record.classes))
      record.classes[name] = record.classes[name].map(line => line.replace(/ \| /g, " ; "));
  const found = problems(shot);
  assert.ok(found.length > 10, "a capture it cannot read passed anyway");
  assert.match(found.join("\n"), /the renderer gave it no top/);
});

test("a week that did not move reads as no change at all", () => {
  assert.deepEqual(differences(known(), known()), []);
});

test("a lesson that moved is one line naming the class", () => {
  const now = known();
  const record = Object.values(now)[0];
  const name = Object.keys(record.classes)[0];
  record.classes[name] = bend(TOP, "t123")(record.classes[name].slice());
  const moved = differences(known(), now);
  assert.equal(moved.length, 1);
  assert.match(moved[0], new RegExp(`${record.school} ${name}: draws differently now`));
  assert.match(moved[0], /was: .*\n {2}now: /);
});

test("a class or a timetable that comes or goes is its own line", () => {
  const gone = known();
  const record = Object.values(gone)[0];
  const name = Object.keys(record.classes)[0];
  delete record.classes[name];
  assert.deepEqual(differences(known(), gone), [`${record.school} ${name}: gone`]);
  assert.deepEqual(differences(gone, known()), [`${record.school} ${name}: new`]);

  const fewer = known();
  const number = Object.keys(fewer)[0];
  const school = fewer[number].school;
  delete fewer[number];
  assert.deepEqual(differences(known(), fewer), [`${school}: the whole timetable is gone`]);
  assert.deepEqual(differences(fewer, known()),
                   [`${school}: a timetable that was not there before`]);
});

test("the diff shows the line that changed and not the whole class", () => {
  const was = ["a", "b", "c"], now = ["a", "B", "c"];
  assert.equal(firstDifferences(was, now), "  was: b\n  now: B");
  assert.match(firstDifferences(["a"], ["a", "b"]), /was: \(nothing\)\n {2}now: b/);
});
