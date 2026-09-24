/* Build the page from the school's own server, and say whether anything moved.
 *
 *     node tests/js/live.mjs            compare against the last accepted week
 *     node tests/js/live.mjs --accept   take today's week as the reference
 *     node tests/js/live.mjs --cache D  build from answers already in D
 *
 * With no --cache it fetches from the school, which is what works by hand. The
 * daily check passes one, because the school's server does not answer a GitHub
 * runner: the answers are fetched for it by the build Lambda, which is on the
 * network the school does answer.
 *
 * Nothing in this repository changes when the school edits its timetable, so
 * every other test here can be green while the page is wrong. This is the one
 * check that looks at what the school published today.
 *
 * Two questions, in order. Does every class still draw — which is a fault, and
 * ours. And has any box moved since the last accepted week — which is a
 * change, and the school's, and only a person can say whether the page still
 * reads correctly with it. A box that stayed where it was with a new room or
 * teacher in it is reported and passes.
 *
 * The reference is not committed. It is an output, and committing it would
 * turn every timetable edit into a commit. It lives in the workflow's cache,
 * written only after a run that passes, so a moved box goes on failing every
 * afternoon until somebody has looked at it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLivePage, capture } from "./render.mjs";
import { verdict } from "./sane.mjs";

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
function report(title, lines, say = console.error, limit = 20) {
  say(title + ":");
  for (const line of lines.slice(0, limit)) say("  " + line.replace(/\n/g, "\n  "));
  if (lines.length > limit) say(`  ... and ${lines.length - limit} more`);
}

const accept = process.argv.includes("--accept");
const cache = process.argv[process.argv.indexOf("--cache") + 1];
/* The page stamps itself only when the publisher asks it to, and this build is
   not that one, so the day is taken here. It is what the next run reports back
   as the day the week it holds was read. */
const today = new Date().toISOString().slice(0, 10);

const data = buildLivePage(process.argv.includes("--cache") ? cache : null);
const shot = capture(data);
const renders = Object.values(shot).reduce((n, r) => n + Object.keys(r.classes).length, 0);
console.log(`${today}: ${data.schools.length} timetables, ${renders} renders`);

function keep() {
  mkdirSync(dirname(REFERENCE), { recursive: true });
  writeFileSync(REFERENCE, JSON.stringify(
    { read: today, code: codeVersion(), shot }, null, 1) + "\n");
}

const last = !accept && existsSync(REFERENCE)
  ? JSON.parse(readFileSync(REFERENCE, "utf8")) : null;
const said = verdict(shot, last, codeVersion());

/* A box the renderer could not place is a fault rather than a change, and no
   reference is written over one. Accepting does not make it right either. */
if (said.wrong.length) {
  report(`${said.wrong.length} things the page cannot draw`, said.wrong);
  process.exit(1);
}
console.log("every class draws a week");

/* A week that passes is the week the next run compares against. One that only
   reads differently is written over too, or the same new room would be
   reported every afternoon — and a week written each day keeps the cache from
   expiring. */
if (said.pass) keep();

if (accept) {
  console.log("accepted: today is the reference now");
  process.exit(0);
}
if (!last) {
  console.log("nothing to compare against yet — today is the reference now");
  process.exit(0);
}

if (said.pass) {
  if (said.reworded.length) {
    report(`${said.reworded.length} changes of wording since ${last.read}, ` +
           "in boxes that stayed where they were", said.reworded, console.log);
  }
  console.log(`nothing has moved since ${last.read}`);
  process.exit(0);
}

if (said.ours)
  console.error("the page's own code changed since the reference was taken, " +
                "so some of this is ours rather than the school's.\n");
report(`${said.moved.length} changes since ${last.read}`, said.moved);
if (said.reworded.length) {
  report(`\nand ${said.reworded.length} changes of wording, which would pass on their own`,
         said.reworded);
}
console.error('\nRead the page, then run this workflow by hand with "accept" ticked.');
process.exit(1);
