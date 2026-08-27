"""A whole page, built from the committed API responses.

tests/fixtures holds the school's own responses, frozen. Building from them
needs no network and takes a moment, which is what lets these run on every push
— the school's server is someone else's, and it rations how often one address
may ask.
"""

import collections
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIXTURES = os.path.join(HERE, "fixtures")

sys.path.insert(0, ROOT)

import tt


FIXTURE_FILES = ("tera-ttlist-2026.json", "tera-tt-68.json", "tera-tt-104.json",
                 "tera-tt-105.json", "tera-tt-103.json")


def build(*args):
    """Run the generator against the fixtures and return the payload it embedded.

    Nothing here may reach the network. The generator treats `--cache` as a
    read-through cache, so a run that misses writes the answer back — a build
    that fetched would leave new files in the fixture directory and spend the
    school's rate limit, with the suite none the wiser. Every call is checked
    for that afterwards.
    """
    before = set(os.listdir(FIXTURES))
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "page.html")
        done = subprocess.run(
            # The year is named, not derived: the fixtures are one year's, and
            # a suite that depends on today's date starts failing in a summer.
            [sys.executable, os.path.join(ROOT, "tt.py"), "--cache", FIXTURES,
             "--year", "2026", "-o", out, *args],
            capture_output=True, text=True, cwd=ROOT)
        if done.returncode != 0:
            raise AssertionError(done.stderr)
        with open(out, encoding="utf-8") as fh:
            page = fh.read()
    fetched = sorted(set(os.listdir(FIXTURES)) - before)
    assert not fetched, ("the build went to the network and cached %s — the "
                         "fixtures no longer describe what was tested" % fetched)
    blob = re.search(r'<script id="data" type="application/json">(.*?)</script>', page, re.S)
    return page, json.loads(blob.group(1))


class WholePage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Without the fixtures the generator falls through to the live API, and
        # the suite would quietly pass while spending the school's rate limit.
        for name in FIXTURE_FILES:
            assert os.path.exists(os.path.join(FIXTURES, name)), f"missing fixture {name}"
        cls.page, cls.data = build()

    def test_it_builds_the_schools_the_fixtures_describe(self):
        self.assertEqual([s["l"] for s in self.data["schools"]],
                         ["ProTERA ja TERA gümnaasium", "SädeTERA", "LõunaTERA", "TäheTERA"])

    def test_the_fixtures_actually_produce_a_timetable(self):
        """The one that stops every invariant below being vacuous.

        All of them loop over the lessons and pass trivially when there are
        none, so a build that emitted an empty week would have been green.
        """
        rows = [e for s in self.data["schools"] for c in s["c"] for e in c["e"]]
        boxes = [e for e in rows if not e["c"]]
        self.assertEqual(len(self.data["schools"]), 4)
        self.assertEqual(sum(len(s["c"]) for s in self.data["schools"]), 40)
        # Fewer boxes than periods-with-a-lesson: a published block covering
        # two periods is one box. Fewer rows than periods with a card, too —
        # SädeTERA has two lessons its own day plan leaves no room for, and the
        # build says so rather than drawing them at a guessed time.
        self.assertEqual((len(rows), len(boxes)), (1890, 1552))
        # 70 subject names, plus the five named breaks. A break is drawn and
        # recolored like a lesson, so it needs a color of its own.
        self.assertEqual(len(self.data["palette"]), 74)
        # Every class carries lessons, and the group pickers are populated.
        self.assertTrue(all(c["e"] for s in self.data["schools"] for c in s["c"]))
        self.assertEqual(sum(len(c["v"]) for s in self.data["schools"]
                             for c in s["c"]), 59)

    def test_a_known_day_comes_out_exactly_as_it_should(self):
        """One day, pinned whole: subject, period, groups and clock time.

        The arithmetic that turns a slot into a printed time had nothing over
        it — the pieces were tested apart, the thing they add up to was not.
        """
        school = next(s for s in self.data["schools"] if s["n"] == "68")
        klass = next(c for c in school["c"] if c["n"] == "8")
        monday = sorted(((e["p"], e["s"], e["w"], "/".join(e["g"]))
                         for e in klass["e"] if e["d"] == 0 and not e["c"]))
        self.assertEqual(monday, [
            (1, "Ajutreening", "9.00–10.20", "8.1"),
            (1, "Ajutreening", "9.00–10.20", "8.2"),
            (1, "Ajutreening", "9.00–10.20", "8.3"),
            (1, "Ajutreening", "9.00–10.20", "8.4"),
            (3, "Inglise keel", "10.30–11.50", "I A"),
            (3, "Inglise keel", "10.30–11.50", "II A"),
            (3, "Prantsuse keel", "10.30–11.50", "Pr 1"),
            (3, "Saksa keel", "10.30–11.50", "Sk 1"),
            (3, "Vene keel", "10.30–11.50", "Vk 2"),
            (5, "Inglise keel", "12.50–13.35", "I B"),
            (5, "Inglise keel", "12.50–13.35", "II B"),
            (5, "Inglise keel", "12.50–13.35", "III B"),
            (5, "Prantsuse keel", "12.50–13.35", "Pr 2"),
            (5, "Vene keel", "12.50–13.35", "Vk 1"),
            (6, "Ajalugu", "13.55–15.15", "Alfa"),
            (6, "Geograafia", "13.55–15.15", "Beeta"),
            (6, "Muusika", "13.55–15.15", "Gamma"),
            (8, "Eesti keel", "15.20–16.05", "8.j"),
            (8, "Eesti keel", "15.20–16.05", "8.r"),
        ])
        # And the fields the page draws from, on one of them.
        pair = next(e for e in klass["e"] if e["d"] == 0 and e["p"] == 6
                    and e["s"] == "Ajalugu")
        self.assertEqual((pair["u"], pair["a"], pair["z"]), (2, 835, 915))
        self.assertTrue(pair["t"] and pair["T"] and pair["r"])

    def test_the_subject_that_covers_the_most_paper_is_the_lightest(self):
        """A week of one subject in a deep color reads as a wall. Üldõpetus is
        219 lessons and had a dark slate; every junior class was that slate."""
        # Breaks are deliberately outside the palette — one quiet grey, whether
        # the school writes them as gaps or as lessons. They would otherwise
        # count as the lightest member of whatever family their name falls in.
        breaks = {b["n"] for school in self.data["schools"] for c in school["c"]
                  for day in c["h"].values() for b in day["b"] if b["n"]}
        breaks |= {e["s"] for school in self.data["schools"] for c in school["c"]
                   for e in c["e"] if e.get("B")}
        counts = collections.Counter(
            e["s"] for school in self.data["schools"] for c in school["c"]
            for e in c["e"] if not e["c"] and e["s"] not in breaks)
        palette = self.data["palette"]
        families = collections.defaultdict(list)
        for name in palette:
            if name in counts:
                families[tt.subject_family(name)[0]].append(name)

        def light(name):
            """How light the color was asked to be, not how bright it looks.
            A green and a blue of one lightness have very different luminance,
            and lightness is what the palette assigns."""
            import colorsys
            bg = palette[name]["bg"]
            r, g, b = (int(bg[i:i + 2], 16) / 255 for i in (1, 3, 5))
            return round(colorsys.rgb_to_hls(r, g, b)[1], 3)

        checked = 0
        for family, members in families.items():
            if len(members) < 2:
                continue
            leader = max(members, key=lambda n: (counts[n], n))
            # Only where the leader is a clear one. A family whose members are
            # neck and neck has no business reshuffling on a rebuild.
            rest = [n for n in members if n != leader]
            if counts[leader] < 2 * max(counts[n] for n in rest):
                continue
            checked += 1
            with self.subTest(family=family, leader=leader):
                self.assertEqual(light(leader), max(light(n) for n in members))
        self.assertGreater(checked, 2, "no family had a clear leader to check")
        # And the two that made this worth doing.
        self.assertGreater(light("Üldõpetus"), 0.8)
        self.assertGreater(light("Inglise keel"), 0.8)

    def test_a_break_names_no_teacher(self):
        """aSc wants a teacher on every card, so a break carries one that is
        not a person: LõunaTERA's is "Vahe Paus", which is "break pause".
        Nobody reads a break to find out who is supervising it."""
        named = {t for school in self.data["schools"] for c in school["c"]
                 for e in c["e"] for t in e["T"]}
        self.assertNotIn("Vahe Paus", named)
        shorts = {t for school in self.data["schools"] for c in school["c"]
                  for e in c["e"] for t in e["t"]}
        self.assertNotIn("VP", shorts, "the abbreviation stayed behind")
        # Every break lost its teacher, and the abbreviation went with the
        # name: they are two lists built from the same ids, so dropping one
        # and not the other would leave a box naming the wrong teacher.
        school = next(s for s in self.data["schools"] if s["l"] == "LõunaTERA")
        breaks = [e for c in school["c"] for e in c["e"] if e.get("B")]
        self.assertGreater(len(breaks), 100, "the fixtures lost the breaks")
        for e in breaks:
            self.assertEqual((e["T"], e["t"]), ([], []))
        # A real teacher on a real lesson is untouched.
        taught = [e for c in school["c"] for e in c["e"] if not e.get("B") and e["T"]]
        self.assertGreater(len(taught), 100)
        for e in taught:
            self.assertEqual(len(e["T"]), len(e["t"]))

    def test_the_swapped_spanish_groups_land_on_the_right_days(self):
        """TäheTERA 5.a takes Spanish at 12.10 and at 12.55 on Monday and on
        Thursday, and the half that goes first on Monday goes second on
        Thursday. aSc cannot say that, so it names one group per period and
        both names are placeholders. HK1 is the group that goes at 12.10 on
        Monday, HK2 the other one."""
        school = next(s for s in self.data["schools"] if s["l"] == "TäheTERA")
        cls = next(c for c in school["c"] if c["n"] == "5.a")
        spanish = sorted((e["d"], e["a"], "/".join(e["g"]))
                         for e in cls["e"] if e["s"] == "Hispaania keel")
        mon, thu = 0, 3
        self.assertEqual(spanish, [
            (mon, 12 * 60 + 10, "HK1"), (mon, 12 * 60 + 55, "HK2"),
            (thu, 12 * 60 + 10, "HK2"), (thu, 12 * 60 + 55, "HK1"),
        ])

    def test_the_group_picker_offers_both_spanish_groups(self):
        """One aSc group becomes two, and the reader has to be able to pick
        either. French and German share the division and do not swap."""
        school = next(s for s in self.data["schools"] if s["l"] == "TäheTERA")
        cls = next(c for c in school["c"] if c["n"] == "5.a")
        div = next(d for d in cls["v"] if "HK1" in d["groups"])
        self.assertEqual(div["groups"], ["HK1", "HK2", "PK", "SK"])

    def test_the_other_fifth_years_are_left_as_edupage_has_them(self):
        """5.l and 5.t sit in the same two lessons and are listed the same way.
        Whether they swap too is not in the data, and the school has said only
        for 5.a. Guessing would put the wrong lesson in front of a reader."""
        school = next(s for s in self.data["schools"] if s["l"] == "TäheTERA")
        for name in ("5.l", "5.t"):
            cls = next(c for c in school["c"] if c["n"] == name)
            groups = {g for e in cls["e"] if e["s"] == "Hispaania keel"
                      for g in e["g"]}
            self.assertEqual(sorted(groups), ["HK", "HK1"], name)

    def test_a_teacher_named_class_is_offered_with_its_year(self):
        """LõunaTERA names its classes after their teacher, so the built page
        carries a label saying the year as well. The name itself must not move:
        a shared link names the class, and the reader's own settings — hidden
        subjects, added events, group picks — are filed under it."""
        school = next(s for s in self.data["schools"] if s["l"] == "LõunaTERA")
        self.assertEqual([c["n"] for c in school["c"]],
                         ["Maarja", "Heliis", "Mari-Liis", "Cathleen", "Silva ",
                          "Elis", "Kateriine", "Juta", "Katrin", "Joanna",
                          "Sille"])
        self.assertEqual([c["d"] for c in school["c"]],
                         ["1. Maarja", "2. Heliis", "2. Mari-Liis",
                          "3. Cathleen", "3. Silva", "4. Elis", "4. Kateriine",
                          "5. Juta", "5. Katrin", "6. Joanna", "6. Sille"])

    def test_a_school_whose_names_say_the_year_is_offered_as_it_writes_them(self):
        """Everywhere else the name opens with the year, and a second label
        would only say it twice."""
        for school in self.data["schools"]:
            if school["l"] == "LõunaTERA":
                continue
            labelled = [c["n"] for c in school["c"] if c.get("d")]
            self.assertEqual(labelled, [], school["l"])

    def test_a_worked_out_break_centres_its_one_line(self):
        """It has one line and a box that can be three hours tall. Left at the
        top, the words float above a wide empty rectangle."""
        page, _ = build()
        rule = page.split(".ev.gap {", 1)[1].split("}", 1)[0]
        for want in ("display: flex", "align-items: center", "justify-content: center"):
            self.assertIn(want, rule, rule)
        # The line has to fill the box for centring and the ellipsis to agree.
        inner = page.split(".ev.gap .what {", 1)[1].split("}", 1)[0]
        self.assertIn("width: 100%", inner, inner)

    def test_a_break_is_quiet_and_a_subject_is_not(self):
        """A break runs the full width of the day. Through the subject palette
        it came out a muddy beige and won every glance, which is backwards for
        a gap."""
        breaks = {b["n"] for s in self.data["schools"] for c in s["c"]
                  for day in c["h"].values() for b in day["b"] if b["n"]}
        self.assertEqual(breaks, {"Vaba aeg", "Amps", "Hommikuamps", "Lõuna",
                                  "Lõuna + loovaeg"})
        for name in breaks:
            with self.subTest(name=name):
                self.assertEqual(self.data["palette"][name],
                                 {"bg": tt.BREAK_BG, "fg": tt.BREAK_FG})
        # A subject still gets a colour of its own from its family.
        self.assertNotEqual(self.data["palette"]["Ajalugu"]["bg"], tt.BREAK_BG)

    def test_the_gumnaasium_keeps_its_own_day(self):
        """One published timetable, two schools. Read against the grades below
        it, the gümnaasium afternoon ran ten and then twenty minutes late."""
        school = next(s for s in self.data["schools"] if s["n"] == "68")
        names = [c["n"] for c in school["c"]]
        self.assertEqual(names, ["7", "8", "9", "G1B", "G1J", "G1K",
                                 "G2A", "G2M", "G2T"])

        def monday(klass):
            cls = next(c for c in school["c"] if c["n"] == klass)
            first = {}
            for e in cls["e"]:
                if e["d"] == 0:
                    first.setdefault(e["p"], e)
            return ([e["w"] for _, e in sorted(first.items()) if not e["c"]],
                    [(b["n"], b["s"], b["e"]) for b in cls["h"]["0"]["b"]])

        # Four lessons of eighty minutes, and the day plan's own two breaks.
        lessons, breaks = monday("G1B")
        self.assertEqual(sorted(set(lessons)),
                         ["10.30–11.50", "12.40–14.00", "14.10–15.30", "9.00–10.20"])
        self.assertEqual(breaks, [("Hommikuamps", "8.30", "8.55"),
                                  ("Lõuna", "11.50", "12.40")])
        # The grades below it are untouched.
        lessons, breaks = monday("8")
        self.assertIn("12.50–13.35", lessons)
        self.assertEqual(breaks, [("Vaba aeg", "11.50", "12.50"),
                                  ("Amps", "13.35", "13.55")])

    def test_the_fifth_years_split_around_lunch(self):
        """Two groups, opposite orders: one takes the language at 12.10 and
        eats after, the other eats first and takes it at 12.55. Two rows on the
        sheet, two periods in the timetable, so both are drawn — and a reader
        who picks their group is left with their own lunch as the free hour
        between the lesson and whatever is either side of it."""
        school = next(s for s in self.data["schools"] if s["l"] == "TäheTERA")
        cls = next(c for c in school["c"] if c["n"].strip() == "5.a")
        for day in (0, 3):
            with self.subTest(day=day):
                first = {(e["p"], e["w"]) for e in cls["e"]
                         if e["d"] == day and e["p"] in (5, 6) and not e["c"]}
                self.assertEqual(first, {(5, "12.10–12.55"), (6, "12.55–13.40")})
        # The two do not overlap, so nobody is shown in two places at once.
        for day in (0, 3):
            five = [e for e in cls["e"] if e["d"] == day and e["p"] == 5][0]
            six = [e for e in cls["e"] if e["d"] == day and e["p"] == 6][0]
            self.assertLessEqual(five["z"], six["a"])
        # On these two days no lunch band is drawn across the class, because it
        # would be wrong for half of it: each group eats around its own
        # language slot. Only the morning Amps, which everybody shares.
        for day in (0, 3):
            with self.subTest(day=day):
                self.assertEqual({b["n"] for b in cls["h"][str(day)]["b"]},
                                 {"Amps"})

    def test_the_short_days_keep_their_half_hour_lunch(self):
        """The days without the language split leave one gap between the last
        long block and the closing lesson. The first sheet gave it no times and
        ten minutes was what fit; the next one named it: 13.15 to 13.45."""
        school = next(s for s in self.data["schools"] if s["l"] == "TäheTERA")
        cls = next(c for c in school["c"] if c["n"].strip() == "5.a")
        for day in (1, 2, 4):
            with self.subTest(day=day):
                lunch = [b for b in cls["h"][str(day)]["b"] if b["n"] == "Lõuna"]
                self.assertEqual([(b["s"], b["e"]) for b in lunch],
                                 [("13.15", "13.45")])

    def test_lunch_belongs_to_a_class_not_to_a_school(self):
        """One canteen cannot seat everybody at once, so a school can name the
        classes a band applies to. Only 5.a has published times, so only 5.a
        is given the short lunch."""
        school = next(s for s in self.data["schools"] if s["l"] == "TäheTERA")
        for cls in school["c"]:
            if cls["n"].strip() == "5.a":
                continue
            names = {b["n"] for d in cls["h"].values() for b in d["b"]}
            self.assertNotIn("Lõuna", names, cls["n"])

    def test_only_the_school_that_leaves_lunch_to_arithmetic_says_so(self):
        """Three schools publish a lunch band. TäheTERA cannot: it is a
        different hour for each language group, so it is whatever the reader's
        own lessons leave — and the school says which holes count as one."""
        window = {s["l"]: s["lg"] for s in self.data["schools"]}
        self.assertEqual(window["TäheTERA"],
                         {"n": "Lõuna", "a": 12 * 60, "z": 13 * 60, "m": 30})
        for name in ("ProTERA ja TERA gümnaasium", "SädeTERA", "LõunaTERA"):
            self.assertEqual(window[name], 0, name)

    def test_a_group_that_has_a_block_to_itself_gets_one_box(self):
        """Two groups at once are two boxes side by side, which is the point of
        a group. One group taking the same subject on both halves of a block is
        one lesson, and it was drawn beside itself: 5.a has English on both
        periods of a Tuesday block, once for each of its three groups, and
        every group saw two of itself."""
        school = next(s for s in self.data["schools"] if s["l"] == "TäheTERA")
        cls = next(c for c in school["c"] if c["n"].strip() == "5.a")
        for day, when, subject, groups in (
                (1, "10.45–12.10", "Inglise keel", {"IK1", "IK2", "IK3"}),
                (3, "10.45–12.05", "Matemaatika", {"Mat 1", "Mat 2", "Mat 3", "Mat 4"})):
            with self.subTest(day=day, subject=subject):
                boxes = [e for e in cls["e"]
                         if e["d"] == day and not e["c"] and e["p"] in (3, 4)]
                # One per group, not two, and each spans the whole block.
                self.assertEqual(len(boxes), len(groups))
                self.assertEqual({g for e in boxes for g in e["g"]}, groups)
                for e in boxes:
                    self.assertEqual((e["w"], e["u"], e["s"]), (when, 2, subject))
        # Two different subjects on one period still sit side by side.
        monday = [e for e in cls["e"] if e["d"] == 0 and not e["c"] and e["p"] == 6]
        self.assertEqual({e["s"] for e in monday},
                         {"Hispaania keel", "Prantsuse keel", "Saksa keel"})

    def test_a_lesson_running_past_one_published_block_ends_where_it_ends(self):
        """LõunaTERA publishes blocks rather than lesson lengths. A lesson
        covering two of them used to stop at the end of the first.

        And where the school says such a lesson stops early, it stops there:
        the fifth period runs to 14.00 on its own, and to 14.35 when it carries
        the sixth with it — which is 20 minutes before the sixth would have
        ended on its own."""
        school = next(s for s in self.data["schools"] if s["n"] == "105")
        klass = next(c for c in school["c"] if c["n"].strip() == "Elis")
        box = next(e for e in klass["e"]
                   if e["d"] == 3 and e["s"] == "Kodundus" and not e["c"])
        self.assertEqual((box["w"], box["a"], box["z"]), ("13.15–14.35", 795, 875))
        # The same period on its own keeps its own end.
        alone = [e for e in klass["e"]
                 if e["p"] == 8 and e["u"] == 1 and not e["c"]]
        self.assertTrue(alone, "no class takes the fifth period on its own")
        for e in alone:
            self.assertEqual(e["w"], "13.15–14.00")

    def test_a_merged_box_carries_the_subjects_it_merged(self):
        merged = [e for s in self.data["schools"] for c in s["c"]
                  for e in c["e"] if e["S"]]
        self.assertEqual(len(merged), 36)
        self.assertIn(["Häälestus", "Üldõpetus"], [e["S"] for e in merged])

    def test_the_two_teacher_spellings_do_not_change_places(self):
        # One field is the short form the grid uses, the other the full name in
        # the tooltip. Swapped, both are still populated and still plausible.
        school = next(s for s in self.data["schools"] if s["n"] == "68")
        klass = next(c for c in school["c"] if c["n"] == "8")
        box = next(e for e in klass["e"]
                   if e["d"] == 0 and e["p"] == 6 and e["s"] == "Ajalugu")
        self.assertEqual((box["t"], box["T"]), (["RM"], ["Metsik Robert"]))

    def test_the_named_breaks_survive_into_the_page(self):
        school = next(s for s in self.data["schools"] if s["n"] == "68")
        klass = next(c for c in school["c"] if c["n"] == "8")
        breaks = [(b["n"], b["s"], b["e"]) for b in klass["h"]["0"]["b"]]
        self.assertEqual(breaks, [("Vaba aeg", "11.50", "12.50"),
                                  ("Amps", "13.35", "13.55")])

    def test_each_school_abbreviates_and_colors_in_its_own_words(self):
        """The four timetables are separate aSc documents that spell the same
        subject differently. One table keyed by name handed whichever school
        was read first to all of them."""
        seen = {s["n"]: s["sj"].get("Inglise keel") for s in self.data["schools"]
                if "Inglise keel" in s["sj"]}
        self.assertGreater(len(seen), 1)
        self.assertGreater(len({(f or {}).get("short") for f in seen.values()}), 1)
        self.assertGreater(len({(f or {}).get("color") for f in seen.values()}), 1)
        # And every subject a box names can be abbreviated, lead or not.
        for s in self.data["schools"]:
            for c in s["c"]:
                for e in c["e"]:
                    for name in (e["S"] or [e["s"]]):
                        with self.subTest(school=s["n"], subject=name):
                            self.assertIn(name, s["sj"])
                            self.assertIn(name, self.data["palette"])

    def test_the_right_schools_have_a_day_plan(self):
        """All four are timed now, each from a plan copied off a published
        sheet. TäheTERA is the thin one: a sheet arrived for one class of
        fourteen, so that class is timed and the other thirteen keep the plain
        grid. If a bell config stopped matching, the invariants below would
        pass by examining nothing at all."""
        self.assertEqual({s["l"]: s["b"] for s in self.data["schools"]},
                         {"ProTERA ja TERA gümnaasium": True, "SädeTERA": True,
                          "LõunaTERA": True, "TäheTERA": True})
        tahe = next(s for s in self.data["schools"] if s["l"] == "TäheTERA")
        timed = [c["n"].strip() for c in tahe["c"]
                 if any(e["a"] is not None for e in c["e"])]
        self.assertEqual(timed, ["5.a"], "a class was timed from a sheet nobody sent")
        self.assertEqual(len(tahe["c"]), 14)

    def test_sadetera_draws_the_day_plan_the_school_publishes(self):
        """It ran on a clock with fixed periods, and had to guess which lessons
        in a row were a double. The guess is not derivable — the school decides
        — and it was wrong on one box in five. So the plan is copied in."""
        school = next(s for s in self.data["schools"] if s["l"] == "SädeTERA")
        boxes = [e for c in school["c"] for e in c["e"] if not e["c"]]
        self.assertTrue(all(e["a"] is not None and e["z"] > e["a"] for e in boxes))

        def day(klass, idx):
            cls = next(c for c in school["c"] if c["n"].strip() == klass)
            first = {}
            for e in cls["e"]:
                if e["d"] == idx and not e["c"]:
                    first.setdefault(e["p"], e)
            return [e["w"] for _, e in sorted(first.items())]

        # A double the school pairs, where the old guess paired 2 and 3.
        self.assertEqual(day("1. S", 3),
                         ["9.00–9.45", "9.50–10.35", "10.45–12.05", "13.00–13.45"])
        # And a day of its own: this one starts its third lesson ten minutes late.
        self.assertIn("10.55–12.15", day("6. S", 2))

        # Two lunch sittings, which is why one plan for the school cannot be
        # right for all of it: the younger half eats at 12.05, the older at 12.20.
        def lunch(klass):
            cls = next(c for c in school["c"] if c["n"].strip() == klass)
            return sorted({b["s"] for d in cls["h"].values() for b in d["b"]})
        # The younger half never eats later than 12.05, the older never earlier
        # than 12.20. A day that stops before lunch gets the sheet's own window,
        # which is why the first sitting also shows a 12.00.
        self.assertEqual(lunch("1. S"), ["12.00", "12.05"])
        self.assertEqual(lunch("5. S"), ["12.20"])
        self.assertTrue(all(b <= "12.05" for b in lunch("2. S") if b != "12.20"))
        # Every day a class is at school, it eats. Five of thirty had no band:
        # four Fridays that stop before lunch, so there is no second block to
        # measure a space against, and one Tuesday whose lunch is 25 minutes.
        for cls in school["c"]:
            for day, shape in cls["h"].items():
                with self.subTest(klass=cls["n"].strip(), day=day):
                    self.assertEqual(len(shape["b"]), 1, "one lunch, no more")

        # What makes a space lunch is when it falls, not only how long it is.
        # A 20-minute gap at half past one is neither corridor nor lunch.
        for cls in school["c"]:
            for shape in cls["h"].values():
                for b in shape["b"]:
                    self.assertTrue("12.00" <= b["s"] <= "12.45", b)

    def test_every_class_with_a_day_plan_gets_its_times(self):
        """The check that would have caught a class quietly losing them.

        A class in a school that publishes times, whose lessons are all untimed,
        draws nothing at all. That happened: aSc calls one class "Silva " and the
        band table said "Silva".
        """
        checked = 0
        for school in self.data["schools"]:
            if not school["b"]:
                continue
            cfg = tt.bell_config(school["l"], school["t"]) or {}
            bands = cfg.get("bands")
            # A school can publish a sheet for one class and none for the
            # others — TäheTERA has one of fourteen — and the others fall back
            # to the plain grid on purpose. Check the ones the plan names.
            # A band names the classes it covers, or the years — and where it
            # names years, every class the school offers is in one of them.
            covered = ({k["n"].strip() for k in school["c"]}
                       if not bands or any("grades" in band for band in bands)
                       else {name.strip() for band in bands
                             for name in band["classes"]})
            for klass in school["c"]:
                name = klass["n"].strip()
                timed = sum(1 for e in klass["e"] if e["a"] is not None)
                with self.subTest(school=school["l"], klass=name):
                    if name in covered:
                        checked += 1
                        self.assertEqual(timed, len(klass["e"]),
                                         "lessons without a time are never drawn")
                    else:
                        # All or nothing. Half a class is the shape the bug had.
                        self.assertIn(timed, (0, len(klass["e"])),
                                      "half of a class has times")
        self.assertGreater(checked, 20, "the scan checked suspiciously few")

    def test_no_lesson_is_drawn_twice_in_the_same_place(self):
        """Two boxes in one place, same subject, same groups, is aSc's record of
        one lesson showing through as two half-width boxes.

        Keyed on the slot rather than the clock, so the schools without times —
        which are drawn in the period grid, where the same duplication shows —
        are covered too."""
        for school in self.data["schools"]:
            for klass in school["c"]:
                drawn = [e for e in klass["e"] if not e["c"]]
                seen = collections.Counter(
                    (e["d"], e["k"], e["p"], e["s"], tuple(e["g"])) for e in drawn)
                repeated = [key for key, n in seen.items() if n > 1]
                with self.subTest(school=school["l"], klass=klass["n"]):
                    self.assertEqual(repeated, [])

    def test_no_lesson_is_implausibly_short(self):
        """assertLess(a, z) alone is satisfied by a one-minute lesson."""
        for school in self.data["schools"]:
            for klass in school["c"]:
                for e in klass["e"]:
                    if e["a"] is None:
                        continue
                    with self.subTest(school=school["l"], klass=klass["n"], at=e["w"]):
                        self.assertGreaterEqual(e["z"] - e["a"], 20)

    def test_the_page_carries_the_code_that_makes_it_work(self):
        for marker in ("function readEvents", "function renderTimeline",
                       "function renderEvents", "qrcode"):
            self.assertIn(marker, self.page, "page.js or the QR library is not inlined")

    # The counter's script tag is there only when a site was named at build
    # time, and page.js is written to find nothing and do nothing when it is
    # absent. Every other id must exist in every build.
    OPTIONAL_IDS = {"gc"}

    def test_every_element_the_page_reaches_for_exists(self):
        """A renamed id is a blank page that no syntax check would catch."""
        with open(os.path.join(ROOT, "page.js"), encoding="utf-8") as fh:
            wanted = set(re.findall(r'getElementById\("([^"]+)"\)', fh.read()))
        self.assertGreater(len(wanted), 20, "the scan found suspiciously few")
        for name in sorted(wanted - self.OPTIONAL_IDS):
            with self.subTest(id=name):
                self.assertIn('id="%s"' % name, self.page)

    def test_every_lesson_ends_after_it_starts(self):
        for school in self.data["schools"]:
            for klass in school["c"]:
                for e in klass["e"]:
                    if e["a"] is None:
                        continue
                    with self.subTest(school=school["l"], klass=klass["n"], at=e["w"]):
                        self.assertLess(e["a"], e["z"])

    def test_every_subject_shown_has_a_color_to_show_it_in(self):
        used = {e["s"] for s in self.data["schools"] for c in s["c"] for e in c["e"]}
        self.assertTrue(used <= set(self.data["palette"]),
                        "a subject with no palette entry falls back to grey")

    def test_nothing_in_the_payload_can_close_the_script_block(self):
        blob = re.search(r'<script id="data" type="application/json">(.*?)</script>',
                         self.page, re.S).group(1)
        self.assertNotIn("<", blob, "a '<' in school data could end the block early")

    def test_a_plain_build_carries_no_tracker_and_no_date(self):
        # page.js always holds the code that would count a visit; what a plain
        # build must not hold is anything that reaches a third party.
        self.assertNotIn("gc.zgo.at", self.page)
        self.assertNotIn("data-goatcounter", self.page)
        self.assertNotIn('id="gc"', self.page)
        self.assertEqual(self.data["built"], "")

    def test_the_same_input_gives_the_same_page(self):
        first, _ = build("--school", "ProTERA", "--class", "8")
        second, _ = build("--school", "ProTERA", "--class", "8")
        self.assertEqual(first, second)


class Counting(unittest.TestCase):
    def test_a_local_build_calls_nobody(self):
        page, _ = build()
        for reach in ("gc.zgo.at", "data-goatcounter", 'id="gc"'):
            self.assertNotIn(reach, page)

    def test_the_counter_is_never_told_the_child_s_name(self):
        # Left alone the counter reports document.title, and the page puts the
        # name there. It counts by hand instead, out of the school's own names.
        page, _ = build("--goatcounter", "little-tools-timetable")
        self.assertIn("gc.zgo.at/count.js", page)
        self.assertIn("window.goatcounter = {no_onload: true", page)
        self.assertLess(page.index("window.goatcounter ="), page.index("gc.zgo.at"))
        # The hand-off between the two: page.js waits on the tag by its id.
        self.assertIn('<script id="gc"', page)
        self.assertIn('document.getElementById("gc")', page)


class SchoolYear(unittest.TestCase):
    def test_it_rolls_over_in_august(self):
        self.assertEqual(tt.school_year(datetime.date(2026, 8, 1)), 2026)
        self.assertEqual(tt.school_year(datetime.date(2027, 7, 31)), 2026)
        self.assertEqual(tt.school_year(datetime.date(2027, 8, 1)), 2027)

    def test_it_is_not_written_down_anywhere(self):
        # A pinned year keeps working until the summer it quietly does not.
        with open(os.path.join(ROOT, "tt.py"), encoding="utf-8") as fh:
            source = fh.read()
        self.assertNotIn("default=2026", source)


def _every_string(root):
    """Every key the string table names, read straight off the source."""
    import ast
    with open(os.path.join(root, "tt.py"), encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for key in node.keys:
                if isinstance(key, ast.Constant) and isinstance(key.value, str):
                    out.add(key.value)
    return out


class Documentation(unittest.TestCase):
    """Counts in prose go stale silently. These are the ones worth pinning."""

    def resources(self, name):
        with open(os.path.join(ROOT, "deploy", name), encoding="utf-8") as fh:
            body = fh.read().split("\nResources:\n", 1)[1].split("\nOutputs:")[0]
        return re.findall(r"^  ([A-Za-z0-9]+):\s*$", body, re.M)

    def test_no_two_strings_share_a_key(self):
        """A duplicate key is silent — the later value simply wins, and some
        label somewhere shows text meant for something else."""
        import ast
        with open(os.path.join(ROOT, "tt.py"), encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            keys = [k.value for k in node.keys
                    if isinstance(k, ast.Constant) and isinstance(k.value, str)]
            twice = [k for k in set(keys) if keys.count(k) > 1]
            self.assertFalse(twice, "duplicate keys near line %d: %s"
                                    % (node.lineno, twice))

    def test_every_string_the_page_asks_for_exists(self):
        """A data-i18n naming a string that is not there renders as its key."""
        with open(os.path.join(ROOT, "tt.py"), encoding="utf-8") as fh:
            source = fh.read()
        wanted = set(re.findall(r'data-i18n(?:-ph|-aria)?="([^"]+)"', source))
        self.assertGreater(len(wanted), 20, "the scan found suspiciously few")
        _, data = build()
        for lang in ("en", "et"):
            have = set(data["strings"][lang])
            for key in sorted(wanted - have):
                with self.subTest(lang=lang, key=key):
                    self.fail("no %s string for %s" % (lang, key))

    def test_no_string_is_carried_that_nothing_renders(self):
        """A string nobody asks for is dead weight, and it still gets
        translated, reviewed and read every time somebody edits the table."""
        with open(os.path.join(ROOT, "tt.py"), encoding="utf-8") as fh:
            source = fh.read()
        with open(os.path.join(ROOT, "page.js"), encoding="utf-8") as fh:
            script = fh.read()
        asked = set(re.findall(r'data-i18n(?:-ph|-aria)?="([^"]+)"', source))
        for text in (source, script):
            asked |= set(re.findall(r'\bt\(\s*"([^"]+)"', text))
        # A key built where it is used — t("face." + face) — names a whole
        # family at once. The family is asked for; which member is not
        # something this can read, and a list built from one is checked by the
        # test that every option carries a label.
        families = set(re.findall(r'\bt\(\s*"([^"]+\.)"\s*\+', script))
        self.assertTrue(families, "the scan for built keys found none at all")
        asked |= {key for family in families
                  for key in _every_string(ROOT) if key.startswith(family)}
        # Read off the table by name rather than through t().
        asked.add("days")
        _, data = build()
        for lang in ("en", "et"):
            spare = sorted(set(data["strings"][lang]) - asked)
            self.assertEqual(spare, [], "%s strings nothing renders" % lang)

    def test_the_share_note_names_the_button_it_points_at(self):
        """The note tells the reader to press a button, so it has to print the
        name that button really carries in that language."""
        page, data = build()
        self.assertIn('id="shareNote"', page)
        self.assertIn('t("settings.share", t("share"))', page)
        for lang in ("en", "et"):
            note = data["strings"][lang]["settings.share"]
            self.assertIn("{0}", note, lang)
            # The button's own label goes in the hole, not a copy of the word.
            self.assertNotIn(data["strings"][lang]["share"], note, lang)

    def test_the_printed_note_names_the_setting_it_points_at(self):
        """The corner is empty until a reader switches the code on, so the note
        has to say which setting does that, in the words it really carries."""
        page, data = build()
        self.assertIn('id="printedNote"', page)
        self.assertIn('t("settings.printed", t("showQr"))', page)
        for lang in ("en", "et"):
            note = data["strings"][lang]["settings.printed"]
            self.assertIn("{0}", note, lang)
            # The checkbox's own label goes in the hole, not a copy of it.
            self.assertNotIn(data["strings"][lang]["showQr"], note, lang)

    def test_every_display_setting_sits_under_the_right_heading(self):
        """Three settings drifted into "For each lesson, show:" that are not
        about a lesson at all — free time, which is a box the page adds to the
        day, and two that change nothing until the sheet leaves the printer.
        A control under the wrong heading is a control nobody finds."""
        with open(os.path.join(ROOT, "tt.py"), encoding="utf-8") as fh:
            page = fh.read()
        panel = page[page.index('<details class="panel" id="displayPanel">'):
                     page.index('<details class="panel" id="eventsPanel">')]
        # Which heading each control falls under: the last one written above it.
        where, heading = {}, ""
        for kind, name in re.findall(
                r'data-i18n="(\w+Heading)"|id="(show\w+|printMargin|\w*[Nn]ame)"', panel):
            if kind:
                heading = kind
            elif name:
                where.setdefault(name, heading)
        want = {
            "showStudentName": "titleHeading", "showSchoolName": "titleHeading",
            "showClassName": "titleHeading",
            "showTeacher": "showHeading", "showDuration": "showHeading",
            "showRoom": "showHeading", "showGroup": "showHeading",
            "showSubject": "showHeading",
            "showGaps": "dayHeading",
            "showQr": "printHeading", "printMargin": "printHeading",
        }
        for control, expected in want.items():
            self.assertEqual(where.get(control), expected,
                             f"{control} is under {where.get(control)!r}")

    def test_a_heading_does_not_repeat_itself_in_its_own_labels(self):
        """"On the printout:" followed by "QR code on the printout" says it
        twice and reads as if the two were different things."""
        _, data = build()
        strings = data["strings"]
        for lang, heading, labels in (
                ("en", "printHeading", ("showQr", "printMargin")),
                ("et", "printHeading", ("showQr", "printMargin"))):
            words = set(re.findall(r"\w+", strings[lang][heading].lower()))
            words.discard("on")
            words.discard("the")
            for label in labels:
                said = set(re.findall(r"\w+", strings[lang][label].lower()))
                self.assertFalse(words & said,
                                 f"{lang} {label} repeats its own heading: "
                                 f"{strings[lang][label]!r}")

    def test_cloudfront_and_the_report_function_agree_on_the_gate(self):
        """The function URL is open to the world and a header is the only
        thing between it and everybody. If the two spell it differently,
        every report is refused and the page never finds out."""
        with open(os.path.join(ROOT, "deploy", "site.yaml"), encoding="utf-8") as fh:
            template = fh.read()
        added = re.search(r"HeaderName:\s*(\S+)", template)
        self.assertIsNotNone(added, "CloudFront adds no header")
        checked = re.search(r'headers\.get\("([^"]+)"\)', template)
        self.assertIsNotNone(checked, "the function checks no header")
        self.assertEqual(added.group(1), checked.group(1))
        # And the page posts where CloudFront listens.
        # Without a leading slash. CloudFront matches the pattern against the
        # path with the slash already off, so "/report" matches nothing and the
        # request falls through to the bucket.
        self.assertIn("PathPattern: report\n", template)
        self.assertNotIn("PathPattern: /report", template)
        # And the route the API answers is the path the page posts to.
        self.assertIn("RouteKey: POST /report", template)
        with open(os.path.join(ROOT, "deploy", "publish.py"), encoding="utf-8") as fh:
            body = fh.read()
        self.assertIn('configured("REPORT_ERRORS", "yes")', body)
        self.assertIn('"/report"', body)

    def test_the_policy_opens_only_for_something_that_is_there(self):
        """default-src is 'none'. Every hole in it has to be earned by a
        feature that is switched on."""
        with open(os.path.join(ROOT, "deploy", "site.yaml"), encoding="utf-8") as fh:
            template = fh.read()
        policy = template.split("ContentSecurityPolicy: !Sub", 1)[1]
        self.assertIn("connect-src ${Connect}", policy)
        # 'self' is in the reporting arm and nowhere else.
        arms = policy.split("Connect: !If", 1)[1].split("Beacon:", 1)[0]
        self.assertIn("Reporting", arms)
        self.assertEqual(arms.count("'self'"), 2, "one per counting case")

    def test_the_endpoint_takes_both_kinds_and_counts_them_apart(self):
        """A fault and a message from a reader go the same way, and want
        different treatment at the other end."""
        with open(os.path.join(ROOT, "deploy", "site.yaml"), encoding="utf-8") as fh:
            template = fh.read()
        self.assertIn('report.get("kind") not in ("page-error", "feedback")', template)
        self.assertIn(
            'FilterPattern: \'{ $.kind = "page-error" && $.opaque NOT EXISTS }\'',
            template, "an unreadable error should not wake anybody")
        self.assertIn('FilterPattern: \'{ $.kind = "feedback" }\'', template)
        for metric in ("PageErrors", "Feedback"):
            self.assertIn("MetricName: %s" % metric, template)
        # And the page has somewhere to write, in both languages.
        page, data = build()
        self.assertIn('id="sayText"', page)
        self.assertIn('id="sayWithSettings"', page)
        for lang in ("en", "et"):
            for key in ("say", "say.intro", "say.withSettings", "say.shown",
                        "say.send", "say.sent", "say.failed", "say.empty"):
                self.assertIn(key, data["strings"][lang], (lang, key))

    def test_a_stale_day_plan_is_alarmed_on(self):
        """The plans in tt.py are copied from published sheets. A lesson
        landing where the plan has no slot is what a republished sheet looks
        like from here, and it has to reach somebody."""
        with open(os.path.join(ROOT, "deploy", "site.yaml"), encoding="utf-8") as fh:
            template = fh.read()
        self.assertIn("""FilterPattern: '"the day plan has no time for"'""", template)
        self.assertIn("MetricName: PlanDrift", template)
        # The words the filter looks for are the words the build prints.
        with open(os.path.join(ROOT, "tt.py"), encoding="utf-8") as fh:
            self.assertIn("the day plan has no time for", fh.read())

    def test_the_vendored_code_is_the_code_that_was_vetted(self):
        """Two libraries are copied into this repository and inlined into the
        page, so whatever is in them runs in a reader's browser. These hashes
        are of the files as checked against upstream — qrcode-generator 1.4.4
        byte for byte, and fflate 0.8.2 byte for byte once the license this
        repository prepends is taken off.

        A changed byte here is either an upgrade nobody wrote down or somebody
        else's idea. Either way it should not go out quietly.
        """
        import hashlib
        expected = {
            "qrcode-generator.js":
                "18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780",
            "fflate.js":
                "eb598c2062fbdceb120c2513824aac9d86bf65169229493cf328833a80899b36",
        }
        for name, want in expected.items():
            with self.subTest(library=name):
                blob = open(os.path.join(ROOT, "vendor", name), "rb").read()
                self.assertEqual(hashlib.sha256(blob).hexdigest(), want)

    def test_the_page_runs_no_code_it_did_not_ship(self):
        """Nothing in the page builds code out of a string, and nothing talks
        to the network except the two calls this repository makes."""
        page, _ = build()
        for pattern, what in (
                (r"(?<![A-Za-z_.$])eval\s*\(", "eval"),
                (r"(?<![A-Za-z_.$])Function\s*\(", "the Function constructor"),
                (r"XMLHttpRequest", "XMLHttpRequest"),
                (r"WebSocket", "a WebSocket"),
                (r"sendBeacon", "sendBeacon"),
                (r"new\s+Image\s*\(", "an image beacon")):
            with self.subTest(looking_for=what):
                self.assertEqual(re.findall(pattern, page), [], what)
        # Two fetches: the fault report and the message a reader writes.
        self.assertEqual(len(re.findall(r"(?<![A-Za-z_.$])fetch\s*\(", page)), 2)

    def test_the_deploy_readme_counts_the_resources_correctly(self):
        counts = {n: len(self.resources(n))
                  for n in ("site.yaml", "dns.yaml", "cert.yaml")}
        self.assertEqual(counts, {"site.yaml": 30, "dns.yaml": 2, "cert.yaml": 1})
        with open(os.path.join(ROOT, "deploy", "README.md"), encoding="utf-8") as fh:
            readme = fh.read()
        # The words, not their capitalisation: the sentence around them is
        # free to be reworded.
        self.assertIn("thirty-three resources", readme.lower())
        self.assertIn("thirty in `site.yaml`", readme)

    def test_the_size_the_readmes_quote_is_the_size_it_is(self):
        import gzip
        page, _ = build()
        raw, wire = len(page.encode("utf-8")), len(gzip.compress(page.encode("utf-8"), 9))
        # Within a tolerance, since the school's own data moves it about.
        self.assertLess(abs(raw / 1024 - 700), 60, "%.0f KB raw" % (raw / 1024))
        self.assertLess(abs(wire / 1024 - 104), 12, "%.0f KB over the wire" % (wire / 1024))
        for name in ("README.md", os.path.join("deploy", "README.md")):
            with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
                self.assertIn("104 KB", fh.read(), name)

    def test_the_interface_is_british_and_the_code_is_american(self):
        """Two spellings, each in its own place.

        The reader sees "colour". The source and the documents say "color",
        which is also what the stored settings have always called the field.
        """
        _, data = build()
        english = data["strings"]["en"]
        for key, value in english.items():
            if isinstance(value, str) and "olor" in value:
                self.fail("the interface string %s says %r" % (key, value))
        shown = {v for v in english.values()
                 if isinstance(v, str) and "olour" in v}
        for name in ("tt.py", "page.js", "README.md",
                     os.path.join("deploy", "README.md")):
            with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
                source = fh.read()
            for i, line in enumerate(source.splitlines(), 1):
                if "olour" not in line.lower():
                    continue
                if any(v in line for v in shown):
                    continue        # the interface strings themselves
                self.fail("%s:%d uses British spelling outside the interface: %s"
                          % (name, i, line.strip()[:70]))

    def test_the_readme_does_not_write_down_a_school_year(self):
        # The generator derives it; prose that names one goes wrong in a summer.
        with open(os.path.join(ROOT, "README.md"), encoding="utf-8") as fh:
            readme = fh.read()
        self.assertNotIn("default 2026", readme)
        self.assertNotIn("default: 2026", readme)


class Selection(unittest.TestCase):
    def test_it_opens_where_it_was_asked_to(self):
        # Not the first school in the list, or ignoring --school would pass.
        _, data = build("--school", "LõunaTERA", "--class", "Maarja")
        self.assertEqual((data["initialSchool"], data["initialClass"]), ("105", "Maarja"))

    def test_a_class_can_be_asked_for_by_the_year_in_front_of_it(self):
        """The year form is the only one anybody has seen on the page, so it is
        the one they will type. Both reach the same class."""
        _, plain = build("--school", "LõunaTERA", "--class", "Maarja")
        _, with_year = build("--school", "LõunaTERA", "--class", "1. Maarja")
        self.assertEqual(with_year["initialClass"], "Maarja")
        self.assertEqual(plain["initialClass"], with_year["initialClass"])

    def test_a_class_that_is_in_no_timetable_is_reported_with_the_years(self):
        with self.assertRaises(Exception) as caught:
            build("--school", "LõunaTERA", "--class", "9. Nobody")
        self.assertIn("1. Maarja", str(caught.exception))

    def test_naming_only_a_school_opens_that_school(self):
        # With no class to fall back on, this can only pass if --school is read.
        _, data = build("--school", "LõunaTERA")
        self.assertEqual(data["initialSchool"], "105")

    def test_a_class_name_is_matched_past_the_spaces_around_it(self):
        # aSc returns what someone typed, and one of the classes ends in a space.
        _, data = build("--school", "LõunaTERA", "--class", " Maarja ")
        self.assertEqual(data["initialClass"], "Maarja")

    def test_a_class_is_found_without_naming_its_school(self):
        _, data = build("--class", "Maarja")
        self.assertEqual(data["initialClass"], "Maarja")

    def test_asking_for_one_school_leaves_the_others_out(self):
        _, data = build("--only", "ProTERA")
        self.assertEqual([s["l"] for s in data["schools"]], ["ProTERA ja TERA gümnaasium"])


if __name__ == "__main__":
    unittest.main()
