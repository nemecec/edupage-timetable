# Personalised EduPage timetables

`tt.py` pulls every published timetable from an EduPage site and renders one
self-contained HTML file. The reader picks their **school**, **class** and
**groups** in the page; nothing needs regenerating per student.

## Why this does not scrape the page

`https://tera.edupage.org/timetable/view.php?num=35&class=-69` renders its grid
client-side into an SVG, so fetching the HTML gives you nothing. The data behind
it comes from a JSON endpoint that an anonymous session may read:

    POST /timetable/server/regulartt.js?__func=regularttGetData
    {"__args": [null, "<tt_num>"], "__gsh": "00000000"}

The endpoint needs a `PHPSESSID` obtained by first requesting the public
timetable page; without it every call answers `Insufficient privileges`. The
script handles that handshake itself.

The response is the full aSc relational model — `cards`, `lessons`, `groups`,
`divisions`, `subjects`, `teachers`, `classrooms`, `days`, `periods` — which is
strictly richer than the rendered SVG. Extraction is a join, not a parse.

## "School" here means a timetable

`tera.edupage.org` publishes one timetable per school in the group — ProTERA ja
TERA gümnaasium, SädeTERA, TäheTERA, LõunaTERA — so that is what the **School**
picker switches between. Each carries its own classes, days, periods and group
divisions, and the page adapts to whichever is selected.

`--list` names them all with their internal `tt_num`.

## Note on `num=` in the URL

`num=35` in that URL is a retired timetable; requesting it returns
`Insufficient privileges`, and the site quietly falls back to another one. The
real id for the 2026/27 gymnasium timetable is **68**. Because published `num=`
values go stale, this script never relies on them — it enumerates the visible
timetables instead.

## Usage

    python3 tt.py --list                                # timetables and classes
    python3 tt.py -o schedule.html                      # everything
    python3 tt.py --school ProTERA --class 8 -o schedule.html

Two flags exist for the hosted copy and are off by default, so an ordinary build
stays reproducible and reaches nothing but EduPage:

    --built 2026-08-23        print the fetch date in the footer
    --goatcounter SITE        count page views at SITE.goatcounter.com

Every visible timetable and class is embedded regardless; `--school` and
`--class` only choose what is selected when the page first opens. A `--class`
given without `--school` is looked up across all timetables.

| flag | meaning |
| --- | --- |
| `--edupage NAME` | EduPage subdomain (default `tera`) |
| `--year YYYY` | school year for the timetable listing (default 2026) |
| `--only TEXT` | only embed timetables whose title contains TEXT (repeatable) |
| `--school TEXT` | timetable selected on first open |
| `--class NAME` | class selected on first open |
| `--lang en\|et` | interface language the page opens in (default `en`) |
| `--json FILE` | also write the extracted data as readable JSON |
| `--refresh` | ignore the on-disk cache and refetch |
| `-v` | show what it is doing |

Python 3 standard library only — no pip installs, no browser.

For `tera` in 2026 the result is 4 schools, 41 classes and 2041 lesson slots in
a ~390 KB file.

## Lesson times and the day plan

EduPage carries no times for these timetables — every period is `00:00` and the
`bells` table is empty — so the day plan lives in `BELLS` at the top of `tt.py`,
keyed by a substring of the timetable title. Only **ProTERA** is filled in; the
other schools render without times and say so.

A day is a sequence of **slots** ("the 1st lesson", "the 2nd lesson"), and a
slot holds either a paired lesson (`P`, two aSc periods) or a single one (`L`,
one period). Which it is varies day by day, and that is what makes the times
branch. Rather than enumerate the branches, the script runs a clock:

    start 9.00 · single = 45 min · paired = 80 min · slots 1-2 always paired
    gaps after slot 1 = 10 min, 2 = 60 min (Söömine), 3 = 20 min (Amps), else 5 min

That reproduces every cell of the school's printed Päevaplaan, so all
combinations are generated rather than listed. Two details it gets right:

- A slot can hold a single **and** a pair at once, for different groups — the
  Päevaplaan writes this as `14.30-15.15 L / 14.30-15.50 P`. The slot fixes the
  start; each lesson's own length fixes the end.
- The end of slot 3 shifts the rest of the day, which is why Amps falls at
  13.35-13.55 on some days and 14.10-14.30 on others.

Two things worth knowing:

1. The Päevaplaan leaves slot 5 blank in the `3=L, 4=P` column, but ProTERA
   class 8 does have a lesson there on Mondays (period 8). The clock puts it at
   **15.20-16.05**, matching the identical slot in the neighbouring column.
   This is the one inferred time.
2. One lesson in 2041 starts part-way through a slot that other groups take
   whole (ProTERA class 8, Thursday, group 8.k, period 2 only). The day plan
   never splits a pair, so no time is claimed — the cell reads *"time not in day
   plan"*.

## Languages

The interface comes in **English** and **Estonian**, switched with the
**Language / Keel** picker in the page — no rebuild needed, and the choice is
remembered. `--lang et` decides which one a freshly generated file opens in.

Only the interface is translated. Everything the school entered — subject names,
group codes, rooms, teacher names, the break names from `BELLS` — stays in its
original language, since translating it would make it stop matching the official
timetable. Weekday names do follow the interface language, as those are known
from the day index rather than the data.

Both catalogues live in `STRINGS` at the top of `tt.py`, keyed alike, with `{0}`
for substitutions. Adding a third language means adding one more entry there and
to `LANGUAGES`; anything a new catalogue leaves out falls back to English rather
than showing a blank.

Note that the event syntax always accepts weekday names in **both** languages
whichever interface language is showing, so a list written in one does not break
when you switch to the other. Accepted per day, case-insensitively and with or
without diacritics:

| Day | Tokens |
| --- | --- |
| Esmaspäev | `mon` `monday` `esmaspäev` `esmaspaev` `es` `e` `m` `mo` |
| Teisipäev | `tue` `tues` `tuesday` `teisipäev` `teisipaev` `te` `t` `tu` |
| Kolmapäev | `wed` `wednesday` `kolmapäev` `kolmapaev` `ko` `k` `w` `we` |
| Neljapäev | `thu` `thur` `thurs` `thursday` `neljapäev` `neljapaev` `ne` `n` `th` |
| Reede | `fri` `friday` `reede` `re` `r` `f` `fr` |
| Laupäev | `sat` `saturday` `laupäev` `laupaev` `la` `l` `sa` |
| Pühapäev | `sun` `sunday` `pühapäev` `puhapaev` `pü` `py` `p` `su` |

## Colours

Subjects are coloured by family, so a printed sheet reads as "languages are
blue, sciences are green" before you read a word of it. `SUBJECT_FAMILIES` in
`tt.py` maps Estonian keywords onto eight hue bands — literature, language,
computing, maths, science, sport, humanities, arts — with anything unmatched
parked on muted greys that cannot be mistaken for a core subject. Within a
family, members are spread across the band and given well-separated lightness
steps; families larger than the lightness cycle get a second, muted saturation
tier so the ninth member does not repeat the first.

Every colour is paired with black or white text, whichever contrasts better,
and any background landing in the mid-luminance band where neither clears
**WCAG AA** is nudged lighter or darker until one does. All 70 subjects on
`tera` reach at least 4.5:1.

`--json` reports the same colours the page uses, and the per-subject colour
pickers still override them.

## Hosting it

`deploy/` puts the page on the public internet at
[little.tools/timetable](https://little.tools/timetable/): a private S3
bucket in Frankfurt behind CloudFront, with a nightly GitHub Actions run that
reruns this generator and writes the result back. Nothing sits in the request path, so a
failed build leaves the previous page serving, and the workflow authenticates
with a short-lived OIDC token rather than a stored key. See
[deploy/README.md](deploy/README.md) — about $0.50 a month for the hosted zone,
everything else within the free tiers.

Every page carries a footer naming itself unofficial, linking the school's own
timetable page for whichever timetable is on screen, and printing the date the
data was fetched. It prints along with the timetable, so a sheet that leaves the
building still says where it came from. Where visits are counted, the footer says
that too.

## Determinism

API responses are cached under `cache/`. Given the same upstream data the output
is byte-identical between runs, including subject colours (hue comes from the
golden angle over the sorted subject list, jittered by an MD5 of the subject
name). Re-running with `--refresh` against unchanged upstream data reproduces
the same bytes.

Because the palette is computed over the subjects of *all* embedded timetables,
restricting the set with `--only` shifts the colours. That is still
deterministic, just a different deterministic assignment.

## The generated page

- **School** and **Class** pickers. Switching school resets the class, since
  class lists differ between them.
- **Group pickers**, one per division, each named after what is taught in it
  rather than by its group codes: a division carrying one subject is that
  subject (*Ajutreening*, *Matemaatika*), two or three are listed
  (*Käsitöö / Tehnoloogiaõpetus*), and four or more are shortened to the two
  commonest with an ellipsis. The broad split a class uses for most of its
  lessons is headed *Main group*, and names its subjects the same way. Hovering
  the heading gives the full list, however long. The group codes stay underneath
  as a subtitle, so nothing is ambiguous. Leave a picker on *— all —* to keep every group on that
  axis; whole-class lessons always show. Divisions with no lessons are dropped.
  Choices are remembered per school+class, so switching away and back keeps them.
- **Timeline** (the default) draws a continuous clock down the side, ruled every
  30 minutes, and places every box at its true start and height. A 45-minute
  lesson is visibly shorter than an 80-minute one, and lessons that do not begin
  on a standard boundary simply sit where they belong instead of being forced
  into a row. Each box carries its own start-end time in a smaller font.
  Overlapping lessons — several groups at once, when no filter is set — share
  the column the way a calendar does. Breaks are hatched bands; the one lesson
  whose exact time the day plan does not define gets a dashed border and a `?`.
- **Table** is the slot grid: columns are the day's lessons (the Päevaplaan's
  1-5), a paired lesson is one cell, and the breaks get their own columns.
  **Days as columns** transposes it.
- **aSc period grid** is the raw 8-period table, for cross-checking against the
  official page. Schools with no bell schedule only get this one.
- **Teachers** shows each lesson's teacher as the school's abbreviation, the
  full name, or not at all. **Room** and **Group** switch those details on and
  off independently — all three default to showing, and **Short subject names**
  now only affects the subject itself.
- **School colours** switches from the generated palette to the colours set in
  aSc. Either can be overridden per subject: use the swatch in the legend, or
  just **click any lesson in the grid** to recolour its subject. Text
  automatically flips between black and white for whatever colour is chosen.
- Hovering a lesson shows the full tooltip: subject, group, teacher's full name,
  room.
- In the aSc period grid, multi-period lessons repeat in each period they cover
  with the continuation dimmed, so every cell stands alone. In the slot grid they are simply one cell. In
  ProTERA class 8, 52 of the 70 lessons are paired, so this is the common case
  rather than an edge case.
- **Print view (A4 landscape)** lays out whichever view is selected for paper,
  scaled to fill one sheet: the timeline as a to-scale calendar, or the table in
  the layout the school's own printouts use — slots down the side with a single
  **Aeg** column, days across, breaks as rows, and any day that departs from a
  slot's usual time carrying its own time in brackets. **Name** puts a child's
  name in the title. The page sets `@page { size: A4 landscape }`, so
  **Print…** (or Cmd/Ctrl+P) gives one landscape sheet with the controls hidden
  and the colours preserved — the page forces `print-color-adjust: exact`, so
  backgrounds survive even with Chrome's "Background graphics" left unticked,
  which is its default. Verified for both views with that box off: 297 × 210 mm
  on a single page, colours intact.

  One sheet is the point of this view, so it fits itself to the page rather than
  spilling onto a second. The table is laid out on screen at the exact size of
  the sheet — same width, same type, same row padding — so what the fitting
  measures is what will print. Air goes first: the rows give up their padding
  down to a floor, and only then does the type step down, from 12.5px in small
  steps until it fits. A class with several lessons stacked in one cell, a row of
  personal events — each takes a little more, and the page absorbs it. Checked across all nine ProTERA classes, in both layouts, with no
  events and with six: one page every time, and the roomy classes keep their
  full padding.
- **My own events** — a text box, one event per line, for everything the school
  does not know about:

      Mon 17:15-18:15 orange Dance training
      reede 8.00-8.45 #2e86de Early swim
      L 10:30-12:00 mediumseagreen Choir practice
      K 12:10-12:30 #333333/#dddddd Söömine

  Weekdays accept English or Estonian, long or short (`Mon`, `Tue`, `esmaspäev`,
  `Re`, `L`); times take `:` or `.`; the label is the rest of the line and may
  contain spaces. Blank lines and lines starting with `#` are ignored, and
  anything unparseable is reported underneath with its line number rather than
  silently dropped. An event on a day the school week does not cover — a
  Saturday rehearsal — adds that day.

  The colour column is any CSS colour name, hex or function, and sets the
  background; the text then comes out black or white, whichever reads better on
  it. Write it as `<text>/<background>` — `#333333/#dddddd` — to set both, and
  the box's border follows the text colour. Only a slash between whole colours
  counts, so `rgb(0,0,0/50%)` still parses as one. A bad half is named on its
  own: *line 1: "#zzzzzz" is not a colour*.

  In the timeline, events are drawn **on top of** the timetable rather than
  beside it: the lessons keep their full width and the event is inset over them,
  bordered and shadowed. That is what makes an event usable for marking
  something out inside a break. The school's canteen plan — which grade eats
  when, inside the long break — is written this way, one line per day, as the
  last line above does: no rebuild, and it can differ per child. Events still pack against each other, so two at once
  sit side by side instead of hiding one another, and a box too short for two
  lines puts its time and label on one.

  The other views have no geometry to draw over, so events get a **My own**
  column in the table — a row when transposed, and the last row of the printout
  — since an event at 17.15 belongs to no lesson slot. Typing into the box
  stores every keystroke but repaints on a short timer, so a long line is never
  typed against a redraw.
- **Back up settings…** shows the whole configuration as JSON: group picks,
  custom colours, personal events, names, and view options, for every class you
  have set up. Copy it to keep a backup, or paste one back and apply it. Older
  backups still load, since they are merged onto the current defaults.
- **Name** identifies whose timetable this is. It appears in the page heading,
  the browser tab and both print layouts, which all share one title, and it is
  stored per class — so two children in one file each keep their own.
- **Language** switches the whole interface between English and Estonian.
- All state lives in `localStorage`, so each reader sets theirs once.

## Verification

Extraction was checked against the official rendering: all 70 lesson boxes for
ProTERA class 8 match the page's own SVG exactly — the 69 that carry a tooltip
by subject, groups, teachers and room, with no extras or omissions, and the one
that carries none (*Praktikum*, which has no room, group or teacher) by the text
the page draws.

The bell clock was checked cell by cell against the printed Päevaplaan: all five
published day shapes, both halves of the two-variant slot-4 cell, and the
Söömine/Amps times in each branch.

Every subject colour was checked for WCAG AA text contrast, and both print
layouts were rendered to PDF to confirm A4 landscape on one page. The event
parser was exercised over valid English and Estonian lines and every failure
mode — unknown weekday, out-of-range hour, bad colour, reversed times,
unparseable line — and the settings backup was round-tripped through a class
switch to confirm picks, colours, events and names all come back.

The publisher was exercised end to end without touching AWS, against a stub
standing in for the CLI: it renders the page, uploads it once with the right
content type and cache header, and on a second run with unchanged data uploads
nothing and raises no invalidation. Both CloudFormation templates pass
`cfn-lint`, which caught two faults worth having found — resource names carrying
the domain's dots, illegal for a Lambda or CloudFront function name and fatal for
the S3 origin's TLS, and an `s3:HeadObject` IAM action that does not exist.

CI splits along the same line: a `lint` job that compiles the sources and checks
the templates without leaving the runner, and a `build` job that fetches once,
builds twice from that one fetch and compares the bytes. Nothing is committed to
make the build hermetic — the API responses are an output, not source, and an
Actions cache is evicted after a week of quiet, so a fixture that can disappear
is worse than none. The trade is that `build` also goes red when the school's
server is down, which is worth being told about.

Both print layouts were re-rendered with background graphics disabled to confirm
the colours still come through, and the timeline's axis was measured to confirm
the boxes sit exactly on their gridlines with the first and last labels clear of
the edges. Every weekday token above was fed through the parser and checked to land on the
right day. Both languages were checked across the whole interface — headings, controls,
group pickers, counts, parser errors, weekday names and the printout title — and
the Estonian print output was rendered to PDF as a single A4 landscape page.

The school's canteen plan was written out as personal events — all five days,
including Friday's two sittings — and rendered over the long break, confirming
that each box lands on its true minute, that the lessons keep their full width
with the overlay in place, that two overlapping events still divide the layer
between them, and that a `<text>/<background>` pair drives the text and border
in all three views — with each bad half of a pair named on its own line, in both
languages. Personal events were
confirmed to appear in all three views and in both printouts, and the printout
was re-fitted for every ProTERA class with none and with six events. Every
lesson entry, slot time and division was diffed against a build from the
previous version of the script to confirm none of this changed the timetable
itself, and the output is still byte-identical from cache and from a live
`--refresh`.
