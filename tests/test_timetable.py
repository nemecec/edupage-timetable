"""The generator's own reasoning, checked without a network.

Everything here is pure or reads the committed fixtures in tests/fixtures — the
same API responses the live site is built from, frozen. Nothing that needs the
school's server or a browser belongs in this file.
"""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
sys.path.insert(0, ROOT)

import tt


class DayShape(unittest.TestCase):
    """Grouping aSc's periods into the slots a day plan really has."""

    def shape(self, blocks, periods=8, always_paired=0):
        return [(s["period"], s["periods"]) for s in tt.day_slots(set(blocks), periods, always_paired)]

    def test_the_first_slots_stay_pairs_even_when_a_single_sits_in_them(self):
        # ProTERA teaches its first two slots as doubles. A single card there is
        # still the first lesson; calling it 45 minutes starts the rest early.
        self.assertEqual(self.shape([(1, 1), (3, 1), (5, 1)], always_paired=2)[:3],
                         [(1, 2), (3, 2), (5, 1)])

    def test_an_empty_early_slot_advances_the_clock_the_same_way(self):
        self.assertEqual(self.shape([(5, 1)], always_paired=2)[:3],
                         [(1, 2), (3, 2), (5, 1)])

    def test_a_longer_lesson_still_wins(self):
        self.assertEqual(self.shape([(1, 3)], periods=6, always_paired=2)[0], (1, 3))

    def test_a_slot_is_as_long_as_the_longest_lesson_starting_there(self):
        # One group takes a single where another takes a pair; the slot fits both.
        self.assertIn((5, 2), self.shape([(5, 2), (5, 1)], periods=6))

    def test_nothing_is_scheduled_past_the_last_lesson(self):
        self.assertEqual(self.shape([(1, 1)], periods=8)[-1][0], 1)


class BellClock(unittest.TestCase):
    """ProTERA's times are run off a clock rather than listed."""

    cfg = tt.BELLS["ProTERA"]

    def test_reproduces_the_published_day(self):
        slots, _ = tt.day_times(["P", "P", "P", "L", "L"], self.cfg)
        self.assertEqual([(s["start"], s["end"]) for s in slots],
                         [("9.00", "10.20"), ("10.30", "11.50"), ("12.50", "14.10"),
                          ("14.30", "15.15"), ("15.20", "16.05")])

    def test_the_named_breaks_land_where_the_plan_says(self):
        _, breaks = tt.day_times(["P", "P", "P", "L", "L"], self.cfg)
        self.assertEqual([(b["name"].split(",")[0], b["start"], b["end"]) for b in breaks],
                         [("Söömine", "11.50", "12.50"), ("Amps", "14.10", "14.30")])

    def test_a_shorter_third_lesson_moves_the_rest_of_the_day(self):
        # The Päevaplaan puts Amps at 13.35 when slot 3 is a single, not a pair.
        _, breaks = tt.day_times(["P", "P", "L", "L", "L"], self.cfg)
        self.assertEqual(breaks[1]["start"], "13.35")


class PublishedBlocks(unittest.TestCase):
    """LõunaTERA lists fixed blocks instead, one table per band of grades."""

    cfg = tt.BELLS["LõunaTERA"]

    def test_grades_one_to_three_on_a_monday(self):
        got = [(s["period"], s["periods"], s["start"], s["end"])
               for s in tt.band_slots(self.cfg, "Maarja", 0)]
        self.assertEqual(got[:3], [(1, 2, "9.00", "10.50"), (3, 1, "10.50", "11.10"),
                                   (4, 1, "11.10", "12.10")])

    def test_friday_has_its_own_shape(self):
        self.assertEqual(len(tt.band_slots(self.cfg, "Maarja", 4)), 4)

    def test_the_two_bands_differ(self):
        self.assertNotEqual(tt.band_slots(self.cfg, "Maarja", 0),
                            tt.band_slots(self.cfg, "Juta", 0))

    def test_a_class_name_with_stray_space_still_matches(self):
        # aSc hands back "Silva " — matching it literally lost that class its times.
        self.assertIsNotNone(tt.band_slots(self.cfg, "Silva ", 0))

    def test_a_class_in_no_band_gets_nothing(self):
        self.assertIsNone(tt.band_slots(self.cfg, "Nobody", 0))

    def test_a_school_without_bands_gets_nothing(self):
        self.assertIsNone(tt.band_slots(tt.BELLS["ProTERA"], "8", 0))


class MergingABlock(unittest.TestCase):
    """A published block holding two subjects in sequence is one box."""

    def entry(self, subject, period, duration=1, groups=()):
        return {"subject": subject, "startPeriod": period, "period": period, "day": 0,
                "duration": duration, "groups": list(groups), "part": 0, "slot": 1,
                "teachers": [], "teacherShorts": [], "rooms": []}

    def test_a_sequence_becomes_one_box_naming_both(self):
        got = tt.merge_blocks([self.entry("Häälestus", 1), self.entry("Üldõpetus", 2)])
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["names"], ["Häälestus", "Üldõpetus"])

    def test_the_longer_half_gives_the_box_its_colour(self):
        got = tt.merge_blocks([self.entry("Häälestus", 1),
                               self.entry("Üldõpetus", 2, duration=2)])
        self.assertEqual(got[0]["subject"], "Üldõpetus")

    def test_otherwise_the_later_half_does(self):
        # A warm-up runs first; the box should look like what it becomes.
        got = tt.merge_blocks([self.entry("Häälestus", 1), self.entry("muusika", 2)])
        self.assertEqual(got[0]["subject"], "muusika")

    def test_choices_running_side_by_side_stay_apart(self):
        got = tt.merge_blocks([self.entry("Kodundus", 4), self.entry("Käsitöö", 4),
                               self.entry("Puutöö", 4)])
        self.assertEqual(len(got), 3)

    def test_grouped_lessons_stay_apart(self):
        got = tt.merge_blocks([self.entry("Inglise keel", 1, groups=["I A"]),
                               self.entry("Vene keel", 2, groups=["Vk 1"])])
        self.assertEqual(len(got), 2)

    def test_two_cards_of_one_subject_become_one_box_named_once(self):
        # aSc sometimes records a block as a card per period. The school still
        # teaches one lesson there, and two half-width boxes is not that.
        got = tt.merge_blocks([self.entry("Matemaatika", 1), self.entry("Matemaatika", 2)])
        self.assertEqual(len(got), 1)
        self.assertIsNone(got[0]["names"], "one subject needs no list of names")
        self.assertEqual(got[0]["duration"], 2)

    def test_choices_that_each_span_the_block_stay_apart_but_do_not_double(self):
        # Hispaania keel or Prantsuse keel, each recorded once per period.
        got = tt.merge_blocks([self.entry("Hispaania keel", 1), self.entry("Hispaania keel", 2),
                               self.entry("Prantsuse keel", 1), self.entry("Prantsuse keel", 2)])
        self.assertEqual(sorted(e["subject"] for e in got),
                         ["Hispaania keel", "Prantsuse keel"])


class Colours(unittest.TestCase):
    """Every subject must be legible on its own colour, on paper."""

    subjects = ["Eesti keel", "Inglise keel", "Matemaatika", "Füüsika", "Keemia",
                "Bioloogia", "Ajalugu", "Geograafia", "Kunst", "Muusika",
                "Liikumisõpetus", "Informaatika", "Ajutreening", "Kirjandus"]

    def readable(self, pair):
        def luminance(hexcode):
            n = int(hexcode.lstrip("#"), 16)
            return tt._relative_luminance(n >> 16 & 255, n >> 8 & 255, n & 255)
        return tt._contrast(luminance(pair["bg"]), luminance(pair["fg"]))

    def test_every_subject_gets_one(self):
        self.assertEqual(sorted(tt.palette(self.subjects)), sorted(self.subjects))

    def test_text_meets_wcag_aa_on_every_one(self):
        for subject, pair in tt.palette(self.subjects).items():
            with self.subTest(subject=subject):
                self.assertGreaterEqual(self.readable(pair), tt.MIN_CONTRAST)

    def test_the_same_subjects_always_get_the_same_colours(self):
        self.assertEqual(tt.palette(self.subjects), tt.palette(self.subjects))

    def test_far_more_subjects_than_hues_still_all_resolve(self):
        got = tt.palette([f"Subject {i}" for i in range(200)])
        self.assertEqual(len(got), 200)
        for subject, pair in got.items():
            with self.subTest(subject=subject):
                self.assertGreaterEqual(self.readable(pair), tt.MIN_CONTRAST)


class ValidityLine(unittest.TestCase):
    """The line a school prints under its timetable, kept only if it says something."""

    def test_a_label_with_dates_is_kept(self):
        self.assertEqual(tt.worth_showing("Kehtivus: 24/08/2026-18/12/2026"),
                         "Kehtivus: 24/08/2026-18/12/2026")

    def test_a_label_with_nothing_after_it_is_dropped(self):
        for blank in ("Kehtivus: ", "Kehtivus:", "a: b: ", "", "   "):
            with self.subTest(line=blank):
                self.assertEqual(tt.worth_showing(blank), "")

    def test_text_with_no_label_at_all_is_kept(self):
        self.assertEqual(tt.worth_showing("Valid until 18.12.2026"), "Valid until 18.12.2026")


class Strings(unittest.TestCase):
    def test_both_languages_carry_the_same_keys(self):
        self.assertEqual(set(tt.STRINGS["en"]), set(tt.STRINGS["et"]),
                         "a key missing from one catalogue shows to the reader as its raw name")

    def test_substitutions_match_between_languages(self):
        for key, english in tt.STRINGS["en"].items():
            if not isinstance(english, str):
                continue
            with self.subTest(key=key):
                self.assertEqual({m for m in ("{0}", "{1}") if m in english},
                                 {m for m in ("{0}", "{1}") if m in tt.STRINGS["et"][key]})


class ColourSafety(unittest.TestCase):
    """A colour from the school's database ends up in a style attribute."""

    def test_only_something_that_looks_like_a_colour_is_kept(self):
        for good in ("#fff", "#FFFFFF", "#12345678"):
            self.assertTrue(tt.HEX_COLOUR.match(good), good)
        for bad in ('x"><img src=x onerror=alert(1)>', "red", "", "#12345", "url(x)"):
            self.assertFalse(tt.HEX_COLOUR.match(bad), bad)


if __name__ == "__main__":
    unittest.main()
