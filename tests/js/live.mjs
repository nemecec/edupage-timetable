/* Build the page from the school's own server, and say whether anything moved.
 *
 *     node tests/js/live.mjs            compare against the last accepted week
 *     node tests/js/live.mjs --accept   take today's week as the reference
 *
 * Nothing in this repository changes when the school edits its timetable, so
 * every other test here can be green while the page is wrong. This is the one
 * check that looks at what the school published today.
 *
 * Two questions, in order. Does every class still draw — which is a fault, and
 * ours. And has anything moved since the last accepted week — which is a
 * change, and the school's, and only a person can say whether the page still
 * reads correctly with it.
 *
 * The reference is not committed. It is an output, and committing it would
 * turn every timetable edit into a commit. It lives in the workflow's cache,
 * written only after a clean run, so a change goes on failing every afternoon
 * until somebody has looked at it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLivePage, capture } from "./render.mjs";
import { differences, problems } from "./sane.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REFERENCE = join(root, ".live", "week.json");

/* Our own part of the answer. A box moves when the school moves a lesson and
   equally when we change the renderer, and a run that cannot tell the two
   apart sends somebody looking at the school for something we did. */
function codeVersion() {
  const sum = createHash("sha256");
  for (const file of ["tt.py", "page.js"]) sum.update(readFileSync(join(root, file)));
  return sum.digest("hex").slice(0, 12);
}

/* Enough to act on, and not a wall nobody reads to the end of. */
function report(title, lines, limit = 20) {
  console.error(title + ":");
  for (const line of lines.slice(0, limit)) console.error("  " + line.replace(/\n/g, "\n  "));
  if (lines.length > limit) console.error(`  ... and ${lines.length - limit} more`);
}

const accept = process.argv.includes("--accept");
/* The page stamps itself only when the publisher asks it to, and this build is
   not that one, so the day is taken here. It is what the next run reports back
   as the day the week it holds was read. */
const today = new Date().toISOString().slice(0, 10);

const data = buildLivePage();
const shot = capture(data);
const renders = Object.values(shot).reduce((n, r) => n + Object.keys(r.classes).length, 0);
console.log(`${today}: ${data.schools.length} timetables, ${renders} renders`);

function keep() {
  mkdirSync(dirname(REFERENCE), { recursive: true });
  writeFileSync(REFERENCE, JSON.stringify(
    { read: today, code: codeVersion(), shot }, null, 1) + "\n");
}

/* A box the renderer could not place is a fault rather than a change, and no
   reference is written over one. Accepting does not make it right either. */
const wrong = problems(shot);
if (wrong.length) {
  report(`${wrong.length} things the page cannot draw`, wrong);
  process.exit(1);
}
console.log("every class draws a week");

if (accept) {
  keep();
  console.log("accepted: today is the reference now");
  process.exit(0);
}

if (!existsSync(REFERENCE)) {
  keep();
  console.log("nothing to compare against yet — today is the reference now");
  process.exit(0);
}

const last = JSON.parse(readFileSync(REFERENCE, "utf8"));
const moved = differences(last.shot, shot);
if (!moved.length) {
  keep();          // the same week, freshly stamped, so the cache stays warm
  console.log(`nothing has moved since ${last.read}`);
  process.exit(0);
}

if (last.code !== codeVersion())
  console.error("the page's own code changed since the reference was taken, " +
                "so some of this is ours rather than the school's.\n");
report(`${moved.length} changes since ${last.read}`, moved);
console.error('\nRead the page, then run this workflow by hand with "accept" ticked.');
process.exit(1);
