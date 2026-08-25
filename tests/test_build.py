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
        self.assertEqual(sum(len(s["c"]) for s in self.data["schools"]), 41)
        self.assertEqual((len(rows), len(boxes)), (1935, 1589))
        # 70 subject names, plus the two named breaks. A break is drawn and
        # recolored like a lesson, so it needs a color of its own.
        self.assertEqual(len(self.data["palette"]), 72)
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

    def test_a_break_is_quiet_and_a_subject_is_not(self):
        """A break runs the full width of the day. Through the subject palette
        it came out a muddy beige and won every glance, which is backwards for
        a gap."""
        breaks = {b["n"] for s in self.data["schools"] for c in s["c"]
                  for day in c["h"].values() for b in day["b"] if b["n"]}
        self.assertEqual(breaks, {"Vaba aeg", "Amps"})
        for name in breaks:
            with self.subTest(name=name):
                self.assertEqual(self.data["palette"][name],
                                 {"bg": tt.BREAK_BG, "fg": tt.BREAK_FG})
        # A subject still gets a colour of its own from its family.
        self.assertNotEqual(self.data["palette"]["Ajalugu"]["bg"], tt.BREAK_BG)

    def test_a_lesson_running_past_one_published_block_ends_where_it_ends(self):
        # LõunaTERA publishes blocks rather than lesson lengths. A lesson
        # covering two of them used to stop at the end of the first.
        school = next(s for s in self.data["schools"] if s["n"] == "105")
        klass = next(c for c in school["c"] if c["n"].strip() == "Elis")
        box = next(e for e in klass["e"]
                   if e["d"] == 3 and e["s"] == "Kodundus" and not e["c"])
        self.assertEqual((box["w"], box["a"], box["z"]), ("13.25–15.00", 805, 900))

    def test_a_merged_box_carries_the_subjects_it_merged(self):
        merged = [e for s in self.data["schools"] for c in s["c"]
                  for e in c["e"] if e["S"]]
        self.assertEqual(len(merged), 28)
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
        """Three of the four are timed: two from a hand-written day plan, and
        SädeTERA from the period times it keeps in EduPage. TäheTERA has none
        anywhere and gets the grid. If a bell config stopped matching, the
        invariants below would pass by examining nothing at all."""
        self.assertEqual({s["l"]: s["b"] for s in self.data["schools"]},
                         {"ProTERA ja TERA gümnaasium": True, "SädeTERA": True,
                          "LõunaTERA": True, "TäheTERA": False})

    def test_a_school_that_keeps_its_own_period_times_uses_them(self):
        # SädeTERA writes no day plan here, but its periods carry real clock
        # times; discarding them cost that school its timeline.
        school = next(s for s in self.data["schools"] if s["l"] == "SädeTERA")
        boxes = [e for c in school["c"] for e in c["e"] if not e["c"]]
        self.assertTrue(boxes)
        self.assertTrue(all(e["a"] is not None and e["z"] > e["a"] for e in boxes))
        first = min(boxes, key=lambda e: e["a"])
        self.assertEqual((first["a"], first["w"]), (480, "08:00–08:45"))

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
        wanted = set(re.findall(r'data-i18n(?:-ph)?="([^"]+)"', source))
        self.assertGreater(len(wanted), 20, "the scan found suspiciously few")
        _, data = build()
        for lang in ("en", "et"):
            have = set(data["strings"][lang])
            for key in sorted(wanted - have):
                with self.subTest(lang=lang, key=key):
                    self.fail("no %s string for %s" % (lang, key))

    def test_the_deploy_readme_counts_the_resources_correctly(self):
        counts = {n: len(self.resources(n))
                  for n in ("site.yaml", "dns.yaml", "cert.yaml")}
        self.assertEqual(counts, {"site.yaml": 16, "dns.yaml": 2, "cert.yaml": 1})
        with open(os.path.join(ROOT, "deploy", "README.md"), encoding="utf-8") as fh:
            readme = fh.read()
        # The words, not their capitalisation: the sentence around them is
        # free to be reworded.
        self.assertIn("nineteen resources", readme.lower())
        self.assertIn("sixteen in `site.yaml`", readme)

    def test_the_size_the_readmes_quote_is_the_size_it_is(self):
        import gzip
        page, _ = build()
        raw, wire = len(page.encode("utf-8")), len(gzip.compress(page.encode("utf-8"), 9))
        # Within a tolerance, since the school's own data moves it about.
        self.assertLess(abs(raw / 1024 - 600), 60, "%.0f KB raw" % (raw / 1024))
        self.assertLess(abs(wire / 1024 - 75), 12, "%.0f KB over the wire" % (wire / 1024))
        for name in ("README.md", os.path.join("deploy", "README.md")):
            with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
                self.assertIn("75 KB", fh.read(), name)

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
