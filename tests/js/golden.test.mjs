/* Every class, every box, against the record in tests/golden.
 *
 * The other suite says why one rule is right. This says that nothing else
 * moved while it was being made right — across all four schools and all of
 * their classes, which no hand-written test covers.
 *
 * When a change is meant to move boxes:
 *
 *     node tests/js/update-golden.mjs
 *
 * and read the diff before committing it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildPage, capture, goldenFile } from "./render.mjs";

const data = buildPage();
const shot = capture(data);

/* Enough of the diff to see what happened, and not so much that the real line
   is lost in it. */
function firstDifferences(was, now, limit = 6) {
  const lines = [];
  for (let i = 0; i < Math.max(was.length, now.length) && lines.length < limit; i++) {
    if (was[i] !== now[i]) {
      lines.push("  was: " + (was[i] === undefined ? "(nothing)" : was[i]));
      lines.push("  now: " + (now[i] === undefined ? "(nothing)" : now[i]));
    }
  }
  return lines.join("\n");
}

for (const [number, record] of Object.entries(shot)) {
  test(`${record.school} draws what it drew before`, () => {
    const path = goldenFile(number);
    assert.ok(existsSync(path),
              `no record for school ${number}. Run node tests/js/update-golden.mjs`);
    const golden = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(golden.school, record.school, "the school was renamed");

    /* A class that appears or disappears is worth its own line: it means the
       fixtures changed, or the generator stopped drawing something. */
    assert.deepEqual(Object.keys(record.classes), Object.keys(golden.classes),
                     "the set of renders changed");

    for (const [name, now] of Object.entries(record.classes)) {
      const was = golden.classes[name];
      if (JSON.stringify(was) === JSON.stringify(now)) continue;
      assert.fail(`${record.school} ${name} draws differently now ` +
                  `(${was.length} lines before, ${now.length} now):\n` +
                  firstDifferences(was, now) +
                  "\n\nIf this is intended, run node tests/js/update-golden.mjs");
    }
  });
}

test("the record covers every class the page carries", () => {
  /* A record that quietly stops covering a school is worse than none: it goes
     on passing and says nothing. */
  const classes = data.schools.reduce((n, s) => n + s.c.length, 0);
  const renders = Object.values(shot)
                        .reduce((n, r) => n + Object.keys(r.classes).length, 0);
  assert.equal(Object.keys(shot).length, data.schools.length);
  assert.ok(classes >= 41, `only ${classes} classes in the fixtures`);
  assert.equal(renders % classes, 0, "not every class got every scenario");
  assert.ok(renders / classes >= 4, "fewer scenarios than there were");
});

test("a record notices a box that moves", () => {
  /* The point of the file is that it fails when something changes. A record
     that cannot fail is a file nobody should trust, so this moves one box and
     checks that the comparison above would have caught it. */
  const one = Object.values(shot)[0];
  const name = Object.keys(one.classes).find(k => one.classes[k].length > 3);
  const now = one.classes[name].slice();
  now[1] = now[1].replace(/\| t(\d+) \|/, (_, top) => "| t" + (Number(top) + 1) + " |");
  assert.notDeepEqual(now, one.classes[name], "the record holds no coordinates");
  assert.match(firstDifferences(one.classes[name], now), /was: .*\n {2}now: /);
});
