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

**One timetable can be offered as two schools.** ProTERA and TERA gümnaasium
share a file and nothing else: the gümnaasium keeps a different day, starts its
year on a different date, and a reader of one has no use for the other's
classes. So the picker offers them apart — `split` in `BELLS` says which class
prefix belongs to which — and four timetables become five entries.

The first part keeps the timetable's own number as its key, so a link written
before the split still names something. A link naming a class the other half
now holds is not broken either: the class is the more specific of the two and
decides, and the page follows it to the right half. And a reader's own settings
are filed under the **timetable** rather than under the picker entry, so
splitting a school renames nothing anybody has saved.

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

For `tera` in 2026 the result is 5 schools, 40 classes and about 1,800 lesson
slots, in a file of about 805 KB. That is 136 KB over the wire, because it
compresses well.

    python3 -m unittest discover -s tests     # the generator
    node --test tests/js/*.test.mjs           # the page's own logic

Both run without a network. `tests/fixtures` holds frozen answers from the
school's API.

## Lesson times and the day plan

All four timetables are timed, from three different places.

**SädeTERA** is the simple case. EduPage carries real times for its periods, so
the script uses them as they come.

The others carry nothing in EduPage. Every period reads `00:00`, and the `bells`
table is empty. For these the day plan lives in `BELLS` at the top of `tt.py`,
keyed by a substring of the timetable title. Three schools publish a day plan,
in two different shapes.

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
  at 14.10-14.30 on others. The hour before it, `Proaeg`, is fixed at 11.50-12.50. It comes after slot 2, and the first two slots are
  always pairs. Where a school writes a break as a list, the grid shows the part before the
  first comma.
- **That hour is one hour for every class, and the canteen is not.** So the
  plan gives each year a third of it and rotates which third through the week,
  and the three never meet. The hour is cut around the sitting: Proaeg, the
  sitting, Proaeg. Drawn as a band over the top the two would be packed side by
  side at half the width each, which says the class is doing both at once.

  | | E | T | K | N |
  |---|---|---|---|---|
  | 11.50–12.10 | 7 | 9 | 8 | 7 |
  | 12.10–12.30 | 8 | 7 | 9 | 8 |
  | 12.30–12.50 | 9 | 8 | 7 | 9 |

  Read off the Proaeg table on the published Päevakava, and hand-copied, so it
  goes stale when the sittings move. A class the table says nothing about keeps
  the plain hour.

  A sitting is a break like any other, so the reader can rename or recolor it
  from the subject table — and it takes the meal color, not the plain one. See
  **Two quiet colors, not one** below.
- **Friday is not split by class, and the page has to ask a question aSc cannot
  hold.** Every year has Praktikum at the same hour that day, and the plan
  splits the sitting by where yours is rather than by which year you are in.
  Those going out of the schoolhouse eat first, because they take the 12.15
  bus.

  aSc keeps a division only where the lessons differ, so a split that changes no
  lesson has nowhere to live there. It lives in the day plan's `asked` list
  instead and is offered in the same row as the real divisions, so a reader
  answers it in the same place and it rides in a shared link with the rest. It
  hides nothing, because no lesson carries its groups.

  Every sitting shares one name. Each of the two on Friday carries a group and
  a note as well: the group is what the answer is matched against, and the note
  is what the box adds to its name while both of them are on the day. A note
  rather than a name of its own, so the subject table holds one row and a reader
  who renames or recolors it does it once for the week.

  Unanswered, both sittings are drawn and the note is what tells them apart —
  before a reader picks, every group's lessons are on the screen and their
  sittings belong there with them. Two bands one above the other called the same
  thing say nothing, and a twenty-minute band has no second line to say a group
  on.

  Answered, theirs is the only one there. The note then has nothing left to tell
  it apart from, so it goes and the box says what it says on every other day of
  the week.
- **The answer decides the afternoon as well as the meal.** The Päevakava
  carries what aSc cannot: a bus at 12.15, and the same Praktikum in another
  building from 12.30 to 14.00. aSc has one Praktikum row for the whole class at
  12.50, which is the one held in the schoolhouse.

  So the row becomes one per group, each with its own clock, and the page
  filters them the way it filters any lesson a class splits for. The moved one
  waits to be asked for: drawn beside the other it is half a column, and a day
  showing both alternatives has no room left to say which is which. Until the
  reader answers, the day keeps the row aSc published.

  The bus waits the same way, and for a plainer reason — it leaves in the middle
  of the other group's meal. Two sittings can stand on one day because they
  follow one another; a bus across one of them cannot.
- **There is a second bus, and the lesson waits for it.** Liikumisõpetus after
  Proaeg is somewhere else in town, and the plan puts a bus to it at 12.50 —
  which is the same minute aSc starts the lesson. A lesson cannot start before
  the class arrives, so the ride comes out of the front of it: `Buss`
  12.50–13.05, then Liikumisõpetus 13.05–14.10.

  Fifteen minutes is the school's figure. The plan does not carry it — it names
  the bus and leaves the arrival to whoever is on it.

  The end does not move with the start. The rest of the day is where it was and
  Amps follows at 14.10, so the ride comes out of the lesson rather than pushing
  the afternoon along in front of it.

  The band carries every group the lesson has, so a reader in any of them keeps
  the ride and a reader in none of them never sees it. It lands twice in a
  ProTERA week: the seventh year on Thursday and the eighth on Tuesday. The
  ninth never has Liikumisõpetus after Proaeg, and the gümnaasium keeps its own
  day plan.

  Both rides are called `Buss`. Each sits immediately in front of the lesson it
  serves, so the destination is already on the screen — and a band that short
  has no room for it anyway. One name is also one row in the subject table,
  which a reader recolors once.

  A break gives way to what the same plan puts inside it. Answering "outside the
  schoolhouse" leaves the reader eating at 11.50, on a bus at 12.15 and gone at
  12.30, so the rest of the Proaeg hour is not theirs — and it is only on their
  day at all because the other group's sitting fell back to it. It is cut to the
  five minutes that really are theirs — and five minutes is not an hour of
  anything, so it is drawn as `Paus`.

  Ten minutes is where the page already draws that line, and for the same
  reason: under it a space is a corridor rather than time you can plan around.
  A band the leavings make shorter than that is handed to the box that says
  exactly that, with the page's own word on it and the outline that says nobody
  named it. A band the school really does write that short keeps its name —
  TäheTERA has a ten-minute one between its second and third lessons, and ten
  is not under ten.

  Only the plan's own, and only once answered. Where aSc and the plan disagree —
  TäheTERA has a two-hour Loovloodus with the school's lunch band sitting inside
  it — that is the school's disagreement and not ours to settle by deleting one
  of them. And before the reader answers, both groups' Fridays are on the screen
  at once: the page draws alternatives side by side, and trimming then would
  take one group's meal away because the other group's lesson runs across it.

  The other sitting does not leave a hole. It leaves the stretch it stood in,
  under the name the plan gave that stretch before the sitting was cut out of
  it — which on Friday is `Proaeg`, the same word the other four days use for
  the minutes around their sitting. Dropped outright it read as a hole, and the
  day drew a worked-out `Paus · 20 min` across it: the same plan and the same
  hour, described two different ways depending on which day you were looking
  at. Each sitting carries the name of the band it was cut from for exactly
  this.

  The times are hand-copied. The build stops on a sitting that lands inside no
  break of the day plan, which is what a moved plan looks like from here — a
  meal drawn at the wrong hour is worse than a build that says it cannot.

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
its clock comes from the school's own day-plan sheets instead, one for years
1-3 and one for years 4-6. All fourteen classes are in them, and no two run the
same week. Nor does one day settle another: 5.a alone has the fourth lesson
ending at 12.05 on a Monday and 12.20 on a Wednesday, so a clock that looks
regular is not one.

The sheets were read by script rather than by hand, and the script was checked
against the one class that had already been transcribed from its own sheet. It
reproduced that class byte for byte, all five days, before the other thirteen
were taken from it.

Reading them settled the numbering for the whole school. EduPage labels
period 5 `HA`, which reads as a break, and it is not one — it is the fifth
years' language lesson. Only 5.a, 5.l and 5.t use it, on Monday and Thursday.
For the other eleven classes it is empty, and there it really is the break.

Around midday the fifth years split, and the sheet writes it as two rows that
each hold a lesson and lunch in the opposite order. The school gave the split:
one group takes the language at **12.10-12.55** and eats after, the other eats
first and takes it at **12.55-13.40**. Two rows, two periods in the timetable,
so both are drawn.

**EduPage's two Spanish groups are not groups.** It names one group per lesson,
which assumes that a group meets at the same period every week. Here it does
not. The half that goes first on Monday goes second on Thursday. What EduPage
holds is `HK` fixed to 12.10 and `HK1` fixed to 12.55, on both days. Neither is
a set of children. A reader who picked one saw the right lesson on one day and
the wrong one on the other, with lunch on the wrong side of it.

So 5.a's two are mapped onto the groups the school does name. `HK1` takes the
language at 12.10 on Monday and at 12.55 on Thursday. `HK2` is the other way
round. The mapping is per class and per day. It renames the picker as well as
the lessons, because one EduPage group becomes two.

5.l and 5.t sit in the same two lessons and are listed the same way. Whether
they swap too is not in the data, and the school has said only for 5.a. It is
one more line in the table once somebody says.

**EduPage calls the fourth maths group the whole class.** 5.l and 5.t split
maths four ways. Three of the four lessons carry a group. The fourth carries
*Terve klass*.

A lesson in no group belongs to everybody, so that one was drawn beside
whichever group the reader picked. No pick removed it. The reader saw two maths
lessons at the same hour, in two rooms, with two teachers.

One aSc lesson serves several classes and names a group per class, and in 5.a
the same lesson names `Mat 4`. So where a subject runs at one hour both in
groups and as the whole class, the whole-class card is a further group of that
class, and it takes the name the school gave it elsewhere. Where no other class
names it, nothing is invented and the lesson stays as it is. A real whole-class
lesson is untouched: the fourth years take one maths lesson a week all
together, with all four teachers in the room, and no groups run against it.

On Monday and Thursday, then, the school publishes no lunch band. Lunch is a
different hour for each group, and a band across the class would be wrong for
half of it. It does not need one: a reader who picks their language group is
left with their own lunch as the free time around that lesson, found by the
same rule that finds any other gap.

The other three days do not split, and there the sheet leaves half an hour
between the last long block and the closing lesson: 13.15 to 13.45. The first
sheet to arrive gave that row no times and ten minutes was what fit around the
lessons either side; the next one named it, and moved the fifth lesson to
12.30–13.15 to make the room.

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

A block can carry a fifth time, and one does:

    (first period, how many periods, start, end, end when it runs on)

The older years' fifth period has two shapes. On its own it runs 13.15 to
14.00, and where a lesson carries the sixth period with it, the pair finishes
at 14.35 — twenty minutes before the sixth would have ended alone, because the
break between them is not taken. Ten lessons a week are the second shape. Left
to end where the sixth ends, every one of them said a child was busy for twenty
minutes after they were free.

**LõunaTERA names its classes after their teacher** — Maarja, Heliis, Sille —
so the name says nothing about which year a class is in. The school marks the
years with rows of their own: a class called `3`, carrying no lessons, standing
in the list in front of the classes in the third year. The order of the list is
the only place that says which teacher teaches which year, and the school's own
page reads it the same way.

Those rows are not classes and are not offered as one. Only for a school whose
day plan says it works this way, because `7` and `8` are real classes at
ProTERA and dropping those would lose two years of the school. One of
LõunaTERA's markers carries a single stray lesson, which is a slip in the
timetable rather than a class anybody attends.

So the two bands below are named by year rather than by a list of teachers. A
school renames a class when its teacher changes, and a list of names here would
quietly stop covering it — a class with no times draws nothing at all.

The year is shown as well, so the class picker offers `1. Maarja` rather than
`Maarja` alone. Only the label carries it. The name stays as the school writes
it, because that is what a shared link names and what a reader's own settings —
hidden subjects, added events, group picks — are filed under, and renaming it
would drop both. `--class` takes either form. Everywhere else the name already
opens with the year, and no label is added: `7. 7` says it twice.

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
keeps the date, and leaves the rest on screen. A QR code back to the page can
be switched on.
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
  whole list. The group codes sit underneath as a subtitle.

  **Each option names the teacher**, because the code is the school's own
  filing and a reader knows who teaches them instead: *HK1 (Maria Martinez)*.
  Only the option says so. The value stays the code, which is what the pick is
  stored under and what a shared link carries.

  Where a division carries more than one subject and a group more than one
  teacher, each name says what that teacher takes — *I A (Eesti k: Hanna-Stina
  Vigel, Eng: Jane Eskla)* — in the division's own subject order, so two options
  can be compared at a glance. Past three names nothing is said at all. Those
  groups are not a language set but a whole half of a class taking its own six
  subjects, and there the code is already something a reader knows: it is their
  own class, *7.a* or *Alfa*.

  One thing the teacher cannot do is separate two groups that share one. Both
  TäheTERA Spanish groups are Maria Martinez, so the name tells them apart from
  French and German and not from each other.

  **Two questions in one picker.** ProTERA's ninth years take Estonian and
  English in six sets — *I A, I B, II A, II B, III A, III B* — and aSc holds
  them as one division. The letter is which half of the class you are in: the
  halves swap the two subjects at the same hour, so a reader keeps one letter
  all week. The numeral is the set within that half, and it can differ between
  the two subjects. A reader who is Estonian II and English I had no code to
  pick, and picking one gave them the right lesson in one subject and the wrong
  one in the other.

  So that division is offered twice, once per subject, with the same codes in
  both and the right teacher against each. The seventh and eighth years keep
  English in a division of its own, which is the same arrangement written the
  way aSc can hold it. Only a division named in `perSubject` is pulled apart —
  a class split into science sets keeps those sets across the sciences, and two
  pickers there would invite a week nobody has.

  To keep every group on one axis, leave its picker on *— all —*. Whole-class lessons always show.
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
- **The filter** is open on a first visit and closed after that. A reader
  arriving for the first time has one job — to say whose timetable this is —
  and the filter is where that is said. A reader coming back has done it, and
  the panel is then a header taking up the room the week wants. A link counts
  as having said it, since it names the class itself. The page is shipped with
  the panel open, so a browser running no script at all gets the answer that
  helps somebody who cannot collapse it either.
- **Display options** is six sections, and each holds only what belongs to it.
  The title, then what each lesson box says, then how those parts are fitted
  into the box, then what the day shows, then the type, then how lessons look.
  A control under the wrong heading is a control nobody finds, and
  a test holds each one where it belongs. Free time lives under the day rather
  than the lesson, because it is a box the page adds where the school left a
  hole and not a label on a lesson. Which parts a box says and whether they take
  a line each are two questions, so they are two sections.
- **Calendar** is the other way of taking a week away with you, and sits next
  to Print options for that reason. One button writes an `.ics` file holding
  exactly what is on screen — the reader's groups, without the subjects they
  turned off — with their own events beside the lessons unless they say
  otherwise.

  It is a file, not a connection. Nothing signs in, no key is held, nothing
  runs nightly, and the same file opens in Google Calendar, Apple Calendar and
  Outlook. A subscribed URL would keep itself fresh, but only by moving the
  reader's picks onto a server, and Google refetches an external calendar on
  its own slow schedule — half a day at best, sometimes days — so a corrected
  timetable would sit stale and the feature would read as broken.

  **The panel says what the school's own year does to the file**, because a
  reader who knows the week is missing on the twenty-first trusts the rest of
  it, and one who does not is left wondering whether the export is broken. Each
  school states its own:

      ProTERA          Katab 26.08.2026 kuni 18.12.2026
                       Tunde ei ole: TERA20 aktus 31.08.2026,
                                     Sügisvaheaeg 26.10–30.10.2026
      TäheTERA         Katab 27.08.2026 kuni 18.12.2026
                       Tunde ei ole: Iseõppepäev 21.09.2026,
                                     Sügisvaheaeg 26.10–30.10.2026
                       Asendab tunde: Jõulukontsert 16.12.2026 9.15–10.15

  A stretch is named by the school days it costs, not by the calendar days the
  holiday covers: the autumn break reads 26.10–30.10 because the weekend either
  side was never a school day. A holiday that falls on a Saturday is not listed
  at all, since nothing about the week changes.

  The file itself is named for the school, the class and the child —
  `Tunniplaan-ProTERA-8-Eva-2026-08-26.ics` — because Google offers the
  filename when it makes a calendar, and a household with two children needs to
  tell one from the other. A child's name that was never filled in is left out
  rather than leaving a gap. Estonian letters are folded in the filename and
  kept in the calendar's own name: stripping them turns `gümnaasium` into
  `g-mnaasium`, which is nobody's school.

  **The dates come from `SCHOOL_YEAR`, not from EduPage.** The timetable is a
  repeating week and carries no dates: aSc's `terms` table is one nameless
  entry with none, and two of the four timetables leave even the free-text
  `Kehtivus:` line empty. So the term is written down in `tt.py`, from the
  school's own calendar. Where a school has no dates the panel is not drawn at
  all, because an export that guessed them would put a child in a lesson on a
  day nobody has said there is one.

  Schools do not share a start. The year opens for everyone on 24.08, but the
  first days are spent with the class rather than on the published plan:
  TäheTERA joins the timetable on the 27th, ProTERA on the 26th. Each also has
  days of its own — an *iseõppepäev*, ProTERA's TERA20 aktus — on top of the
  breaks and national holidays every school keeps. `SCHOOL_DATES` holds what
  one school does differently, keyed the way `BELLS` is.

  **An import is not a sync**, and this is the thing worth knowing. It can add
  an event and it can correct one, but nothing in the format says *this lesson
  is gone*, so a lesson the school drops stays in the calendar until somebody
  removes it. Two things follow. Every recurrence stops at the end of the
  published term, so no stale entry outlives the data behind it. And the panel
  asks for a calendar of its own: when the timetable changes, deleting one
  calendar and exporting again is two clicks, where weeding one is not.

  **A reminder is set only where there is room for one.** The reader can ask
  for one before their own events — half an hour by default — and it is added
  only when the pause before the event is at least that long. The pause is
  measured from whatever ends last before it, a lesson or another of the
  reader's own events, so a training session a quarter of an hour after school
  gets no half-hour warning and neither does one a quarter of an hour after
  swimming. A reminder that rings while the phone is in a bag during a lesson
  is one nobody sees, and by the time they look the thing has started.

  Reminders survive the import into a separate calendar in both, which is
  worth writing down because it is widely reported not to: the Google Calendar
  community carries threads saying reminders are dropped into any calendar but
  the primary one. Tested against Google in August 2026 with a calendar of its
  own, and they arrived. The page said otherwise for about an hour on the
  strength of those threads, which is what undated forum posts are worth
  against one run of the real thing.

  **The two makers do not behave the same, and the panel says which is which.**
  On Apple — iPhone, iPad and Mac — opening the file is the whole procedure:
  tap it, choose a calendar, done, phone included. Google Calendar's phone app
  has no import at all, neither *Import & export* nor *From URL*, so a parent
  who taps the button on a phone ends up with a file and nowhere to put it.
  That is worth one line each, because it is the difference between a job done
  in ten seconds and one that cannot be done on the device in hand.

  Each line carries a link: [Apple's](https://support.apple.com/guide/calendar/import-or-export-calendars-icl1023/mac)
  and [Google's](https://support.google.com/calendar/answer/37118). Both
  articles are English whatever locale is asked for — Apple answers an Estonian
  address with Estonian navigation around an English article, Google says the
  page is not available in your language — so the Estonian labels say as much
  before the reader follows either. Neither link pins a locale, because letting
  the maker choose gives a reader whose account runs in some third language
  their own.

  One caution about Apple's page: the warning on it that importing *replaces
  all of your current calendar information* is about a calendar archive
  (`.icbu`), not about an `.ics`. Importing an `.ics` adds to whichever
  calendar is chosen. The file this page writes is served as `text/calendar`
  with an `.ics` name, which is what lets Safari hand it to Calendar at all —
  a file sent as `application/octet-stream` is one iOS refuses to open.

  A correction needs none of that. Each event is named after aSc's own id for
  the placed lesson, so a lesson moved to another hour keeps its name and a
  second import fixes the entry in place rather than drawing a second one
  beside it. The class is in the name too, because one aSc lesson serves
  several classes and a parent with two children may put both in one calendar.

  **An hour the school fills is not a day off.** TäheTERA's Christmas concert
  runs 9.15 to 10.15 on 16.12, and the school counts it as replacing the first
  two lessons. What that is depends on the class: most have one paired block
  there, the first years two singles, and the classes that split into groups
  several boxes at once. All of them lose exactly two periods. So `instead`
  cancels by overlap rather than by counting lessons — whatever a class has at
  that hour goes, the rest of its day stands — and the concert takes their
  place as an event that happens once. A reader's own events keep their hour:
  a swimming lesson at five is not cancelled by an assembly at nine.

  These are the only dated things the page knows. The screen shows a week that
  repeats, which has no room for one, so they live in the calendar alone.

  The file carries Estonia's clock rule as a `VTIMEZONE`. The autumn term
  straddles the change — the clocks go back the day before the autumn break —
  so without it every lesson after October is an hour out.

- **Print options** is a section of its own, beside Display options. Everything
  in it changes nothing until the sheet comes out of the printer, which is a
  different question from what the reader is looking at on screen. It held a row
  inside Display options once, and a reader looking for the paper edge had to
  open the wrong section and scroll past the typefaces to find it.

  **For each lesson, show:** the teacher, the room, the study group and the
  subject are independent of each other. The teacher and the
  subject each choose between the full name and the school's abbreviation.

  The clock is two checkboxes rather than one, one per end, and how long the
  lesson lasts is a third. A sheet the size of a card has room for one end, and
  the start is the end somebody reads a timetable for. The end kept on its own
  keeps its dash — `–10.20` — because a bare `10.20` reads as a start, and a
  sheet showing nothing else gives a reader nothing to read it against. Drop
  both ends and the duration stands on its own, without the brackets it has
  nothing left to sit beside.

  **Fit these into a lesson box** is a second question about the same
  checkboxes. Whichever parts they leave switched on either take a line each or
  share one. Stacked is a line each, which is what a box tall enough for three
  lines wants. Packed sets them side by side on one line.

  On a 100 by 60 card a box is one line tall. Stacked, everything under the
  first line falls off the bottom and is not drawn at all: a reader asking for
  the room gets a box with no space to say it. Packed, the same parts fit on the
  line the box has. Which parts those are is not this setting's business — that
  is the checkboxes above it — so a reader who wants the start time, the short
  subject name and the room on one line switches the rest off and asks for
  packed.

  A box too short for two lines packs itself whatever the setting says. There is
  no second line there to stack anything on.

  Where the packed line is too long for the column and the box does have a
  second line to spare, the room goes on it rather than being cut off the first.
  That space is space the box already owns and was leaving empty, and the box
  height is fixed by the clock before any of this, so the second line costs the
  sheet nothing.

  It is measured, not worked out. Whether `9.00 Eesti k A212` fits 64 pixels is a
  question about the font on the reader's machine and the size they asked for,
  and only the browser knows. The pass runs after the type has given back
  whatever the box had no room for, so it measures what is drawn.

  A box with room for exactly one line is left alone, and that is what the
  measurement is for. Told it may wrap, such a box breaks at the space before the
  part that does not fit and then has nowhere to put it: `9.00…` where it had
  shown `9.00 Mus A2…`, which is less of the lesson rather than more.

  The clock and the line of room and teacher never break inside themselves — a
  room number split over two lines is not a room number — so the break falls
  between the parts. The subject name is left breakable, because it is the long
  one and an atom wider than the column has nowhere to go but over the edge.

  Where there is no second line either, a line within fifteen per cent of
  fitting is set down in size instead of being cut. An ellipsis is about a
  character wide, so cutting a line that is a character too long spends as much
  width as it saves and loses a fact for nothing. The three sizes go down
  together, so the box keeps the proportions the reader asked for and only gets
  quieter. Either the whole line fits or nothing changes: a box set smaller and
  still cut gave up its size for nothing and would sit among its neighbours
  looking like a different kind of thing for no reason a reader could see.

  This is measured finer than a whole pixel. `scrollWidth` and `clientWidth` are
  integers, and the box that found this was 54.250 wide in a line of 54.203 —
  both report 54, so the arithmetic said it fitted while the browser drew an
  ellipsis over a twentieth of a pixel. A range over the content measures what
  was laid out.

  It is also measured twice. A card that tiles a page is drawn from copies, and
  a copy comes out about a fifth of a pixel narrower than the original it was
  measured on — enough to cut a line that had just been made to fit. So the
  copies are measured again once they exist, and each box remembers the sizes it
  started from so the second pass cannot set it down from where the first one
  left it.

  Nothing hides the clock inside a box. Any sheet under 170mm used to, on screen
  as well as on paper, because the rule followed the size of the sheet and not
  the printing. The reason was sound while it was the only answer available: the
  strip down the side already says when a lesson is, and a copy of it inside a
  59-pixel box costs the subject its name — every card read `9.00…` where it
  should have read the lesson.

  It was still the page reversing the reader, and once the clock became three
  checkboxes it left all three doing nothing on the one sheet they were added
  for. What it cost is real, and the reader pays it with the controls instead.
  On a 100 by 60 card, class 7 with a study group picked:

  | | lines that fit whole |
  |---|---|
  | as the page opens | 0 of 17 |
  | start time, short names, room, packed, 70% | 11 of 17 |
  | the same at 60% | 16 of 17 |
  | the same at 50% | 17 of 17 |
  | the same at 60% with the strip switched off | 17 of 17 |

  Those figures are measured on the original, and for a while they could not
  have been. The copies that tile a page are cloned from it, so the original has
  to stand at the width of a card while everything is measured on it — and
  `body.printview #grid` sets the A4 width, which an id wins. So the original
  stood at 1054px against a card's 378, and the pass that gives type back to a
  box too small to hold it had nothing to act on. The rule that narrows it is
  written against the id now.

  **In the day, show: Times down the side** is that strip, and it switches. On,
  because it is the scale every box is positioned against and a week with no
  scale is a week of colored blocks. Off is for a card: the strip costs a fixed
  slice of the width whatever the size of the sheet, and a reader who has asked
  for the start time inside each box has already said where they want the clock.

  What goes with it is the mark for an axis cut, which is drawn on the strip. A
  day with hours taken out of the middle then says so only through the boxes
  either side of the join.

  A teacher's name arrives family name first and abbreviated, which is how a
  school files a name and fits it in a cell — not how a family says it. So the
  page writes it out in full and turns it round, and both are the reader's to
  put back. A second pair of buttons does the turning round. Only the first word moves: a person can have more than one
  given name, and `Kask Mari Liis` is one family name and two given ones. One
  entry can hold several people, separated by a slash, a comma or a semicolon —
  which one is not consistent — so each name is turned round on its own and the
  list is put back together with the separators it came with.

  **Type in a lesson box** is three settings, one per kind of line: the subject
  name, the clock, and the room and teacher. Each takes a typeface and a size.
  The page asks for the subject name at 150% and the clock at 125% — the two
  things a reader is looking for. The line of room and teacher stays at 100%:
  it is there to be checked rather than read, and it is what gives the other
  two the room to grow.

  The sizes run from 50% to 150%. The steps under a hundred are what a small
  sheet needs: a name the box cannot fit is cut with an ellipsis, and a size
  down costs nothing but reading distance while it buys whole words. On a 100 by
  60 card, twelve of the thirty-three names were cut at 90% and six at 70% —
  *Ajutreening*, *Geograafia* and *Praktikum* all come out whole at 70%. Fifty
  is the floor. It is six point, which is small print rather than a smudge, and
  on a card that size it is the step that fits a room number beside the name
  instead of cutting one of the two.

  Every box answers to these, breaks included. A break and a worked-out gap are
  set smaller than a lesson, and the stylesheet scales both off the reader's
  number rather than off a fixed count of pixels. Fixed, they were the one thing
  on a card that ignored the setting: a reader asking for 60% got it everywhere
  but the breaks, which stayed at full size and came out the largest words on
  the sheet. `baseSizes` in `page.js` carries the same numbers, so the
  arithmetic that decides how much a box can grow measures what is drawn.

  Nothing is fetched. A page that asks for a font from somewhere else is a page
  that does not open on a train, so the choices are the three families every
  machine has: sans-serif, serif and monospace.

  Neither list offers "automatic". For a typeface it would resolve to the
  page's own font, which is the first of the three, so it would be a fourth
  entry drawing exactly like one of the other three — a choice that is not one.
  For a size, what the page chooses is a value on the list already. In both
  cases the page's own answer is simply the one selected, which is also what a
  reader returns to by pressing Reset. A link written while the lists did carry
  "automatic" still opens, on the same typeface and at the same size it drew
  then.

  The size is what the reader would like, not what they get. A box gives its
  content its own height less the border and the padding, and every line costs
  its size times its leading — so how much of the asked size a box can take is
  arithmetic, and each box does it for itself. A box with room gets all of it,
  a box with none keeps the size the page has always drawn, and one in between
  gets the part that fits. Nothing is ever drawn smaller than it was before the
  setting existed.

  Arithmetic is not the whole answer. A name set larger can *wrap* where it did
  not before — `Prantsuse keel` is one line at twelve pixels and two at
  fourteen — and no arithmetic here knows how tall that made it. So after the
  boxes are in the page, every one that overflows gives its growth back a step
  at a time until it fits. That is the check the print sweep makes too, which
  is how the wrapping was found.

  The other view takes the typefaces and the sizes as they stand: a table cell
  grows with what is in it and can cut nothing. Its subject name used to ignore
  the print scale, which it could while it was the size the browser gave it.
  Asked to grow, it has to shrink with everything else, or the fitter has
  nothing left to give.

  **Print options** carries the rest: the QR code can be switched on, the paper
  edge is the reader's to set, and so is the size of the sheet. The code is off to begin
  with, because most sheets go on a wall and are read as paper, and the corner
  is room the timetable could have used. The address in the other corner stays
  either way: the code goes to this reader's own timetable, and the address is
  where anybody gets one of their own.

  **Sheet** is the size the timetable is laid out for. Three answers: the whole
  A4 page, an iPad 11" A16, or a size the reader types in millimetres. A4 is
  what almost every printout is, and it is what this says until somebody asks
  for something else.

  The other two are smaller than an A4 page and are cut out of one. The printer
  is still handed an A4 page — the `@page` rule says A4 whatever the sheet says
  — and the smaller sheet is drawn on it as a dashed line to cut along. That
  matters more than it sounds. A custom paper size has to exist in the printer
  driver, and a browser asked for paper the printer does not hold scales the
  page to what it does hold, which is how a sheet meant to be 248.6mm wide
  arrives at 287. Nothing here can go wrong that way, because nothing is ever
  scaled: the page is A4, and only the line moves.

  The iPad figures are Apple's own for the device, 248.6 by 179.5 millimetres,
  not for its screen. The sheet is meant to go where the iPad goes. The
  timetable is fitted to the line rather than to the paper, and 2.5mm of white
  is left inside it, so a scissors that wanders by a hair does not take a room
  number with it.

  **The paper edge and the sheet are different settings**, and it is worth being
  plain about which does what. The paper edge is the printer's own margin. It
  moves the cut line further in from the edge of the paper and never makes the
  line smaller: an iPad-sized sheet measures 248.6 by 179.5 at a 5mm edge and at
  a 14mm one. What the edge does do is leave less paper to cut a sheet out of, so
  it caps how large a sheet can be — the A4 page less that edge at each end, 287
  by 200 at the narrowest and 269 by 182 at the widest.

  A typed size is held inside that, and to 50mm at the small end. A week fits in
  60mm of height at about eight point, which is a wallet card rather than a
  smudge, and the preview says plainly what anything smaller looks like. Past either end it comes back to the largest or the
  smallest that fits, rather than being refused: that is what the reader was
  reaching for. Widening the paper edge brings a sheet that no longer fits back
  in with it. It used to keep whatever was typed, and a sheet the size of the
  page at the widest edge printed off it and cost a second sheet of paper. Only
  an emptied box keeps the size that was in force.

  A named sheet is never trimmed to fit, because a line drawn short of an iPad
  would cut a sheet that does not go where the iPad goes. So a sheet that cannot
  fit must not be offered at all, and a test holds every one of them against the
  paper at the widest edge.

  **A sheet smaller than the page is copied to fill it.** Somebody who asks for
  a card a third the size of the paper wants more than one card, and the rest of
  the page would go in the bin. So the copies are laid out in a block and the
  note under the picker says how many: 100 by 60 gets eight.

  **The paper is turned when turning it fits more.** Landscape wins for most
  sizes and portrait for many — 100 by 60 gets six across a landscape page and
  eight down a portrait one, while 90 by 50 gets twelve landscape against ten
  portrait. So both are counted and the better one is used. It is still a named
  A4 either way round, so the printer is handed paper it holds and nothing is
  scaled.

  The copies sit flush against each other with no space between them. One
  straight cut then separates a whole row, and every line runs the full width or
  height of the block. Space between them would mean two cuts at every boundary
  and a strip of waste to pick off, and it would protect the type no better —
  the room for a wandering scissors is the 2.5mm of white inside each copy,
  which is already there. Each copy draws its own right and bottom edge and the
  block draws its top and left, so a line between two copies is one line rather
  than two.

  The copies are made after the fitter has run, from a sheet that is already the
  right size and scale, so nothing is measured or drawn twice. Their `id`
  attributes come off on the way: two nodes answering to `grid` would send every
  later `getElementById` to whichever came first. The original stays in the
  document and goes out of sight only once the copies exist — hidden any earlier
  it measures nothing, and the fitter then scales the week for a sheet of no
  size at all. While the copies are being made it is laid out at the width of
  one of them, or the fitter measures a week three times wider than the one
  going on the card.

  **A card drops what it has no room for.** The heading, the day names and the
  clock down the side are sized in points rather than fitted, so on a sheet a
  third the size of a page they crowded out the week they were labelling. They
  shrink with the sheet now, down to a floor that keeps them readable. Below
  170mm the clock also keeps its hours and drops its half hours, which had run
  into each other and read as a grey smear, and a lesson box drops the clock it
  repeats: the strip beside it already says when the lesson is, and every box on
  a 100 by 60 card read *9.00…* where it should have read its own name.

  At that size the week is still a week — subject names, breaks and free time,
  each lesson at its true height — but a class with five parallel groups has
  19mm to draw each day in. Picking a group makes it a card worth carrying,
  which is the same thing the picker is for on screen.
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
  A row holds a weekday, a span, a label, a second line and its colors, in that
  order. When comes first, then what. The second line is where a lesson shows
  its room and teacher, so a training session can show its hall and its coach.
  It needs the same height to earn it — three tight lines come to 36 pixels,
  and 46 is where all three fit — and a box too short for it drops the line
  rather than cutting it. There is no syntax to get wrong and no color to
  spell. A row that cannot be drawn says so underneath. An event on a day the school week does not cover,
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
  fragment never leaves the browser.

  **A link and a browser that disagree are put to the reader.** Only what the
  link actually names is compared, and only that. Storage keeps every setting,
  including the ones that were the page's own answer on the day they were
  saved — so the moment a default moves, no stored copy can match a link again,
  and a reader opening their own bookmark a month later would be asked about a
  setting neither they nor the sender ever chose. On everything the link is
  silent about there is nothing to choose, so silence is not a disagreement.
  Which week is on screen is compared too, however the link came to name it,
  because that is the one thing a reader would notice at once.

  It is a shallow value-by-value check and no more, and value-by-value is the
  whole of it: two sides holding the same answer is nothing to choose between,
  and why either of them holds it never comes into it. One may have picked it
  and the other inherited it from a default that has since moved. Where the
  values do differ, the reader would have watched the page change under them,
  so that is worth a question.

  Both answers are real and neither is obviously right: a link carries only what differs from
  the defaults, so anything the sender left alone is simply absent from it, and
  filling those gaps in from the reader's own settings is as defensible as
  resetting them. The link's are shown, because following one is a request to
  see what it carries. Nothing of the reader's is written down until they say
  which they meant, so *keep mine* is still on the table however long they take.

  Three answers, and the difference between the first two is only what happens
  to a setting the link says nothing about:

  - **Keep the link's** — every setting the link carries, and the page's own
    where it is silent. The class it is about is the link's too, name and
    events and all: mixing one child's after-school events into another child's
    week is not a merge. Every other class this browser knows about is left
    alone, because a link for one child must not throw away a sibling's setup.
  - **Merge** — the link's where it speaks, the reader's where it does not.
    This is what the page did on its own before it started asking.
  - **Use mine instead** — the link is ignored.

  **Copy mine first** puts what this browser had on the clipboard before any of
  that, or into the box under Advanced where there is no clipboard — which is
  where a backup is pasted back in. It answers nothing; the question stays up.

  The question is asked in the language the reader was reading in, whatever the
  link says. A question somebody cannot read is not a question. The link's own
  language arrives with the rest of it, if they choose it.

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
  ends. Ten minutes is where a hole stops being a corridor and becomes time you
  can plan around. It was fifteen while a box that short could not hold a line
  of type; a box that gives its type back until it fits can, so the shorter
  holes are drawn now too. It counts the whole day: the lessons, the school's own
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
- **The printed sheet** carries the date the data was read. It can also carry a
  QR code of the link, captioned *Edit it here*, so a sheet on the fridge can be
  picked back up on a phone with every choice still on it. The code is off until
  a reader asks for it: most sheets are read as paper, and the corner is room the
  timetable could have used. Past about 2 kB no code holds the link, and the
  corner is then empty. It used to print the address as text
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
  or a language. A third sentence says which setting puts the same address in
  the bottom right corner of the printed sheet, and prints that setting's own
  label for the same reason. It matters because a sheet handed to somebody is a
  copy of the settings, which is not obvious from a grid of lessons.
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

The box is redrawn with the page, so it always shows what is stored. It used to
be filled once, when the panel was opened, and went stale under every control
touched afterwards. That was not only a stale display: **Apply** reads from the
box, so pressing it put the older settings back and the button undid the change
instead of keeping it. The one time the box is left alone is while it is being
typed into — somebody pasting a backup is mid-edit, and the box is where the
paste lands.

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
  "teacherNameOrder": "first",
  "boxLayout": "stacked",

  "nameFace": "sans",
  "nameSize": "150",
  "timeFace": "sans",
  "timeSize": "125",
  "detailFace": "sans",
  "detailSize": "100",
  "showStart": true,
  "showEnd": true,
  "showDuration": true,
  "showGaps": true,
  "showAxis": true,
  "showQr": false,
  "calMine": true,
  "calAlarm": false,
  "calAlarmMinutes": 30,
  "printMargin": 5,
  "printSheet": "a4",
  "printWidth": 210,
  "printHeight": 148,

  "subjectColorStyle": "school",
  "subjects": {
        "Matemaatika": { "label": "Maths", "short": "Ma", "style": "custom",
                     "backgroundColor": "#83EC9B" },
    "Kunst": { "style": "palette" },
    "Lastekoor": { "hide": true },
    "Proaeg": { "label": "Free time" }
  },

  "classes": {
    "68/8": {
      "studyGroups": {
        "Alfa/Beeta/Gamma": "Beeta",
        "8.1/8.2/8.3/8.4": "8.1"
      },
      "studentName": "Eva",
      "events": [
        { "id": "k3n8xq2p", "day": "Mon", "startTime": "16:15", "endTime": "17:10",
          "backgroundColor": "#F6F2C1", "label": "Tantsutrenn",
          "note": "Stuudio 2 · Maret" }
      ]
    }
  }
}
```

Some of these choices are not obvious:

- **`calAlarm` and `calAlarmMinutes` ring before the reader's own events**, and
  never before a lesson: a phone that goes off thirty times a week is a phone
  with notifications switched off. Off until it is asked for, because a reminder
  is a thing that goes off in a pocket.
- **Each event carries an `id`**, given once and then kept. Nothing on the page
  shows it and only the calendar file reads it, where it is what names the
  event. Without one an event was identified by where it sat in the table, and
  that is not an identity: deleting the row above it, reordering, or repairing
  a typo in a different row all renamed it — and a calendar cannot be told that
  an event has gone, so the reader got a second copy of a training session for
  tidying up. An event written before this existed is given an id the first
  time its settings are read, and keeps it.
- **`studyGroups` is keyed by the choice on offer**, `"Alfa/Beeta/Gamma"`. It is
  not keyed by aSc's own identifier for that division, which is `"*5:1"` and
  means nothing outside the feed. Where one division is offered once per subject,
  both halves carry the same codes, so each is keyed by its own subject:
  `"Eesti keel: I A/I B/…"` and `"Inglise keel: I A/I B/…"`. Both, and not only
  the second. A pick saved before the split answered one of the two subjects and
  nothing records which, so a half left under the plain group list took that
  answer whatever it meant — a reader who had picked their English set was shown
  that set's Estonian lessons, and told nothing. Neither key matches the old
  one now, so both pickers stand unanswered until the reader answers them.
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

  Every row also carries a **Short label**, beside the school's own
  abbreviation. The two overrides are separate fields because one word cannot be
  both: a reader who writes *Maths* for a wall chart wants *Ma* on a card.
  Writing either leaves the other alone. A long name of your own still stands in
  where the short one is wanted and none was given — you already wrote it as
  short as you wanted it, and the school's abbreviation of a word the school does
  not use would be a name from neither. Breaks have no short name of any kind:
  they are drawn under one name whatever the subject setting says, so those two
  cells are left empty rather than filled with a field that does nothing.

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
- **The named breaks are rows in that table too**, so *Proaeg* and *Amps* can
  be renamed and recolored like any subject. They sit after the subjects, under
  a heading of their own, because a gap is a different kind of thing from a
  lesson. Among themselves they run in clock order, the order the day runs
  them: the midday hour first, the afternoon snack after it.

  **A break a lesson runs straight across is drawn over the lesson**, inset, the
  way a reader's own event is — a layer, with the lesson keeping its full width.
  Packed beside it the two are half a column each, which is how the day says
  "two groups, one hour" everywhere else, and a reader wrote in to say that is
  exactly how it read: lunch and handicraft as two groups' lessons. TäheTERA's
  4.a has the case, a two-hour Loovloodus on a Thursday with the plan's Lõuna
  inside it.

  Only where one reader can have both. A break and a lesson of two different
  groups are alternatives rather than layers, and side by side is what the day
  should say about them: ProTERA's Tuesday has a bus for 8.j and 8.r across the
  hour 8.e spends in Keemia. Whole-class on either side means one reader has
  both, and so does any shared group.

  The plan and the timetable disagree in that TäheTERA case, and the page does
  not settle it. The plan gives 4.a a Lõuna at 13.15 and the timetable gives it
  a lesson from 12.30 to 14.30, and only the school can say which is when.

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
  blend.

  **The page rule the script writes has to come last.** Two `@page` rules are
  resolved by which is written later, not by which is more specific. The
  stylesheet carries a copy for a browser running no script, and while that copy
  came second the reader's paper edge was worked out, drawn to, and then quietly
  overridden on the way to the printer — the sheet always printed at 5mm
  whatever the setting said. Nothing on screen showed it, because the preview
  reads the setting rather than the rule. A test now holds the script's rule
  after the fallback.

  **No gradient that reaches the sheet has a see-through stop**, and the hatch
  is only where that was learned. The half-hour rules down a day and the grey
  behind the clock strip were written the same way, `transparent` past the first
  pixel, and printed the same way: black bands across the afternoon, on paper
  and in a printed PDF, never on screen. Both now name the color behind them
  instead. A browser test walks every gradient the sheet really paints and fails
  on any stop that is not opaque, which is the only place this can be caught —
  nothing on screen shows it, so the reader finds out from the printer.

  Collapsing the rules also fixed something quieter. They were two stacked
  gradients, one per half hour and one per hour, and the top one had to be
  see-through for the other to show. Both drew their lines at the same offsets,
  so the lighter half-hour line covered the darker hour line it was meant to
  leave showing. An hour is exactly two halves, so one gradient now holds both
  lines and the hour reads darker again. The default
  color is a quiet grey rather than one from the subject palette. A break runs
  the full width of the day, so a palette color wins every glance, which is
  backwards for a gap.

  **Two quiet colors, not one.** A break that is a meal — *Söömine*, *Amps*,
  *Hommikuamps*, *Lõuna*, *Lõuna + loovaeg*, and a lunch the page worked out for
  itself — is drawn in a warm `#EADFC8` rather than the grey `#EDEFF2` the rest
  take. Eating is one answer to "what is this hour" and free time is another,
  and in one grey with labels of much the same length a column of them was a
  column of identical boxes.

  A hue because it is the fastest thing to read at a glance, and a step darker
  as well because a card is printed as often as it is looked at and a printer
  with no color has only the step: fifteen points of greyscale between them, and
  a test that says so.

  The label is firmer on a meal too — a warm `#453520` at 8.9:1, against 7.1:1
  for the grey ones. A meal is the one gap a reader plans around, so it is not
  quite as quiet as free time, and where the boxes are small and the labels the
  same length the text is the other half of telling them apart.

  The worked-out lunch takes the meal color too. Same hour and same meal, so a
  reader should not be told two different things about it depending on whether
  their school named the band or left it to arithmetic. Each row says what that subject
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

They are frozen on purpose and they go out of date on purpose. A test needs an
input that does not move under it; it does not need this week. So the fixtures
are not the place to look up what a class has on a Monday — the published page
is, and it is rebuilt every night. Read the fixtures for that and you will
report a lesson the school moved weeks ago, which is a mistake that has already
been made twice.

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
address says where anybody can get one of their own. Which is why the address
stays when the code is off. The address is read off
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
