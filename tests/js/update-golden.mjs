/* Write the golden records down again.
 *
 *     node tests/js/update-golden.mjs
 *
 * Run it when a change is meant to move boxes, and read the diff before
 * committing it. A record updated without reading the diff is worth nothing:
 * the whole value of the file is that somebody looked at what moved.
 *
 * Not named *.test.mjs, so `node --test tests/js/*.test.mjs` never runs it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildPage, capture, goldenDir, goldenFile } from "./render.mjs";

const shot = capture(buildPage());
mkdirSync(goldenDir, { recursive: true });
for (const [number, record] of Object.entries(shot)) {
  writeFileSync(goldenFile(number), JSON.stringify(record, null, 1) + "\n");
  const boxes = Object.values(record.classes).reduce((n, r) => n + r.length, 0);
  console.log("%s  %s: %d renders, %d lines",
              number, record.school, Object.keys(record.classes).length, boxes);
}
