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

    def test_a_slot_is_kept_when_the_lesson_starts_part_way_through_it(self):
        # A forced pair covers periods 3-4; a lesson at period 4 begins inside
        # it. Marking the slot free let the trailing trim delete it, and the
        # lesson then had no time at all and vanished from the timeline.
        self.assertEqual(self.shape([(1, 2), (4, 1)], always_paired=2),
                         [(1, 2), (3, 2)])
        self.assertEqual(self.shape([(2, 1)], always_paired=2), [(1, 2)])

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
        self.assertEqual([(b["name"], b["start"], b["end"]) for b in breaks],
                         [("Vaba aeg", "11.50", "12.50"), ("Amps", "14.10", "14.30")])

    def test_a_shorter_third_lesson_moves_the_rest_of_the_day(self):
        # The Päevaplaan puts Amps at 13.35 when slot 3 is a single, not a pair.
        _, breaks = tt.day_times(["P", "P", "L", "L", "L"], self.cfg)
        self.assertEqual(breaks[1]["start"], "13.35")


class PublishedBlocks(unittest.TestCase):
    """LõunaTERA lists fixed blocks instead, one table per band of grades."""

    cfg = tt.BELLS["LõunaTERA"]

    def test_grades_one_to_three_on_a_monday(self):
        """The settling-in half hour and the lesson after it are one block,
        because the timetable runs one lesson across both. Then porridge."""
        got = [(s["period"], s["periods"], s["start"], s["end"])
               for s in tt.band_slots(self.cfg, "Maarja", 0)]
        self.assertEqual(got[:3], [(1, 2, "9.00", "10.30"), (3, 1, "10.30", "10.50"),
                                   (4, 1, "10.50", "11.50")])

    def test_a_block_can_say_where_a_run_on_lesson_stops(self):
        """The fifth period of the older years has two shapes: on its own it
        runs to 14.00, and carrying the sixth with it, it finishes at 14.35 —
        which is 20 minutes before the sixth would have ended alone."""
        fifth = next(s for s in tt.band_slots(self.cfg, "Joanna", 0)
                     if s["period"] == 8)
        self.assertEqual((fifth["start"], fifth["end"]), ("13.15", "14.00"))
        self.assertEqual(fifth["runsOn"], "14.35")
        # Every other block says nothing, and stops where its last one does.
        others = [s for s in tt.band_slots(self.cfg, "Joanna", 0)
                  if s["period"] != 8]
        self.assertTrue(others)
        for slot in others:
            self.assertNotIn("runsOn", slot)

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

    def entry(self, subject, period, duration=1, groups=(), who="", room=""):
        # The same fields a real extracted entry has, including the school's own
        # abbreviation: a merged box carries one per member, and a stand-in that
        # left it out would not notice if that stopped working.
        return {"subject": subject, "subjectShort": subject[:3],
                "startPeriod": period, "period": period, "day": 0,
                "duration": duration, "groups": list(groups), "part": 0, "slot": 1,
                "teachers": [who] if who else [], "teacherShorts": [who[:2]] if who else [],
                "rooms": [room] if room else []}

    def test_a_merged_box_names_everyone_teaching_in_it(self):
        got = tt.merge_blocks([self.entry("Häälestus", 1, who="Tamm", room="A1"),
                               self.entry("Üldõpetus", 2, who="Kask", room="A2")])
        self.assertEqual(got[0]["teachers"], ["Tamm", "Kask"])
        self.assertEqual(got[0]["rooms"], ["A1", "A2"])

    def test_two_groups_of_one_subject_at_once_stay_two_boxes(self):
        # Two Kunst cards on the same period are parallel groups, not a
        # sequence. Folding them into one drew a double-width box over a
        # period nobody is teaching in.
        # Ungrouped, or the "anything with groups is left alone" guard above
        # would answer first and this branch would never be reached.
        got = tt.merge_blocks([self.entry("Kunst", 1), self.entry("Kunst", 1),
                               self.entry("Käsitöö", 2)])
        self.assertEqual(sorted((e["subject"], e["startPeriod"]) for e in got),
                         [("Kunst", 1), ("Kunst", 1), ("Käsitöö", 2)])

    def test_a_merged_box_keeps_every_member_s_abbreviation(self):
        # Without one per member the box reads "Häälestus + Üld" when short
        # names are on, and the member has no legend swatch to recolor.
        got = tt.merge_blocks([self.entry("Häälestus", 1), self.entry("Üldõpetus", 2)])
        self.assertEqual(got[0]["names"], ["Häälestus", "Üldõpetus"])
        self.assertEqual(got[0]["nameShorts"], ["Hää", "Üld"])

    def test_a_box_spans_its_parts_rather_than_summing_them(self):
        # Two cards overlapping on a period must not make a box longer than the
        # block, which would draw it running past the end of the day.
        got = tt.merge_blocks([self.entry("A", 1, duration=2), self.entry("B", 2)])
        self.assertEqual(len(got), 1)
        self.assertEqual((got[0]["startPeriod"], got[0]["duration"]), (1, 2))

    def test_a_sequence_becomes_one_box_naming_both(self):
        got = tt.merge_blocks([self.entry("Häälestus", 1), self.entry("Üldõpetus", 2)])
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["names"], ["Häälestus", "Üldõpetus"])

    def test_the_longer_half_gives_the_box_its_color(self):
        # Longer *and* earlier, so "the later one wins" cannot also satisfy it.
        got = tt.merge_blocks([self.entry("Üldõpetus", 1, duration=2),
                               self.entry("Häälestus", 3)])
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


class Colors(unittest.TestCase):
    """Every subject must be legible on its own color, on paper, and telling
    two subjects apart is the whole point of having a palette."""

    WCAG_AA = 4.5        # the standard's number, deliberately not the code's constant

    subjects = ["Eesti keel", "Inglise keel", "Matemaatika", "Füüsika", "Keemia",
                "Bioloogia", "Ajalugu", "Geograafia", "Kunst", "Muusika",
                "Liikumisõpetus", "Informaatika", "Ajutreening", "Kirjandus"]

    def readable(self, pair):
        """Contrast worked out here rather than imported, so that weakening the
        generator's own idea of contrast cannot make this pass."""
        def luminance(hexcode):
            n = int(hexcode.lstrip("#"), 16)
            channels = []
            for shift in (16, 8, 0):
                c = ((n >> shift) & 255) / 255.0
                channels.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
            r, g, b = channels
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        lo, hi = sorted((luminance(pair["bg"]), luminance(pair["fg"])))
        return (hi + 0.05) / (lo + 0.05)

    def test_every_subject_gets_one(self):
        self.assertEqual(sorted(tt.palette(self.subjects)), sorted(self.subjects))

    def test_text_meets_wcag_aa_on_every_one(self):
        for subject, pair in tt.palette(self.subjects).items():
            with self.subTest(subject=subject):
                self.assertGreaterEqual(self.readable(pair), self.WCAG_AA)

    def test_no_two_subjects_share_a_color(self):
        got = tt.palette(self.subjects)
        self.assertEqual(len({pair["bg"] for pair in got.values()}), len(self.subjects))

    def test_subjects_in_one_family_are_told_apart_and_not_merely_different(self):
        """Different is not the same as distinguishable.

        Four sciences all rendered as near-identical greens satisfy "no two are
        equal" perfectly, and are useless on paper — which is the whole reason
        the family members are spread across lightness steps.
        """
        sciences = ["Bioloogia", "Füüsika", "Geograafia", "Keemia"]
        got = tt.palette(sciences)
        rgb = [tuple(int(got[s]["bg"][i:i + 2], 16) for i in (1, 3, 5))
               for s in sciences]
        gaps = [sum(abs(a - b) for a, b in zip(x, y))
                for i, x in enumerate(rgb) for y in rgb[i + 1:]]
        self.assertGreater(min(gaps), 60,
                           "two subjects of one family are too close to tell apart")

    def test_a_family_is_spread_across_its_band_not_stacked_on_one_hue(self):
        # Lightness alone would separate them; the hue spread is what keeps a
        # crowded family from reading as one color in several strengths.
        sciences = ["Bioloogia", "Füüsika", "Geograafia", "Keemia"]
        hues = {tt._hue_of(tt.palette(sciences)[s]["bg"]) for s in sciences}
        self.assertGreater(max(hues) - min(hues), 6,
                           "the family sits on a single hue")

    def test_the_colors_do_not_depend_on_the_order_asked_in(self):
        self.assertEqual(tt.palette(self.subjects),
                         tt.palette(list(reversed(self.subjects))))

    def test_far_more_subjects_than_hues_still_all_resolve(self):
        got = tt.palette([f"Subject {i}" for i in range(200)])
        self.assertEqual(len(got), 200)
        self.assertGreater(len({pair["bg"] for pair in got.values()}), 150,
                           "a few collisions at this many subjects, not wholesale")
        for subject, pair in got.items():
            with self.subTest(subject=subject):
                self.assertGreaterEqual(self.readable(pair), self.WCAG_AA)


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


class ColorSafety(unittest.TestCase):
    """A color from the school's database ends up in a style attribute."""

    def test_only_something_that_looks_like_a_color_is_kept(self):
        for good in ("#fff", "#FFFFFF", "#12345678"):
            self.assertTrue(tt.HEX_COLOR.match(good), good)
        for bad in ('x"><img src=x onerror=alert(1)>', "red", "", "#12345", "url(x)"):
            self.assertFalse(tt.HEX_COLOR.match(bad), bad)


if __name__ == "__main__":
    unittest.main()
