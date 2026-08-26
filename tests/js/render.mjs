/* A record of what the page draws, for every class the fixtures hold.
 *
 * The hand-written tests each pin one rule on one made-up class. Between them
 * they say nothing about the other forty, and a change to a shared piece —
 * packing, the axis, the palette, a bell schedule — moves boxes in classes no
 * test names. This renders all of them and writes down where every box landed,
 * so the next run can say exactly which ones moved.
 *
 * It is not a replacement for the hand-written tests. Those say why a thing is
 * right. This only says it has not changed, which is a different and cheaper
 * kind of true.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load } from "./harness.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* The generator is in the loop on purpose. A bell schedule, a day plan or a
   subject prefix is as able to move a box as the renderer is, and a record of
   the renderer alone would miss all three. The year is named because the
   fixtures are one year's. */
export function buildPage() {
  const dir = mkdtempSync(join(tmpdir(), "golden-"));
  try {
    const out = join(dir, "page.html");
    execFileSync("python3", [join(root, "tt.py"), "--cache",
                             join(root, "tests", "fixtures"),
                             "--year", "2026", "-o", out],
                 { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    const html = readFileSync(out, "utf8");
    const found = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/
                    .exec(html);
    if (!found) throw new Error("the built page carries no data");
    return JSON.parse(found[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* Rounded, because a record that changes on a fraction of a pixel records the
   fraction rather than the layout. */
const px = (style, field) => {
  const found = new RegExp(field + ":\\s*([-\\d.]+)px").exec(style || "");
  return found ? Math.round(Number(found[1])) : null;
};
/* left and width are written as calc(), which carries the lane arithmetic. */
const pct = (style, field) => {
  const found = new RegExp(field + ":\\s*calc\\(([-\\d.]+)%").exec(style || "");
  return found ? Math.round(Number(found[1]) * 10) / 10 : null;
};

const text = (html) => html.replace(/<[^>]*>/g, " ")
                           .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
                           .replace(/&gt;/g, ">").replace(/&quot;/g, '"')
                           .replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/* One line per box. A line rather than an object so a moved box reads as one
   changed line in a diff, which is the whole point of keeping the file. */
function timelineBoxes(html) {
  const out = [];
  /* Columns first, so a box carries the day it is in. The day heading is the
     school's own word for it, which is what a reader would look for. */
  const heads = [...html.matchAll(/<div class="cell">([^<]*)<\/div>/g)]
                  .map(m => text(m[1]));
  const columns = html.split('<div class="tlcol">').slice(1);
  columns.forEach((column, i) => {
    const day = heads[i] || String(i);
    for (const box of column.matchAll(
           /<div class="(ev[^"]*)"([^>]*)>([\s\S]*?)<\/div>\s*(?=<div class="ev|<\/div>|$)/g)) {
      const attrs = box[2], style = (/style="([^"]*)"/.exec(attrs) || [])[1];
      const subject = (/data-subject="([^"]*)"/.exec(attrs) || [])[1] || "";
      out.push([day, box[1], subject,
                "t" + px(style, "top"), "h" + px(style, "height"),
                "l" + pct(style, "left"), "w" + pct(style, "width"),
                text(box[3])].join(" | "));
    }
  });
  /* The axis and the cut bands say where the ruler is, which is what makes the
     tops above mean anything. */
  for (const tick of html.matchAll(/<div class="(t hour|t)" style="top:(\d+)px">([^<]*)</g)) {
    out.push(["axis", tick[1], "t" + tick[2], tick[3]].join(" | "));
  }
  for (const cut of html.matchAll(
         /<div class="tlcut" style="top:(\d+)px;height:(\d+)px" title="([^"]*)"/g)) {
    out.push(["cut", "t" + cut[1], "h" + cut[2], text(cut[3])].join(" | "));
  }
  const height = /class="tlbody" style="height:(\d+)px/.exec(html);
  if (height) out.push("body | h" + height[1]);
  return out;
}

/* The other view. No coordinates to record — a table has none — so the record
   is which cell holds what, which is the whole of what the grid decides. */
function gridCells(html) {
  const out = [];
  const rows = html.split("<tr>").slice(1);
  rows.forEach((row, i) => {
    const cells = [...row.matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/g)]
                    .map(cell => text(cell[3])).filter(cell => cell !== "");
    if (cells.length) out.push("r" + i + " | " + cells.join(" | "));
  });
  return out;
}

/* Fixed settings, so a record says something about the page rather than about
   the last thing somebody clicked. English throughout: the record is read by
   whoever is looking at the diff, not by a reader of the page. */
const SCENARIOS = [
  { name: "plain", setUp: "" },
  /* The first option of every division. A class with groups draws a different
     week per group, and the plain scenario draws all of them at once. */
  { name: "groups", setUp: `
      var picks = {};
      (currentClass().v || []).forEach(function (division) {
        picks[division.groups.join("/")] = division.groups[0];
      });
      myOwn().studyGroups = picks;` },
  /* An evening event, which is what puts a hole in every day and so is the
     only thing that exercises the cut axis and the lane packing together. */
  { name: "evening", setUp: `
      myOwn().events = [{ day: "Mon", startTime: "18:00", endTime: "19:00",
                          label: "Training", backgroundColor: "#00FF00" },
                        { day: "Wed", startTime: "18:00", endTime: "19:30",
                          label: "Choir", backgroundColor: "#00FFFF" }];` },
  /* One subject switched off, to pin what the hole it leaves turns into. */
  { name: "hidden", setUp: `
      var first = subjectsOnScreen()[0];
      if (first) state.subjects[first] = { hide: true };` },
];

/* Every class of every school, under every scenario. */
export function capture(data) {
  const run = load(data);
  const json = (expression) => JSON.parse(run(`JSON.stringify(${expression})`));
  const out = {};
  for (const school of data.schools) {
    const rows = {};
    for (const cls of school.c) {
      for (const scenario of SCENARIOS) {
        run(`state = defaults(); state.lang = "en"; applyStrings();
             state.school = ${JSON.stringify(school.n)};
             state.class = ${JSON.stringify(cls.n)};
             ${scenario.setUp}
             render();`);
        const html = json(`document.getElementById("grid").innerHTML`);
        /* Which view drew it is a decision per class, not per school: a school
           with times still has classes the plan gives none, and those fall
           back to the grid. Reading it off the markup keeps the record
           honest about which of the two ran. */
        rows[cls.n + " · " + scenario.name] =
          html.includes('class="tl"') ? timelineBoxes(html)
          : html.includes("<table") ? gridCells(html)
          : ["empty | " + text(html)];
      }
    }
    out[school.n] = { school: school.l, classes: rows };
  }
  return out;
}

export const goldenDir = join(root, "tests", "golden");
export const goldenFile = (number) => join(goldenDir, number + ".json");
