/* Two checks on what the page draws from whatever the school published.
 *
 * The golden records are built from the frozen fixtures, so they cannot notice
 * a change at the school — the change nothing in this repository sees coming.
 * These read the live week instead, in the same lines the records are made of,
 * so a change to how a render is written down reaches both at once.
 *
 * `problems` asks whether every class still draws a week: things that hold for
 * every correct render and for no broken one. A failure there is ours.
 *
 * `differences` asks what changed since the week somebody last accepted, and
 * sorts it by whether anything moved. A box that moved, grew or shrank, or a
 * class that came or went, changes how the week is drawn, and only a person
 * can say the page still reads right with it. A room, a teacher or a subject
 * changing inside a box that stayed where it was is drawn in the space it
 * always had, and needs nobody.
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

/* A line with its words taken out, so that what is left is where things are.
 *
 * A box keeps its day and its four numbers, and loses its kind, its subject and
 * everything written in it. The ruler and the height of the day are nothing but
 * position, and stay whole. A cut keeps where it is and how tall. A table has
 * no coordinates, so a row of one keeps how many of its cells are filled, which
 * is as near to a shape as a table comes. */
function shape(line) {
  const part = line.split(" | ");
  if (part[0] === "axis" || part[0] === "body") return line;
  if (part[0] === "cut") return part.slice(0, 3).join(" | ");
  if (part[0] === "empty") return "empty";
  if (/^r\d+$/.test(part[0])) return part[0] + " | " + (part.length - 1);
  return [part[0], ...part.slice(3, 7)].join(" | ");
}

/* The same rectangles in whatever order the page wrote them: two lessons at
   one hour can come out either way round, and that is not a move. */
const outline = (lines) => lines.map(shape).sort();
const sameShape = (a, b) => JSON.stringify(outline(a)) === JSON.stringify(outline(b));

/* What changed between two captures of the same school's week, as two lists.
 *
 * `moved` is anything that changes how the week is drawn: a box that moved or
 * changed size, one that came or went, the ruler, the height of the day, and a
 * class or a whole timetable that appeared or disappeared — which means the
 * school republished, and is the change most worth reading twice.
 *
 * `reworded` is a class whose boxes are all where they were, with something
 * different written in them: a room, a teacher, two lessons trading places.
 *
 * One entry per class, because that is the unit somebody can go and look at. */
export function differences(was, now) {
  const moved = [], reworded = [];
  const schools = [...new Set([...Object.keys(was), ...Object.keys(now)])].sort();
  for (const number of schools) {
    const before = was[number], after = now[number];
    const where = (after || before).school || number;
    if (!after) { moved.push(`${where}: the whole timetable is gone`); continue; }
    if (!before) { moved.push(`${where}: a timetable that was not there before`); continue; }

    const names = [...new Set([...Object.keys(before.classes || {}),
                               ...Object.keys(after.classes || {})])].sort();
    for (const name of names) {
      const a = (before.classes || {})[name], b = (after.classes || {})[name];
      if (!b) { moved.push(`${where} ${name}: gone`); continue; }
      if (!a) { moved.push(`${where} ${name}: new`); continue; }
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      if (sameShape(a, b)) {
        reworded.push(`${where} ${name}: reads differently now\n` + firstDifferences(a, b));
      } else {
        moved.push(`${where} ${name}: draws differently now\n` + firstDifferences(a, b));
      }
    }
  }
  return { moved, reworded };
}

/* What one afternoon's run decides, from today's capture and the week last
 * accepted. Apart from the script that fetches and prints, so every way it can
 * go can be asked without a school or a Python.
 *
 * A run passes when every class draws and nothing moved, and a run that passes
 * is the one that becomes the reference. `last` is null on a first run and when
 * accepting. `ours` says the page's own code is not what took the reference, so
 * a move may be ours rather than the school's. */
export function verdict(shot, last, code) {
  const wrong = problems(shot);
  if (wrong.length || !last) {
    return { pass: !wrong.length, wrong, moved: [], reworded: [], ours: false };
  }
  const { moved, reworded } = differences(last.shot, shot);
  return { pass: !moved.length, wrong, moved, reworded, ours: last.code !== code };
}
