/* Does the page still draw a week, whatever the school published today?
 *
 * The golden records answer a different question: did anything move since the
 * last time somebody looked. They are built from the frozen fixtures, so they
 * cannot notice a change at the school — which is the change nothing in this
 * repository can see coming.
 *
 * This asks what the records cannot. It is deliberately not a comparison. The
 * school edits its timetable most days, and a check that fails on every edit
 * is a check that gets ignored by the second week. These are the things that
 * hold for every correct render and for no broken one.
 *
 * It reads the same lines the records are made of, so a change to how a render
 * is written down is a change both files see at once.
 */

/* "t0" is nought, "tnull" is nothing at all, and the difference is the whole
   point: a box the renderer could not place writes the second. */
const num = (token, letter) =>
  typeof token === "string" && token.startsWith(letter)
    ? Number(token.slice(letter.length)) : NaN;

/* Where each number sits in a box's line, and what to call it out loud. */
const PLACE = [["t", "top"], ["h", "height"], ["l", "left"], ["w", "width"]];

/* Rounding puts a box at most half a pixel and a tenth of a percent outside
   what it really covers, so a box is only past an edge when it is past it by
   more than that. */
const PIXEL = 1;
const PERCENT = 0.2;

function classProblems(where, lines, complain) {
  let body = null, ticks = 0, rows = 0;
  const boxes = [];
  for (const line of lines) {
    const part = line.split(" | ");
    if (part[0] === "body") body = num(part[1], "h");
    else if (part[0] === "axis") ticks++;
    else if (part[0] === "cut") continue;
    else if (part[0] === "empty") complain(where, "drew nothing at all");
    else if (/^r\d+$/.test(part[0])) rows++;
    else boxes.push(part);
  }

  /* The one that catches a broken reader as well as a broken page: if these
     lines ever stop being lines this can read, every class looks empty and
     every class says so. */
  if (!boxes.length && !rows) return complain(where, "no lessons drawn");
  /* A class the school gives no times falls back to a table, and a table has
     no coordinates to be wrong about. */
  if (!boxes.length) return;
  if (!ticks) complain(where, "lessons drawn, but no clock beside them");

  for (const part of boxes) {
    const label = `${part[0]} ${part[2] || "(no subject)"}`;
    const at = {};
    PLACE.forEach(([letter, name], i) => { at[name] = num(part[3 + i], letter); });

    const lost = PLACE.map(([, name]) => name).filter(name => !Number.isFinite(at[name]));
    if (lost.length) { complain(where, `${label}: the renderer gave it no ${lost.join(" and no ")}`); continue; }

    if (at.height <= 0) complain(where, `${label}: ${at.height}px tall`);
    if (at.width <= 0) complain(where, `${label}: ${at.width}% wide`);
    if (at.top < 0) complain(where, `${label}: starts ${-at.top}px above the day`);
    if (body !== null && Number.isFinite(body) && at.top + at.height > body + PIXEL)
      complain(where, `${label}: runs ${Math.round(at.top + at.height - body)}px past the foot of the day`);
    if (at.left < 0) complain(where, `${label}: starts ${-at.left}% left of the column`);
    if (at.left + at.width > 100 + PERCENT)
      complain(where, `${label}: reaches ${Math.round(at.left + at.width)}% across a column that is 100% wide`);
    if (!part.slice(7).join(" | ").trim()) complain(where, `${label}: an empty box`);
  }
}

/* Every complaint the capture deserves, most useful first by being grouped per
   class. An empty list is a page a reader can use. */
export function problems(shot) {
  const found = [];
  const complain = (where, what) => found.push(`${where}: ${what}`);
  for (const [number, record] of Object.entries(shot)) {
    const school = record.school || number;
    const classes = Object.entries(record.classes || {});
    if (!classes.length) { complain(school, "not one class"); continue; }
    for (const [name, lines] of classes) classProblems(`${school} ${name}`, lines, complain);
  }
  return found;
}

/* Enough of the diff to see what happened, and not so much that the real line
   is lost in it. */
export function firstDifferences(was, now, limit = 6) {
  const lines = [];
  for (let i = 0; i < Math.max(was.length, now.length) && lines.length < limit; i++) {
    if (was[i] !== now[i]) {
      lines.push("  was: " + (was[i] === undefined ? "(nothing)" : was[i]));
      lines.push("  now: " + (now[i] === undefined ? "(nothing)" : now[i]));
    }
  }
  return lines.join("\n");
}

/* What moved between two captures of the same school's week.
 *
 * One entry per class, because that is the unit somebody can go and look at.
 * A class that appeared or disappeared gets a line of its own: it means the
 * school republished, and it is the change most worth reading twice. */
export function differences(was, now) {
  const found = [];
  const schools = [...new Set([...Object.keys(was), ...Object.keys(now)])].sort();
  for (const number of schools) {
    const before = was[number], after = now[number];
    const where = (after || before).school || number;
    if (!after) { found.push(`${where}: the whole timetable is gone`); continue; }
    if (!before) { found.push(`${where}: a timetable that was not there before`); continue; }

    const names = [...new Set([...Object.keys(before.classes || {}),
                               ...Object.keys(after.classes || {})])].sort();
    for (const name of names) {
      const a = (before.classes || {})[name], b = (after.classes || {})[name];
      if (!b) { found.push(`${where} ${name}: gone`); continue; }
      if (!a) { found.push(`${where} ${name}: new`); continue; }
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      found.push(`${where} ${name}: draws differently now\n` + firstDifferences(a, b));
    }
  }
  return found;
}
