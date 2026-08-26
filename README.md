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
slots, in a file of about 660 KB. That is 91 KB over the wire, because it
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

**One timetable can hold two schools.** School 68 is published as "ProTERA ja
TERA gümnaasium", and the gümnaasium does not keep the ProTERA day. Its
classes are the ones named `G1B`, `G2M` and so on, and they run four lessons of
eighty minutes:

    start 9.00 · every lesson 80 min · slots 1-4 always paired
    Hommikuamps 8.30-8.55 · gaps after slot 1 = 10 min, 2 = 50 min (Lõuna),
    3 = 10 min

Read against the grades below it, its afternoon ran ten and then twenty minutes
late. So a bell schedule can carry variants, chosen by what the class is named.
`Hommikuamps` is a break before the first lesson, which is why it is written as
a clock time rather than a length: there is nothing in front of it to measure
from.

**SädeTERA publishes a day plan per class**, and a class is the unit: the
school is small enough that a class stays together for every lesson, so there
are no groups to split. What it does have is two lunch sittings, grades 1-3 and
grades 4-6, which is why the fourth lesson ends at 12.05 for the younger half
and 12.20 for the older — and why one plan for the school cannot be right for
all of it.

This ran on a clock with fixed periods, and it was wrong on one box in five. A
clock has to guess which lessons in a row are a double, and the guess is not
derivable: the school decides, class by class and day by day. So the published
sheet is copied in, 135 blocks of it, in the same shape LõunaTERA uses.

A published plan lists lessons, not the spaces between them. Most of those
spaces are a corridor and one is lunch, so both when and how long decide it.
Length alone is not enough in either direction: one Tuesday's lunch is 20
minutes, and one Wednesday leaves 35 minutes in the morning that is not lunch
at all. A space counts when it runs 20 minutes or more and starts between 12.00
and 12.45.

A day can also stop before lunch, and then there is no second block to measure
a space against — four Fridays do. Those children still eat, so the sheet's own
heading is drawn instead, `Lõuna- ja loovaeg 12.00-13.00`, starting no earlier
than the last lesson ends. Every one of the thirty class-days now carries
exactly one lunch, which a test holds it to.

Hand-copied data goes stale. The build already warns when a lesson lands where
the plan has no slot — which is what a republished sheet looks like from here —
and a metric filter on that warning raises an alarm, so a plan that has moved
on says so instead of quietly drawing last year's times. It earned its keep on
the first run: it caught two lessons the transcription had missed.

**TäheTERA publishes nothing to EduPage** — no day plan, no period times — so
its classes fall back to the plain grid. A sheet arrived for one class of
fourteen, and one class is what is encoded. The others are not guessable from
it: 5.a alone has the fourth lesson ending at 12.05 on a Monday and 12.20 on a
Wednesday, so a clock that looks regular is not one.

The sheet did settle something for the whole school, though. EduPage labels
period 5 `HA`, which reads as a break, and it is not one — it is the fifth
years' language lesson. Only 5.a, 5.l and 5.t use it, on Monday and Thursday.
For the other eleven classes it is empty, and there it really is the break.

Around midday the fifth years split, and the sheet writes it as two rows that
each hold a lesson and lunch in the opposite order. The school gave the split:
one group takes the language at **12.10-12.55** and eats after, the other eats
first and takes it at **12.55-13.40**. Two rows, two periods in the timetable,
so both are drawn.

On Monday and Thursday, then, the school publishes no lunch band. Lunch is a
different hour for each group, and a band across the class would be wrong for
half of it. It does not need one: a reader who picks their language group is
left with their own lunch as the free time around that lesson, found by the
same rule that finds any other gap.

The other three days do not split, and there the sheet leaves ten minutes
between the last long block and the closing lesson. It gives that row no
times, so ten minutes is what is drawn.

A gap found by the same rule says what it is. The school gives a window —
midday, at least half an hour — and a hole that fits it is drawn as `Lõuna`
rather than the generic `Paus`. Fifteen minutes between two lessons is not a
meal, and a free hour in the morning is not one either. A school that names no
window goes on saying `Paus`.

Where the class also has a published band of that name, the two are the same
meal, so they are one row in the subject table, one color and one name — and
the worked-out one is drawn as a hatched band like the published one, because
Monday's lunch and Tuesday's lunch are the same thing. Only a class whose
lunch is never published gets a row of its own, under the key `lunch`.

Which class eats when is a canteen decision, not a school-wide one. A school
can name more than one break window, and a window can name the classes it
belongs to, so the ten-minute band is 5.a's alone until the other sheets
arrive.

**LõunaTERA publishes fixed blocks instead.** There is no clock to run. Each
block says which aSc periods it holds, and when it is:

    (first period, how many periods, start, end)

Two grade bands run different days. The breaks — Puder, Lõuna/Õue, Hea aeg —
are lessons in the timetable rather than gaps between lessons, with a
supervisor and a length. The school says which subjects those are, and the page
draws them the way it draws every other school's breaks: hatched, quiet grey,
and listed under the breaks heading rather than among the subjects.

A break names no teacher. aSc wants one on every card, so LõunaTERA's carry
`Vahe Paus` — "break pause" — on all 123 of them. Nobody reads a break to find
out who is supervising it, so the name and its abbreviation both go. A block that covers two periods is one box. What sits inside
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

**The subject that covers the most paper gets the lightest step.** A family's
most common member is put first, and the first step is the lightest one. A week
is mostly its commonest subject — `Üldõpetus` is 219 lessons, and it filled
every junior class in a deep slate, which read as a wall. Light where it
repeats, saturated where it is rare, is the way round that reads.

Only the leader moves, and only where it leads by a wide margin, so a rebuild
does not shuffle the week's colors. `Inglise keel` has 282 lessons against the
next language's 32.

A box shows the clock, the subject, and — where there is room — the room,
teacher and group. "Where there is room" is 46 pixels, which is exactly a
45-minute lesson: three tight lines come to 36, and the box gives its content
its height less the border and the padding. The old threshold was 54, so a
SädeTERA week, which is mostly 45-minute lessons, named no teachers at all.

A break does the same: a short band puts its name and its clock on one line
rather than dropping the clock.

The day is drawn at **1.8 pixels a minute** on screen. It was 1.05, which put a
ten-minute break under the height of one line of type — TäheTERA has one
between its second and third lessons — and left the shortest bands to be
squeezed until they were barely words. A page scrolls; a lesson that cannot be
read does not get better further down. A day now runs 720 to 830 pixels rather
than 430 to 490. Printing passes its own scale and is untouched, so the sheet
still fits one page. The times either side of a break are the
one thing a reader cannot work out from the lessons around it.

Nothing in a box wraps past its bottom edge. The clock never wraps, the detail
line is one line cut with an ellipsis, and the subject takes at most three
lines — one in a box only tall enough for one. Before that, 104 boxes were
cutting text mid-line, which reads as a rendering fault rather than as a name
too long for the space.

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

  A link this page wrote and cannot read is said out loud, above the filter,
  and what it says is that the timetable below did not come from the link —
  which is true whether the page fell back to its own defaults or to what this
  browser had stored. It used to be dropped in silence, and the reader believed
  what came up was what had been shared. The usual cause is a link cut
  short on its way through a chat window, which the reader can do something
  about — but only if they are told. A fragment that is not ours, an anchor
  somebody appended, is not a fault and says nothing. The notice is not
  printed: the sheet is the timetable, not a note about how the reader got to
  it.

  Each one is logged and none of them wakes anybody. A handful a week is
  normal and none is a fault in this page. A lot of them at once would say the
  links have grown too long for something to carry, which is worth being able
  to see.

  Which class the page opens on comes out of the school's own timetable, and it
  moves when the school moves one. A link written when the class it was about
  happened to be that class carried no class of its own — there was nothing to
  write down — and from the day the default moved, it showed a different week
  than the one that was shared. It still says which class it is about, in the
  one per-class bag it carries, so a link that names exactly one class and does
  not say which to show now shows that one. Every link written from now on
  carries the class outright.
- **Print…** lays the page out for A4 landscape and prints it. Printing is a
  moment, not a setting: the page returns to normal afterwards. The timeline
  scales itself to fill exactly one sheet. The scale is measured, not guessed.
  The colors survive even with Chrome's "Background graphics" unticked, which is
  its default, because the page forces `print-color-adjust: exact`.
- **How long a lesson lasts** is written beside its clock: `9.50–11.10 (1 hour
  20 min)`. Subtracting one time from the other is work a reader should not
  have to do to find out whether a lesson is a single. An exact hour drops the
  minutes, and Estonian counts one differently from many, so the hours come
  from two strings rather than one with an `s` stuck on.
- **A gap of fifteen minutes or more** is drawn as a break of its own, saying
  only how long it is — the lessons either side already say when it starts and
  ends. Fifteen minutes is where a hole stops being a corridor and becomes time
  you can plan around. It counts the whole day: the lessons, the school's own
  breaks and the reader's own events, so the hours between the last lesson and
  a training session in the evening show up too.

  A plain gap is worked out here rather than published, so it wears an outline
  instead of the hatch a school's own break wears — in the subject table as
  well as in the day, because a sample that does not look like the thing it
  stands for is worth less than no sample. It is still listed in the subject
  table with the other breaks, under the key `gap`, and can be renamed and
  recolored like any of them. A hole the school's window says is lunch is the
  exception: it is a meal, and it is drawn as one.
- **An hour where every day is empty is cut out of the axis.** A training
  session at six in the evening otherwise pushes the whole afternoon off the
  screen, and the emptiness it pushes it with says nothing. A stretch of
  45 minutes or more with nothing on any day is drawn at a sixth of the scale,
  between 26 and 64 pixels. Everywhere anything happens keeps the scale it had:
  no lesson is squeezed to make room, because squeezing what a reader came to
  read is the wrong trade.

  The clock runs down a strip of its own, carried on from the day headings
  above it, and where the axis jumps the strip is torn across. A piece the
  shape of the gap is lifted out, and the two edges left behind match each
  other the way the two halves of a torn sheet do. The tear sits clear of the
  clock at either end, since a label is centred on its own minute and half of
  it hangs into the cut.

  A band across the days was drawn there first, and it was wrong twice over. It
  wore the same stripes as a break, so it read as one, and the day's own boxes
  are drawn over the top of it — the worked-out break that fills the same hours
  hid it on every day that had one, leaving stripes only on the days that did
  not. It also covered the tick label at the top of the cut. A scale belongs
  beside the scale.
- **The plain grid** — what a school with no times at all gets — runs weekdays
  across the top and periods down the side, the same way round as the timeline.
  It used to be transposed, so the two views of one week read differently.
  Periods the class never reaches are dropped from the bottom; an empty one in
  the middle stays, because it is a break and the numbers either side say so.
- **Printing** goes through one path, whether it starts at the button or at
  Cmd+P. The stylesheet applies either way, but only the button used to switch
  the page into print mode, so the keyboard shortcut printed a sheet with no QR
  code, no scaling and the screen's footer. A `beforeprint` listener does that
  now; the button still does it by hand as well, for a browser too old to fire
  the event, and both are guarded so neither renders twice.
- **The printed sheet** carries the date the data was read and a QR code of the
  link, captioned *Edit it here*. A sheet on the fridge can then be picked back
  up on a phone with every choice still on it. Past about 2 kB no code holds the
  link, and the corner is then empty. It used to print the address as text
  instead, which was worse than nothing: an address too long for a code is far
  too long to type. The page's other furniture — the
  disclaimer, the source link, the controls — stays on screen.
- **Save and restore settings** holds the whole configuration as JSON, to copy
  or to paste back, and **Reset all settings**. The panel says in a sentence
  what the box is for, because "settings as JSON" means nothing to a parent. A
  second sentence says the same settings ride in the address. The address bar
  already holds it, because every change rewrites it, so the note says to copy
  it from there. The **Share** button does the same in one press. The note
  prints the button's own label, so the two cannot drift apart across a rename
  or a language. A third sentence says that the printed sheet carries the same
  address in the QR code in its bottom right corner. That matters for the same
  reason the second sentence does: a sheet handed to somebody is a copy of the
  settings, which is not obvious from a grid of lessons.
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
  "showDuration": true,
  "showGaps": true,
  "printMargin": 5,

  "subjectColorStyle": "school",
  "subjects": {
        "Matemaatika": { "label": "Maths", "style": "custom",
                     "backgroundColor": "#83EC9B" },
    "Kunst": { "style": "palette" },
    "Lastekoor": { "hide": true },
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

  A subject can carry three names, and they are three different strings. The
  school files it as `Gümn Inglise keel`; the page shows `Inglise keel`, with
  the prefix its own timetable puts on it taken off; and a name of yours beats
  both. The prefix comes off the name **shown**, not off the name the subject is
  filed under, because five of these have a twin taught in the grades below
  with an abbreviation of its own — `Inglise k (B2)` against `Eng` — and one
  entry cannot hold both. So the two keep their own colors, and the settings
  hold the school's name as the key. The prefix was also carrying the capital,
  so the first letter of what is left takes it over: `Gümn programmeerimise
  algkursus` shows as `Programmeerimise algkursus`. Only the first letter — the
  words after it keep the school's own casing.
- **The paper edge is the reader's to set.** Five millimetres, nine, or
  fourteen for a hole punch. Five is the default and about as narrow as a laser
  printer takes without clipping. Every millimetre saved is one the timetable
  can use, and on a tight class that is the difference between a readable box
  and a cut line. An `@page` rule cannot be reached through a class or a custom
  property, so the whole rule is rewritten when the setting changes. The fitter
  that scales a sheet to one page reads the same setting, or it would measure
  against paper of a different size.
- **Every row has a switch**, ticked to begin with. Not every subject in a
  timetable is every child's: a choir sits in the class's week and in nobody
  else's afternoon. Clearing the tick drops that row from the day and from the
  printout, and leaves the row in the table so it can be brought back. It is
  stored as `"hide": true` against the subject. The hole it leaves is read like
  any other, so it becomes a break, or the day simply ends earlier. The switch
  rides in the settings with the names and the colors, so a shared link carries
  it.
- **The named breaks are rows in that table too**, so *Vaba aeg* and *Amps* can
  be renamed and recolored like any subject. They sit after the subjects, under
  a heading of their own, because a gap is a different kind of thing from a
  lesson. Among themselves they run in clock order, the order the day runs
  them: the midday hour first, the afternoon snack after it.

  A break keeps its diagonal hatch, which is what says "not a lesson". The
  stripes are white at two strengths rather than white against black: the dark
  half of the old pair sat under the words, and a twenty-minute band writes its
  name and clock straight across them. Worst-case contrast goes from 6.3:1 to
  7.3:1.

  The two stripe colors are mixed in `page.js` against whatever color the band
  carries, and written onto the box opaque. They used to be translucent white
  in the stylesheet, and a printer rendered the translucent half as solid black
  — on paper only, never in a PDF, which is the sort of thing a driver does
  with alpha it would rather not composite. Nothing is left for a driver to
  blend. The default
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

Measured, rather than guessed at:

| | covered |
| --- | --- |
| `page.js` | 96% of code lines |
| `tt.py` | 89% of statements |
| `deploy/publish.py` | 97% |
| `deploy/lambda_function.py` | 100% |

The `page.js` figure is the two runs together: 87% under the stub, 87% in a
real browser, and different 87% each time. The stub reaches the reasoning and
the browser reaches the wiring, and neither reaches the other. What is left is
mostly the clipboard, which a page opened from a file cannot use, and the
posting of a fault report, which would leave the machine.

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

A stub has no DOM to click through, so the decisions the controls make are
named functions rather than the bodies of listeners: `applySettingsText`,
`resetSettings`, `editEvent`, `eventFieldFor`. Each takes plain values and
hands back a plain answer, and each has a test of its own. The listener beside
it is then two lines, which is about as much as can be checked by reading.

Doing that found two faults on the spot. A reset read `klass` off the state,
which has no such key — the state calls it `class` — so it dropped the reader
back to the class the page opens on. And `hide` never survived being written
down and read back, because the settings reader keeps only the fields it knows
and nobody had added that one. Both had gone unnoticed because a listener
cannot be reached from a stub.

### The browser tests

`tests/test_browser.py` drives a real Chrome over the DevTools protocol, with
no automation framework and nothing to install. It is where the two questions a
stub cannot answer are asked: does the printed sheet fit, and does pressing
something do what it says.

Every class is laid out at print scale and measured against A4 landscape less
the reader's margin, and every box is checked for text cut off by its own edge.
Both were run by hand before, from a script that lived outside the repository —
which is verification that disappears when the terminal is closed. The first
run of the checked-in version found a real fault: a ten-minute break, scaled
down to fit a full week onto one sheet, came out three pixels shorter than the
line of type inside it.

The rest of the file presses things: Share, Apply, Reset, the subject switches,
the whole event editor from the add button to the drop button, a display
switch, a study group, the language. It also checks that the page asks the
network for nothing, on screen and while printing.

Without a browser these tests skip rather than fail, so a checkout with no
Chrome still runs everything else. `CHROME_BIN` names one.

### The golden records

Both suites above pin one rule on one class. Between them they say nothing
about the other forty, so a change to a shared piece — the packing, the axis,
the palette, a bell schedule — can move boxes that no test names.

`tests/golden/` holds one file per school. Each is a record of what the page
draws for every class in it, twice: the full view, with every group side by
side in its lane, and then one week per set of study group picks. Every box is
one line, and the line carries the day, the kind of box, the subject, the top,
the height, the lane, the width and the text. The axis ticks, the cut bands and
the height of the sheet are recorded beside them. Classes the plan gives no
times to are recorded as grid cells, because that is the view they get.

What it is for is the week itself: the bells, the breaks, the double lessons,
the splits — the reading of each school's own plan, which is where the work
went and where a regression would be silent. Nothing is switched off and
nothing is added. The controls a reader works with — hiding a subject, adding
an event, choosing a color — have tests of their own that say why each is
right. Recording them here as well would only make the file move whenever a
control changes, which is the noise that stops anybody reading the diff.

The generator is inside the loop. The record is taken from a page built out of
`tests/fixtures`, so a changed bell window moves the record exactly as a
changed renderer does. A build takes about a fifth of a second, and the whole
comparison runs in well under one.

When a change is meant to move boxes:

    node tests/js/update-golden.mjs

Then read the diff before committing it. A record updated without reading the
diff is worth nothing: the value of the file is that somebody looked at what
moved. The failure names the school, the class, the setting and the first few
lines that differ, so the diff is usually short enough to read in the failure
itself.

Two of the tests guard the record rather than the page. One checks that every
class got both, so the file cannot quietly stop covering a school. The
other moves a box by a pixel and checks that the comparison would have caught
it, because a record that cannot fail is worse than none.

### Escaping

### Talking to EduPage

`tests/test_client.py` replaces `urlopen` and `sleep` for the length of a test,
so a backoff of eighty-five seconds costs nothing and no socket is opened. It
covers the parts that only a bad night reaches: a rate limit waited out, a
broken server given up on, a refusal not retried at all, a lapsed session that
answers with a login page and HTTP 200, and a half-written cache file fetched
again rather than kept for ever.

That last one found a fault too. A run stopped between writing the cache beside
its place and moving it in left the part file behind, in a directory that is
checked in.

### The publisher

`tests/test_publish.py` stands the bucket up as a dictionary and CloudFront as
a list. It covers what reaches the site and what does not: the first run, a
page that only moved its build stamp, a page that lost a school and is
refused, the override for when a school really has closed, and the pages around
the timetable, which go up on every run so an edit to either reaches the site
on a quiet day. Both stores are driven against a fake `subprocess` and a fake
client, so the content type and the cache rule are read off the calls they
would have made — and the two paths are checked against each other, since a
header set on one and not the other is a page that behaves differently
depending on where it was published from.

### Escaping

The escaping test pushes hostile text through every channel that carries it.
Those channels are the school's own subject, teacher, room, day and class names,
and everything the reader can type. The test then checks the rendered markup in
both views. It is deliberately end to end, rather than a test of `esc()` alone,
because `esc()` was well tested and the calls to it were not.

## When the page breaks

A fault in the browser used to leave a half-drawn page and tell nobody. The
page now posts one report to `/report` on its own site, which a Lambda answers
by writing a line to CloudWatch. An alarm mails the same address the build
alarm uses.

Three decisions shape it, and all three come from what the page holds.

- **Nobody else is in it.** Bugsnag and Sentry both capture `location.href` as
  the context of an error. This page keeps every setting in the address, so a
  stock install would have sent a child's name and school to a third party on
  every crash. The endpoint is same-origin instead, so `connect-src` stays
  `'self'` and the report never leaves the account.
- **The report carries the shape, not the words.** The settings are the most
  useful thing to read a fault against: which switches are on, how many events
  there are, which subjects carry a color. So they are sent, with every word
  the reader typed replaced by as many `X` as it had characters —
  `"studentName": "XXX"`. The length is what explains a broken layout, and a
  report weighs what the real one weighs, which matters because the page
  truncates at 4000 bytes. See `scrubbed()` in `page.js`, and the test that
  fails if any typed word survives.
- **The address is never sent.** The path is. The address carries the settings,
  and the settings carry a name. That took two goes: the field naming the file
  a fault happened in is the page's own address for an error in the page, and
  it arrived with 269 characters of a reader's settings in it. Everything from
  the `#` or the `?` comes off now, and a test holds it there.
- **An error from something the reader installed is logged, not alarmed on.**
  A wallet extension failing to set `window.ethereum` has nothing to do with a
  timetable and nothing here can fix it. Neither can an error the browser will
  not describe, which is what an injected script looks like when it is loaded
  from somewhere else.

Five reports per page load, one per distinct message. A fault inside the
drawing code fires on every repaint, and a reporter that reports its own
reporting never stops.

The way in is an HTTP API, and it took two tries to learn why. A Lambda
function URL is the smaller thing and was the first choice. It cannot be
reached without authentication in this account, which sits in an organization
that forbids that. CloudFront cannot supply the authentication either: its
signature does not cover a request body, and the body is the whole payload. An
HTTP API has neither limit.

The API is reachable by anyone who finds it, so a header CloudFront alone adds
is what the function answers to. A direct POST without it answers 403. That is
a gate on noise, not a secret worth guarding: the worst a leak buys is a log
line.

One trap worth knowing, because it hid the first failure: `CustomErrorResponses`
applies to the whole distribution. A 403 from the report origin came back as
the site's own 404 page, which reads like a routing mistake rather than a
refusal. The other half of that first failure was the path pattern. CloudFront
matches it without a leading slash, so `/report` matched nothing and the
request fell through to the bucket.

## The icon

Inline, as a `data:` URI, on all three pages — the timetable, the root and the
404. Without one a browser asks for `/favicon.ico`, and there is nothing at
that address, so it is handed the 404 page as an image and logs a failure. The
icon is a week: five columns, one a day, hanging from the morning down the way
lessons fill a day, tall at both ends and dipping between so the shape survives
being shrunk. It costs 607 bytes and no request.

It appears three times, from one string in `tt.py`: as the tab icon, beside the
heading on screen, and in the bottom left of the printed sheet next to the
site's address. That last one is the opposite corner from the QR code, and the
two say different things — the code goes to *this* reader's timetable, the
address says where anybody can get one of their own. The address is read off
`location` rather than written down, so it cannot name somewhere the page is
not.

## Feedback

The way in is a link in the subtitle, beside the source link — the line at the
top where this page keeps its own business. It opens the last panel on the
page. The subtitle is rebuilt on every render, so the link is handled by one
listener on the document rather than its own.

It asks for anything, not only faults: what is missing, what is wrong, what can
be better, or that it all works. Worded as a bug report it would collect only
bug reports, and most of what a reader has to say is not one.

The same endpoint takes a message from a reader. A panel on the page has a text
box, a Send button, and a checkbox that attaches your settings. Tick it and the
exact payload appears on screen, in full, before you press anything — the panel
shows `JSON.stringify(feedbackPayload(), null, 2)` and sends that same object,
which a test holds to.

Those settings are **not** scrubbed, unlike a fault report. The reader asked for
them to go and can read every character of what goes, a child's name among them.
That is the difference between a report the page sends by itself and a message
somebody chose to write.

A second metric filter counts these apart from faults, so the mail says which
arrived. The message is capped at 2000 characters, and the panel is not drawn at
all when there is no endpoint to post to.

`REPORT_ERRORS=no` in `site.conf` switches off the endpoint and the posting
together, so the page can never post to a path nothing answers. That takes the
feedback panel with it.

## What runs in a reader's browser

Two libraries are copied into `vendor/` and inlined, so whatever is in them
runs on a reader's machine. A test pins the SHA-256 of each file. They were
checked against upstream byte for byte — `qrcode-generator` 1.4.4 exactly, and
`fflate` 0.8.2 exactly once the license this repository prepends is taken off.
A changed byte is either an upgrade nobody wrote down or somebody else's idea,
and either way it fails the build.

A second test says the page builds no code out of a string — no `eval`, no
`Function` constructor — and reaches the network in exactly two places, both
of them calls this repository makes. No `XMLHttpRequest`, no `WebSocket`, no
`sendBeacon`, no image pings.

One script is loaded rather than inlined: the visit counter, from `gc.zgo.at`.
The policy names that host exactly, so nothing else can be fetched and nothing
can be sent anywhere unnamed. A page load makes two external requests and no
others: that script, and the counter's own beacon.

None of this stops a browser extension. An extension runs in the page whatever
the policy says, which is where `window.ethereum` came from in a fault report.
That is why an error naming an injected global is logged rather than alarmed
on.

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
