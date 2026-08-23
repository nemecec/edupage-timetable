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
import datetime
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
        "reset": "Reset all settings",
        "share": "Share",
        "shared": "Link copied",
        "shareHint": ("Everything you have chosen is in the address bar, so a "
                      "bookmark or a shared link carries it along."),
        "qrHint": "Edit it here",
        "colourHint": ("Type or paste a colour code to set one, or click the "
                       "swatch beside it, or click any lesson in the timetable "
                       "itself. Clicking a code selects it, ready to copy into an "
                       "event of your own."),
        "colourCode": "Colour code — type, paste, or copy",
        "groups": "Groups",
        "all": "— all —",
        "time": "Time",
        "nothing": "Nothing to show.",
        "paired": "paired (2 periods)",
        "single": "single",
        "noExactTime": "exact time not in the day plan",
        "noTimeShort": "time not in day plan",
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
        "reset": "Lähtesta kõik seaded",
        "share": "Jaga",
        "shared": "Link kopeeritud",
        "shareHint": ("Kõik valikud on aadressiribal, nii et järjehoidja või "
                      "jagatud link kannab need kaasa."),
        "qrHint": "Muuda siin",
        "colourHint": ("Kirjuta või kleebi värvikood, klõpsa selle kõrval oleval "
                       "värvikastil või klõpsa tunniplaanis tunnil. Koodil "
                       "klõpsamine valib selle, et saaksid oma sündmusele "
                       "kopeerida."),
        "colourCode": "Värvikood — kirjuta, kleebi või kopeeri",
        "groups": "Rühmad",
        "all": "— kõik —",
        "time": "Aeg",
        "nothing": "Pole midagi näidata.",
        "paired": "paaristund (2 tundi)",
        "single": "üksiktund",
        "noExactTime": "täpset aega päevaplaanis pole",
        "noTimeShort": "aeg puudub päevaplaanis",
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
        # aSc hands back what someone typed, trailing space and all: LõunaTERA
        # has a class called "Silva ". Matching it literally lost that class its
        # times, and a class with no times draws nothing at all.
        if class_name.strip() not in [c.strip() for c in band["classes"]]:
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
                try:
                    with open(path, encoding="utf-8") as fh:
                        payload = json.load(fh)
                    self.log(f"cache hit: {path}")
                    return payload
                except (json.JSONDecodeError, OSError) as exc:
                    # A half-written file would otherwise be a permanent cache
                    # hit that fails the same way on every run.
                    self.log(f"unreadable cache {path} ({exc}); fetching again")

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
            raw = resp.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            # EduPage answers a lapsed session with a login page, HTTP 200 and
            # all. Say what came back rather than where the parser gave up.
            raise RuntimeError(f"{func}{tuple(args)}: expected JSON, got "
                               f"{raw[:120]!r} ({exc})") from None
        if not isinstance(payload, dict):
            raise RuntimeError(f"{func}{tuple(args)}: expected an object, got {type(payload).__name__}")

        result = payload.get("r")
        if not isinstance(result, dict) or "error" in result:
            err = (result.get("error") if isinstance(result, dict) else None) \
                or payload.get("e") or f"no result ({type(result).__name__})"
            raise RuntimeError(f"{func}{tuple(args)}: {err}")

        if path:
            # Written beside and moved into place: a run interrupted here leaves
            # the previous cache intact instead of a truncated file.
            tmp = f"{path}.{os.getpid()}.part"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False)
            os.replace(tmp, path)
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
        # A school that teaches its first slots as doubles does so whatever card
        # happens to sit there: a single in slot 1 is still the first lesson,
        # and treating it as 45 minutes would start every later slot early.
        forced = 2 if len(slots) < always_paired else 1
        step = max(longest.get(pos, 1), forced)
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
                last = slots[min(slot_of_period.get(
                    e["startPeriod"] + e["duration"] - 1, e["slot"]), len(slots)) - 1]
                e["startMin"] = slot["at"]
                e["endMin"] = _minutes(last["end"].replace(".", ":"))
                e["time"] = f"{slot['start']}–{last['end']}"
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
    }


def merge_blocks(entries):
    """One box per lesson the school publishes, however aSc happens to record it.

    A published block covers one or two aSc periods. Inside it there may be a
    sequence — Häälestus and then Üldõpetus, which the school writes as a single
    9.00-10.50 — or a set of choices running side by side, Kodundus or Käsitöö
    or Puutöö. Both can also be recorded as one card per period rather than one
    card spanning two, and then the same lesson appears twice over.

    So: entries naming a group are left alone, because a group is already the
    thing that tells them apart. Otherwise, if every entry starts on its own
    period the block is a sequence and becomes one box naming each subject in
    turn. If any two share a period, the block holds choices, and each subject's
    entries merge among themselves so the choices stay side by side.

    The colour goes to whichever subject fills more of the block, and to the
    later one when they fill it equally: a block that opens with a warm-up
    should look like what it becomes.
    """
    out, blocks = [], {}
    for e in entries:
        if e["part"]:
            continue
        if e["slot"] is None:
            # On a period the published blocks do not cover: it belongs to no
            # block, so it merges with nothing.
            out.append(e)
            continue
        blocks.setdefault((e["day"], e["slot"]), []).append(e)

    for (day, slot), here in sorted(blocks.items()):
        if len(here) == 1 or any(x["groups"] for x in here):
            out.extend(here)
            continue
        starts = {x["startPeriod"] for x in here}
        if len(starts) == len(here):
            out.append(_one_box(here))
            continue
        by_subject = {}
        for x in here:
            by_subject.setdefault(x["subject"], []).append(x)
        for group in by_subject.values():
            # Only a subject spread across distinct periods is one lesson; the
            # same subject twice on one period is two, taught side by side.
            if len(group) == 1 or len({x["startPeriod"] for x in group}) < len(group):
                out.extend(group)
            else:
                out.append(_one_box(group))

    out.sort(key=lambda e: (e["day"], e["period"], e["subject"], "/".join(e["groups"])))
    return out


def _one_box(here):
    """Fold several entries of one block into the single box they describe."""
    here = sorted(here, key=lambda x: x["startPeriod"])
    lead = max(here, key=lambda x: (x["duration"], x["startPeriod"]))
    joined = dict(lead)
    names = []
    for x in here:
        if x["subject"] not in names:
            names.append(x["subject"])
    joined["names"] = names if len(names) > 1 else None
    joined["duration"] = sum(x["duration"] for x in here)
    joined["startPeriod"] = here[0]["startPeriod"]
    joined["period"] = here[0]["period"]
    for field in ("teachers", "teacherShorts", "rooms"):
        seen = []
        for x in here:
            for value in x[field]:
                if value not in seen:
                    seen.append(value)
        joined[field] = seen
    return joined


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


# What the school typed into aSc ends up inside a style attribute on a public
# page. Anything that is not plainly a colour is dropped rather than trusted.
HEX_COLOUR = re.compile(r"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


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
                if HEX_COLOUR.match(e["schoolColor"] or ""):
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
            "c": [{
                "n": cls["name"],
                "v": [{"id": d["id"], "groups": d["groups"], "l": d["label"],
                       "sj": d["subjects"]}
                      for d in cls["divisions"]],
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
  /* A personal event is drawn over the timetable, so it needs to be above it —
     but it should not look like a different kind of thing. Given one colour it
     is a lesson in every visible respect; the heavier border is for an event
     that asked for its own text colour, where the border follows it. */
  .ev.mine { z-index: 2; }
  .ev.mine.outlined { border-width: 2px; box-shadow: 0 1px 4px rgba(0,0,0,.28); }
  input[type=text] { font: inherit; padding: 5px 8px; border: 1px solid var(--line);
                     border-radius: 5px; background: #fff; color: inherit; }
  .hiddenpick { position: absolute; width: 1px; height: 1px; padding: 0; border: none;
                opacity: 0; pointer-events: none; }
  .ev[data-subject], .lesson[data-subject] { cursor: pointer; }
  .divsub { font-size: 10px; color: #9aa1ab; text-transform: none; letter-spacing: 0; }
  .field label[title] { cursor: help; }

  /* Print: the same timeline, laid out at the width of the sheet so what is
     measured on screen is what comes out of the printer. */
  .ptitle.sheet { font-size: 19px; font-weight: 700; text-align: center;
                  padding: 0 0 10px; border: none; }
  body.printview .count, body.printview .topbar { display: none; }
  body.printview #grid { width: 1054px; }          /* 297mm less two 9mm margins */
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
  body.printview .foot { width: 1054px; margin: 8px 0 0; font-size: 9px; }
  @media print { .foot { width: auto; margin: 7px 0 0; font-size: 9px; } }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; }
  .legend .item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .legend input[type=color] { width: 26px; height: 20px; padding: 0; border: 1px solid var(--line); }
  .legend .hex { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
                 width: 7.5em; padding: 3px 5px; border: 1px solid transparent;
                 border-radius: 4px; background: none; color: var(--muted); }
  .legend .hex:hover { border-color: var(--line); background: #fff; }
  .legend .hex:focus { border-color: var(--accent); background: #fff; color: inherit;
                       outline: none; }
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
__APP__</script>
</body>
</html>
"""


def _same_name(a, b):
    """Class names as aSc returns them: one of them has a trailing space."""
    return (a or "").strip().casefold() == (b or "").strip().casefold()


def school_year(today=None):
    """aSc names a school year by the calendar year it starts in.

    Derived rather than pinned: a year written into the source is right until
    the summer it silently is not, and the nightly rebuild would keep asking
    for last year's timetable without ever saying so.
    """
    today = today or datetime.date.today()
    return today.year if today.month >= 8 else today.year - 1


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
        hit = next((c for c in school["classes"]
                    if _same_name(c["name"], want_class)), None)
        if not hit:
            # The class may live in another timetable; find it there instead.
            for other in schools:
                match = next((c for c in other["classes"]
                               if _same_name(c["name"], want_class)), None)
                if match and not want_school:
                    return other["ttNum"], match["name"]
            raise SystemExit(
                f"Class {want_class!r} not in {school['label']!r}. Available: "
                + ", ".join(c["name"] for c in school["classes"]))
        klass = hit["name"]
    return school["ttNum"], klass


# Page counts with nothing personal in them. The counter reports document.title
# along with the visit, and this page puts the child's name in the title — so the
# title it reports is pinned to a constant first. Without that line a name typed
# into the Title field would be sent to a third party on every visit, which is
# exactly what the page tells the reader does not happen.
#
# The script is only in the file when a site is named at build time, so a local
# build makes no third-party request at all.
GOATCOUNTER = ('<script>window.goatcounter = {{title: "timetable", referrer: ""}};</script>'
               '<script data-goatcounter="https://{site}.goatcounter.com/count"'
               ' async src="https://gc.zgo.at/count.js"></script>')


def beside(name, *parts):
    """A file that ships with the generator, read at build time."""
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, *parts, name), encoding="utf-8") as fh:
        return fh.read()


def vendored(name):
    """Third-party code copied into the page. Fetching it at run time would hand
    the reader's settings to whoever served it."""
    return beside(name, "vendor")


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
    # "</" would close the block early; "<!--<script" would open a nested one and
    # swallow the real close. Neither can survive as a literal "<".
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True).replace("<", "\\u003c")
    tag = GOATCOUNTER.format(site=html.escape(goatcounter, quote=True)) if goatcounter else ""
    return (PAGE
            .replace("__APP__", beside("page.js"))
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
    ap.add_argument("--year", type=int, default=school_year(),
                    help=f"school year, by its starting year (default: {school_year()})")
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
