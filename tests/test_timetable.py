"""The generator's own reasoning, checked without a network.

Everything here is pure or reads the committed fixtures in tests/fixtures — the
same API responses the live site is built from, frozen. Nothing that needs the
school's server or a browser belongs in this file.
"""

import datetime
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


class TheCanteenSitting(unittest.TestCase):
    """The hour of free time is the same hour for every ProTERA class, and the
    canteen does not hold them all at once. So each class is given a sitting
    inside it, and the hour becomes free time, the sitting, and free time."""

    cfg = tt.BELLS["ProTERA"]
    MON, FRI = 0, 4

    def breaks(self, class_name, day):
        _, plain = tt.day_times(["P", "P", "P", "L", "L"], self.cfg)
        got = tt.with_meals(plain, self.cfg, class_name, day)
        return [(b["name"], b["start"], b["end"]) for b in got]

    def test_the_hour_is_cut_around_the_sitting(self):
        # Twenty minutes of the hour is this class's turn. The rest is still
        # free time, so it is still drawn as free time.
        self.assertEqual(self.breaks("8", self.MON),
                         [("Vaba aeg", "11.50", "12.10"),
                          ("Söömine", "12.10", "12.30"),
                          ("Vaba aeg", "12.30", "12.50"),
                          ("Amps", "14.10", "14.30")])

    def test_a_sitting_at_the_edge_leaves_no_empty_band(self):
        # Wednesday eats first. A stretch of no minutes in front of it is not a
        # band, and drawing one would put a nought-minute box on the day.
        self.assertEqual(self.breaks("8", 2),
                         [("Söömine", "11.50", "12.10"),
                          ("Vaba aeg", "12.10", "12.50"),
                          ("Amps", "14.10", "14.30")])

    def test_two_sittings_in_one_hour_share_one_name(self):
        # Friday splits the class: whoever has Praktikum outside the schoolhouse
        # eats first, because they have the walk. Both sittings are the same
        # meal under the same name, so a reader who renames or recolors the row
        # does it once for the week.
        self.assertEqual(self.breaks("8", self.FRI),
                         [("Söömine", "11.50", "12.10"),
                          ("Söömine", "12.10", "12.50"),
                          ("Amps", "14.10", "14.30")])

    def test_each_friday_sitting_carries_a_group_and_a_note(self):
        """The group is what the reader's answer is matched against. The note is
        what the box adds to its name while both sittings are on the day, and a
        twenty-minute band has no second line to say it on."""
        _, plain = tt.day_times(["P", "P", "P", "L", "L"], self.cfg)
        got = tt.with_meals(plain, self.cfg, "8", self.FRI)
        self.assertEqual([(b.get("group", ""), b.get("note", "")) for b in got],
                         [("Väljaspool koolimaja", "praktikum väljas"),
                          ("Koolimajas", "praktikum koolis"),
                          ("", "")])
        # Every other day is the whole class's, so no group and nothing to say.
        monday = tt.with_meals(plain, self.cfg, "8", self.MON)
        self.assertEqual([(b.get("group", ""), b.get("note", "")) for b in monday],
                         [("", ""), ("", ""), ("", ""), ("", "")])

    def test_a_sitting_remembers_what_the_stretch_was_called(self):
        """Two sittings tile the whole hour on a Friday, so the one that is not
        the reader's leaves nothing behind. It has to fall back to something,
        and what these minutes are called on every other day is Vaba aeg — read
        off the band the sitting was cut out of rather than written down twice."""
        _, plain = tt.day_times(["P", "P", "P", "L", "L"], self.cfg)
        friday = tt.with_meals(plain, self.cfg, "8", self.FRI)
        self.assertEqual([b.get("wasNamed", "") for b in friday],
                         ["Vaba aeg", "Vaba aeg", ""])

    def test_the_question_is_asked_of_the_class_that_splits_and_no_other(self):
        """aSc holds a division only where the lessons differ, and this one
        changes no lesson at all — everybody has Praktikum at the same hour. So
        it is not in the timetable and cannot be, and the page asks it."""
        asked = tt.asked_divisions(self.cfg, "8")
        self.assertEqual([(d["label"], d["groups"]) for d in asked],
                         [("Praktikum",
                           ["Väljaspool koolimaja", "Koolimajas"])])
        # It carries no lessons on purpose: `visible` skips a division whose
        # groups no lesson names, so answering it hides nothing.
        self.assertEqual(asked[0]["lessons"], [])
        self.assertEqual(tt.asked_divisions(self.cfg, "7"), [])
        self.assertEqual(tt.asked_divisions(self.cfg, "9"), [])

    def test_a_class_the_school_has_not_told_us_about_keeps_the_plain_hour(self):
        self.assertEqual(self.breaks("7", self.MON),
                         [("Vaba aeg", "11.50", "12.50"),
                          ("Amps", "14.10", "14.30")])

    def test_a_sitting_outside_every_break_stops_the_build(self):
        """It means the day plan moved under the copied times. A meal drawn at
        the wrong hour is worse than a build that stops and says so."""
        cfg = dict(self.cfg, meals={"8": [{"day": "Mon", "at": "9:30",
                                           "until": "9:50"}]})
        _, plain = tt.day_times(["P", "P", "P", "L", "L"], cfg)
        with self.assertRaises(SystemExit) as caught:
            tt.with_meals(plain, cfg, "8", self.MON)
        self.assertIn("9:30", str(caught.exception))

class PublishedBlocks(unittest.TestCase):
    """LõunaTERA lists fixed blocks instead, one table per band of grades."""

    cfg = tt.BELLS["LõunaTERA"]

    def test_grades_one_to_three_on_a_monday(self):
        """The settling-in half hour and the lesson after it are one block,
        because the timetable runs one lesson across both. Then porridge."""
        got = [(s["period"], s["periods"], s["start"], s["end"])
               for s in tt.band_slots(self.cfg, "Maarja", 0, 1)]
        self.assertEqual(got[:3], [(1, 2, "9.00", "10.30"), (3, 1, "10.30", "10.50"),
                                   (4, 1, "10.50", "11.50")])

    def test_a_block_can_say_where_a_run_on_lesson_stops(self):
        """The fifth period of the older years has two shapes: on its own it
        runs to 14.00, and carrying the sixth with it, it finishes at 14.35 —
        which is 20 minutes before the sixth would have ended alone."""
        fifth = next(s for s in tt.band_slots(self.cfg, "Joanna", 0, 6)
                     if s["period"] == 8)
        self.assertEqual((fifth["start"], fifth["end"]), ("13.15", "14.00"))
        self.assertEqual(fifth["runsOn"], "14.35")
        # Every other block says nothing, and stops where its last one does.
        others = [s for s in tt.band_slots(self.cfg, "Joanna", 0, 6)
                  if s["period"] != 8]
        self.assertTrue(others)
        for slot in others:
            self.assertNotIn("runsOn", slot)

    def test_friday_has_its_own_shape(self):
        self.assertEqual(len(tt.band_slots(self.cfg, "Maarja", 4, 1)), 4)

    def test_the_two_bands_differ(self):
        self.assertNotEqual(tt.band_slots(self.cfg, "Maarja", 0, 1),
                            tt.band_slots(self.cfg, "Juta", 0, 5))

    def test_the_year_comes_from_the_order_of_the_school_s_own_list(self):
        """LõunaTERA names its classes after their teacher, so the name says
        nothing. It marks the years with rows of their own: a class called `3`,
        carrying no lessons, in front of the classes in the third year. Those
        rows are not classes and must not be offered as one."""
        names = ["1", "Maarja", "2", "Heliis", "Mari-Liis", "3", "Cathleen",
                 "Silva ", "4", "Elis", "Kateriine"]
        grades, markers = tt.class_grades(names, self.cfg)
        self.assertEqual(markers, {"1", "2", "3", "4"})
        self.assertEqual(grades, {"Maarja": 1, "Heliis": 2, "Mari-Liis": 2,
                                  "Cathleen": 3, "Silva ": 3,
                                  "Elis": 4, "Kateriine": 4})
        # The trailing space aSc hands back is carried through untouched, so
        # the class it belongs to still finds its year and its times.
        self.assertIsNotNone(tt.band_slots(self.cfg, "Silva ", 0, grades["Silva "]))

    def test_a_school_that_writes_the_year_in_the_name_needs_no_rows(self):
        """Everywhere else the number at the front of the name is the year, and
        a class called `7` is a class, not a marker."""
        grades, markers = tt.class_grades(["7", "8", "5.a", "6. S"], None)
        self.assertEqual(markers, set())
        self.assertEqual(grades, {"7": 7, "8": 8, "5.a": 5, "6. S": 6})

    def test_a_teacher_named_class_is_labelled_with_its_year(self):
        """The year the school states in its list order, said in the name a
        reader sees, because "Maarja" alone leaves them counting rows."""
        self.assertEqual(tt._year_first(1, "Maarja"), "1. Maarja")
        # The trailing space aSc hands back belongs to the name, not the label.
        self.assertEqual(tt._year_first(3, "Silva "), "3. Silva")

    def test_a_name_that_already_says_the_year_is_left_alone(self):
        """Most schools open the name with the year. "7. 7" says it twice."""
        for grade, name in [(7, "7"), (5, "5.a"), (6, "6. S"), (1, "1.i"),
                            (2, "2. klass")]:
            self.assertEqual(tt._year_first(grade, name), "")

    def test_a_class_in_no_year_is_left_alone(self):
        """The gymnasium classes are in no year the day plan knows."""
        self.assertEqual(tt._year_first(None, "G1B"), "")

    def test_a_class_in_no_year_gets_nothing(self):
        self.assertIsNone(tt.band_slots(self.cfg, "Nobody", 0, None))

    def test_a_school_without_bands_gets_nothing(self):
        self.assertIsNone(tt.band_slots(tt.BELLS["ProTERA"], "8", 0))


class SwappedGroups(unittest.TestCase):
    """TäheTERA 5.a takes Spanish in two groups that swap between two periods.

    aSc names one group per lesson, so it holds "HK" always at 12.10 and "HK1"
    always at 12.55. Neither is a group anybody is in.
    """

    def setUp(self):
        self.cfg = tt.BELLS["TäheTERA"]

    def test_the_group_at_the_earlier_hour_swaps_between_the_two_days(self):
        # Monday: HK is the earlier lesson, HK1 the later one.
        self.assertEqual(tt.regroup(self.cfg, "5.a", 0, ["HK"]), ["HK1"])
        self.assertEqual(tt.regroup(self.cfg, "5.a", 0, ["HK1"]), ["HK2"])
        # Thursday the same two lessons belong to the other groups.
        self.assertEqual(tt.regroup(self.cfg, "5.a", 3, ["HK"]), ["HK2"])
        self.assertEqual(tt.regroup(self.cfg, "5.a", 3, ["HK1"]), ["HK1"])

    def test_a_group_the_rule_does_not_name_is_left_alone(self):
        """French and German sit in the same division and do not swap."""
        for day in (0, 3):
            self.assertEqual(tt.regroup(self.cfg, "5.a", day, ["PK"]), ["PK"])
            self.assertEqual(tt.regroup(self.cfg, "5.a", day, ["SK"]), ["SK"])

    def test_a_day_with_no_rule_is_left_alone(self):
        """The split is Monday and Thursday. Nothing else is touched."""
        for day in (1, 2, 4):
            self.assertEqual(tt.regroup(self.cfg, "5.a", day, ["HK"]), ["HK"])

    def test_a_class_with_no_rule_is_left_alone(self):
        """5.l and 5.t sit in the same two lessons, and whether they swap the
        same way is not in the data and has not been stated."""
        self.assertEqual(tt.regroup(self.cfg, "5.l", 0, ["HK"]), ["HK"])
        self.assertEqual(tt.regroup(tt.BELLS["ProTERA"], "8", 0, ["HK"]), ["HK"])

    def test_the_picker_offers_both_groups_and_the_rest_untouched(self):
        """One aSc group becomes two, because the two days disagree about which
        group it is. A reader has to be able to pick either."""
        self.assertEqual(
            tt.regroup_all(self.cfg, "5.a", ["HK", "HK1", "PK", "SK"]),
            ["HK1", "HK2", "PK", "SK"])

    def test_a_class_with_no_rule_keeps_the_list_it_came_with(self):
        self.assertEqual(tt.regroup_all(self.cfg, "5.l", ["HK", "HK1"]),
                         ["HK", "HK1"])


class AGroupTheSchoolLeftUnnamed(unittest.TestCase):
    """A lesson marked "whole class" that in fact serves one group of it.

    One aSc lesson serves several classes and names a group per class. Where
    the school names a real group in one class and "whole class" in another,
    the second class draws that lesson beside every group it splits into, and
    no pick removes it. TäheTERA's fourth maths group is the live case.
    """

    def tables(self, others, mine, beside=(("Mat 1", "MargeL"),), day="10000",
               period="3", duration=1):
        """One class, one hour, one subject: the groups run side by side.

        `mine` is what the school wrote for this class — a group name, or None
        for "whole class". `others` is what the same lesson names elsewhere.
        """
        groups = [{"id": "g" + str(i), "name": name, "classid": "*me",
                   "divisionid": "*me:1", "entireclass": False}
                  for i, (name, _) in enumerate(beside)]
        groups.append({"id": "gall", "name": "Terve klass", "classid": "*me",
                       "divisionid": "*me:", "entireclass": True})
        groups += [{"id": "go" + str(i), "name": name, "classid": "*other",
                    "divisionid": "*other:1", "entireclass": False}
                   for i, name in enumerate(others)]
        if mine:
            groups.append({"id": "gmine", "name": mine, "classid": "*me",
                           "divisionid": "*me:1", "entireclass": False})
        lessons = [{"id": "L" + str(i), "subjectid": "-1", "classids": ["*me"],
                    "teacherids": [], "groupids": ["g" + str(i)],
                    "durationperiods": 1}
                   for i in range(len(beside))]
        lessons.append({"id": "Lx", "subjectid": "-1",
                        "classids": ["*me", "*other"], "teacherids": [],
                        "groupids": (["gmine"] if mine else ["gall"]) +
                                    ["go" + str(i) for i in range(len(others))],
                        "durationperiods": duration})
        cards = [{"lessonid": x["id"], "period": period, "days": day,
                  "classroomids": []} for x in lessons]
        return ({"cards": cards}, {"id": "*me", "name": "5.l"},
                {g["id"]: g for g in groups}, {x["id"]: x for x in lessons})

    def answer(self, *args, **kw):
        T, cls, groups, lessons = self.tables(*args, **kw)
        return tt.name_whole_class_groups(T, cls, groups, lessons)

    def test_it_takes_the_name_the_school_gave_it_in_another_class(self):
        self.assertEqual(self.answer(["Mat 4"], None), {"Lx": ("Mat 4", "*me:1")})

    def test_a_lesson_the_school_did_name_here_is_left_alone(self):
        self.assertEqual(self.answer(["Mat 4"], "Mat 2"), {})

    def test_a_whole_class_lesson_at_an_hour_with_no_groups_is_left_alone(self):
        """Every class has real whole-class lessons. This must not touch them:
        TäheTERA's fourth years take one maths lesson a week all together."""
        T, cls, groups, lessons = self.tables(["Mat 4"], None)
        T["cards"] = [c for c in T["cards"] if c["lessonid"] == "Lx"]
        self.assertEqual(tt.name_whole_class_groups(T, cls, groups, lessons), {})

    def test_nothing_is_invented_where_no_other_class_names_it(self):
        """A guess would be a group nobody is in, offered in the picker."""
        self.assertEqual(self.answer([], None), {})

    def test_two_names_elsewhere_say_nothing_about_which_one_this_is(self):
        self.assertEqual(self.answer(["Mat 4", "Mat 5"], None), {})

    def test_an_unplaced_card_is_not_an_hour(self):
        """aSc keeps cards with no day in the same table as the placed ones."""
        self.assertEqual(self.answer(["Mat 4"], None, day="00000"), {})

    def test_a_pair_is_beside_the_groups_on_both_its_periods(self):
        """A double period overlaps the singles it runs against on the second
        period as much as the first, and the first is enough to find it."""
        self.assertEqual(self.answer(["Mat 4"], None, duration=2),
                         {"Lx": ("Mat 4", "*me:1")})


class TwoQuestionsInOnePicker(unittest.TestCase):
    """A division whose subjects are chosen independently is offered per subject.

    ProTERA's ninth years take Estonian and English in six sets. aSc holds one
    division, so a reader who is Estonian II and English I has no code to pick.
    """

    def setUp(self):
        self.cfg = {"perSubject": [{"classes": ["9"],
                                    "subjects": ["Eesti keel", "Inglise keel"]}]}

    def entries(self, pairs):
        """One entry per (group, subject), which is all the split reads."""
        return [{"groups": [group], "subject": subject, "part": 0}
                for group, subject in pairs]

    def division(self, groups, subjects):
        return {"id": "*6:3", "groups": list(groups), "subjects": list(subjects),
                "label": " / ".join(subjects), "lessons": 1}

    def test_the_division_becomes_one_picker_per_subject(self):
        div = self.division(["I A", "I B"], ["Eesti keel", "Inglise keel"])
        entries = self.entries([("I A", "Eesti keel"), ("I B", "Eesti keel"),
                                ("I A", "Inglise keel"), ("I B", "Inglise keel")])
        got = tt.split_by_subject(self.cfg, "9", [div], entries)
        self.assertEqual([d["label"] for d in got], ["Eesti keel", "Inglise keel"])
        self.assertEqual([d["groups"] for d in got],
                         [["I A", "I B"], ["I A", "I B"]])
        self.assertEqual([d["only"] for d in got], ["Eesti keel", "Inglise keel"])

    def test_each_half_is_filed_under_a_key_naming_its_subject(self):
        """Both halves offer the same groups, so a key each, or the two share
        one answer.

        Both halves and not only the second. A pick saved before the split
        answered one of the two subjects and nothing records which, so a first
        half left under the plain key takes that answer whatever it meant. A
        reader who had picked their English set would be shown that set's
        Estonian lessons, and told nothing.
        """
        div = self.division(["I A", "I B"], ["Eesti keel", "Inglise keel"])
        entries = self.entries([("I A", "Eesti keel"), ("I B", "Eesti keel"),
                                ("I A", "Inglise keel"), ("I B", "Inglise keel")])
        got = tt.split_by_subject(self.cfg, "9", [div], entries)
        self.assertEqual([d["key"] for d in got],
                         ["Eesti keel: I A/I B", "Inglise keel: I A/I B"])
        # And neither is the group list, which is what the page falls back to
        # and therefore what a pick made before the split is filed under.
        self.assertNotIn("I A/I B", [d["key"] for d in got])

    def test_a_subject_the_rule_does_not_name_stays_where_it_is(self):
        """The rule names two subjects. A third in the same division is not
        pulled out, and a division holding none of them is untouched."""
        div = self.division(["9.1", "9.2"], ["Füüsika", "Keemia"])
        entries = self.entries([("9.1", "Füüsika"), ("9.2", "Keemia")])
        self.assertEqual(tt.split_by_subject(self.cfg, "9", [div], entries), [div])

    def test_a_division_carrying_one_of_them_is_left_whole(self):
        """The seventh and eighth years keep English on its own. There is one
        question there, and splitting it would ask it twice."""
        div = self.division(["I A", "I B"], ["Inglise keel"])
        entries = self.entries([("I A", "Inglise keel"), ("I B", "Inglise keel")])
        self.assertEqual(tt.split_by_subject(self.cfg, "9", [div], entries), [div])

    def test_a_class_the_rule_does_not_name_is_left_alone(self):
        div = self.division(["I A", "I B"], ["Eesti keel", "Inglise keel"])
        entries = self.entries([("I A", "Eesti keel"), ("I A", "Inglise keel")])
        self.assertEqual(tt.split_by_subject(self.cfg, "8", [div], entries), [div])
        self.assertEqual(tt.split_by_subject(None, "9", [div], entries), [div])

    def test_a_half_offers_only_the_groups_that_take_its_subject(self):
        """Nothing says both subjects reach every group. One that takes only
        the first must not be offered as an answer to the second."""
        div = self.division(["I A", "I B"], ["Eesti keel", "Inglise keel"])
        entries = self.entries([("I A", "Eesti keel"), ("I B", "Eesti keel"),
                                ("I A", "Inglise keel")])
        got = tt.split_by_subject(self.cfg, "9", [div], entries)
        self.assertEqual([d["groups"] for d in got], [["I A", "I B"], ["I A"]])


class TheTermTheExportCovers(unittest.TestCase):
    """Dates for the calendar file. Nothing else on the page needs any."""

    def test_it_takes_out_the_school_days_and_leaves_the_rest(self):
        got = tt.term_days({"start": "2026-08-24", "end": "2026-12-18",
                            "off": [("2026-10-26", "2026-11-01", "Sügis")]})
        self.assertEqual(got[:2], ("2026-08-24", "2026-12-18"))
        # Monday to Friday of that week. The weekend was never a school day and
        # taking it out would say a lesson was cancelled that never ran.
        self.assertEqual(got[2], ["2026-10-26", "2026-10-27", "2026-10-28",
                                  "2026-10-29", "2026-10-30"])
        # And the same days named, for the panel to say. The stretch stops on
        # the Friday: what a reader wants is which school days go, not which
        # calendar days the holiday covers.
        self.assertEqual(got[3], [("Sügis", "2026-10-26", "2026-10-30")])

    def test_a_stretch_that_costs_no_school_day_is_not_named(self):
        """A holiday on a Saturday changes nothing about the week, and naming
        it would have the panel list days the reader never had lessons on."""
        got = tt.term_days({"start": "2026-08-24", "end": "2026-12-18",
                            "off": [("2026-11-07", "2026-11-08", "Laupäev")]})
        self.assertEqual((got[2], got[3]), ([], []))

    def test_the_named_stretches_and_the_dates_say_the_same_thing(self):
        """Two ways of writing one fact: the export reads the dates and the
        panel reads the names. Nothing reads both, so this holds them level."""
        for label in ("TäheTERA", "ProTERA", "SädeTERA", "LõunaTERA"):
            _, _, dates, named = tt.term_days(tt.year_for_school(label, ""))
            covered = set()
            for _, first, last in named:
                day = datetime.date.fromisoformat(first)
                stop = datetime.date.fromisoformat(last)
                while day <= stop:
                    if day.weekday() < 5:
                        covered.add(day.isoformat())
                    day += datetime.timedelta(days=1)
            self.assertEqual(covered, set(dates), label)

    def test_a_day_off_outside_the_window_costs_nothing(self):
        """The winter break opens after this timetable stops, and the August
        holiday falls before it starts. Both are in the config so the next
        timetable needs only its own two dates."""
        got = tt.term_days({"start": "2026-08-24", "end": "2026-12-18",
                            "off": [("2026-12-21", "2027-01-04", "Jõulu"),
                                    ("2026-08-20", "2026-08-20", "Taas")]})
        self.assertEqual(got[2], [])

    def test_no_dates_means_no_export(self):
        for year in ({}, None, {"start": "2026-08-24"}, {"end": "2026-12-18"}):
            self.assertIsNone(tt.term_days(year), year)
        # And a window that runs backwards is not a window.
        self.assertIsNone(tt.term_days({"start": "2026-12-18",
                                        "end": "2026-08-24", "off": []}))

    def test_each_school_opens_its_week_on_its_own_day(self):
        """The year starts for everyone on 24.08, but the timetable does not:
        the first days are spent with the class. TäheTERA joins the plan on the
        27th and ProTERA on the 26th, and a school that has said nothing keeps
        the year's first day."""
        self.assertEqual(tt.year_for_school("TäheTERA", "")["start"], "2026-08-27")
        self.assertEqual(tt.year_for_school("ProTERA ja TERA gümnaasium", "")["start"],
                         "2026-08-26")
        self.assertEqual(tt.year_for_school("SädeTERA", "")["start"],
                         tt.SCHOOL_YEAR["start"])

    def test_a_schools_own_days_off_are_added_to_the_shared_ones(self):
        """Not instead of them: TäheTERA's self-study day is one more day
        without lessons, and it still keeps every break the school publishes."""
        _, _, off, _ = tt.term_days(tt.year_for_school("TäheTERA", ""))
        self.assertIn("2026-09-21", off, "the iseõppepäev")
        self.assertIn("2026-10-26", off, "and the autumn break with it")
        _, _, protera, _ = tt.term_days(tt.year_for_school("ProTERA", ""))
        self.assertIn("2026-08-31", protera, "the TERA20 aktus")
        self.assertNotIn("2026-09-21", protera, "which is TäheTERA's day, not this one")


class OneTimetableTwoSchools(unittest.TestCase):
    """ProTERA and the gümnaasium share a file and nothing else."""

    def payload(self, classes, label="ProTERA ja TERA gümnaasium"):
        return [{"n": "68", "l": label, "t": label + " 2026/2027",
                 "c": [{"n": name} for name in classes]}]

    def test_a_prefix_takes_its_classes_and_the_rest_stay_behind(self):
        got = tt.split_schools(self.payload(["7", "8", "G1B", "G2A"]))
        self.assertEqual([(x["n"], x["l"], [c["n"] for c in x["c"]]) for x in got],
                         [("68", "ProTERA", ["7", "8"]),
                          ("68G", "TERA gümnaasium", ["G1B", "G2A"])])

    def test_both_halves_remember_the_timetable_they_came_from(self):
        """Which is what a reader's settings are filed under, so splitting a
        school renames nothing they have saved."""
        got = tt.split_schools(self.payload(["7", "G1B"]))
        self.assertEqual([x["tt"] for x in got], ["68", "68"])
        # And the first half keeps the number itself, so an old link still
        # names something.
        self.assertEqual(got[0]["n"], "68")

    def test_a_school_with_no_rule_comes_through_whole(self):
        one = self.payload(["1.i", "5.a"], label="TäheTERA")
        got = tt.split_schools(one)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["l"], "TäheTERA")
        self.assertEqual(got[0]["tt"], "68", "the timetable is named either way")

    def test_a_half_with_no_classes_is_not_offered(self):
        """A timetable holding no gümnaasium class is one school, not one and
        an empty one."""
        got = tt.split_schools(self.payload(["7", "8", "9"]))
        self.assertEqual([x["l"] for x in got], ["ProTERA"])

    def test_the_halves_keep_their_own_dates(self):
        """The old title names both, so matching on it would give the
        gümnaasium ProTERA's term. Only the name each half chose has a say."""
        got = tt.split_schools(self.payload(["7", "G1B"]))
        protera, gumn = got
        self.assertEqual(protera["cal"]["a"], "2026-08-26")
        self.assertIn("2026-08-31", protera["cal"]["x"], "the TERA20 aktus")
        self.assertEqual(gumn["cal"]["a"], tt.SCHOOL_YEAR["start"])
        self.assertNotIn("2026-08-31", gumn["cal"]["x"])


class AnHourThatReplacesLessons(unittest.TestCase):
    """A concert is not a day off. It takes the lessons it sits on and no more."""

    def test_the_hour_is_read_in_minutes(self):
        got = tt.term_events({"instead": [
            {"date": "2026-12-16", "start": "9:15", "end": "10:15", "name": "Kontsert"}]})
        self.assertEqual(got, [{"date": "2026-12-16", "from": 555, "to": 615,
                                "name": "Kontsert"}])

    def test_a_school_with_no_such_hour_has_none(self):
        self.assertEqual(tt.term_events({}), [])
        self.assertEqual(tt.term_events(None), [])

    def test_tahetera_keeps_its_christmas_concert_and_nobody_else_does(self):
        self.assertEqual([e["date"] for e in
                          tt.term_events(tt.year_for_school("TäheTERA", ""))],
                         ["2026-12-16"])
        self.assertEqual(tt.term_events(tt.year_for_school("ProTERA", "")), [])


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
