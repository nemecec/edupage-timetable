#!/usr/bin/env python3
"""Extract EduPage/aSc timetables and render a personalised, filterable view.

The public timetable page renders its grid client-side into an SVG, but the
data behind it comes from a plain JSON endpoint that an anonymous session may
read. This script talks to that endpoint directly, so no browser is involved
and repeated runs on unchanged data produce byte-identical output.

    python3 tt.py --list
    python3 tt.py -o schedule.html
    python3 tt.py --school ProTERA --class 8 -o schedule.html

Every visible timetable and every class is embedded in the generated page, so
the reader picks their school and class there; --school/--class only choose
what is selected on first open.

Standard library only.
"""

import argparse
import colorsys
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")


# The school's server stalls now and then — a connection that opens and then
# never answers, most reliably when it has just been asked for everything
# several times over. A nightly job should ride that out rather than skip a day,
# so every fetch gets a few attempts with a widening gap between them.

ATTEMPTS = 4
BACKOFF = (5, 20, 60)      # seconds; a nightly job can afford to wait one out


def _transient(exc):
    """Whether trying again could plausibly help."""
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code == 429 or exc.code >= 500
    return True          # timeout, reset, refused, no route: all worth a retry


def open_url(req, timeout):
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except (urllib.error.URLError, OSError) as exc:
            if attempt == ATTEMPTS or not _transient(exc):
                raise
            pause = BACKOFF[min(attempt, len(BACKOFF)) - 1]
            print(f"{exc}; retrying in {pause}s ({attempt}/{ATTEMPTS - 1})",
                  file=sys.stderr)
            time.sleep(pause)


# --------------------------------------------------------------------------
# Interface strings
# --------------------------------------------------------------------------
#
# Only the interface is translated. Everything coming from the timetable —
# subject names, group codes, room numbers, the school's own break names — stays
# in the language the school entered it in. `{0}` marks a substitution.

STRINGS = {
    "en": {
        "lang": "Language",
        "school": "School", "class": "Class", "classN": "class {0}",
        "display": "Display options",
        "advanced": "Advanced",
        "showHeading": "For each lesson, show:",
        "showTeacher": "Teacher",
        "showRoom": "Room",
        "showGroup": "Study group",
        "showSubject": "Subject",
        "nameFull": "full name",
        "nameShort": "abbreviated",
        "subjectFull": "full name",
        "subjectShort": "short name",
        "coloursHeading": "Lesson colours:",
        "schoolColours": "Colours from the timetable",
        "customColours": "Colours of my own",
        "appName": "School timetable",
        "filter": "Filter",
        "groupsHeading": "Show only these study groups:",
        "titleHeading": "Title:",
        "titleWho": "Student name",
        "titleSchool": "School name",
        "titleClass": "Class name",
        "print": "Print…",
        "backup": "Settings as JSON",
        "reset": "Reset groups & colours",
        "share": "Share",
        "shared": "Link copied",
        "shareHint": ("Everything you have chosen is in the address bar, so a "
                      "bookmark or a shared link carries it along."),
        "qrHint": "Edit it here",
        "colourHint": ("Click a swatch to change one, or click any lesson in the "
                       "timetable itself."),
        "groups": "Groups",
        "noGroups": "This class is not split into groups.",
        "all": "— all —",
        "time": "Time",
        "nothing": "Nothing to show.",
        "paired": "paired (2 periods)",
        "single": "single",
        "noExactTime": "exact time not in the day plan",
        "noTimeShort": "time not in day plan",
        "lessonsShown": "{0} of {1} lessons shown",
        "slotsShown": "{0} of {1} lesson slots shown",
        "noFilter": "(no group filter active)",
        "noBells": "no bell schedule for this school, times unknown",
        "lessonCount": "{0} lessons",
        "mineCount": "{0} of my own",
        "mineCol": "My own",
        "events.summary": "My own events",
        "events.label": "One per line:",
        "events.example": "Mon 17:15-18:15 orange Dance training",
        "events.placeholder": ("Mon 17:15-18:15 orange Dance training\n"
                               "Wed 15:25-17:15 #c0392b Piano lesson\n"
                               "Fri 12:10-12:50 #333333/#dddddd Lunch sitting"),
        "events.syntax": ("expected  <day> <hh:mm>-<hh:mm> "
                          "<background> or <text>/<background> <label>"),
        "events.badDay": "unknown weekday {0}",
        "events.badRange": "times run 00:00-23:59",
        "events.backwards": "end time must be after the start",
        "events.badColour": "{0} is not a colour",
        "events.line": "line {0}: {1}",
        "settings.label": ("Settings as JSON — copy this to keep a backup, "
                           "or paste a saved one and apply it"),
        "settings.copy": "Copy to clipboard",
        "settings.apply": "Apply pasted settings",
        "settings.copied": "Copied to clipboard.",
        "settings.selected": "Selected — press Cmd/Ctrl+C.",
        "settings.badJson": "That is not valid JSON: {0}",
        "settings.notObject": "Expected a JSON object of settings.",
        "settings.applied": "Applied.",
        "footer.disclaimer": ("Unofficial. Built from the school's public timetable "
                              "data; not published or maintained by the school."),
        "footer.source": "Source: {0}",
        "sourceLink": "source",
        "footer.built": "data fetched {0}",
        "footer.counts": ("Visits are counted with GoatCounter: no cookies, "
                          "nothing personal, nothing shared."),
        "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                 "Saturday", "Sunday"],
    },
    "et": {
        "lang": "Keel",
        "school": "Kool", "class": "Klass", "classN": "{0}. klass",
        "display": "Kuvamise seaded",
        "advanced": "Täpsemad seaded",
        "showHeading": "Iga tunni juures näita:",
        "showTeacher": "Õpetaja",
        "showRoom": "Ruum",
        "showGroup": "Õpperühm",
        "showSubject": "Aine",
        "nameFull": "täisnimi",
        "nameShort": "lühend",
        "subjectFull": "täisnimi",
        "subjectShort": "lühinimi",
        "coloursHeading": "Tundide värvid:",
        "schoolColours": "Tunniplaani värvid",
        "customColours": "Minu omad värvid",
        "appName": "Kooli tunniplaan",
        "filter": "Filter",
        "groupsHeading": "Näita ainult neid õpperühmi:",
        "titleHeading": "Pealkiri:",
        "titleWho": "Õpilase nimi",
        "titleSchool": "Kooli nimi",
        "titleClass": "Klassi nimi",
        "print": "Prindi…",
        "backup": "Seaded JSON-ina",
        "reset": "Lähtesta rühmad ja värvid",
        "share": "Jaga",
        "shared": "Link kopeeritud",
        "shareHint": ("Kõik valikud on aadressiribal, nii et järjehoidja või "
                      "jagatud link kannab need kaasa."),
        "qrHint": "Muuda siin",
        "colourHint": ("Klõpsa värvikastil või tunniplaanis tunnil, et värvi "
                       "muuta."),
        "groups": "Rühmad",
        "noGroups": "See klass ei ole rühmadeks jaotatud.",
        "all": "— kõik —",
        "time": "Aeg",
        "nothing": "Pole midagi näidata.",
        "paired": "paaristund (2 tundi)",
        "single": "üksiktund",
        "noExactTime": "täpset aega päevaplaanis pole",
        "noTimeShort": "aeg puudub päevaplaanis",
        "lessonsShown": "näidatud {0} tundi {1}-st",
        "slotsShown": "näidatud {0} tunnipesa {1}-st",
        "noFilter": "(rühmafilter puudub)",
        "noBells": "sellel koolil pole päevaplaani, ajad teadmata",
        "lessonCount": "{0} tundi",
        "mineCount": "{0} minu oma",
        "mineCol": "Minu oma",
        "events.summary": "Minu enda sündmused",
        "events.label": "Üks real:",
        "events.example": "E 17:15-18:15 orange Tantsutrenn",
        "events.placeholder": ("E 17:15-18:15 orange Tantsutrenn\n"
                               "K 15:25-17:15 #c0392b Klaveritund\n"
                               "R 12:10-12:50 #333333/#dddddd Söömine"),
        "events.syntax": ("ootasin kujul  <päev> <hh:mm>-<hh:mm> "
                          "<taust> või <tekst>/<taust> <nimetus>"),
        "events.badDay": "tundmatu nädalapäev {0}",
        "events.badRange": "kellaajad on vahemikus 00:00-23:59",
        "events.backwards": "lõpuaeg peab olema pärast algusaega",
        "events.badColour": "{0} ei ole värv",
        "events.line": "rida {0}: {1}",
        "settings.label": ("Seaded JSON-ina — kopeeri varukoopiaks "
                           "või kleebi salvestatud seaded ja rakenda"),
        "settings.copy": "Kopeeri lõikelauale",
        "settings.apply": "Rakenda kleebitud seaded",
        "settings.copied": "Kopeeritud lõikelauale.",
        "settings.selected": "Valitud — vajuta Cmd/Ctrl+C.",
        "settings.badJson": "See ei ole korrektne JSON: {0}",
        "settings.notObject": "Ootasin JSON-objekti seadetega.",
        "settings.applied": "Rakendatud.",
        "footer.disclaimer": ("Mitteametlik. Koostatud kooli avalikest tunniplaani "
                              "andmetest; kool seda lehte ei avalda ega halda."),
        "footer.source": "Allikas: {0}",
        "sourceLink": "allikas",
        "footer.built": "andmed laaditud {0}",
        "footer.counts": ("Külastusi loeb GoatCounter: küpsiseid ei kasutata, "
                          "isikuandmeid ei koguta ega jagata."),
        "days": ["Esmaspäev", "Teisipäev", "Kolmapäev", "Neljapäev", "Reede",
                 "Laupäev", "Pühapäev"],
    },
}

LANGUAGES = [("en", "English"), ("et", "Eesti")]


# --------------------------------------------------------------------------
# Bell schedules
# --------------------------------------------------------------------------
#
# EduPage carries no times for these timetables (every period is 00:00 and the
# bells table is empty), so the day plan has to be described here.
#
# A day is a sequence of lesson slots. A slot holds either a paired lesson
# ("P", two aSc periods) or a single one ("L", one period), and which it is
# varies day by day — that is what makes the times branch. Rather than list
# every branch, run the clock: each slot starts when the previous one plus its
# gap has finished, so all combinations fall out of `single`/`paired` lengths
# and the gaps between slots.
#
# For ProTERA this reproduces the school's printed Päevaplaan exactly, every
# published combination included.
#
# To add a school: key by any substring of its timetable title.

BELLS = {
    "ProTERA": {
        "name": "Päevaplaan",
        "start": "9:00",
        "single": 45,           # minutes for a one-period lesson  ("L")
        "paired": 80,           # minutes for a two-period lesson  ("P")
        "alwaysPaired": 2,      # the first N slots are always a pair
        # Gap in minutes after slot N. Named gaps are drawn in the grid.
        "gaps": [
            {"after": 1, "minutes": 10},
            {"after": 2, "minutes": 60, "name": "Söömine, tiimitund, vaba aeg"},
            {"after": 3, "minutes": 20, "name": "Amps"},
        ],
        "defaultGap": 5,
    },
    # LõunaTERA does not work the way ProTERA does. Its day plan is published as
    # fixed blocks rather than lesson lengths, the two grade bands run different
    # days, and the breaks — Puder, Lõuna/Õue, Hea aeg — are lessons in the
    # timetable rather than gaps between them. So there is no clock to run: each
    # block says which aSc periods it holds and when it is.
    #
    #   (first period, how many periods, start, end)
    #
    # A block holding two periods is one box. Sometimes that is a genuine pair —
    # the same lesson twice over — and sometimes two different subjects taught
    # back to back, which the school writes as one block and this follows.
    # Source: tartuerakool.ee/lounatera/koolielu/
    "LõunaTERA": {
        "name": "Päevakava",
        "bands": [
            {
                "classes": ["Maarja", "Heliis", "Mari-Liis", "Cathleen", "Silva"],
                "days": {
                    (0, 1, 2, 3): [(1, 2, "9:00", "10:50"), (3, 1, "10:50", "11:10"),
                                   (4, 1, "11:10", "12:10"), (5, 1, "12:20", "13:20"),
                                   (6, 1, "13:20", "13:50"), (7, 1, "13:50", "14:50"),
                                   (8, 1, "15:00", "16:00")],
                    (4,): [(1, 1, "9:00", "10:00"), (2, 1, "10:00", "11:00"),
                           (3, 1, "11:00", "12:00"), (4, 1, "12:00", "13:00")],
                },
            },
            {
                "classes": ["Elis", "Kateriine", "Juta", "Katrin", "Joanna", "Sille"],
                "days": {
                    (0, 1, 2, 3): [(1, 2, "9:00", "10:20"), (3, 1, "10:20", "10:40"),
                                   (4, 2, "10:40", "12:00"), (6, 1, "12:00", "12:45"),
                                   (7, 1, "12:45", "13:25"), (8, 1, "13:25", "14:10"),
                                   (9, 1, "14:15", "15:00"), (10, 1, "15:00", "15:45")],
                    (4,): [(1, 2, "9:00", "10:20"), (3, 2, "10:30", "11:50"),
                           (5, 1, "11:50", "12:15"), (6, 1, "12:15", "13:00")],
                },
            },
        ],
    },
}


def bell_config(label, text):
    for key, cfg in BELLS.items():
        if key.casefold() in (label or "").casefold() or key.casefold() in (text or "").casefold():
            return cfg
    return None


def _fmt_time(minutes):
    return f"{minutes // 60}.{minutes % 60:02d}"


def day_times(slot_kinds, cfg):
    """Run the clock over one day's slots.

    slot_kinds is a list of "P"/"L", one per slot. Returns the slot times and
    the named breaks between them.
    """
    hour, _, minute = cfg["start"].partition(":")
    clock = int(hour) * 60 + int(minute)
    gaps = {g["after"]: g for g in cfg["gaps"]}
    slots, breaks = [], []
    for i, kind in enumerate(slot_kinds, start=1):
        length = cfg["paired"] if kind == "P" else cfg["single"]
        # `at` lets a lesson that is shorter than its slot compute its own end:
        # one group can take a single where another takes a pair, and the
        # Päevaplaan lists both ("14.30-15.15 L / 14.30-15.50 P").
        slots.append({"at": clock, "start": _fmt_time(clock),
                      "end": _fmt_time(clock + length)})
        clock += length
        gap = gaps.get(i)
        minutes = gap["minutes"] if gap else cfg["defaultGap"]
        if gap and gap.get("name"):
            breaks.append({"after": i, "name": gap["name"], "at": clock,
                           "until": clock + minutes,
                           "start": _fmt_time(clock), "end": _fmt_time(clock + minutes)})
        clock += minutes
    return slots, breaks


def _minutes(text):
    hour, _, minute = text.partition(":")
    return int(hour) * 60 + int(minute)


def band_slots(cfg, class_name, day):
    """The published blocks for this class on this day, if the school lists them.

    Same shape `day_slots` produces, so everything downstream is none the wiser:
    a block covering two aSc periods is one box either way.
    """
    for band in cfg.get("bands", []):
        if class_name not in band["classes"]:
            continue
        for days, blocks in band["days"].items():
            if day not in days:
                continue
            return [{"period": period, "periods": span, "at": _minutes(start),
                     "start": _fmt_time(_minutes(start)), "end": _fmt_time(_minutes(end))}
                    for period, span, start, end in blocks]
    return None


# --------------------------------------------------------------------------
# EduPage client
# --------------------------------------------------------------------------

class EduPage:
    """Anonymous read-only client for a school's public timetable data."""

    def __init__(self, edupage, cache_dir=None, refresh=False, verbose=False):
        self.edupage = edupage
        self.base = f"https://{edupage}.edupage.org"
        self.cache_dir = cache_dir
        self.refresh = refresh
        self.verbose = verbose
        self.cookie = None
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)

    def log(self, msg):
        if self.verbose:
            print(msg, file=sys.stderr)

    def _session(self):
        """Fetch the public view page once, to obtain a PHPSESSID.

        The RPC endpoints reject requests without a session established this
        way, which is why a bare POST returns "Insufficient privileges".
        """
        if self.cookie:
            return self.cookie
        req = urllib.request.Request(f"{self.base}/timetable/view.php",
                                     headers={"User-Agent": UA})
        with open_url(req, 30) as resp:
            raw = resp.headers.get_all("Set-Cookie") or []
        for c in raw:
            m = re.match(r"(PHPSESSID=[^;]+)", c)
            if m:
                self.cookie = m.group(1)
                break
        if not self.cookie:
            raise RuntimeError("No PHPSESSID returned by the timetable page")
        self.log(f"session established ({self.cookie.split('=')[1][:8]}...)")
        return self.cookie

    def rpc(self, module, func, args, cache_key=None):
        path = None
        if self.cache_dir and cache_key:
            path = os.path.join(self.cache_dir, f"{self.edupage}-{cache_key}.json")
            if os.path.exists(path) and not self.refresh:
                self.log(f"cache hit: {path}")
                with open(path, encoding="utf-8") as fh:
                    return json.load(fh)

        url = f"{self.base}/timetable/server/{module}.js?__func={func}"
        body = json.dumps({"__args": args, "__gsh": "00000000"}).encode()
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "User-Agent": UA,
                "Content-Type": "application/json; charset=UTF-8",
                "Origin": self.base,
                "Referer": f"{self.base}/timetable/view.php",
                "Cookie": self._session(),
            },
        )
        self.log(f"POST {func} {json.dumps(args)}")
        with open_url(req, 60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        result = payload.get("r")
        if result is None or "error" in result:
            err = (result or {}).get("error") or payload.get("e") or "unknown error"
            raise RuntimeError(f"{func}{tuple(args)}: {err}")

        if path:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False)
            self.log(f"cached -> {path}")
        return payload

    def timetables(self, year):
        payload = self.rpc("ttviewer", "getTTViewerData", [None, str(year)],
                           cache_key=f"ttlist-{year}")
        return payload["r"]["regular"]

    def timetable(self, tt_num):
        payload = self.rpc("regulartt", "regularttGetData", [None, str(tt_num)],
                           cache_key=f"tt-{tt_num}")
        return payload["r"]


# --------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------

def tables(result):
    return {t["id"]: t["data_rows"] for t in result["dbiAccessorRes"]["tables"]}


def index(rows):
    return {r["id"]: r for r in rows}


def short_label(text):
    """Turn a timetable's full title into something fit for a dropdown.

    "SädeTERA 2026/27 (24. 08. - 18. 12. 2026)" -> "SädeTERA"
    "ProTERA ja TERA gümnaasium 2026/2027 I pa (...)" -> "ProTERA ja TERA gümnaasium"
    """
    label = re.sub(r"\s*\([^)]*\)\s*$", "", text or "").strip()
    label = re.sub(r"\s*\d{4}\s*/\s*\d{2,4}.*$", "", label).strip()
    label = re.sub(r"\s*\d{4}\s*$", "", label).strip()
    return label or (text or "").strip() or "?"


def worth_showing(line):
    """The line a school prints under its timetable, unless it is only a label.

    Two of the four here have set "Kehtivus:" and left the dates blank, which is
    a heading with nothing under it. Anything the school did fill in is kept as
    they wrote it — this decides whether there is something, not what it says.
    """
    label, sep, value = line.rpartition(":")
    return line.strip() if (value.strip() if sep else line.strip()) else ""


def timetable_meta(result):
    """Days, periods and validity are per timetable, not per class."""
    T = tables(result)
    days = [{"idx": i, "name": d["name"], "short": d["short"]}
            for i, d in enumerate(T["days"])]
    periods = [{"num": int(p["period"]), "name": p["name"],
                "start": p["starttime"], "end": p["endtime"]}
               for p in sorted(T["periods"], key=lambda p: int(p["period"]))]
    settings = (T["globals"][0].get("settings") or {}) if T["globals"] else {}
    return {
        "days": days,
        "periods": periods,
        "showTimes": any(p["start"] not in ("", "00:00") for p in periods),
        "validity": worth_showing(settings.get("m_strDateBellowTimeTable", "")),
        "classNames": [c["name"] for c in T["classes"]],
    }


def day_slots(blocks, n_periods, always_paired=0):
    """Split a day into lesson slots — "the 1st lesson", "the 2nd lesson", ….

    A slot is as long as the longest lesson starting on it, because different
    groups of the same class can pair the same periods differently: on one
    ProTERA Tuesday one group has a single at period 7 while another has a pair
    over 7-8. Both are the day's 4th lesson, so both belong to slot 4.
    """
    longest = {}
    for start, duration in blocks:
        longest[start] = max(longest.get(start, 1), duration)
    slots, pos = [], 1
    while pos <= n_periods:
        if pos in longest:
            step = longest[pos]
        elif len(slots) < always_paired:
            step = 2
        else:
            step = 1
        slots.append({"period": pos, "periods": step, "used": pos in longest})
        pos += step
    while slots and not slots[-1]["used"]:      # trim trailing free slots
        slots.pop()
    return slots


def extract(result, class_name, n_periods=None, cfg=None):
    """Flatten the aSc relational tables into one lesson row per (day, period)."""
    T = tables(result)
    subjects, teachers = index(T["subjects"]), index(T["teachers"])
    classrooms, groups, lessons = index(T["classrooms"]), index(T["groups"]), index(T["lessons"])

    matches = [c for c in T["classes"] if c["name"] == class_name]
    if not matches:
        available = ", ".join(c["name"] for c in T["classes"])
        raise SystemExit(f"Class {class_name!r} not in this timetable. Available: {available}")
    cls = matches[0]

    # Divisions are the "pick one group" axes a student chooses along.
    divisions = []
    for div in T["divisions"]:
        if div["classid"] != cls["id"] or not div["ascttdivision"]:
            continue
        members = [groups[g]["name"] for g in div["groupids"]
                   if g in groups and not groups[g]["entireclass"]]
        if members:
            divisions.append({"id": div["id"], "groups": sorted(set(members))})
    divisions.sort(key=lambda d: (len(d["groups"]), d["groups"]))

    entries = []
    for card in T["cards"]:
        lesson = lessons.get(card["lessonid"])
        if not lesson or cls["id"] not in lesson["classids"]:
            continue
        # aSc keeps unplaced cards in the same table, with no period or day.
        if not card["period"] or "1" not in (card["days"] or ""):
            continue
        subject = subjects.get(lesson["subjectid"], {})
        grp = [groups[g]["name"] for g in lesson["groupids"]
               if g in groups and groups[g]["classid"] == cls["id"]
               and not groups[g]["entireclass"]]
        base = {
            "subject": subject.get("name", "?"),
            "subjectShort": subject.get("short", "?"),
            "schoolColor": subject.get("color", ""),
            "groups": grp,
            "teachers": [teachers[t]["name"] for t in lesson["teacherids"] if t in teachers],
            "teacherShorts": [teachers[t]["short"] for t in lesson["teacherids"] if t in teachers],
            "rooms": [classrooms[c]["short"] for c in card["classroomids"] if c in classrooms],
            "duration": lesson.get("durationperiods") or 1,
        }
        start = int(card["period"])
        for day_idx, flag in enumerate(card["days"]):
            if flag != "1":
                continue
            for step in range(base["duration"]):
                entries.append(dict(base, day=day_idx, period=start + step,
                                    startPeriod=start, part=step))

    entries.sort(key=lambda e: (e["day"], e["period"], e["subject"], "/".join(e["groups"])))

    # Slot the day, so a paired lesson is one cell and the breaks land in a
    # fixed column whatever shape the day happens to take.
    n_periods = n_periods or max((e["period"] for e in entries), default=0)
    shape = {}
    for day in {e["day"] for e in entries}:
        published = band_slots(cfg, cls["name"], day) if cfg else None
        if published:
            used = {e["startPeriod"] + k for e in entries if e["day"] == day
                    for k in range(e["duration"])}
            slots = [s for s in published
                     if any(s["period"] + k in used for k in range(s["periods"]))]
            breaks = []
        else:
            blocks = {(e["startPeriod"], e["duration"]) for e in entries
                      if e["day"] == day and e["part"] == 0}
            slots = day_slots(blocks, n_periods, (cfg or {}).get("alwaysPaired", 0))
            # A school whose plan is published as blocks has no clock to run, so
            # a class its bands do not cover — the empty markers standing in for
            # a grade, say — simply goes without times.
            if cfg and not cfg.get("bands"):
                kinds = ["P" if s["periods"] > 1 else "L" for s in slots]
                times, breaks = day_times(kinds, cfg)
                for slot, time in zip(slots, times):
                    slot.update(time)
            else:
                breaks = []
        shape[day] = {"slots": slots, "breaks": breaks}
        slot_of_period = {}
        for i, slot in enumerate(slots, start=1):
            for k in range(slot["periods"]):
                slot_of_period[slot["period"] + k] = i
        for e in entries:
            if e["day"] != day:
                continue
            e["slot"] = slot_of_period.get(e["startPeriod"])
            e["time"] = ""
            e["offSlot"] = False
            e["startMin"] = e["endMin"] = None
            if published and e["slot"]:
                # The block's own times, whatever the lesson's length: this is
                # what the school publishes, so nothing has to be inferred.
                slot = slots[e["slot"] - 1]
                e["startMin"] = slot["at"]
                e["endMin"] = _minutes(slot["end"].replace(".", ":"))
                e["time"] = f"{slot['start']}–{slot['end']}"
            elif cfg and not cfg.get("bands") and e["slot"]:
                slot = slots[e["slot"] - 1]
                if e["startPeriod"] != slot["period"]:
                    # Starts part-way through a slot another group takes whole.
                    # The day plan never splits a pair, so the exact time is
                    # unknown; span the slot and let the view mark it.
                    e["offSlot"] = True
                    e["startMin"] = slot["at"]
                    e["endMin"] = slot["at"] + (cfg["paired"] if slot["periods"] > 1
                                                else cfg["single"])
                else:
                    length = cfg["paired"] if e["duration"] > 1 else cfg["single"]
                    e["startMin"] = slot["at"]
                    e["endMin"] = slot["at"] + length
                    e["time"] = f"{_fmt_time(slot['at'])}–{_fmt_time(slot['at'] + length)}"

    if cfg and cfg.get("bands") and any(band_slots(cfg, cls["name"], d) for d in shape):
        entries = merge_blocks(entries)

    label_divisions(divisions, entries)
    divisions = [d for d in divisions if d["lessons"]]

    return {
        "name": cls["name"],
        "divisions": divisions,
        "subjects": sorted({e["subject"] for e in entries}),
        "entries": entries,
        "shape": shape,
        "maxSlots": max((len(v["slots"]) for v in shape.values()), default=0),
        "typical": typical_times(shape),
    }


def merge_blocks(entries):
    """One box per published block, even when it holds two different subjects.

    The school writes 9.00-10.50 as a single block; inside it may sit Häälestus
    and then Üldõpetus. Splitting the block in half would invent times nobody
    published, so the two become one box naming both, in the order they run.

    Only a sequence is merged. Lessons starting in the same period are choices
    running side by side — Kodundus or Käsitöö or Puutöö — and stay apart, as do
    any that name a group. The colour goes to whichever subject fills more of
    the block, and to the later one when they fill it equally: a block that
    opens with a warm-up should look like what it becomes.
    """
    out, merged = [], {}
    for e in entries:
        if e["part"]:
            continue
        merged.setdefault((e["day"], e["slot"]), []).append(e)
    for (day, slot), here in sorted(merged.items()):
        starts = {x["startPeriod"] for x in here}
        if (len(here) == 1 or len(starts) < len(here)
                or len({x["subject"] for x in here}) == 1
                or any(x["groups"] for x in here)):
            out.extend(here)
            continue
        here.sort(key=lambda x: x["startPeriod"])
        lead = max(here, key=lambda x: (x["duration"], x["startPeriod"]))
        joined = dict(lead)
        joined["names"] = [x["subject"] for x in here]
        joined["duration"] = sum(x["duration"] for x in here)
        joined["startPeriod"] = here[0]["startPeriod"]
        for field in ("teachers", "teacherShorts", "rooms"):
            seen = []
            for x in here:
                for v in x[field]:
                    if v not in seen:
                        seen.append(v)
            joined[field] = seen
        out.append(joined)
    out.sort(key=lambda e: (e["day"], e["period"], e["subject"], "/".join(e["groups"])))
    return out


def label_divisions(divisions, entries):
    """Name each group picker after what is actually taught in it.

    A division that only ever carries one subject is that subject; a couple of
    subjects are listed; more than that is shortened, and the page keeps the
    whole list for the tooltip.
    """
    for div in divisions:
        counts = {}
        for e in entries:
            if e["part"]:
                continue
            if any(g in div["groups"] for g in e["groups"]):
                counts[e["subject"]] = counts.get(e["subject"], 0) + 1
        div["lessons"] = sum(counts.values())
        div["subjectCounts"] = counts

    for div in divisions:
        ranked = sorted(div["subjectCounts"], key=lambda s: (-div["subjectCounts"][s], s))
        # The page shortens long lists in the picker heading and keeps the whole
        # list for the tooltip, the main group included.
        div["subjects"] = ranked
        if not ranked:
            div["label"] = ""
        elif len(ranked) == 1:
            div["label"] = ranked[0]
        elif len(ranked) <= 3:
            div["label"] = " / ".join(ranked)
        else:
            div["label"] = ", ".join(ranked[:2]) + " …"


def typical_times(shape):
    """The time each slot and break usually runs at, for the print view's Aeg
    column. Days that differ are annotated in the cell itself, the way the
    school's own printouts do it."""
    def commonest(values):
        counts = {}
        for v in values:
            counts[v] = counts.get(v, 0) + 1
        return max(counts, key=lambda v: (counts[v], v)) if counts else ""

    slots, breaks = {}, {}
    for day in shape.values():
        for i, slot in enumerate(day["slots"], start=1):
            if slot.get("start"):
                slots.setdefault(i, []).append(f"{slot['start']}–{slot['end']}")
        for brk in day["breaks"]:
            breaks.setdefault(brk["after"], []).append(f"{brk['start']}–{brk['end']}")
    return {
        "slots": {str(k): commonest(v) for k, v in slots.items()},
        "breaks": {str(k): commonest(v) for k, v in breaks.items()},
    }


def collect(client, year, only, verbose):
    """Every visible timetable, with every class in it, extracted."""
    listing = client.timetables(year)
    visible = [t for t in listing["timetables"] if not t["hidden"]]
    if only:
        needles = [o.casefold() for o in only]
        visible = [t for t in visible
                   if any(n in t["text"].casefold() for n in needles)]
        if not visible:
            raise SystemExit(f"No visible timetable matches {only!r}. Try --list.")
    visible.sort(key=lambda t: (t.get("datefrom") or "", t["tt_num"]), reverse=True)

    schools = []
    for entry in visible:
        try:
            result = client.timetable(entry["tt_num"])
        except RuntimeError as exc:
            print(f"warning: skipping timetable {entry['tt_num']} ({exc})", file=sys.stderr)
            continue
        meta = timetable_meta(result)
        label = short_label(entry["text"])
        cfg = bell_config(label, entry["text"])
        n_periods = len(meta["periods"])
        classes = [extract(result, name, n_periods, cfg) for name in meta["classNames"]]
        classes = [c for c in classes if c["entries"]]
        if not classes:
            continue
        schools.append({
            "ttNum": entry["tt_num"],
            "label": label,
            "text": entry["text"],
            "validity": meta["validity"],
            "days": meta["days"],
            "periods": meta["periods"],
            "showTimes": meta["showTimes"],
            "bells": bool(cfg),
            "bellName": (cfg or {}).get("name", ""),
            "breakSlots": [g["after"] for g in (cfg or {}).get("gaps", []) if g.get("name")],
            "classes": classes,
        })
        if verbose:
            slots = sum(len(c["entries"]) for c in classes)
            times = f"times from {cfg['name']}" if cfg else "no bell schedule"
            print(f"  {entry['tt_num']:<5} {label:<28} "
                  f"{len(classes):>2} classes, {slots:>4} slots, {times}", file=sys.stderr)
    if not schools:
        raise SystemExit("No readable timetables found.")
    return schools


# Subjects that belong together get neighbouring hues, so a printed timetable
# reads as "languages are blue, sciences are green" at a glance. Matched as
# lower-cased substrings of the Estonian subject name, first hit wins — so put
# the more specific keyword first ("kirjandus" before "keel").
SUBJECT_FAMILIES = [
    ("literature", 268, ["kirjandus", "väitlus"]),
    ("language",   228, ["keel", "inglise", "vene", "saksa", "prantsuse", "hispaania"]),
    ("computing",  188, ["informaatika", "tehnoloogia", "robootika", "digi", "arvuti",
                         "programmeeri", "elektrotehnika"]),
    ("maths",      145, ["matemaatika", "ajutreening", "mat "]),
    ("science",    100, ["füüsika", "keemia", "bioloogia", "loodus", "geograafia",
                         "astronoomia"]),
    ("sport",       58, ["liikumi", "kehaline", "sport", "karate", "ujumine", "tants",
                         "poks"]),
    ("humanities",  18, ["ajalugu", "inimese", "ühiskonna", "usundi", "filosoofia",
                         "psühholoogia", "majandus", "karjääri", "klassijuhataja",
                         "klassitund", "õiguse", "mentorlus", "õpilasfirma"]),
    ("arts",       318, ["kunst", "muusika", "draama", "käsitöö", "solfedžo", "koor",
                         "ansambel", "klaver", "kitarr", "loovus", "puutöö", "kodundus",
                         "kokkamine"]),
]

# Lightness steps within a family, ordered so that consecutive members differ
# strongly — the point is telling them apart on a monochrome-ish print too.
LIGHTNESS_STEPS = [0.72, 0.42, 0.86, 0.56, 0.34, 0.79, 0.49, 0.64]


def subject_family(name):
    low = (name or "").casefold()
    for family, hue, keywords in SUBJECT_FAMILIES:
        if any(k in low for k in keywords):
            return family, hue
    return "other", None


def _relative_luminance(r, g, b):
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def palette(names):
    """Print-friendly colour per subject, with related subjects kept close.

    Each family owns a hue band; members are spread across it and given
    well-separated lightness steps, which is what keeps them distinct on paper.
    Text colour is picked from the background's luminance so every label stays
    legible. Deterministic: everything derives from the sorted subject list.
    """
    families = {}
    for name in sorted(names):
        family, hue = subject_family(name)
        families.setdefault(family, {"hue": hue, "members": []})["members"].append(name)

    # Subjects with no family keyword still need hues; give them the gaps left
    # between the named families rather than letting them collide.
    leftovers = families.pop("other", None)
    used = sorted(h for _, h, _ in SUBJECT_FAMILIES)
    colors = {}
    for family, info in families.items():
        members = info["members"]
        band = 22 if len(members) > 1 else 0
        for i, name in enumerate(members):
            offset = 0 if len(members) == 1 else (i / (len(members) - 1) - 0.5) * band
            hue = (info["hue"] + offset) % 360
            light = LIGHTNESS_STEPS[i % len(LIGHTNESS_STEPS)]
            # Families bigger than the lightness cycle get a second, muted tier
            # so the ninth member does not repeat the first.
            sat = 0.74 if (i // len(LIGHTNESS_STEPS)) % 2 == 0 else 0.45
            colors[name] = _hexpair(hue, light, sat)
    if leftovers:
        members = leftovers["members"]
        for i, name in enumerate(members):
            # Park unmatched subjects on greys and the reds nothing else uses.
            hue = (0 + i * 137.508) % 360
            light = LIGHTNESS_STEPS[i % len(LIGHTNESS_STEPS)]
            colors[name] = _hexpair(hue, light, 0.25)
    return colors


MIN_CONTRAST = 4.5              # WCAG AA for normal text
FG_DARK, FG_LIGHT = "#14171A", "#FFFFFF"
FG_DARK_LUM = _relative_luminance(0x14, 0x17, 0x1A)


def _contrast(lum_a, lum_b):
    hi, lo = max(lum_a, lum_b), min(lum_a, lum_b)
    return (hi + 0.05) / (lo + 0.05)


def _hexpair(hue, light, sat):
    """A background plus whichever of the two text colours reads better on it.

    Mid-luminance backgrounds are the awkward ones: there is a band where
    neither text colour clears AA, so step the lightness away from it until one
    does. Deterministic, and it only moves the colours that need moving.
    """
    for step in range(30):
        adjusted = min(1.0, light + step * 0.02) if light >= 0.5 else max(0.0, light - step * 0.02)
        r, g, b = colorsys.hls_to_rgb(hue / 360.0, adjusted, sat)
        r, g, b = round(r * 255), round(g * 255), round(b * 255)
        lum = _relative_luminance(r, g, b)
        on_dark, on_light = _contrast(lum, FG_DARK_LUM), _contrast(lum, 1.0)
        fg = FG_DARK if on_dark >= on_light else FG_LIGHT
        if max(on_dark, on_light) >= MIN_CONTRAST:
            break
    return {"bg": "#%02X%02X%02X" % (r, g, b), "fg": fg}


def compact(schools):
    """Shrink the model for embedding: short keys, subject facts hoisted out.

    The --json export keeps the verbose shape; this form only has to be read by
    the page's own script, and halves the size of the generated file.
    """
    subject_meta = {}
    for school in schools:
        for cls in school["classes"]:
            for e in cls["entries"]:
                meta = subject_meta.setdefault(e["subject"], {})
                meta.setdefault("short", e["subjectShort"])
                if e["schoolColor"]:
                    meta.setdefault("color", e["schoolColor"])
    out = []
    for school in schools:
        out.append({
            "n": school["ttNum"],
            "l": school["label"],
            "t": school["text"],
            "v": school["validity"],
            "d": [{"i": d["idx"], "n": d["name"]} for d in school["days"]],
            "p": [{"n": p["num"], "l": p["name"], "s": p["start"], "e": p["end"]}
                  for p in school["periods"]],
            "ts": school["showTimes"],
            "b": school["bells"],
            "bn": school["bellName"],
            "bs": school["breakSlots"],
            "c": [{
                "n": cls["name"],
                "v": [{"id": d["id"], "groups": d["groups"], "l": d["label"],
                       "sj": d["subjects"]}
                      for d in cls["divisions"]],
                "y": cls["typical"],
                "m": cls["maxSlots"],
                "h": {str(day): {
                    "s": [{"p": s["period"], "d": s["periods"],
                           "a": s.get("start", ""), "z": s.get("end", "")}
                          for s in v["slots"]],
                    "b": [{"a": b["after"], "n": b["name"],
                           "s": b["start"], "e": b["end"],
                           "m": b["at"], "x": b["until"]} for b in v["breaks"]],
                } for day, v in cls["shape"].items()},
                "e": [{
                    "d": e["day"], "p": e["period"], "s": e["subject"],
                    "S": e.get("names") or 0,
                    "g": e["groups"], "t": e["teacherShorts"],
                    "T": e["teachers"], "r": e["rooms"], "c": e["part"],
                    "k": e["slot"], "u": e["duration"], "w": e.get("time", ""),
                    "o": 1 if e.get("offSlot") else 0,
                    "a": e.get("startMin"), "z": e.get("endMin"),
                } for e in cls["entries"]],
            } for cls in school["classes"]],
        })
    return out, subject_meta


# --------------------------------------------------------------------------
# Render
# --------------------------------------------------------------------------

PAGE = """<!DOCTYPE html>
<html lang="et">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1b1d21; --muted: #6b7280;
    --line: #d6d9de; --panel: #f6f7f9; --accent: #1f5c8b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: var(--fg); background: var(--bg);
  }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: var(--muted); font-size: 13px; }
  .sub a { color: var(--accent); }
  .unofficial { margin-top: 2px; font-size: 12px; color: #8a919b; }
  .foot:empty { display: none; }
  .topbar { display: flex; justify-content: space-between; align-items: flex-start;
            gap: 18px; margin-bottom: 18px; }
  /* The heading takes what is left; the actions keep their corner. Without the
     zero minimum a long validity line pushes them onto their own row. */
  .topbar > :first-child { flex: 1 1 auto; min-width: 0; }
  .topactions { flex: 0 0 auto; display: flex; gap: 8px; align-items: center; }
  @media (max-width: 700px) { .topbar { flex-wrap: wrap; } }
  button.go { background: #12805c; border-color: #0e6b4d; color: #fff; font-weight: 600; }
  button.go:hover { background: #0e6b4d; border-color: #0e6b4d; color: #fff; }
  .field label.inline, .checklist label.inline {
    text-transform: none; letter-spacing: .01em; font-size: 13px; color: inherit;
    display: inline-flex; align-items: center; gap: 6px; margin: 0; font-weight: 400; }
  .checklist { display: flex; flex-direction: column; gap: 7px; margin-top: 4px; }
  .checklist .line { display: flex; align-items: center; gap: 18px; min-height: 20px; }
  .checklist .line > label.inline:first-child { min-width: 9.5rem; }
  .choice { display: flex; gap: 14px; }
  .choice.off { opacity: .4; pointer-events: none; }
  #colourPicker { margin-top: 10px; }
  #colourPicker.off { display: none; }
  .panel {
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 14px 16px; margin-bottom: 18px;
  }
  .row { display: flex; flex-wrap: wrap; gap: 18px 26px; align-items: flex-end; }
  .row + .row { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  select, button { font: inherit; padding: 5px 8px; border: 1px solid var(--line);
                   border-radius: 5px; background: #fff; color: inherit; }
  button { cursor: pointer; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  .primary select { font-weight: 600; }
  .toggles { display: flex; gap: 16px; align-items: center; }
  .toggles label { display: flex; gap: 6px; align-items: center; font-size: 13px; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; min-width: 720px; background: #fff; }
  th, td { border: 1px solid var(--line); vertical-align: top; padding: 5px 7px; }
  thead th { background: var(--panel); font-size: 12px; text-align: center; white-space: nowrap; }
  tbody th { background: var(--panel); font-size: 13px; text-align: left; white-space: nowrap; }
  td { min-width: 96px; }
  .lesson { border-radius: 4px; padding: 4px 6px; margin-bottom: 4px; }
  .lesson:last-child { margin-bottom: 0; }
  .lesson .name { font-weight: 600; }
  .lesson .meta { font-size: 11px; opacity: .85; }
  .lesson .time { font-size: 11px; opacity: .85; font-variant-numeric: tabular-nums; }
  .cont { opacity: .62; }
  .brk { background: #f2f3f5; min-width: 60px; }
  .brk .lbl { font-size: 11px; color: var(--muted); }
  .brk .time { font-size: 11px; color: #3d444d; font-variant-numeric: tabular-nums; }
  thead th.brk, tbody th.brk { font-weight: 500; color: var(--muted); font-size: 11px;
                               white-space: normal; min-width: 80px; }
  .slottime { font-weight: 400; color: #6b7280; font-variant-numeric: tabular-nums; }
  textarea { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; width: 100%;
             padding: 6px 8px; border: 1px solid var(--line); border-radius: 5px;
             resize: vertical; }
  .evwarn { font-size: 12px; color: #a33; margin-top: 5px; white-space: pre-line; }
  details.panel { padding: 0; }
  details.panel > summary { padding: 12px 16px; cursor: pointer; font-size: 13px;
                            font-weight: 600; color: var(--muted); list-style: none;
                            display: flex; align-items: center; gap: 8px; }
  details.panel > summary::-webkit-details-marker { display: none; }
  details.panel > summary::before { content: "▸"; font-size: 11px; transition: transform .15s; }
  details.panel[open] > summary::before { transform: rotate(90deg); }
  details.panel > summary:hover { color: var(--accent); }
  details.panel > :not(summary) { padding: 0 16px; }
  details.panel > :last-child { padding-bottom: 14px; }
  details.panel[open] > summary { border-bottom: 1px solid var(--line); margin-bottom: 12px; }
  details.panel .row + .row { margin-top: 12px; }

  /* Timeline: a continuous clock down the side and every box drawn at its true
     start and height, so a 45-minute lesson never has to pretend to be 80. */
  .tl { --ppm: 1; --gut: 58px; border: 1px solid var(--line); border-radius: 8px;
        overflow: hidden; background: #fff; }
  .tlhead { display: flex; border-bottom: 1px solid var(--line); background: var(--panel); }
  .tlhead .cell { flex: 1 1 0; text-align: center; font-size: 12px; font-weight: 600;
                  padding: 6px 4px; border-left: 1px solid var(--line); }
  .tlhead .gut { flex: 0 0 var(--gut); border-left: none; }
  .tlbody { display: flex; position: relative; padding: 9px 0 11px; }
  .tlaxis { flex: 0 0 var(--gut); position: relative; }
  .tlaxis .t { position: absolute; right: 6px; font-size: 10.5px; color: var(--muted);
               transform: translateY(-50%); font-variant-numeric: tabular-nums; }
  .tlaxis .t.hour { color: #4b5563; font-weight: 600; }
  .tlcol { flex: 1 1 0; position: relative; border-left: 1px solid var(--line);
           background-image:
             repeating-linear-gradient(to bottom, #eceef1 0 1px, transparent 1px var(--half)),
             repeating-linear-gradient(to bottom, #d8dbe0 0 1px, transparent 1px var(--hour));
  }
  .ev { position: absolute; border-radius: 4px; padding: 2px 5px; overflow: hidden;
        box-sizing: border-box; border: 1px solid rgba(0,0,0,.18); }
  .ev .when { font-size: 10px; opacity: .85; font-variant-numeric: tabular-nums;
              line-height: 1.25; }
  .ev .what { font-weight: 600; font-size: 12px; line-height: 1.25; }
  .ev .who2 { font-size: 10.5px; opacity: .85; line-height: 1.25; }
  .ev.tight .what { font-size: 11px; }
  .ev.approx { border-style: dashed; border-width: 2px; }
  .ev.brk { background: repeating-linear-gradient(135deg, #f4f5f7 0 6px, #eceef1 6px 12px);
            color: #6b7280; border-color: #e2e5ea; }
  .ev.brk .what { font-weight: 500; font-size: 11px; }
  .ev.mine { border-width: 2px; border-color: rgba(0,0,0,.34); z-index: 2;
             box-shadow: 0 1px 4px rgba(0,0,0,.28); }
  input[type=text] { font: inherit; padding: 5px 8px; border: 1px solid var(--line);
                     border-radius: 5px; background: #fff; color: inherit; }
  .hiddenpick { position: absolute; width: 1px; height: 1px; padding: 0; border: none;
                opacity: 0; pointer-events: none; }
  .ev[data-subject], .lesson[data-subject] { cursor: pointer; }
  .divsub { font-size: 10px; color: #9aa1ab; text-transform: none; letter-spacing: 0; }
  .field label[title] { cursor: help; }

  /* Print view: the layout the school's own printouts use — slots down the
     side with an Aeg column, days across, breaks as full-width rows. */
  .ptbl { border-collapse: collapse; width: 100%; background: #fff; }
  .ptbl th, .ptbl td { border: 1px solid #000; padding: 4px 5px; text-align: center;
                       vertical-align: middle; font-size: var(--pfont, 12.5px); }
  .ptbl .ptitle { font-size: 19px; font-weight: 700; padding: 8px; border: 1px solid #000; }
  .ptitle.sheet { font-size: 19px; font-weight: 700; text-align: center;
                  padding: 0 0 10px; border: none; }
  .ptbl thead .phead { font-size: 11px; font-weight: 700; }
  .ptbl .pnum { font-weight: 700; width: 26px; }
  .ptbl .ptime { font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;
                 width: 104px; }
  .ptbl .pcell { line-height: 1.25; }
  .ptbl .pwhen { font-size: calc(var(--pfont, 12.5px) * .84); }
  .ptbl .pbreak { font-weight: 400; }
  .ptbl .corner { border: none; }
  body.printview .count, body.printview .topbar { display: none; }
  body.printview #grid { width: 1054px; }          /* 297mm less two 9mm margins */
  body.printview .ptbl .pcell, body.printview .ptbl .pnum,
  body.printview .ptbl .ptime, body.printview .ptbl td:empty,
  .ptbl .pcell, .ptbl .pnum, .ptbl .ptime, .ptbl td:empty {
    padding: var(--ppad, 15px) 5px; }
  body.printview .ptbl .pbreak, .ptbl .pbreak {
    padding: calc(var(--ppad, 15px) * .6) 5px; }
  @page { size: A4 landscape; margin: 9mm; }
  @media print {
    /* Chrome leaves "Background graphics" off by default, which would drop
       every lesson colour — and white-on-white text with it. */
    *, *::before, *::after {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body { padding: 0; }
    .panel, .count, .topbar { display: none; }
    #grid { width: auto; }

    .ptitle { font-size: 17px; font-weight: 700; text-align: center; }
  }
  .foot { margin: 24px 0 10px; font-size: 11.5px; color: var(--muted); line-height: 1.5; }
  /* Flex, not a float: a floated child adds nothing to its parent's height, so
     the fitting would size the table as if the code were not there and push it
     off the sheet. */
  .foot { display: flex; align-items: flex-start; gap: 16px; }
  .foot .lines { flex: 1 1 auto; }
  .qrbox { flex: 0 0 auto; text-align: center; }
  .qrhint { font-size: 7.5px; max-width: 32mm; line-height: 1.2; margin-top: 2px; }
  .qr { display: block; }
  .foot a { color: inherit; }
  .foot .warn { font-weight: 600; }
  body.printview .foot { width: 1054px; margin: 8px 0 0; font-size: 9px; }
  @media print { .foot { width: auto; margin: 7px 0 0; font-size: 9px; } }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; }
  .legend .item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .legend input[type=color] { width: 26px; height: 20px; padding: 0; border: 1px solid var(--line); }
  .count { color: var(--muted); font-size: 12px; margin: 10px 0; }
  @media print { body { padding: 0; } .panel, .count { display: none; } }
</style>
</head>
<body>
<div class="topbar">
  <div>
    <h1 id="heading" data-i18n="appName"></h1>
    <div class="sub" id="subtitle"></div>
  </div>
  <div class="topactions">
    <select id="lang" aria-label="Language"></select>
    <button id="share" data-i18n="share"></button>
    <button id="doprint" class="go" data-i18n="print"></button>
  </div>
</div>

<details class="panel" id="filterPanel" open>
  <summary data-i18n="filter"></summary>
  <div class="row">
    <div class="field primary">
      <label for="school" data-i18n="school"></label>
      <select id="school"></select>
    </div>
    <div class="field primary">
      <label for="klass" data-i18n="class"></label>
      <select id="klass"></select>
    </div>
  </div>
  <div class="row" id="groupsRow">
    <div class="field" style="width:100%">
      <label data-i18n="groupsHeading"></label>
      <div class="row" id="divisions" style="margin-top:6px;padding-top:0;border-top:none"></div>
    </div>
  </div>
</details>

<details class="panel" id="displayPanel">
  <summary data-i18n="display"></summary>
  <div class="row">
    <div class="field" style="width:100%">
      <label data-i18n="titleHeading"></label>
      <div class="checklist">
        <div class="line">
          <label class="inline"><input type="checkbox" id="showWho">
            <span data-i18n="titleWho"></span></label>
          <input type="text" id="who" size="18">
        </div>
        <div class="line">
          <label class="inline"><input type="checkbox" id="showSchool">
            <span data-i18n="titleSchool"></span></label>
          <input type="text" id="titleSchool" size="30">
        </div>
        <div class="line">
          <label class="inline"><input type="checkbox" id="showClass">
            <span data-i18n="titleClass"></span></label>
          <input type="text" id="titleClass" size="18">
        </div>
      </div>
    </div>
  </div>
  <div class="row">
    <div class="field" style="width:100%">
      <label data-i18n="showHeading"></label>
      <div class="checklist">
        <div class="line">
          <label class="inline"><input type="checkbox" id="showTeacher">
            <span data-i18n="showTeacher"></span></label>
          <span class="choice" id="teacherChoice">
            <label class="inline"><input type="radio" name="teacherName" value="full">
              <span data-i18n="nameFull"></span></label>
            <label class="inline"><input type="radio" name="teacherName" value="short">
              <span data-i18n="nameShort"></span></label>
          </span>
        </div>
        <div class="line">
          <label class="inline"><input type="checkbox" id="showRoom">
            <span data-i18n="showRoom"></span></label>
        </div>
        <div class="line">
          <label class="inline"><input type="checkbox" id="showGroup">
            <span data-i18n="showGroup"></span></label>
        </div>
        <div class="line">
          <label class="inline"><input type="checkbox" id="showSubject">
            <span data-i18n="showSubject"></span></label>
          <span class="choice" id="subjectChoice">
            <label class="inline"><input type="radio" name="subjectName" value="full">
              <span data-i18n="subjectFull"></span></label>
            <label class="inline"><input type="radio" name="subjectName" value="short">
              <span data-i18n="subjectShort"></span></label>
          </span>
        </div>
      </div>
    </div>
  </div>
  <div class="row">
    <div class="field" style="width:100%">
      <label data-i18n="coloursHeading"></label>
      <div class="checklist">
        <div class="line">
          <label class="inline"><input type="checkbox" id="schoolColors">
            <span data-i18n="schoolColours"></span></label>
        </div>
        <div class="line">
          <label class="inline"><input type="checkbox" id="customColours">
            <span data-i18n="customColours"></span></label>
        </div>
      </div>
      <div id="colourPicker">
        <div class="divsub" id="colourHint"></div>
        <div class="legend" id="legend"></div>
      </div>
    </div>
  </div>
</details>

<details class="panel" id="eventsPanel">
  <summary data-i18n="events.summary"></summary>
  <div class="field" style="width:100%;margin-top:12px">
    <label for="events"><span data-i18n="events.label"></span>
      <code data-i18n="events.example"></code></label>
    <textarea id="events" rows="3" spellcheck="false"
      data-i18n-ph="events.placeholder"></textarea>
    <div class="evwarn" id="evwarn"></div>
  </div>
</details>

<details class="panel" id="advancedPanel">
  <summary data-i18n="advanced"></summary>
  <div class="field" style="width:100%;margin-top:12px">
    <label for="settingsText" data-i18n="backup"></label>
    <textarea id="settingsText" rows="5" spellcheck="false"></textarea>
  </div>
  <div class="row" style="margin-top:8px;padding-top:0;border-top:none">
    <button id="copySettings" data-i18n="settings.copy"></button>
    <button id="applySettings" data-i18n="settings.apply"></button>
    <button id="reset" data-i18n="reset"></button>
    <span class="evwarn" id="settingsMsg"></span>
  </div>
</details>

<input type="color" id="pick" class="hiddenpick" tabindex="-1" aria-hidden="true">

<div class="count" id="count"></div>
<div class="scroll"><div id="grid"></div></div>
<footer class="foot" id="foot"></footer>

__ANALYTICS__
<script>__QRLIB__</script>
<script id="data" type="application/json">__DATA__</script>
<script>
"use strict";
const DATA = JSON.parse(document.getElementById("data").textContent);
const SCHOOLS = DATA.schools;
const KEY = "tt:" + DATA.edupage + ":" + DATA.year;

const defaults = () => ({
  school: DATA.initialSchool, klass: DATA.initialClass,
  lang: DATA.lang, picks: {}, colors: {}, who: {}, events: {},
  titleSchool: {}, titleClass: {},
  showWho: false, showSchool: true, showClass: true,
  showTeacher: true, teacherName: "short",
  showRoom: true, showGroup: true,
  showSubject: true, subjectName: "full",
  schoolColors: false, customColours: true,
});
/* Settings arrive from localStorage, from a link, or from a pasted backup — all
   of them outside this page's control. Anything of the wrong shape is replaced
   by its default rather than allowed to break the render. */
function normalise(saved) {
  const base = defaults();
  const out = Object.assign({}, base);
  const was = (saved && typeof saved === "object" && !Array.isArray(saved)) ? saved : {};
  for (const key of Object.keys(base)) {
    const value = was[key];
    if (value === undefined) continue;
    if (typeof base[key] === "object") {
      if (value && typeof value === "object" && !Array.isArray(value)) out[key] = value;
    } else if (typeof value === typeof base[key]) {
      out[key] = value;
    }
  }
  for (const [key, allowed] of [["teacherName", ["short", "full"]],
                                ["subjectName", ["short", "full"]]]) {
    if (!allowed.includes(out[key])) out[key] = base[key];
  }
  if (!DATA.languages.some(l => l[0] === out.lang)) out.lang = DATA.lang;
  return out;
}

let state = defaults();
try {
  state = normalise(JSON.parse(localStorage.getItem(KEY) || "null"));
} catch (e) { /* corrupt or unavailable storage: fall back to defaults */ }
/* A link wins over what this browser had, since following one is a request to
   see that. The per-class bags merge rather than replace, so a link for one
   class does not wipe the choices made for a sibling's. */
{
  const shared = readUrl();
  if (shared) {
    const merged = normalise(Object.assign({}, state, shared));
    for (const bag of ["picks", "colors", "who", "events"]) {
      if (shared[bag]) merged[bag] = Object.assign({}, state[bag], shared[bag]);
    }
    state = merged;
    /* Keep what the link brought, so closing it and coming back later still
       shows the same timetable. */
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
}

/* ----- the address bar carries the settings -------------------------------
   Everything chosen lives in the fragment, so a bookmark keeps it and a link
   hands it to someone else. Only what differs from the defaults goes in, which
   keeps a typical link short — short enough to put in a QR code. The fragment
   never leaves the browser, so nothing is sent anywhere by carrying it. */
/* Declarations, not arrow constants: the state is read out of the address bar
   before this point in the file, and a const would still be in its dead zone. */
function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).split("+").join("-").split("/").join("_").split("=").join("");
}
function unb64url(code) {
  const padded = code.split("-").join("+").split("_").join("/");
  const binary = atob(padded + "===".slice((padded.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

function changedFromDefaults() {
  const base = defaults(), out = {};
  for (const key of Object.keys(base)) {
    if (JSON.stringify(state[key]) !== JSON.stringify(base[key])) out[key] = state[key];
  }
  return out;
}

function shareUrl() {
  const changed = changedFromDefaults();
  const bare = location.href.split("#")[0];
  return Object.keys(changed).length
    ? bare + "#s=" + b64url(JSON.stringify(changed)) : bare;
}

function readUrl() {
  const hash = location.hash.slice(1);
  if (!hash.startsWith("s=")) return null;
  try {
    const parsed = JSON.parse(unb64url(hash.slice(2)));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  try {
    const url = shareUrl();
    if (url !== location.href) history.replaceState(null, "", url);
  } catch (e) { /* a browser that will not rewrite the address bar: no matter */ }
};

/* Whose timetable this is: the name if one has been given, then the school and
   class. Shared by the heading, the browser tab and both print layouts so they
   can never drift apart. */
/* Provenance, and the fact that this is nobody's official page. Printed as well
   as shown: a sheet handed to someone else should say where it came from. */
function sourceUrl(school) {
  return "https://" + DATA.edupage + ".edupage.org/timetable/view.php?num=" + school.n;
}

/* Where this came from and when, next to what it is: all of it belongs in the
   heading rather than at the bottom of the page. */
function renderSubtitle(school) {
  const stamp = DATA.built ? esc(t("footer.built", DATA.built)) : "";
  const link = '<a href="' + esc(sourceUrl(school)) + '">' + esc(t("sourceLink")) + "</a>";
  /* school.v is the line the school configured to print under its own
     timetable — "Kehtivus: 24/08/2026-18/12/2026". Their text, so it stays in
     their language; the build drops it where they set a label and left it
     blank, so nothing shows a heading with nothing under it. */
  document.getElementById("subtitle").innerHTML =
    [esc(school.t), esc(school.v), link, stamp].filter(Boolean).join(" · ") +
    '<div class="unofficial">' + esc(t("footer.disclaimer")) + "</div>";
}

function renderFooter(school) {
  const stamp = DATA.built ? esc(t("footer.built", DATA.built)) : "";
  /* On paper the heading is gone, so the date it was read comes down here with
     the code that leads back to the page. On screen both live in the heading and
     the footer says only what the page is. */
  const bits = printing ? (stamp ? [stamp] : []) : [];
  /* Say so where it is true. A page that counts its readers should admit it,
     and this one only counts when it was built for a public address. */
  if (DATA.counts && !printing) bits.push(esc(t("footer.counts")));
  /* 36mm keeps a typical link at about half a millimetre per module, which a
     phone reads without ceremony. A link carrying many custom colours gets
     denser; it still scans, just less forgivingly. */
  const code = printing ? qrSvg(shareUrl(), "36mm") : "";
  document.getElementById("foot").innerHTML =
    '<div class="lines">' + bits.join("<br>") + "</div>" +
    (code ? '<div class="qrbox">' + code +
            '<div class="qrhint">' + esc(t("qrHint")) + "</div></div>" : "");
  document.getElementById("foot").classList.toggle("bare", printing && !bits.length);
}

/* What the heading and both printouts call this timetable. Each part can be
   switched off or written differently — a school's official name is not always
   the one a family uses — and the heading updates as it is typed, so the effect
   is visible before anything is printed. */
function titleParts(school, cls) {
  return {
    who: (perClass("who") || "").trim(),
    school: (perClass("titleSchool") || "").trim() || school.l,
    klass: (perClass("titleClass") || "").trim() || t("classN", cls.n),
  };
}

function displayTitle(school, cls) {
  const part = titleParts(school, cls);
  const right = [state.showSchool ? part.school : "", state.showClass ? part.klass : ""]
                  .filter(Boolean).join(", ");
  return [state.showWho ? part.who : "", right].filter(Boolean).join(" — ");
}

/* Interface strings only; anything from the timetable stays in the language
   the school entered it in. */
function t(key) {
  const table = DATA.strings[state.lang] || DATA.strings.en;
  let out = table[key];
  if (out === undefined) out = DATA.strings.en[key];
  if (out === undefined) return key;
  for (let i = 1; i < arguments.length; i++) {
    out = out.split("{" + (i - 1) + "}").join(arguments[i]);
  }
  return out;
}
/* Weekday names follow the interface language; the timetable only supplies
   its own, so fall back to those when a translation is missing. */
function dayLabel(school, idx) {
  const table = DATA.strings[state.lang] || DATA.strings.en;
  const own = (school.d.find(d => d.i === idx) || {}).n;
  if (state.lang === "et" && own) return own;
  return (table.days || [])[idx] || own || String(idx);
}

function applyStrings() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function currentSchool() {
  return SCHOOLS.find(s => s.n === state.school) || SCHOOLS[0];
}
function currentClass() {
  const school = currentSchool();
  return school.c.find(c => c.n === state.klass) || school.c[0];
}
/* Group choices belong to a class, not to the reader, so they are stored per
   school+class and survive switching back and forth. */
function picksKey() { return currentSchool().n + "/" + currentClass().n; }
function picks() { return perClass("picks"); }

function readable(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg || "");
  if (!m) return "#14171A";
  const n = parseInt(m[1], 16);
  const ch = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * ch(n >> 16 & 255) + 0.7152 * ch(n >> 8 & 255) + 0.0722 * ch(n & 255);
  const dark = 0.00778;   // luminance of #14171A
  const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return cr(L, dark) >= cr(L, 1) ? "#14171A" : "#FFFFFF";
}
function colorFor(subject) {
  if (state.customColours && state.colors[subject]) {
    const bg = state.colors[subject];
    return { bg: bg, fg: readable(bg) };
  }
  if (state.schoolColors) {
    const bg = (DATA.subjects[subject] || {}).color;
    if (bg) return { bg: bg, fg: readable(bg) };
  }
  return DATA.palette[subject] || { bg: "#EEEEEE", fg: "#14171A" };
}

/* A lesson is mine when every division it belongs to matches one of my picks.
   Whole-class lessons carry no groups and are always mine. */
function visible(entry, mine, divisions) {
  if (!entry.g.length) return true;
  if (!Object.values(mine).filter(Boolean).length) return true;
  for (const div of divisions) {
    if (!entry.g.some(g => div.groups.includes(g))) continue;
    const pick = mine[div.id];
    if (pick && !entry.g.includes(pick)) return false;
  }
  return true;
}

/* ----- my own events -------------------------------------------------------
   One per line: <weekday> <start>-<end> <colour> <label>
       Mon 17:15-18:15 orange Dance training                                  */
const WEEKDAYS = {};
[["mon","monday","esmaspäev","esmaspaev","es","e","m","mo"],
 ["tue","tues","tuesday","teisipäev","teisipaev","te","t","tu"],
 ["wed","wednesday","kolmapäev","kolmapaev","ko","k","w","we"],
 ["thu","thur","thurs","thursday","neljapäev","neljapaev","ne","n","th"],
 ["fri","friday","reede","re","r","f","fr"],
 ["sat","saturday","laupäev","laupaev","la","l","sa"],
 ["sun","sunday","pühapäev","puhapaev","pü","py","p","su"]]
  .forEach((names, i) => names.forEach(n => { WEEKDAYS[n] = i; }));

const DAY_NAMES_ET = ["Esmaspäev","Teisipäev","Kolmapäev","Neljapäev","Reede",
                      "Laupäev","Pühapäev"];
const LINE_RE = /^(\\S+)\\s+(\\d{1,2})[:.](\\d{2})\\s*[-–—]\\s*(\\d{1,2})[:.](\\d{2})\\s+(\\S+)\\s+(.+?)\\s*$/;

const isColour = (c) => !!(window.CSS && CSS.supports && CSS.supports("color", c));

/* The colour column is either a background on its own, or a foreground and a
   background split by a slash: "#333333/#dddddd". Only a slash between whole
   colours counts, so the one inside "rgb(0,0,0/50%)" is left alone. */
function splitColours(token) {
  let depth = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "/" && depth === 0) return [token.slice(0, i), token.slice(i + 1)];
  }
  return [null, token];
}

/* What an event writes with: its own foreground if it named one, otherwise
   whichever of black or white reads better on its background. */
function eventFg(ev) { return ev.fg || readable(cssColour(ev.bg)); }

function parseEvents(text) {
  const out = [], errors = [];
  String(text == null ? "" : text).split("\\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = LINE_RE.exec(line);
    if (!m) { errors.push(t("events.line", i + 1, t("events.syntax"))); return; }
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day === undefined) {
      errors.push(t("events.line", i + 1, t("events.badDay", JSON.stringify(m[1])))); return;
    }
    const h1 = +m[2], n1 = +m[3], h2 = +m[4], n2 = +m[5];
    if (h1 > 23 || h2 > 23 || n1 > 59 || n2 > 59) {
      errors.push(t("events.line", i + 1, t("events.badRange"))); return;
    }
    const start = h1 * 60 + n1, end = h2 * 60 + n2;
    if (!(end > start)) { errors.push(t("events.line", i + 1, t("events.backwards"))); return; }
    const pair = splitColours(m[6]);
    const bad = pair.filter(c => c !== null).find(c => !isColour(c));
    if (bad !== undefined) {
      errors.push(t("events.line", i + 1, t("events.badColour", JSON.stringify(bad))));
      return;
    }
    out.push({ day: day, a: start, z: end, fg: pair[0], bg: pair[1],
               label: m[7], mine: true });
  });
  return { events: out, errors: errors };
}

/* Overlapping boxes share the column's width, the way a calendar does. */
function pack(items) {
  const sorted = items.slice().sort((p, q) => p.a - q.a || q.z - p.z);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const lanes = [];
    for (const it of cluster) {
      let lane = lanes.findIndex(end => end <= it.a);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = it.z;
      it._lane = lane;
    }
    for (const it of cluster) it._lanes = lanes.length;
    cluster = [];
  };
  for (const it of sorted) {
    if (it.a >= clusterEnd && cluster.length) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.z);
  }
  flush();
  return sorted;
}

const hhmm = (m) => Math.floor(m / 60) + "." + String(m % 60).padStart(2, "0");

/* The days a view shows: the ones the timetable has, plus any weekend a
   personal event lands on. */
function daysWith(school, mine) {
  const idx = school.d.map(d => d.i);
  for (const ev of mine) if (!idx.includes(ev.day)) idx.push(ev.day);
  return idx.sort((a, b) => a - b);
}

function renderTimeline(school, cls, shown, mine, scale) {
  const dayIdx = daysWith(school, mine);

  const perDay = new Map(dayIdx.map(i => [i, []]));
  for (const e of shown) {
    if (e.a == null) continue;
    perDay.get(e.d).push({ a: e.a, z: e.z, lesson: e });
  }
  for (const ev of mine) perDay.get(ev.day).push(ev);
  if (school.b) {
    for (const i of dayIdx) {
      const shape = cls.h[i];
      if (!shape) continue;
      for (const b of shape.b) {
        if (shape.s.length > b.a) perDay.get(i).push({ a: b.m, z: b.x, brk: b.n });
      }
    }
  }

  const all = [].concat(...[...perDay.values()]);
  if (!all.length) return '<p style="color:#6b7280">' + esc(t("nothing")) + "</p>";
  let lo = Math.min(...all.map(x => x.a)), hi = Math.max(...all.map(x => x.z));
  lo = Math.floor(lo / 30) * 30; hi = Math.ceil(hi / 30) * 30;
  const span = hi - lo;
  /* Pixels per minute. On screen a fixed, readable scale; on paper whatever
     fills the sheet, which the caller finds by measuring. */
  const ppm = scale || 1.05;
  const H = Math.round(span * ppm);

  /* Over the timetable rather than at the top of the page, and drawn the same
     way on screen as on paper: whatever is typed into the title fields shows up
     here at once, which is the only way to see what will print. */
  const named = displayTitle(school, cls);
  let h = named ? '<div class="ptitle sheet">' + esc(named) + "</div>" : "";
  h += '<div class="tl" style="--ppm:' + ppm + ";--half:" + (30 * ppm) +
          "px;--hour:" + (60 * ppm) + 'px">';
  h += '<div class="tlhead"><div class="cell gut"></div>' +
       dayIdx.map(i => '<div class="cell">' + esc(dayLabel(school, i)) + "</div>").join("") +
       "</div>";
  /* height covers the padding too, so the ruled area is exactly H tall and the
     first and last labels have somewhere to hang. */
  h += '<div class="tlbody" style="height:' + (H + 20) + 'px">';
  h += '<div class="tlaxis">';
  for (let t = lo; t <= hi; t += 30) {
    const cls2 = t % 60 === 0 ? "t hour" : "t";
    h += '<div class="' + cls2 + '" style="top:' + Math.round((t - lo) * ppm) + 'px">' +
         esc(hhmm(t)) + "</div>";
  }
  h += "</div>";

  /* Where a box sits in its column. Lessons and breaks share the full width
     between them; a personal event is drawn afterwards, over the top, so it
     never squeezes the timetable — which is what makes it usable for marking
     something out inside a break.
     It is inset only where there is something underneath worth glimpsing. An
     event in an empty evening covers nothing, so narrowing it there would look
     like a mistake rather than a layer. */
  const place = (it, inset) => {
    const lanes = it._lanes || 1, lane = it._lane || 0;
    const each = (100 - inset) / lanes;
    return "top:" + Math.round((it.a - lo) * ppm) +
           "px;height:" + Math.max(14, Math.round((it.z - it.a) * ppm) - 1) +
           "px;left:calc(" + (inset + lane * each) + "% + 2px);width:calc(" + each + "% - 4px);";
  };

  for (const i of dayIdx) {
    h += '<div class="tlcol">';
    const items = perDay.get(i);
    for (const it of pack(items.filter(x => !x.mine))) {
      const height = Math.max(14, Math.round((it.z - it.a) * ppm) - 1);
      const geom = place(it, 0);
      const when = hhmm(it.a) + "–" + hhmm(it.z);
      if (it.brk) {
        h += '<div class="ev brk" style="' + geom + '" title="' +
             esc(it.brk + "\\n" + when) +
             '"><div class="what">' + esc(it.brk.split(",")[0]) + "</div>" +
             (height >= 30 ? '<div class="when">' + esc(when) + "</div>" : "") + "</div>";
        continue;
      }
      const e = it.lesson, col = colorFor(e.s), info = DATA.subjects[e.s] || {};
      const meta = detailLine(e);
      const tip = [subjectName(e, false), e.g.join("/"), e.T.join(" / "),
                   e.r.join(" / "), when, e.u > 1 ? t("paired") : t("single"),
                   e.o ? t("noExactTime") : ""].filter(Boolean).join("\\n");
      const name = lessonTitle(e);
      let body = '<div class="when">' + esc(when) + (e.o ? " ?" : "") + "</div>" +
                 '<div class="what">' + esc(name) + "</div>";
      if (height >= 54 && meta.length) {
        body += '<div class="who2">' + esc(meta.join(" · ")) + "</div>";
      }
      h += '<div class="ev' + (height < 40 ? " tight" : "") + (e.o ? " approx" : "") +
           '" data-subject="' + esc(e.s) + '" style="' + geom + "background:" + col.bg +
           ";color:" + col.fg + '" title="' + esc(tip) + '">' + body + "</div>";
    }
    /* The layer on top. Events are packed among themselves, so two of them at
       once still sit side by side rather than hiding one another. */
    const base = items.filter(x => !x.mine);
    for (const it of pack(items.filter(x => x.mine))) {
      const over = base.some(x => x.a < it.z && it.a < x.z);
      const height = Math.max(14, Math.round((it.z - it.a) * ppm) - 1);
      const when = hhmm(it.a) + "–" + hhmm(it.z);
      const fg = eventFg(it);
      /* A twenty-minute box has room for one line, so the time joins the label
         rather than pushing it out of sight. */
      const body = height >= 30
        ? '<div class="when">' + esc(when) + "</div>" +
          '<div class="what">' + esc(it.label) + "</div>"
        : '<div class="what">' + esc(when + " " + it.label) + "</div>";
      h += '<div class="ev mine' + (height < 40 ? " tight" : "") + '" style="' +
           place(it, over ? 16 : 0) + "background:" + it.bg + ";color:" + fg + ";border-color:" +
           (it.fg ? fg : "rgba(0,0,0,.34)") + '" title="' +
           esc(it.label + "\\n" + when) + '">' + body + "</div>";
    }
    h += "</div>";
  }
  return h + "</div></div>";
}

/* The link as a QR code, so a printed sheet can be picked back up on a phone
   with every choice still on it. Drawn as squares rather than an image: it has
   to survive a printer at whatever size the sheet allows. */
function qrSvg(text, side) {
  let code;
  try {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    code = qrcode(0, "M");
    code.addData(text);
    code.make();
  } catch (e) {
    return "";                    // too long to encode: the link still works
  }
  const n = code.getModuleCount(), quiet = 4, span = n + quiet * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (code.isDark(r, c)) path += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
    }
  }
  return '<svg class="qr" width="' + side + '" height="' + side + '" viewBox="0 0 ' +
         span + " " + span + '" shape-rendering="crispEdges" role="img">' +
         '<rect width="' + span + '" height="' + span + '" fill="#fff"/>' +
         '<path d="' + path + '" fill="#000"/></svg>';
}

/* Named CSS colours have to become hex before luminance can be measured. */
const _swatch = document.createElement("span");
function cssColour(value) {
  _swatch.style.color = "";
  _swatch.style.color = value;
  document.body.appendChild(_swatch);
  const rgb = getComputedStyle(_swatch).color;
  document.body.removeChild(_swatch);
  const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(rgb);
  if (!m) return "#888888";
  return "#" + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, "0")).join("");
}

/* Slot view is the school's own day plan: one cell per lesson however many
   periods it spans, with the named breaks in fixed columns. Period view is the
   raw aSc grid, where a paired lesson repeats with its continuation dimmed. */
/* The timeline is the view. A school with no day plan has no times to draw one
   from — three of the four here publish none — so those fall back to the aSc
   period grid rather than rendering nothing. Nothing to choose; the data
   decides. */
const onTimeline = () => currentSchool().b;
/* What goes on a lesson's second line: room, teacher and group are each
   independently switchable, so the box can be as dense or as bare as wanted. */
function detailLine(e) {
  const bits = [];
  if (state.showRoom && e.r.length) bits.push(e.r.join(" / "));
  const who3 = teacherText(e);
  if (who3) bits.push(who3);
  if (state.showGroup && e.g.length) bits.push(e.g.join("/"));
  return bits;
}

/* What to call a lesson. A block the school publishes as one but which holds
   two subjects in sequence names both, in the order they run; the colour and the
   legend still follow the one subject the box is keyed to. */
function subjectName(e, short) {
  const one = (name) => short ? ((DATA.subjects[name] || {}).short || name) : name;
  return (e.S && e.S.length ? e.S : [e.s]).map(one).join(" + ");
}

/* The subject as the reader asked to see it, or nothing at all. */
function lessonTitle(e) {
  if (!state.showSubject) return "";
  return subjectName(e, state.subjectName === "short");
}

/* Teacher names: the school's abbreviation, the full name, or neither. */
function teacherText(e) {
  if (!state.showTeacher) return "";
  const names = state.teacherName === "full" ? e.T : e.t;
  return (names || []).join(" / ");
}

const perClass = (bag) => {
  if (!state[bag] || typeof state[bag] !== "object") state[bag] = {};
  const key = picksKey(), got = state[bag][key];
  const ok = bag === "picks" ? (got && typeof got === "object") : typeof got === "string";
  if (!ok) state[bag][key] = bag === "picks" ? {} : "";
  return state[bag][key];
};

/* A personal event belongs to no slot, so the table gives it a column of its
   own rather than pretending it is a lesson. */
function mineCell(list) {
  if (!list.length) return "<td></td>";
  return "<td>" + list.slice().sort((p, q) => p.a - q.a).map(ev =>
    '<div class="lesson" style="background:' + ev.bg + ";color:" + eventFg(ev) +
    ";border:1px solid " + (ev.fg || "transparent") +
    '"><div class="name">' + esc(ev.label) + "</div>" +
    '<div class="time">' + esc(hhmm(ev.a) + "–" + hhmm(ev.z)) +
    "</div></div>").join("") + "</td>";
}

function lessonHtml(e, time) {
  const meta = detailLine(e);
  const label = lessonTitle(e);
  const note = e.o ? t("noExactTime") : "";
  const tip = [subjectName(e, false), e.g.join("/"), e.T.join(" / "), e.r.join(" / "),
               time, e.u > 1 ? t("paired") : t("single"), note]
              .filter(Boolean).join("\\n");
  const col = colorFor(e.s);
  return '<div class="lesson' + (e.c ? " cont" : "") + '" data-subject="' + esc(e.s) +
    '" style="background:' + col.bg + ";color:" + col.fg + '" title="' + esc(tip) + '">' +
    '<div class="name">' + esc(label) + "</div>" +
    ((time || e.o)
        ? '<div class="time">' + (e.o ? esc(t("noTimeShort")) : esc(time)) + "</div>" : "") +
    (meta.length ? '<div class="meta">' + esc(meta.join(" · ")) + "</div>" : "") +
    "</div>";
}

/* Columns are slots plus the named breaks that sit between them, or aSc
   periods when slot mode is off. */
function columnModel(school, cls) {
  if (!onTimeline()) return school.p.map(p => ({ kind: "period", p: p }));
  const cols = [];
  for (let n = 1; n <= cls.m; n++) {
    cols.push({ kind: "slot", n: n });
    if (school.bs.includes(n) && n < cls.m) cols.push({ kind: "break", after: n });
  }
  return cols;
}

function columnLabel(school, cls, col) {
  if (col.kind === "period") {
    if (!school.ts) return esc(col.p.l);
    return esc(col.p.l) + '<br><span class="slottime">' + esc(col.p.s + "–" + col.p.e) + "</span>";
  }
  if (col.kind === "slot") {
    /* Show the time in the header when every day agrees on it, which is the
       case for the slots before the day plan starts branching. */
    const times = cls.e.filter(e => e.k === col.n && e.w).map(e => e.w);
    const same = times.length && times.every(t => t === times[0]);
    return String(col.n) + (same ? '<br><span class="slottime">' + esc(times[0]) + "</span>" : "");
  }
  const name = (Object.values(cls.h).flatMap(v => v.b).find(b => b.a === col.after) || {}).n || "";
  return esc(name.split(",")[0]);
}

function bodyCell(cls, dayIdx, col, bucket) {
  if (col.kind === "break") {
    const shape = cls.h[dayIdx];
    const brk = shape && shape.b.find(b => b.a === col.after);
    const hasLater = shape && shape.s.length > col.after;
    if (!brk || !hasLater) return '<td class="brk"></td>';
    return '<td class="brk"><div class="time">' + esc(brk.s + "–" + brk.e) + "</div></td>";
  }
  if (col.kind === "period") {
    return "<td>" + (bucket.get(dayIdx + ":p" + col.p.n) || [])
      .map(e => lessonHtml(e, e.c ? "" : e.w)).join("") + "</td>";
  }
  const shape = cls.h[dayIdx];
  const slot = shape && shape.s[col.n - 1];
  const time = slot && slot.a ? slot.a + "–" + slot.z : "";
  const here = bucket.get(dayIdx + ":s" + col.n) || [];
  if (!here.length) return "<td></td>";
  return "<td>" + here.map(e => lessonHtml(e, e.w || time)).join("") + "</td>";
}

/* One landscape sheet is the whole point of this view, and how tall a row
   wants to be depends on the class — several lessons in one cell, a canteen
   sitting spelled out inside a break, a row of personal events. So the rows are
   measured as they lie on screen and the padding that still fits the sheet is
   solved for, rather than guessed from how many rows there are. */
const SHEET_H = 726;              // 210mm less two 9mm margins, at 96dpi

/* Keep the printout on one landscape sheet whatever the class throws at it —
   several lessons in one cell, a canteen sitting spelled out inside a break, a
   row of personal events. Air goes first: the rows give up their padding down
   to a floor, and only then does the type step down. The view on screen is laid
   out at the size of the sheet, so this measures the real thing. */
/* The largest scale at which the day still fits one sheet, footer and all.
   Found by drawing it and measuring rather than by arithmetic on constants: the
   footer changes size with the QR code and the language, and a guess that was
   right once quietly stops being right. */
function fitTimeline(school, cls, shown, mine) {
  const grid = document.getElementById("grid");
  const keep = grid.innerHTML;
  let small = 0.4, big = 3.0;
  for (let step = 0; step < 9; step++) {
    const mid = (small + big) / 2;
    grid.innerHTML = renderTimeline(school, cls, shown, mine, mid);
    const used = grid.getBoundingClientRect().height + footHeight();
    /* A few pixels in hand: the print layout rounds differently from the screen
       one, and landing exactly on the limit means landing just past it. */
    if (used <= SHEET_H - 8) small = mid; else big = mid;
  }
  grid.innerHTML = keep;
  return small;
}

/* Outer height of the footer, margins included: the sheet has to hold it, and
   getBoundingClientRect leaves margins out. */
function footHeight() {
  const f = document.getElementById("foot");
  if (!f) return 0;
  const s = getComputedStyle(f);
  return f.getBoundingClientRect().height +
         (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0);
}

function fitPrint() {
  const t = document.querySelector("#grid .ptbl");
  if (!t) return;
  const room = SHEET_H - footHeight();
  const fits = () => t.getBoundingClientRect().height <= room;
  for (let font = 12.5; ; font -= 0.75) {
    t.style.setProperty("--pfont", font + "px");
    for (let pad = 15; pad >= 3; pad--) {
      t.style.setProperty("--ppad", pad + "px");
      if (fits()) return;
    }
    if (font <= 8) return;        // as small as this view is willing to go
  }
}

/* The school's own printout: slots down the side with one Aeg column, days
   across, breaks as their own rows. Where a day departs from the usual time,
   the cell carries its own — the same convention the paper versions use. */
function renderPrint(school, cls, shown, mine) {
  const bucket = new Map();
  for (const e of shown) {
    const k = e.d + ":s" + e.k;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(e);
  }
  const dayIdx = daysWith(school, mine);
  const title = displayTitle(school, cls);

  let h = '<table class="ptbl"><thead>';
  h += '<tr><th class="corner"></th><th class="ptitle" colspan="' + (dayIdx.length + 1) + '">' +
       esc(title) + "</th></tr>";
  h += '<tr><th class="corner"></th><th class="phead">' + esc(t("time")) + "</th>" +
       dayIdx.map(i => '<th class="phead">' + esc(dayLabel(school, i)) + "</th>").join("") + "</tr>";
  h += "</thead><tbody>";

  for (let n = 1; n <= cls.m; n++) {
    const usual = (cls.y.slots || {})[n] || "";
    h += '<tr><th class="pnum">' + n + '</th><th class="ptime">' + esc(usual) + "</th>";
    for (const i of dayIdx) {
      const here = bucket.get(i + ":s" + n) || [];
      if (!here.length) { h += "<td></td>"; continue; }
      const col = colorFor(here[0].s);
      const body = here.map(e => {
        const room = e.r.length ? " (" + e.r.join("/") + ")" : "";
        const shown = subjectName(e, false);
        const when = e.o ? "" : (e.w && e.w !== usual
          ? '<br><span class="pwhen">(' + esc(e.w) + ")</span>" : "");
        return esc(shown + room) + when;
      }).join("<br>");
      h += '<td class="pcell" data-subject="' + esc(here[0].s) + '" style="background:' +
           col.bg + ";color:" + col.fg + '">' + body + "</td>";
    }
    h += "</tr>";
    if (!school.bs.includes(n) || n >= cls.m) continue;
    const usualBreak = (cls.y.breaks || {})[n] || "";
    const name = (Object.values(cls.h).flatMap(v => v.b).find(b => b.a === n) || {}).n || "";
    h += '<tr><th class="corner"></th><th class="ptime">' + esc(usualBreak) + "</th>";
    for (const i of dayIdx) {
      const shape = cls.h[i];
      const brk = shape && shape.b.find(b => b.a === n);
      if (!brk || !(shape.s.length > n)) { h += "<td></td>"; continue; }
      const own = brk.s + "–" + brk.e;
      h += '<td class="pbreak">' + esc(name.split(",")[0]) +
           (own !== usualBreak ? '<br><span class="pwhen">(' + esc(own) + ")</span>" : "") +
           "</td>";
    }
    h += "</tr>";
  }
  if (mine.length) {
    h += '<tr><th class="corner"></th><th class="ptime">' + esc(t("mineCol")) + "</th>";
    for (const i of dayIdx) {
      const list = mine.filter(ev => ev.day === i).sort((p, q) => p.a - q.a);
      if (!list.length) { h += "<td></td>"; continue; }
      h += '<td class="pcell" style="padding:0">' + list.map(ev =>
        '<div style="padding:3px 4px;background:' + ev.bg + ";color:" + eventFg(ev) +
        '">' + esc(ev.label) +
        '<br><span class="pwhen">(' + esc(hhmm(ev.a) + "–" + hhmm(ev.z)) +
        ")</span></div>").join("") + "</td>";
    }
    h += "</tr>";
  }
  return h + "</tbody></table>";
}

/* Repaint the grid but leave the legend alone. Its colour inputs are live DOM
   nodes, and replacing one while the native picker is open closes the picker —
   which made the swatches impossible to use. */
let keepLegend = false;
let printing = false;
function paint() {
  keepLegend = true;
  try { render(); } finally { keepLegend = false; }
}

function render() {
  const school = currentSchool(), cls = currentClass();
  state.school = school.n; state.klass = cls.n;
  syncDisplayControls();
  syncPerClassInputs();

  renderFooter(school);
  document.title = displayTitle(school, cls) || t("classN", cls.n);
  renderSubtitle(school);

  const mine = picks();
  const timeline = onTimeline();
  const shown = cls.e.filter(e => visible(e, mine, cls.v))
                     .filter(e => !timeline || !e.c);   // one box per lesson
  const bucket = new Map();
  for (const e of shown) {
    const k = timeline ? e.d + ":s" + e.k : e.d + ":p" + e.p;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(e);
  }

  const parsed = parseEvents(perClass("events"));
  document.getElementById("evwarn").textContent = parsed.errors.join("\\n");

  if (printing && timeline) document.body.classList.add("printview");
  else document.body.classList.remove("printview");

  if (timeline) {
    document.getElementById("grid").innerHTML =
      renderTimeline(school, cls, shown, parsed.events,
                     printing ? fitTimeline(school, cls, shown, parsed.events) : 0);
    document.getElementById("count").textContent =
      t("lessonCount", shown.length) + (parsed.events.length ?
        " · " + t("mineCount", parsed.events.length) : "");
    if (!keepLegend) renderLegend(shown);
    return;
  }

  const cols = columnModel(school, cls);
  const dayIdx = daysWith(school, parsed.events);
  const anyMine = parsed.events.length > 0;
  let h = "<table><thead><tr><th></th>";
  {
    for (const col of cols) {
      const cls2 = col.kind === "break" ? ' class="brk"' : "";
      h += "<th" + cls2 + ">" + columnLabel(school, cls, col) + "</th>";
    }
    if (anyMine) h += "<th>" + esc(t("mineCol")) + "</th>";
    h += "</tr></thead><tbody>";
    for (const i of dayIdx) {
      h += "<tr><th>" + esc(dayLabel(school, i)) + "</th>";
      for (const col of cols) h += bodyCell(cls, i, col, bucket);
      if (anyMine) h += mineCell(parsed.events.filter(ev => ev.day === i));
      h += "</tr>";
    }
  }
  document.getElementById("grid").innerHTML = h + "</tbody></table>";

  const total = cls.e.filter(e => !timeline || !e.c).length;
  document.getElementById("count").textContent =
    t(timeline ? "lessonsShown" : "slotsShown", shown.length, total) +
    (shown.length === total ? " " + t("noFilter") : "") +
    (parsed.events.length ? " · " + t("mineCount", parsed.events.length) : "") +
    (school.b ? "" : " · " + t("noBells"));
  if (!keepLegend) renderLegend(shown);
}

function setColour(subject, value) {
  state.colors[subject] = value;
  state.customColours = true;      // choosing one is asking for them
  document.getElementById("customColours").checked = true;
  save();
  paint();
  const swatch = [...document.querySelectorAll("#legend input[type=color]")]
                   .find(x => x.dataset.subject === subject);
  if (swatch && swatch.value !== value) swatch.value = value;
}

function renderLegend(shown) {
  document.getElementById("colourHint").textContent = t("colourHint");
  document.getElementById("share").title = t("shareHint");
  const used = [...new Set(shown.map(e => e.s))].sort();
  document.getElementById("legend").innerHTML = used.map(s =>
    '<span class="item"><input type="color" data-subject="' + esc(s) + '" value="' +
    colorFor(s).bg + '">' + esc(s) + "</span>").join("");
  document.querySelectorAll("#legend input[type=color]").forEach(inp => {
    inp.addEventListener("input", () => {
      setColour(inp.dataset.subject, inp.value);
    });
  });
}

function renderLanguages() {
  const sel = document.getElementById("lang");
  sel.innerHTML = DATA.languages.map(l =>
    '<option value="' + esc(l[0]) + '"' + (l[0] === state.lang ? " selected" : "") +
    ">" + esc(l[1]) + "</option>").join("");
}

function renderSchools() {
  const sel = document.getElementById("school");
  sel.innerHTML = SCHOOLS.map(s =>
    '<option value="' + esc(s.n) + '"' + (s.n === currentSchool().n ? " selected" : "") +
    ' title="' + esc(s.t) + '">' + esc(s.l) + "</option>").join("");
}

function renderClasses() {
  const sel = document.getElementById("klass");
  sel.innerHTML = currentSchool().c.map(c =>
    '<option value="' + esc(c.n) + '"' + (c.n === currentClass().n ? " selected" : "") +
    ">" + esc(c.n) + "</option>").join("");
}

function renderDivisions() {
  const host = document.getElementById("divisions");
  const cls = currentClass(), mine = picks();
  document.getElementById("groupsRow").hidden = !cls.v.length;
  if (!cls.v.length) {
    host.innerHTML = "";
    return;
  }
  /* The heading says what is taught in the group. Divisions carrying more
     subjects than fit are shortened with an ellipsis, and the whole list is the
     label's tooltip. */
  host.innerHTML = cls.v.map(d => {
    const head = d.l || d.groups.join(" / ");
    const full = (d.sj || []).join(", ");
    return '<div class="field"><label' + (full ? ' title="' + esc(full) + '"' : "") + ">" +
    esc(head) +
    (d.l ? '<br><span class="divsub">' + esc(d.groups.join(" / ")) + "</span>" : "") +
    "</label>" +
    '<select data-div="' + esc(d.id) + '"><option value="">' + esc(t("all")) + "</option>" +
    d.groups.map(g => '<option value="' + esc(g) + '"' +
      (mine[d.id] === g ? " selected" : "") + ">" + esc(g) + "</option>").join("") +
    "</select></div>";
  }).join("");
  host.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", () => {
      picks()[sel.dataset.div] = sel.value;
      save(); render();
    });
  });
}

document.getElementById("school").addEventListener("change", (ev) => {
  state.school = ev.target.value;
  state.klass = currentSchool().c[0].n;   // class lists differ between schools
  save(); renderClasses(); renderDivisions(); syncPerClassInputs(); render();
});
document.getElementById("klass").addEventListener("change", (ev) => {
  state.klass = ev.target.value;
  save(); renderDivisions(); syncPerClassInputs(); render();
});

function bindToggle(id, key) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => { state[key] = el.checked; save(); render(); });
}
function bindChoice(name, key) {
  document.querySelectorAll('input[name="' + name + '"]').forEach(radio => {
    radio.addEventListener("change", () => {
      if (radio.checked) { state[key] = radio.value; save(); render(); }
    });
  });
}
["showWho", "showSchool", "showClass",
 "showTeacher", "showRoom", "showGroup", "showSubject",
 "schoolColors", "customColours"].forEach(key => bindToggle(key, key));
bindChoice("teacherName", "teacherName");
bindChoice("subjectName", "subjectName");

/* The controls follow the state, and the two that only make sense alongside
   something else — how to write a name, which colours to pick — dim or vanish
   when that something is switched off. */
function syncDisplayControls() {
  for (const key of ["showWho", "showSchool", "showClass",
                     "showTeacher", "showRoom", "showGroup", "showSubject",
                     "schoolColors", "customColours"]) {
    document.getElementById(key).checked = !!state[key];
  }
  for (const [name, key] of [["teacherName", "teacherName"], ["subjectName", "subjectName"]]) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(radio => {
      radio.checked = radio.value === state[key];
    });
  }
  document.getElementById("teacherChoice").classList.toggle("off", !state.showTeacher);
  document.getElementById("subjectChoice").classList.toggle("off", !state.showSubject);
  document.getElementById("colourPicker").classList.toggle("off", !state.customColours);
}
/* Clicking a lesson opens a colour picker anchored under it. The input is a
   permanent hidden node, so nothing rebuilds it while the picker is open. */
const pick = document.getElementById("pick");
document.getElementById("grid").addEventListener("click", (ev) => {
  const box = ev.target.closest("[data-subject]");
  if (!box) return;
  const subject = box.dataset.subject;
  const rect = box.getBoundingClientRect();
  pick.style.left = (rect.left + window.scrollX) + "px";
  pick.style.top = (rect.bottom + window.scrollY) + "px";
  pick.dataset.subject = subject;
  pick.value = colorFor(subject).bg;
  pick.click();
});
pick.addEventListener("input", () => setColour(pick.dataset.subject, pick.value));
/* The colour panel keeps the keyboard while it is open. Hand focus back when it
   closes, so the next thing typed goes to the page and not into a dead input. */
pick.addEventListener("change", () => pick.blur());

document.getElementById("lang").addEventListener("change", (ev) => {
  state.lang = ev.target.value;
  save(); applyStrings(); renderDivisions(); render();
});

document.getElementById("reset").addEventListener("click", () => {
  const { school, klass, lang } = state;
  state = Object.assign(defaults(), { school, klass, lang });
  save();
  renderDivisions(); render();
});

/* Everything the reader has customised — group picks, colours, personal
   events, names, display options — is just `state`, so a backup is that object.
   It is filled in when the section is opened, not kept in step continuously. */
const advancedPanel = document.getElementById("advancedPanel");
const settingsText = document.getElementById("settingsText");
const settingsMsg = document.getElementById("settingsMsg");

advancedPanel.addEventListener("toggle", () => {
  if (advancedPanel.open) {
    settingsText.value = JSON.stringify(state, null, 2);
    settingsMsg.textContent = "";
  }
});
/* Sharing is copying the address, since the address is the whole configuration. */
document.getElementById("share").addEventListener("click", async () => {
  const button = document.getElementById("share");
  try {
    await navigator.clipboard.writeText(shareUrl());
    button.textContent = t("shared");
  } catch (e) {
    button.textContent = t("settings.selected");
  }
  button.title = t("shareHint");
  setTimeout(() => { button.textContent = t("share"); }, 2500);
});
document.getElementById("copySettings").addEventListener("click", async () => {
  settingsText.value = JSON.stringify(state, null, 2);
  try {
    await navigator.clipboard.writeText(settingsText.value);
    settingsMsg.textContent = t("settings.copied");
  } catch (e) {
    settingsText.select();
    settingsMsg.textContent = t("settings.selected");
  }
});
document.getElementById("applySettings").addEventListener("click", () => {
  let incoming;
  try {
    incoming = JSON.parse(settingsText.value);
  } catch (e) {
    settingsMsg.textContent = t("settings.badJson", e.message);
    return;
  }
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    settingsMsg.textContent = t("settings.notObject");
    return;
  }
  state = normalise(incoming);
  if (!SCHOOLS.some(x => x.n === state.school)) state.school = DATA.initialSchool;
  if (!currentSchool().c.some(c => c.n === state.klass)) state.klass = currentSchool().c[0].n;
  save();
  for (const [id, key] of [["print", "print"], ["transpose", "transpose"],
                           ["schoolColors", "schoolColors"], ["compact", "compact"],
                           ["showRoom", "showRoom"], ["showGroup", "showGroup"]]) {
    document.getElementById(id).checked = !!state[key];
  }
  renderLanguages(); renderSchools(); renderClasses();
  applyStrings(); renderDivisions(); syncPerClassInputs(); render();
  settingsMsg.textContent = t("settings.applied");
});

/* Text fields keep the state up to date on every keystroke but only repaint on
   a short timer, so a long line is never typed against a redraw. The redraw
   leaves the legend alone as well: rebuilding it would close an open picker. */
/* Typing into a field whose line is switched off would do nothing visible, so
   writing something turns it back on. Clearing it does not turn it off again:
   emptying a box is not the same as asking for the line to go away. */
function reveal(key) {
  if (!key || state[key]) return;
  state[key] = true;
  const box = document.getElementById(key);
  if (box) box.checked = true;
}

function typed(el, bag, shows) {
  let timer = 0;
  el.addEventListener("input", () => {
    state[bag][picksKey()] = el.value;
    if (el.value.trim()) reveal(shows);
    save();
    clearTimeout(timer);
    timer = setTimeout(paint, 150);
  });
}
const who = document.getElementById("who");
const eventsBox = document.getElementById("events");
const titleSchool = document.getElementById("titleSchool");
const titleClass = document.getElementById("titleClass");
typed(who, "who", "showWho");
typed(eventsBox, "events");
typed(titleSchool, "titleSchool", "showSchool");
typed(titleClass, "titleClass", "showClass");

/* These two show what the timetable calls itself until someone types over it.
   An empty box would mean retyping the whole name to change one word, so
   entering the field fills in what is currently shown; leaving it having
   changed nothing empties it again, so the setting stays unset and the shared
   link stays short. */
for (const [field, key, shows] of [[titleSchool, "titleSchool", "showSchool"],
                                   [titleClass, "titleClass", "showClass"]]) {
  field.addEventListener("focus", () => {
    if (!field.value) field.value = field.placeholder;
  });
  field.addEventListener("blur", () => {
    if (field.value.trim() === field.placeholder) field.value = "";
    if (field.value !== perClass(key)) {
      state[key][picksKey()] = field.value;
      if (field.value.trim()) reveal(shows);
      save();
      paint();
    }
  });
}
/* Never write over a field the reader is in the middle of typing into. The two
   title fields show what the timetable calls itself until someone types over
   it, so an empty box and the school's own wording look the same. */
function syncPerClassInputs() {
  const school = currentSchool(), cls = currentClass();
  if (document.activeElement !== who) who.value = perClass("who");
  if (document.activeElement !== eventsBox) eventsBox.value = perClass("events");
  if (document.activeElement !== titleSchool) {
    titleSchool.value = perClass("titleSchool");
    titleSchool.placeholder = school.l;
  }
  if (document.activeElement !== titleClass) {
    titleClass.value = perClass("titleClass");
    titleClass.placeholder = t("classN", cls.n);
  }
}
/* Printing is a moment, not a setting: lay the page out for paper, print it,
   put it back. Nothing about it is worth remembering between visits. */
document.getElementById("doprint").addEventListener("click", () => {
  printing = true;
  try {
    render();
    window.print();
  } finally {
    printing = false;
    render();
  }
});

renderLanguages();
renderSchools();
renderClasses();
applyStrings();
renderDivisions();
syncPerClassInputs();
render();
</script>
</body>
</html>
"""


def pick_initial(schools, want_school, want_class):
    """Resolve --school/--class into the selection the page opens on."""
    school = schools[0]
    if want_school:
        needle = want_school.casefold()
        hit = next((s for s in schools
                    if needle in s["label"].casefold() or needle in s["text"].casefold()
                    or needle == s["ttNum"]), None)
        if not hit:
            raise SystemExit(
                f"No timetable matches --school {want_school!r}. Available: "
                + ", ".join(s["label"] for s in schools))
        school = hit
    klass = school["classes"][0]["name"]
    if want_class:
        hit = next((c for c in school["classes"] if c["name"] == want_class), None)
        if not hit:
            # The class may live in another timetable; find it there instead.
            for other in schools:
                match = next((c for c in other["classes"] if c["name"] == want_class), None)
                if match and not want_school:
                    return other["ttNum"], match["name"]
            raise SystemExit(
                f"Class {want_class!r} not in {school['label']!r}. Available: "
                + ", ".join(c["name"] for c in school["classes"]))
        klass = hit["name"]
    return school["ttNum"], klass


# Privacy-respecting page counts: no cookies, nothing personal, and the script
# is only in the file when a site is named at build time — a local build carries
# no third-party request at all.
GOATCOUNTER = ('<script data-goatcounter="https://{site}.goatcounter.com/count"'
               ' async src="https://gc.zgo.at/count.js"></script>')


def vendored(name):
    """Third-party code copied into the page. Fetching it at run time would hand
    the reader's settings to whoever served it."""
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "vendor", name), encoding="utf-8") as fh:
        return fh.read()


def render_html(schools, edupage, year, initial_school, initial_class, lang="en",
                built="", goatcounter=""):
    entries_data, subject_meta = compact(schools)
    all_subjects = sorted(subject_meta)
    payload = {
        "edupage": edupage,
        "year": year,
        "initialSchool": initial_school,
        "initialClass": initial_class,
        "lang": lang,
        "built": built,
        "counts": bool(goatcounter),
        "languages": [list(x) for x in LANGUAGES],
        "strings": STRINGS,
        "palette": palette(all_subjects),
        "subjects": subject_meta,
        "schools": entries_data,
    }
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True).replace("</", "<\\/")
    tag = GOATCOUNTER.format(site=html.escape(goatcounter, quote=True)) if goatcounter else ""
    return (PAGE
            .replace("__QRLIB__", vendored("qrcode-generator.js"))
            .replace("__TITLE__", html.escape(f"{edupage} timetables {year}"))
            .replace("__ANALYTICS__", tag)
            .replace("__DATA__", blob))


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--edupage", default="tera", help="EduPage subdomain (default: tera)")
    ap.add_argument("--year", type=int, default=2026, help="school year (default: 2026)")
    ap.add_argument("--only", action="append", metavar="TEXT",
                    help="only embed timetables whose title contains TEXT (repeatable)")
    ap.add_argument("--school", help="timetable selected on first open, e.g. ProTERA")
    ap.add_argument("--class", dest="class_name", help="class selected on first open, e.g. 8")
    ap.add_argument("--built", default="", metavar="DATE",
                    help="fetch date to print in the footer, e.g. 2026-08-23 "
                         "(left out by default, so a build stays reproducible)")
    ap.add_argument("--goatcounter", default="", metavar="SITE",
                    help="GoatCounter site code to count page views with "
                         "(no script is embedded without it)")
    ap.add_argument("--lang", default="en", choices=[c for c, _ in LANGUAGES],
                    help="interface language the page opens in (default: en)")
    ap.add_argument("-o", "--out", default="schedule.html", help="output HTML file")
    ap.add_argument("--json", help="also write the extracted data as readable JSON")
    ap.add_argument("--list", action="store_true", help="list timetables and classes, then exit")
    ap.add_argument("--cache", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache"),
                    help="cache directory for API responses")
    ap.add_argument("--refresh", action="store_true", help="ignore cached API responses")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    client = EduPage(args.edupage, cache_dir=args.cache, refresh=args.refresh,
                     verbose=args.verbose)

    if args.list:
        listing = client.timetables(args.year)
        print(f"Timetables on {args.edupage}.edupage.org (default {listing['default_num']}):")
        for t in sorted(listing["timetables"], key=lambda t: (t.get("datefrom") or ""), reverse=True):
            if t["hidden"]:
                continue
            print(f"  {short_label(t['text']):<28} tt_num={t['tt_num']:<5} "
                  f"{t.get('datefrom','')}  {t['text']}")
            try:
                result = client.timetable(t["tt_num"])
            except RuntimeError as exc:
                print(f"        (unreadable: {exc})")
                continue
            print("        classes: " + ", ".join(timetable_meta(result)["classNames"]))
        return 0

    if args.verbose:
        print("collecting timetables:", file=sys.stderr)
    schools = collect(client, args.year, args.only, args.verbose)
    initial_school, initial_class = pick_initial(schools, args.school, args.class_name)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"edupage": args.edupage, "year": args.year, "schools": schools},
                      fh, ensure_ascii=False, indent=2, sort_keys=True)
            fh.write("\n")
        print(f"wrote {args.json}")

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(render_html(schools, args.edupage, args.year, initial_school,
                             initial_class, args.lang, args.built, args.goatcounter))
    total = sum(len(c["entries"]) for s in schools for c in s["classes"])
    classes = sum(len(s["classes"]) for s in schools)
    print(f"wrote {args.out} — {len(schools)} schools, {classes} classes, {total} lesson slots "
          f"(opens on {initial_school}/{initial_class})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as exc:
        sys.exit(f"network error: {exc}")
