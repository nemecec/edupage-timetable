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

    --built 2026-08-23        print the date the data was read
    --goatcounter SITE        count page views at SITE.goatcounter.com

Every visible timetable and class is embedded regardless; `--school` and
`--class` only choose what is selected when the page first opens. A `--class`
given without `--school` is looked up across all timetables.

| flag | meaning |
| --- | --- |
| `--edupage NAME` | EduPage subdomain (default `tera`) |
| `--year YYYY` | school year for the timetable listing (defaults to the current one, rolling over each August) |
| `--only TEXT` | only embed timetables whose title contains TEXT (repeatable) |
| `--school TEXT` | timetable selected on first open |
| `--class NAME` | class selected on first open |
| `--lang en\|et` | interface language the page opens in (default `en`) |
| `--json FILE` | also write the extracted data as readable JSON |
| `--cache DIR` | where API responses are cached (default `cache/` beside the script) |
| `--refresh` | ignore the on-disk cache and refetch |
| `-v` | show what it is doing |

Python 3 standard library only — no pip installs, no browser.

For `tera` in 2026 the result is 4 schools, 41 classes and about 1,900 lesson
slots in a ~600 KB file — 75 KB over the wire, since it compresses well.

    python3 -m unittest discover -s tests     # the generator
    node --test tests/js/*.test.mjs           # the page's own logic

Both run without a network: `tests/fixtures` holds the school's API responses,
frozen.

## Lesson times and the day plan

The four timetables get their times from three different places, and one gets
none at all.

**SädeTERA** is the easy case: EduPage carries real times for its periods, so
they are used as they come.

For the others EduPage carries nothing — every period reads `00:00` and the
`bells` table is empty — so the day plan lives in `BELLS` at the top of `tt.py`,
keyed by a substring of the timetable title. Two schools publish one, in two
quite different shapes.

**ProTERA runs off a clock.** A day is a sequence of slots, and a slot holds
either a paired lesson (`P`, two aSc periods) or a single one (`L`). Which it is
varies day by day, and that is what makes the times branch. Rather than
enumerate the branches, the times are computed:

    start 9.00 · single = 45 min · paired = 80 min · slots 1-2 always paired
    gaps after slot 1 = 10 min, 2 = 60 min, 3 = 20 min, else 5 min

That reproduces every cell of the printed Päevaplaan, so all combinations fall
out rather than being listed. Two details it gets right:

- A slot can hold a single **and** a pair at once, for different groups — the
  Päevaplaan writes this as `14.30-15.15 L / 14.30-15.50 P`. The slot fixes the
  start; each lesson's own length fixes the end.
- Whether slot 3 was a single or a pair shifts the rest of the day, which is
  why the 20-minute break named `Amps` falls at 13.35-13.55 on some days and
  14.10-14.30 on others. The hour before it, `Söömine, tiimitund, vaba aeg`,
  is fixed at 11.50-12.50 — it comes after slot 2, and the first two slots are
  always pairs. Only a break's first word is shown in the grid.

**LõunaTERA publishes fixed blocks instead**, so there is no clock to run. Each
block says which aSc periods it holds and when it is:

    (first period, how many periods, start, end)

Two grade bands run different days, and the breaks — Puder, Lõuna/Õue, Hea aeg —
are lessons in the timetable rather than gaps between them, so they need no
special handling at all. A block covering two periods is one box. What sits
inside it decides how:

- Two subjects, one per period: a sequence, so one box naming both in order,
  coloured by whichever fills more of the block and by the later one on a tie —
  a block that opens with a warm-up should look like what it becomes.
- Two subjects sharing a period: choices running side by side, so they stay
  apart, and each subject's own cards merge among themselves.
- Anything naming a group is left alone; the group already tells them apart.

Class names are matched with surrounding space ignored, because aSc hands back
what someone typed — one class is called `Silva `, and matching that literally
once cost it every one of its times.

**TäheTERA publishes nothing yet**, so its lessons have no times and the page
says so.

Two things worth knowing:

1. The Päevaplaan leaves slot 5 blank in the `3=L, 4=P` column, but ProTERA
   class 8 does have a lesson there on Mondays. The clock puts it at
   **15.20-16.05**, matching the identical slot in the neighbouring column.
   This is the one inferred time.
2. One lesson starts part-way through a slot that other groups take whole
   (ProTERA class 8, Thursday, group 8.k, period 2 only). The day plan never
   splits a pair, so no time is claimed — the box is dashed and reads *"time not
   in day plan"*.

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
parked on golden-angle hues held to a quarter of the saturation, so they
read as background beside any core subject. Within a
family, members are spread across the band and given well-separated lightness
steps; families larger than the lightness cycle get a second, muted saturation
tier so the ninth member does not repeat the first.

Every colour is paired with black or white text, whichever contrasts better,
and any background landing in the mid-luminance band where neither clears
**WCAG AA** is nudged lighter or darker until one does. All 69 subjects on
`tera` reach at least 4.5:1.

The per-subject colour pickers override any of them, and the page remembers
what was picked. `--json` writes the extracted timetable, not the palette.

## Hosting it

`deploy/` puts the page on the public internet at
[little.tools/timetable](https://little.tools/timetable/): a private S3
bucket in Frankfurt behind CloudFront, with a nightly EventBridge schedule
running this generator in Lambda and writing the result back. Nothing sits in the request path, so a
failed build leaves the previous page serving, and the workflow authenticates
with a short-lived OIDC token rather than a stored key. See
[deploy/README.md](deploy/README.md) — about $0.50 a month for the hosted zone,
everything else within the free tiers.

Every page names itself unofficial under its heading, beside a link to the
school's own timetable page for whichever timetable is on screen and the date the
data was read. A printed sheet keeps the date and a QR code back to the page,
and leaves the rest on screen. Where visits are counted, the page says so.

What the reader types stays in the reader's browser. Names, group choices,
colours and personal events live in `localStorage` and in the link's fragment,
which no browser sends to a server. The one thing that does leave is the visit
count, and left to itself GoatCounter reports the page heading along with it —
a heading this page builds out of the child's name. So it does not report the
heading: the count is made by hand once, from the school's own name for the
timetable on screen and nothing the reader wrote.

The counter keeps one title per path, so the label is sent as a path as well —
`/timetable/68/8` for ProTERA's class 8 — or every class would collapse into a
single row showing whichever title arrived last. That is a string in a beacon;
the address a reader sees and shares stays `/timetable/`. The label is always
in English, whichever language the interface is in, so the same class does not
flip between two names in the dashboard; the school's own name is left as the
school writes it.

## Determinism

Given the same upstream data the output is byte-identical, so the file can be
regenerated and diffed. API responses are cached under `cache/`; `--refresh`
ignores them.

Nothing samples the clock or a random source. Subject colours are worked out
from the subject list alone: hue comes from the subject's family band, members
spread evenly across it, lightness stepping through a fixed cycle and saturation
dropping a tier once a family is crowded. Subjects matching no family get
golden-angle hues at lower saturation. Which subjects are present therefore
decides the palette — `--only` changes the colours, because it changes the list.

The one deliberate exception is `--built`, which stamps a date. It is left empty
unless asked for, so an ordinary build stays reproducible.

## The generated page

Nothing chooses a view: the data does. A school with a day plan, and a class it
covers, gets the **timeline**. Everything else gets aSc's raw period grid, which
needs no times.

- **Filter** — school and class, then one picker per division, each named after
  what is taught in it rather than by its group codes: a division carrying one
  subject is that subject (*Ajutreening*), two or three are listed
  (*Käsitöö / Tehnoloogiaõpetus*), four or more are shortened to the two
  commonest with an ellipsis. Hovering gives the whole list. The group codes sit
  underneath as a subtitle. Leave a picker on *— all —* to keep every group on
  that axis; whole-class lessons always show. Divisions with no lessons are
  dropped, and choices are remembered per school+class.
- **The timeline** draws a continuous clock down the side, ruled every 30
  minutes, and places every box at its true start and height. A 45-minute lesson
  is visibly shorter than an 80-minute one, and a lesson that does not begin on a
  standard boundary sits where it belongs rather than being forced into a row.
  Each box carries its own start-end time. Overlapping lessons — several groups
  at once, when no filter is set — share the column the way a calendar does.
  Breaks are hatched bands; the one lesson whose exact time the day plan does not
  define gets a dashed border and a `?`.
- **The period grid** is the fallback: aSc's own periods, one column each, with a
  multi-period lesson repeated in every period it covers and the continuation
  dimmed. Where the school publishes period times, they appear in the headers.
- **Display options** sets what each lesson box says. Teacher, room, study group
  and subject are independent, and teacher and subject each choose between the
  full name and the school's abbreviation. **Lesson colours** offers the school's
  own colours from aSc, and colours of your own; with the latter on, each subject
  gets a swatch and an editable code — type or paste a colour to set it, click
  the code to select it for copying into an event. Clicking any lesson in the
  timetable recolours its subject too. Text flips between black and white for
  whatever colour is chosen.
- **Title** is three independent rows — student name, school name, class name —
  each with a checkbox and a field. The two that come from the timetable are
  pre-filled with what it says, so one word can be changed without retyping the
  rest, and typing into any of them ticks its row. The result appears above the
  timetable as it is typed, which is what will print.
- **My own events** — a row per thing the school does not know about: a
  weekday, a span, a label and its colours, in that order — when first, then
  what. There is no syntax to get wrong and no
  colour to spell; a row that cannot be drawn says so underneath. An event on a
  day the school week does not cover — a Saturday rehearsal — adds that day.

  Each colour is a small set of radio buttons with the control beside the option
  it belongs to, so nothing is a dead click. For the background: **own colour**
  with a picker, or **copy from subject** with a list of the lessons on screen —
  that one takes both of the lesson's colours, which is the quickest way to make
  a training session look like the subject it belongs with. For the text: **own
  colour**, or **automatic**, which is black or white depending on what reads
  better on the background. A box given its own text colour also gains a border
  in it.

  The colour columns are named and laid out as the subject list's are, though
  the two tables do not line up column for column — the subject list has no
  *when*, so there was nothing to gain by bending this order to match it. Each
  row ends with **how it looks**: the box drawn as the timetable would draw it,
  colours, name and all, sized as a 45-minute lesson. Reading a hex code and
  imagining the result is the part nobody can do.

  For a bulk edit — pasting in a term's worth at once — the whole settings
  object is in **Advanced**, and events are a plain list there.

  Events are drawn **on top of** the timetable rather than beside it: the lessons
  keep their full width. An event is inset a little where something is underneath,
  so what it covers still shows at the edge, and drawn full width where the hour
  is empty. Given one colour it looks exactly like a lesson; the border only
  appears where a text colour was asked for. In the period grid, where there is
  no geometry to draw over, events get a **My own** column instead.
- **Share** copies the address, because the address is the whole configuration:
  group picks, colours, events, names, language and every display switch, encoded
  in the fragment. Only what differs from the defaults goes in, and only the
  class on screen, which keeps a typical link near 140 characters and means
  sharing one child's timetable does not hand over a sibling's name. The
  fragment never leaves the browser. Opening a link merges what it carries into
  what this browser already had, rather than replacing it.

  Settings are JSON, UTF-8, base64url. Above a certain size they are gzipped
  first — `#z=` rather than `#s=` — which takes a link carrying every subject
  recoloured from about 4,800 characters to under 1,600. That is not tidiness:
  a QR code holds around 2 kB, so it is the difference between a printed sheet
  you can scan and one that has to fall back to printing the address. Small
  links are left uncompressed, since gzip's header would only make them longer,
  and both forms are read.
- **Print…** lays the page out for A4 landscape and prints it. It is a moment,
  not a setting: the page returns to normal afterwards. The timeline scales
  itself to fill exactly one sheet, measured rather than guessed. Colours survive
  even with Chrome's "Background graphics" unticked, which is its default, because
  the page forces `print-color-adjust: exact`.
- **The printed sheet** carries the date the data was read and a QR code of the
  link, captioned *Edit it here*, so a sheet on the fridge can be picked back up
  on a phone with every choice still on it. The page's other furniture — the
  disclaimer, the source link, the controls — stays on screen.
- **Advanced** holds the whole configuration as JSON, to copy or paste back, and
  **Reset groups & colours**.
- **Language** switches the interface between English and Estonian. Everything
  the school entered — subject names, group codes, rooms, teacher names, the line
  it prints under its own timetable — stays in the language it was entered in.
- All state lives in `localStorage`, so each reader sets theirs once.

## The settings, as they are stored

`localStorage`, the link's fragment and the **Advanced** box all hold the same
object. Two rules shape it: the field names are what the interface calls things,
so a reader can tell which control each one belongs to; and everything belonging
to one class sits in that class's own subtree rather than each setting keeping
its own map of classes.

```json
{
  "lang": "et",
  "school": "68",
  "class": "8",

  "showStudentName": true,
  "showSchoolName": true,
  "showClassName": true,
  "showTeacher": true,
  "teacherNameStyle": "short",
  "showRoom": true,
  "showGroup": true,
  "showSubject": true,
  "subjectNameStyle": "full",

  "subjectColorStyle": "school",
  "subjectColors": {
    "Matemaatika": { "style": "custom", "backgroundColor": "#83EC9B" },
    "Kunst": { "style": "palette" }
  },

  "classes": {
    "68/8": {
      "studyGroups": {
        "Alfa/Beeta/Gamma": "Beeta",
        "8.1/8.2/8.3/8.4": "8.1"
      },
      "studentName": "Eva",
      "events": [
        { "day": "Mon", "startTime": "16:15", "endTime": "17:10",
          "backgroundColor": "#F6F2C1", "label": "Tantsutrenn" }
      ]
    }
  }
}
```

A few of the choices, since they are not all obvious:

- **`studyGroups` is keyed by the choice on offer**, `"Alfa/Beeta/Gamma"`, not by
  aSc's own identifier for that division, which is `"*5:1"` and means nothing
  outside the feed.
- **`subjectColorStyle` says what every subject does** — `palette` (the
  generated one), `school` (the timetable's own), or `custom` (yours). It was
  two checkboxes that quietly layered on each other, which nobody could have
  guessed by looking.
- **`subjectColors` is where one subject differs from that**, and holds only the
  subjects somebody actually touched. A `style` of its own, a `color`, or both.
  So the example above runs on the school's colours, with maths in a colour of
  its own and art left on the generated palette — which a single global switch
  could not express. Not per class: a subject keeps its colour wherever it
  turns up, which is rather the point of colouring it.
- **The subject list is the same table**, one subject to a row, under *Lesson
  colours*. It is collapsed to begin with, since a class has twenty-odd
  subjects and most people never touch it. Each row says what that subject is
  really doing — **own colour**, **from the timetable**, or **automatic** — and
  a subject set to "own colour" with no colour behind it reads as automatic,
  because that is what gets drawn. The sample at the end of the row carries the
  room and teacher from a real lesson of that subject, so it is the box as it
  will actually appear rather than an empty shape.
- **The three radio buttons above it set every subject**, clearing any per-subject style
  as they go; chosen colours survive, so switching back to "my own" restores
  them. Otherwise a row would sit there ignoring the switch that claims to
  govern it.
- **Weekdays are stored as `Mon`…`Sun`**, in English whatever the interface
  language is, so the file reads the same for everyone. The interface shows them
  in the reader's own language.
- **An absent field means "nothing set"** — no `""`, no `{}`, no `[]` in the
  written form. Reading puts the defaults back, so the code using the settings
  always sees every field; only the file is spared them. An event with no
  `textColor` therefore gets black or white, whichever reads better on its
  background.
- **A subject can carry a `textColor` too**, and it holds whatever the
  background came from — the same rule an event follows, because there is no
  reason for the two to differ.
- **`classes` is a map rather than the class keys sitting at the top level**, so
  a class named `lang` cannot collide with the setting called that.

Only what differs from the defaults is written to a link, and only the class
on screen, so most of this is absent from a typical one. Above about a kilobyte
the link is gzipped as well — `#z=` rather than `#s=` — which is what keeps a
heavily customised one inside what a QR code can hold.

## Verification

`python3 -m unittest discover -s tests` and `node --test tests/js/*.test.mjs`,
both in CI on any push that touches the code, the tests, the vendored library
or the deployment. Neither touches the network: `tests/fixtures` holds the
school's own API responses, frozen, so a build takes a moment and CI never
spends the rate limit that the nightly publish needs.

The Python tests cover the reasoning the generator does for itself — the bell
clock against the printed Päevaplaan, LõunaTERA's published blocks and the rules
about which lessons merge, the colour palette's contrast against WCAG AA and the
separation between members of one family, and the parts of the pipeline where a
mistake is silent rather than loud. One whole day of one class is pinned outright
— every box, with its period, groups and printed time — because the arithmetic
that turns a slot into a time had its pieces tested and not the sum of them.

Several are invariants over a whole build rather than examples: no class in a
school that publishes times may have untimed lessons, no lesson may be drawn
twice in the same place, none may be implausibly short, and every subject drawn
must have a colour and an abbreviation. Each was written because it had just
happened. One test exists only to keep the rest honest: it asserts the fixtures
really do produce 1,935 rows across 41 classes, because every invariant above
loops over the lessons and would pass an empty week without complaint.

The JavaScript tests run `page.js` itself under a small stand-in for the browser,
with two schools in the fixture — one with a day plan and one without — so both
the timeline and the fallback grid are actually executed. They cover the event
parser (every weekday token in both languages, every way a line can be
rejected), the settings normaliser, the share link written and read back, the
calendar packing, and the escaping: hostile text is pushed through every channel
that carries it — the school's own subject, teacher, room, day and class names,
and everything the reader can type — and the rendered markup is checked in both
views. That last one is deliberately end-to-end rather than a test of `esc()`
alone, because `esc()` was well tested and the calls to it were not.

The suite is checked by breaking things on purpose: a change is made to the
generator or the page, and the tests are expected to fail. Anything that can be
broken in silence is a gap, and the tests above were written from what such a
pass turned up rather than from reading the code.

Beyond the suite, extraction was checked against the official rendering: all 70
lesson boxes for ProTERA class 8 match the school's own page — the 69 that carry
a tooltip by subject, groups, teachers and room, and the one that carries none
by the text the page draws. The bell clock was checked cell by cell against the
printed Päevaplaan, and LõunaTERA's blocks against the school's published day
plan. The QR code is verified by decoding: the printed page is rasterised and
read back with an independent decoder, and the string compared to the link
character for character. The printout was rendered to PDF with background
graphics disabled to confirm the colours still come through, and counted to
confirm it is one page.

The CloudFormation templates pass `cfn-lint` in CI. `node --check` runs against
`page.js`, because a backslash typo in it used to ship a blank page with CI
green.
