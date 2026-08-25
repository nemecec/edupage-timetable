# Personalized EduPage timetables

`tt.py` reads every published timetable from an EduPage site. It writes one
self-contained HTML file. The reader picks a school, a class and study groups in
the page itself. You do not generate one file per student.

## Why this does not read the rendered page

`https://tera.edupage.org/timetable/view.php?num=35&class=-69` draws its grid in
the browser, as an SVG. The HTML alone holds nothing. The data comes from a JSON
endpoint that an anonymous session can read:

    POST /timetable/server/regulartt.js?__func=regularttGetData
    {"__args": [null, "<tt_num>"], "__gsh": "00000000"}

The endpoint needs a `PHPSESSID`. To get one, first request the public timetable
page. Without it, every call answers `Insufficient privileges`. The script does
this handshake itself.

The answer is the full aSc relational model: `cards`, `lessons`, `groups`,
`divisions`, `subjects`, `teachers`, `classrooms`, `days` and `periods`. This is
richer than the rendered SVG. Extraction is a join, not a parse.

## "School" here means a timetable

`tera.edupage.org` publishes one timetable for each school in the group:
ProTERA ja TERA gümnaasium, SädeTERA, TäheTERA and LõunaTERA. The **School**
picker switches between these timetables. Each one has its own classes, days,
periods and group divisions. The page adapts to the timetable you select.

`--list` names them all with their internal `tt_num`.

## Note on `num=` in the URL

`num=35` in that URL is a retired timetable. A request for it answers
`Insufficient privileges`, and the site falls back to a different timetable
without a word. The real id for the 2026/27 gymnasium timetable is **68**.
Published `num=` values go stale, so this script never depends on them. It
enumerates the visible timetables instead.

## Usage

    python3 tt.py --list                                # timetables and classes
    python3 tt.py -o schedule.html                      # everything
    python3 tt.py --school ProTERA --class 8 -o schedule.html

Two flags exist for the hosted copy. Both are off by default, so an ordinary
build stays reproducible and reaches nothing but EduPage:

    --built 2026-08-23        print the date the data was read
    --goatcounter SITE        count page views at SITE.goatcounter.com

Every visible timetable and class goes into the file whatever you pass.
`--school` and `--class` only choose what the page selects when it first opens.
A `--class` without a `--school` is looked up across all timetables.

| flag | meaning |
| --- | --- |
| `--edupage NAME` | EduPage subdomain (default `tera`) |
| `--year YYYY` | school year for the timetable list (defaults to the current one, and rolls over each August) |
| `--only TEXT` | embed only timetables whose title holds TEXT (repeatable) |
| `--school TEXT` | timetable selected on first open |
| `--class NAME` | class selected on first open |
| `--lang en\|et` | interface language the page opens in (default `en`) |
| `--json FILE` | also write the extracted data as readable JSON |
| `--cache DIR` | where API answers are cached (default `cache/` beside the script) |
| `--refresh` | ignore the cache on disk and read the API again |
| `-v` | show what the script does |

The script needs the Python 3 standard library and nothing else. There is no
pip install and no browser.

For `tera` in 2026 the result is 4 schools, 41 classes and about 1,900 lesson
slots, in a file of about 600 KB. That is 75 KB over the wire, because it
compresses well.

    python3 -m unittest discover -s tests     # the generator
    node --test tests/js/*.test.mjs           # the page's own logic

Both run without a network. `tests/fixtures` holds frozen answers from the
school's API.

## Lesson times and the day plan

The four timetables get their times from three different places. One gets no
times at all.

**SädeTERA** is the simple case. EduPage carries real times for its periods, so
the script uses them as they come.

The others carry nothing in EduPage. Every period reads `00:00`, and the `bells`
table is empty. For these the day plan lives in `BELLS` at the top of `tt.py`,
keyed by a substring of the timetable title. Two schools publish a day plan, in
two different shapes.

**ProTERA runs off a clock.** A day is a sequence of slots. A slot holds either
a paired lesson (`P`, two aSc periods) or a single lesson (`L`). Which one it
holds changes from day to day, and that is what makes the times branch. The
script computes the times rather than list every branch:

    start 9.00 · single = 45 min · paired = 80 min · slots 1-2 always paired
    gaps after slot 1 = 10 min, 2 = 60 min, 3 = 20 min, else 5 min

This reproduces every cell of the printed Päevaplaan. All the combinations fall
out of the clock. The clock gets two details right:

- A slot can hold a single lesson **and** a pair at the same time, for
  different groups. The Päevaplaan writes this as `14.30-15.15 L / 14.30-15.50 P`.
  The slot fixes the start. Each lesson's own length fixes the end.
- Slot 3 shifts the rest of the day, because it can be a single or a pair. This
  is why the 20-minute break named `Amps` falls at 13.35-13.55 on some days and
  at 14.10-14.30 on others. The hour before it, `Vaba aeg`, is fixed at 11.50-12.50. It comes after slot 2, and the first two slots are
  always pairs. Where a school writes a break as a list, the grid shows the part before the
  first comma.

**LõunaTERA publishes fixed blocks instead.** There is no clock to run. Each
block says which aSc periods it holds, and when it is:

    (first period, how many periods, start, end)

Two grade bands run different days. The breaks — Puder, Lõuna/Õue, Hea aeg —
are lessons in the timetable rather than gaps between lessons, so they need no
special handling. A block that covers two periods is one box. What sits inside
the block decides how the script draws it:

- Two subjects, one for each period: this is a sequence. The script makes one
  box that names both, in the order they run. The color comes from the subject
  that fills more of the block, and from the later subject on a tie. A block
  that opens with a warm-up must look like what it becomes.
- Two subjects that share a period: these are choices that run side by side, so
  they stay apart. Each subject's own cards merge among themselves.
- Anything that names a group is left alone. The group already tells them apart.

The script matches class names with the surrounding space ignored, because aSc
hands back what somebody typed. One class is called `Silva `. A literal match
once cost that class every one of its times.

**TäheTERA publishes no times yet.** Its lessons have no times, and the page
says so.

Two more things are worth knowing:

1. The Päevaplaan leaves slot 5 empty in the `3=L, 4=P` column. ProTERA class 8
   does have a lesson there on Mondays. The clock puts it at **15.20-16.05**,
   which matches the same slot in the next column. This is the one
   inferred time in the file.
2. One lesson starts part-way through a slot that other groups take whole
   (ProTERA class 8, Thursday, group 8.k, period 2 only). The day plan never
   splits a pair, so the script claims no time for it. The box has a dashed
   border and reads *"time not in day plan"*.

## Languages

The interface comes in **English** and **Estonian**. The **Language / Keel**
picker in the page switches between them. No rebuild is necessary, and the page
remembers the choice. `--lang et` decides which language a new file opens in.

Only the interface is translated. Everything the school entered stays in its
original language: subject names, group codes, rooms, teacher names and the
break names from `BELLS`. A translation of these stops them matching the
official timetable. Weekday names do follow the interface language, because the
script knows them from the day index rather than from the data.

Both catalogues live in `STRINGS` at the top of `tt.py`. They use the same keys,
with `{0}` for substitutions. To add a third language, add one more entry there
and one more in `LANGUAGES`. Anything a new catalogue leaves out falls back to
English rather than showing a blank.

## Colors

Subjects are colored by family. A printed sheet then reads as "languages are
blue, sciences are green" before you read a word of it. `SUBJECT_FAMILIES` in
`tt.py` maps Estonian keywords onto eight hue bands: literature, language,
computing, maths, science, sport, humanities and arts.

Anything that matches no family gets a golden-angle hue at a quarter of the
saturation. These read as background beside any core subject. Inside a family,
the members spread across the band and get well-separated lightness steps. A
family larger than the lightness cycle gets a second, muted saturation tier, so
the ninth member does not repeat the first.

Every color is paired with black or white text, whichever contrasts better. A
background that lands in the mid-luminance band, where neither text color clears
**WCAG AA**, is moved lighter or darker until one does. All 69 subjects on
`tera` reach at least 4.5:1.

The color controls for each subject override any of these colors, and the page
remembers what you picked. `--json` writes the extracted timetable, not the
palette.

## Hosting it

`deploy/` puts the page on the public internet at
[little.tools/timetable](https://little.tools/timetable/). It is a private S3
bucket in Frankfurt behind CloudFront. A nightly EventBridge schedule runs this
generator in Lambda and writes the result back.

Nothing sits in the request path, so a failed build leaves the previous page in
service. The workflow authenticates with a short-lived OIDC token rather than a
stored key. See [deploy/README.md](deploy/README.md). The cost is about $0.50 a
month for the hosted zone. Everything else stays inside the free tiers.

Every page names itself unofficial under its heading, beside a link to the
school's own timetable page and the date the data was read. A printed sheet
keeps the date and a QR code back to the page, and leaves the rest on screen.
Where visits are counted, the page says so.

What the reader types stays in the reader's browser. Names, group choices,
colors and personal events live in `localStorage` and in the link's fragment.
No browser sends a fragment to a server.

The visit count is the one thing that does leave. Left alone, GoatCounter
reports the page heading with it, and this page builds that heading out of the
child's name. So the page does not report the heading. It counts by hand, once,
from the school's own name for the timetable on screen and nothing the reader
wrote.

The counter keeps one title for each path. As a result, the label goes out as a
path as well: `/timetable/68/8` for ProTERA's class 8. Without this, every class
collapses into one row that shows whichever title arrived last. The path is
a string in a beacon. The address a reader sees and shares stays `/timetable/`.
The label is always in English, whatever language the interface is in, so one
class does not appear under two names in the dashboard. The school's own name
stays as the school writes it.

## Determinism

For the same upstream data the output is byte-identical, so you can generate the
file again and diff it. API answers are cached under `cache/`. `--refresh`
ignores the cache.

Nothing reads the clock or a random source. Subject colors come from the subject
list alone. The hue comes from the subject's family band. The members spread
evenly across that band, the lightness steps through a fixed cycle, and the
saturation drops a tier once a family is crowded. Subjects that match no family
get golden-angle hues at lower saturation. The palette thus depends on which
subjects are present. `--only` changes the colors, because it changes the list.

`--built` is the one deliberate exception, because it stamps a date. It stays
empty unless you ask for it, so an ordinary build stays reproducible.

## The generated page

Nothing chooses a view. The data chooses. A school with a day plan, and a class
that the plan covers, gets the **timeline**. Everything else gets aSc's raw
period grid, which needs no times.

- **Filter** — the school and the class, then one picker for each division.
  Each picker is named after what is taught in it rather than by its group
  codes. A division that carries one subject is that subject (*Ajutreening*).
  Two or three subjects are listed (*Käsitöö / Tehnoloogiaõpetus*). Four or more
  are shortened to the two commonest, with an ellipsis. The pointer gives the
  whole list. The group codes sit underneath as a subtitle. To keep every group
  on one axis, leave its picker on *— all —*. Whole-class lessons always show.
  Divisions with no lessons are dropped. The page remembers the choices for each
  school and class.
- **The timeline** draws a continuous clock down the side, ruled every 30
  minutes, and puts every box at its true start and height. A 45-minute lesson
  is visibly shorter than an 80-minute one. A lesson that does not begin on a
  standard boundary sits where it belongs, rather than in a forced row. Each box
  carries its own start and end time. Lessons that overlap — several groups at
  once, when no filter is set — share the column the way a calendar does. Breaks
  are hatched bands. The one lesson whose exact time the day plan does not define
  gets a dashed border and a `?`.
- **The period grid** is the fallback: aSc's own periods, one column each. A
  lesson over several periods repeats in every period it covers, and the
  continuation is dimmed. Where the school publishes period times, the headers
  show them.
- **Display options** sets what each lesson box says. The teacher, the room, the
  study group and the subject are independent of each other. The teacher and the
  subject each choose between the full name and the school's abbreviation.
  **Lesson colors** offers three answers for every subject: the generated
  palette, the school's own colors from aSc, or colors of your own. A click on
  any lesson in the timetable also recolors its subject. The text flips between
  black and white for whatever color you choose.
- **Title** is three independent rows: the student name, the school name and the
  class name. Each row has a checkbox and a field. The two rows that come from
  the timetable are pre-filled with what it says, so you can change one word
  without retyping the rest. Text typed into any row ticks that row. The result
  appears above the timetable as you type it, and that is what prints.
- **My own events** — one row for each thing the school does not know about.
  A row holds a weekday, a span, a label and its colors, in that order. When
  comes first, then what. There is no syntax to get wrong and no color to spell. A row that cannot
  be drawn says so underneath. An event on a day the school week does not cover,
  such as a Saturday rehearsal, adds that day.

  Each color is a small set of radio buttons, with the control beside the option
  it belongs to, so nothing is a dead click. For the background: **own color**
  with a picker, or **copy from subject** with a list of the lessons on screen.
  Copy from subject takes both of the lesson's colors. That is the quickest way
  to make a training session look like the subject it belongs with. For the
  text: **own color**, or **automatic**, which is black or white depending on
  what reads better on the background. Nothing else about the box changes either
  way. A choice about text is not a choice about borders.

  The color columns are named and laid out as the subject list's columns are.
  The two tables do not line up column for column, because the subject list has
  no *when*. There was nothing to gain by bending this order to match it.

  Each row ends with **how it looks**. This is the box drawn as the timetable
  draws it, with its colors and its name, sized as a 45-minute lesson. Reading a
  hex code and imagining the result is the part nobody can do.

  For a bulk edit, such as a term's worth pasted in at once, the whole settings
  object is in **Save and restore settings**. Events are a plain list there.

  Events are drawn **on top of** the timetable rather than beside it, so the
  lessons keep their full width. An event is inset a little where something sits
  underneath, so what it covers still shows at the edge. Where the hour is empty
  it is drawn full width. It looks exactly like a lesson, whatever its colors
  are. The period grid has no geometry to draw over, so events get a **My own**
  column there instead.
- **Share** copies the address, because the address is the whole configuration:
  group picks, colors, events, names, language and every display switch, all in
  the fragment. Only what differs from the defaults goes in, and only the class
  on screen. This keeps a typical link near 140 characters. It also means that
  sharing one child's timetable does not hand over a sibling's name. The
  fragment never leaves the browser. A link that you open merges what it carries
  into what this browser already had, rather than replacing it.

  Settings are JSON, UTF-8, base64url. Past a certain size the script gzips them
  first, and writes `#z=` rather than `#s=`. This takes a link that carries every
  subject recolored from about 4,800 characters to less than 1,600. That is not
  tidiness. A QR code holds about 2 kB. The compression is the difference between
  a printed sheet you can scan and one that falls back to printing the address.
  Small links stay uncompressed, because gzip's header makes them longer. The
  page reads both forms.
- **Print…** lays the page out for A4 landscape and prints it. Printing is a
  moment, not a setting: the page returns to normal afterwards. The timeline
  scales itself to fill exactly one sheet. The scale is measured, not guessed.
  The colors survive even with Chrome's "Background graphics" unticked, which is
  its default, because the page forces `print-color-adjust: exact`.
- **The printed sheet** carries the date the data was read and a QR code of the
  link, captioned *Edit it here*. A sheet on the fridge can then be picked back
  up on a phone with every choice still on it. The page's other furniture — the
  disclaimer, the source link, the controls — stays on screen.
- **Save and restore settings** holds the whole configuration as JSON, to copy
  or to paste back, and **Reset all settings**. The panel says in a sentence
  what the box is for, because "settings as JSON" means nothing to a parent. A
  second sentence says the same settings ride in the link. The address bar
  already holds that link, because every change rewrites it, so the note says
  to copy it from there. The **Share** button does the same in one press. The
  note prints the button's own label, so the two cannot drift apart across a
  rename or a language.
- **Language** switches the interface between English and Estonian. Everything
  the school entered stays in the language it was entered in. That is the subject
  names, the group codes, the rooms, the teacher names, and the line the school
  prints under its own timetable.
- All state lives in `localStorage`, so each reader sets it up once.

## The settings, as they are stored

`localStorage`, the link's fragment and the settings box all hold the same
object. Two rules shape it. The field names are what the interface calls things,
so a reader can tell which control each name belongs to. Everything that belongs
to one class sits in that class's own subtree, rather than each setting keeping
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
  "subjects": {
        "Matemaatika": { "label": "Maths", "style": "custom",
                     "backgroundColor": "#83EC9B" },
    "Kunst": { "style": "palette" },
    "Vaba aeg": { "label": "Free time" }
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

Some of these choices are not obvious:

- **`studyGroups` is keyed by the choice on offer**, `"Alfa/Beeta/Gamma"`. It is
  not keyed by aSc's own identifier for that division, which is `"*5:1"` and
  means nothing outside the feed.
- **`subjectColorStyle` says what every subject does**: `palette` (the generated
  one), `school` (the timetable's own), or `custom` (yours). It was two
  checkboxes that layered on each other. Nobody can guess that by looking.
- **`subjects` is where one subject differs from that.** It holds only the
  subjects somebody touched. An entry can carry a `label` of the reader's own, a
  `style`, a color, or any of those together. Named breaks appear here as well,
  keyed by the name the school gave them. The example above runs on the school's colors, with maths in a color of
  its own and art left on the generated palette. One global switch cannot
  express that. This map is not per class: a subject keeps its color wherever it
  turns up, which is rather the point of coloring it.
- **The subject list is the same table** as the events list, one subject to a
  row. It starts collapsed, because a class has twenty-odd subjects and most
  people never touch it. Every row carries a **Label** field. The school's own
  word for the subject sits behind it as a placeholder, so one word can be
  changed without retyping the rest, and an empty field means "use the
  school's". A name of your own is never abbreviated, because you already wrote
  it as short as you wanted it.
- **The named breaks are rows in that table too**, so *Vaba aeg* and *Amps* can
  be renamed and recolored like any subject. They sit after the subjects, under
  a heading of their own, because a gap is a different kind of thing from a
  lesson. Among themselves they run in clock order, the order the day runs
  them: the midday hour first, the afternoon snack after it.

  A break keeps its diagonal hatch, which is what says "not a lesson". The
  stripes are translucent, so the color underneath shows through. The default
  color is a quiet grey rather than one from the subject palette. A break runs
  the full width of the day, so a palette color wins every glance, which is
  backwards for a gap. Each row says what that subject
  really does: **own color**, **from the timetable**, or **automatic**. A subject
  set to "own color" with no color behind it reads as automatic, because that is
  what gets drawn. The sample at the end of the row takes the room and teacher
  from a real lesson of that subject. It is the box as it will appear, rather
  than an empty shape.
- **The three radio buttons above the list set every subject.** They clear any
  per-subject style as they go. Chosen colors survive, so a switch back to "my
  own" restores them. Without this, a row can sit there and ignore the switch
  that claims to govern it.
- **Weekdays are stored as `Mon` to `Sun`**, in English whatever the interface
  language is, so the file reads the same for everyone. The interface shows them
  in the reader's own language.
- **A field that is absent means "nothing set".** The written form holds no `""`,
  no `{}` and no `[]`. Reading puts the defaults back, so the code that uses the
  settings always sees every field. Only the file is spared them. An event with
  no `textColor` thus gets black or white, whichever reads better on its
  background.
- **A subject can carry a `textColor` too.** It holds whatever the background
  came from. An event follows the same rule, because there is no reason for the
  two to differ.
- **`classes` is a map**, rather than the class keys sitting at the top level. A
  class named `lang` then cannot collide with the setting of that name.

A link carries only what differs from the defaults, and only the class on
screen. Most of this object is thus absent from a typical link. Past about a
kilobyte the link is gzipped as well, as `#z=` rather than `#s=`. That is what
keeps a heavily customized link inside what a QR code can hold.

## Verification

CI runs `python3 -m unittest discover -s tests` and
`node --test tests/js/*.test.mjs` on any push that touches the code, the tests,
the vendored library or the deployment. Neither suite touches the network.
`tests/fixtures` holds frozen answers from the school's own API, so a build
takes a moment. CI never spends the rate limit that the nightly publish needs.

The Python tests cover the reasoning the generator does for itself. That is the
bell clock against the printed Päevaplaan, LõunaTERA's published blocks, the
rules about which lessons merge, and the color palette. For the palette they
check the contrast against WCAG AA, and the separation between members of one
family. They also cover the parts of the pipeline where a mistake is silent
rather than loud.
One whole day of one class is pinned outright, every box with its period, groups
and printed time. The arithmetic that turns a slot into a time had its pieces
tested and not the sum of them.

Several tests are invariants over a whole build rather than examples. No class in
a school that publishes times can have an untimed lesson. No lesson can be drawn
twice in the same place. None can be implausibly short. Every subject drawn must
have a color and an abbreviation. Each invariant was written because it had just
happened. One test exists only to keep the rest honest. It checks that the
fixtures really do produce 1,935 rows across 41 classes. Every invariant above
loops over the lessons, and passes an empty week without complaint.

The JavaScript tests run `page.js` itself under a small stand-in for the
browser. The fixture holds two schools, one with a day plan and one without, so
both the timeline and the fallback grid really run. The tests cover the reader
for saved events, the settings normalizer, the share link written and read back,
the calendar packing, and the escaping.

The escaping test pushes hostile text through every channel that carries it.
Those channels are the school's own subject, teacher, room, day and class names,
and everything the reader can type. The test then checks the rendered markup in
both views. It is deliberately end to end, rather than a test of `esc()` alone,
because `esc()` was well tested and the calls to it were not.

The suite itself is checked by breaking things on purpose. A change is made to
the generator or the page, and the tests must fail. Anything that can break in
silence is a gap. The tests above were written from what such a pass turned up,
rather than from reading the code.

Beyond the suite, the extraction was checked against the official rendering. All
70 lesson boxes for ProTERA class 8 match the school's own page. The 69 boxes
that carry a tooltip match by subject, groups, teachers and room. The one box
that carries no tooltip matches by the text the page draws. The bell clock was
checked cell by cell against the printed Päevaplaan, and LõunaTERA's blocks
against the school's published day plan.

The QR code is checked by decoding it. The printed page is rasterized and read
back with an independent decoder. The string is then compared to the link,
character for character. The printout was also rendered to PDF with the
background graphics off, to check that the colors still come through. The pages
were counted, to check that there is one.

The CloudFormation templates pass `cfn-lint` in CI. `node --check` runs against
`page.js`, because a backslash typo in it once shipped a blank page with CI
green.
