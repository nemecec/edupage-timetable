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

# Empty containers aSc carries alongside the real classes, standing in for a
# grade heading. Named rather than counted, so the invariants below cannot be
# talked out of examining a real class that happens to be small.
MARKER_CLASSES = {"1"}
sys.path.insert(0, ROOT)

import tt


def build(*args):
    """Run the generator against the fixtures and return the payload it embedded."""
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
    blob = re.search(r'<script id="data" type="application/json">(.*?)</script>', page, re.S)
    return page, json.loads(blob.group(1))


class WholePage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Without the fixtures the generator falls through to the live API, and
        # the suite would quietly pass while spending the school's rate limit.
        for name in ("tera-ttlist-2026.json", "tera-tt-68.json", "tera-tt-104.json",
                     "tera-tt-105.json", "tera-tt-103.json"):
            assert os.path.exists(os.path.join(FIXTURES, name)), f"missing fixture {name}"
        cls.page, cls.data = build()

    def test_it_builds_the_schools_the_fixtures_describe(self):
        self.assertEqual([s["l"] for s in self.data["schools"]],
                         ["ProTERA ja TERA gümnaasium", "SädeTERA", "LõunaTERA", "TäheTERA"])

    def test_the_right_schools_have_a_day_plan(self):
        """Two of the four publish times. If a bell config stopped matching, the
        invariants below would pass by examining nothing at all."""
        self.assertEqual({s["l"]: s["b"] for s in self.data["schools"]},
                         {"ProTERA ja TERA gümnaasium": True, "SädeTERA": False,
                          "LõunaTERA": True, "TäheTERA": False})

    def test_every_class_with_a_day_plan_gets_its_times(self):
        """The check that would have caught a class quietly losing them.

        A class in a school that publishes times, whose lessons are all untimed,
        draws nothing at all. That happened: aSc calls one class "Silva " and the
        band table said "Silva".
        """
        for school in self.data["schools"]:
            if not school["b"]:
                continue
            for klass in school["c"]:
                if klass["n"].strip() in MARKER_CLASSES:
                    continue
                timed = sum(1 for e in klass["e"] if e["a"] is not None)
                with self.subTest(school=school["l"], klass=klass["n"]):
                    self.assertEqual(timed, len(klass["e"]),
                                     "lessons without a time are never drawn")

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
        for marker in ("function parseEvents", "function renderTimeline", "qrcode"):
            self.assertIn(marker, self.page, "page.js or the QR library is not inlined")

    def test_every_element_the_page_reaches_for_exists(self):
        """A renamed id is a blank page that no syntax check would catch."""
        with open(os.path.join(ROOT, "page.js"), encoding="utf-8") as fh:
            wanted = set(re.findall(r'getElementById\("([^"]+)"\)', fh.read()))
        self.assertGreater(len(wanted), 20, "the scan found suspiciously few")
        for name in sorted(wanted):
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

    def test_every_subject_shown_has_a_colour_to_show_it_in(self):
        used = {e["s"] for s in self.data["schools"] for c in s["c"] for e in c["e"]}
        self.assertTrue(used <= set(self.data["palette"]),
                        "a subject with no palette entry falls back to grey")

    def test_nothing_in_the_payload_can_close_the_script_block(self):
        blob = re.search(r'<script id="data" type="application/json">(.*?)</script>',
                         self.page, re.S).group(1)
        self.assertNotIn("<", blob, "a '<' in school data could end the block early")

    def test_a_plain_build_carries_no_tracker_and_no_date(self):
        self.assertNotIn("goatcounter", self.page)
        self.assertEqual(self.data["built"], "")

    def test_the_same_input_gives_the_same_page(self):
        first, _ = build("--school", "ProTERA", "--class", "8")
        second, _ = build("--school", "ProTERA", "--class", "8")
        self.assertEqual(first, second)


class Counting(unittest.TestCase):
    def test_a_local_build_calls_nobody(self):
        page, _ = build()
        self.assertNotIn("goatcounter", page)

    def test_the_counter_is_never_told_the_child_s_name(self):
        # The page puts the name in the title, and the counter reports the
        # title. Pinning it is the only thing keeping the name off the wire.
        page, _ = build("--goatcounter", "little-tools-timetable")
        self.assertIn("gc.zgo.at/count.js", page)
        self.assertIn('window.goatcounter = {title: "timetable"', page)
        self.assertLess(page.index("window.goatcounter ="), page.index("gc.zgo.at"))


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


class Selection(unittest.TestCase):
    def test_it_opens_where_it_was_asked_to(self):
        # Not the first school in the list, or ignoring --school would pass.
        _, data = build("--school", "LõunaTERA", "--class", "Maarja")
        self.assertEqual((data["initialSchool"], data["initialClass"]), ("105", "Maarja"))

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
