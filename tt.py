#!/usr/bin/env python3
"""Extract EduPage/aSc timetables and render a personalised, filterable view.

The public timetable page renders its grid client-side into an SVG, but the
data behind it comes from a plain JSON endpoint that an anonymous session can
read. This script talks to that endpoint directly, so no browser is involved
and repeated runs on unchanged data produce byte-identical output.

    python3 tt.py --list
    python3 tt.py -o schedule.html
    python3 tt.py --school ProTERA --class 8 -o schedule.html

Every visible timetable and every class is embedded in the generated page, so
the reader picks their school and class there. --school and --class only choose
what is selected on first open.

Standard library only.
"""

import argparse
import collections
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
# several times over. A nightly job must ride that out rather than skip a day,
# so every fetch gets a few attempts, with a wider gap between each one.

ATTEMPTS = 4
BACKOFF = (5, 20, 60)      # seconds. A nightly job can wait one out


def _transient(exc):
    """Whether another attempt can help."""
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
        "print.summary": "Print options",
        "cal.summary": "Calendar",
        "cal.covers": "Covers {0} to {1}",
        "cal.off": "No lessons on: {0}",
        "cal.instead": "Replacing lessons: {0}",
        "cal.mine": "Include my own events",
        "cal.alarm": "Remind me before my own events",
        "cal.lead": "How long before",
        "cal.lead.min": "{0} minutes",
        "cal.download": "Download calendar file (.ics)",
        "cal.name": "Timetable {0}",
        "cal.file": "Timetable",
        "cal.advice": "Import this into a new calendar of its own. A calendar "
                      "cannot be told that a lesson has gone, so when the "
                      "timetable changes, delete that calendar and export "
                      "again.",
        # What to actually do, which is not the same on the two the school
        # uses. Apple opens the file where it stands, phone included. Google
        # has no import in its phone app at all.
        "cal.apple": "iPhone, iPad and Mac: open the file and pick a calendar.",
        "cal.google": "Google Calendar: on a computer. Its phone app cannot "
                      "import a file.",
        "cal.help.apple": "Apple's instructions",
        "cal.help.google": "Google's instructions",
        "advanced": "Save and restore settings",
        "showHeading": "For each lesson, show:",
        "dayHeading": "In the day, show:",
        "showTeacher": "Teacher",
        "showRoom": "Room",
        "showGroup": "Study group",
        "showSubject": "Subject",
        "showStart": "Start time",
        "showEnd": "End time",
        "showDuration": "How long it lasts",
        "layoutHeading": "Fit these into a lesson box:",
        "layoutStacked": "a line each",
        "layoutPacked": "all on one line",
        "printMargin": "Paper edge",
        "printMargin.mm": "{0} mm",
        "printSheet": "Sheet",
        "sheet.a4": "The whole A4 page",
        "sheet.ipad11a16": "iPad 11\" A16",
        "sheet.custom": "My own size",
        "sheet.mm": "mm",
        "sheet.width": "Sheet width in millimetres",
        "sheet.height": "Sheet height in millimetres",
        "sheet.cut": ("This sheet is smaller than an A4 page. Print it on A4 "
                      "at full size, then cut along the dashed line."),
        "sheet.cutMany": ("{0} of this sheet fit on one A4 page. Print it at "
                          "full size, then cut along the dashed lines."),
        "showGaps": "Free time between lessons",
        "showAxis": "Times down the side",
        "gap": "Break",
        "dur.hour": "{0} hour",
        "dur.hours": "{0} hours",
        "dur.min": "{0} min",
        "nameFull": "full name",
        "nameShort": "abbreviated",
        "subjectFull": "full name",
        "subjectShort": "short name",
        "colorsHeading": "How lessons look:",
        "paletteColors": "Automatic colours",
        "schoolColors": "Colours from the timetable",
        "customColors": "Colours of my own",
        "colLabel": "Label",
        "colShort": "Short name",
        "colShortLabel": "Short label",
        "colShow": "Show",
        "colNote": "Second line",
        "fontHeading": "Type in a lesson box:",
        "fontName": "Subject name",
        "fontTime": "Clock",
        "fontDetail": "Room and teacher",
        "face.sans": "Sans-serif",
        "face.serif": "Serif",
        "face.mono": "Monospace",
        "size.percent": "{0}%",
        "showQr": "QR code",
        "nameLastFirst": "Kask Mari",
        "nameFirstLast": "Mari Kask",
        "clash.says": "This link's settings are not the ones saved in this "
                      "browser. The link's are showing, and nothing of yours "
                      "is written over until you choose.",
        "clash.merge.means": "Merge takes the link's settings and fills the "
                             "rest in from yours.",
        "clash.useLink": "Keep the link's",
        "clash.useMerge": "Merge",
        "clash.useMine": "Use mine instead",
        "clash.copy": "Copy mine first",
        "clash.copied": "Your settings are on the clipboard.",
        "clash.inBox": "Your settings are in the box under Advanced.",
        "link.unreadable": "This link carries settings that the page cannot read, "
                           "so the timetable below does not come from it. A link "
                           "is often cut short when it is copied, so ask for the "
                           "whole one again.",
        "colSubject": "Subject",
        "breaks.heading": "Longer breaks",
        "colBackground": "Background colour",
        "colTextColor": "Text colour",
        "colSample": "How it looks",
        "colWeekday": "Weekday",
        "colStartTime": "Start time",
        "colEndTime": "End time",
        "events.add": "Add an event",
        "events.remove": "Remove",
        "color.own": "own colour",
        "color.fromSubject": "copy from subject",
        "color.fromTimetable": "from the timetable",
        "color.automatic": "automatic",
        "subjects.summary": "Name and colour of each subject",
        "appName": "School timetable",
        "filter": "Filter",
        "groupsHeading": "Show only these study groups:",
        "titleHeading": "Title:",
        "studentName": "Student name",
        "schoolName": "School name",
        "className": "Class name",
        "print": "Print…",
        "backup": "Your settings as text",
        "reset": "Reset all settings",
        "share": "Share",
        "shared": "Link copied",
        "shareManual": "Copy it below",
        "shareHint": ("The address bar holds everything you chose. A bookmark "
                      "or a shared link carries it with them."),
        "qrHint": "Edit it here",
        "all": "— all —",
        "nothing": "Nothing to show.",
        "paired": "paired (2 periods)",
        "single": "single",
        "noExactTime": "exact time not in the day plan",
        "noTimeShort": "time not in day plan",
        "slotsShown": "{0} of {1} lesson slots shown",
        "noFilter": "(no group filter active)",
        "noBells": "this school publishes no times",
        "lessonCount": "{0} lessons",
        "mineCount": "{0} of my own",
        "mineCol": "My own",
        "events.summary": "My own events",
        "events.label": "Not on the school's timetable:",
        "events.badRange": "times run 00:00-23:59",
        "events.backwards": "end time must be after the start",
        "events.badColor": "{0} is not a colour",
        "events.line": "row {0}: {1}",
        "settings.label": ("This box holds every choice you made on this page. "
                           "If you want, you can copy the text into a file to "
                           "keep it safe. If you paste it back later, the same "
                           "timetable opens again with the same settings, in "
                           "another browser or even on another computer."),
        "settings.share": ("Your settings are also inside the address of this "
                           "page. Send the address to somebody else, and the "
                           "timetable opens exactly as you set it up. The same "
                           "happens if you open it yourself on another "
                           "computer. You can copy it straight from the "
                           "address bar, or use the {0} button in the top "
                           "right corner."),
        "settings.printed": ("The {0} setting puts the same address in the "
                             "bottom right corner of the printed sheet."),
        "say": "Feedback",
        "say.link": "feedback",
        "say.intro": ("Anything you want to say about this page: what is "
                      "missing, what is wrong, what can be better, or that it "
                      "all works. This is the one thing on this page that is "
                      "sent to us, so write only what you want us to read."),
        "say.placeholder": "What would you like to say?",
        "say.withSettings": "Send my settings too, so we can see what you see",
        "say.shown": "This is what is sent with your message:",
        "say.send": "Send",
        "say.sent": "Sent. Thank you.",
        "say.failed": "That did not go. Please try again later.",
        "say.empty": "Write something first.",
        "settings.copy": "Copy to clipboard",
        "settings.apply": "Apply pasted settings",
        "settings.copied": "Copied to clipboard.",
        "settings.selected": "Selected. Press Cmd/Ctrl+C to copy it.",
        "settings.badJson": "That is not valid JSON: {0}",
        "settings.notObject": "Expected a JSON object of settings.",
        "settings.applied": "Applied.",
        "footer.disclaimer": ("Unofficial. Built from the school's public "
                              "timetable data. The school does not publish or "
                              "maintain this page."),
        "sourceLink": "source",
        "footer.built": "data fetched {0}",
        "footer.counts": "GoatCounter counts the visits. No cookies.",
        "footer.reports": ("If the page breaks, it tells us, and sends your "
                           "anonymised settings with the fault. Every name "
                           "and label you typed is replaced by Xs."),
        "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                 "Saturday", "Sunday"],
    },
    "et": {
        "lang": "Keel",
        "school": "Kool", "class": "Klass", "classN": "{0}. klass",
        "display": "Kuvamise seaded",
        "print.summary": "Väljatrüki seaded",
        "cal.summary": "Kalender",
        "cal.covers": "Katab {0} kuni {1}",
        "cal.off": "Tunde ei ole: {0}",
        "cal.instead": "Asendab tunde: {0}",
        "cal.mine": "Lisa ka minu enda sündmused",
        "cal.alarm": "Tuleta enda sündmused enne meelde",
        "cal.lead": "Kui palju aega enne",
        "cal.lead.min": "{0} minutit",
        "cal.download": "Laadi kalendrifail alla (.ics)",
        "cal.name": "Tunniplaan {0}",
        "cal.file": "Tunniplaan",
        "cal.advice": "Impordi see eraldi uude kalendrisse. Kalendrile ei saa "
                      "öelda, et tund on ära jäänud, seega kui tunniplaan "
                      "muutub, kustuta see kalender ja ekspordi uuesti.",
        "cal.apple": "iPhone, iPad ja Mac: ava fail ja vali kalender.",
        "cal.google": "Google'i kalender: arvutis. Telefonirakendus faili "
                      "importida ei oska.",
        # Both pages are English only. Apple answers an Estonian address with
        # Estonian navigation around an English article, and Google answers
        # "Taotletud leht pole praegu teie keeles saadaval". So the reader is
        # told before they follow either one.
        "cal.help.apple": "Apple'i juhend (inglise keeles)",
        "cal.help.google": "Google'i juhend (inglise keeles)",
        "advanced": "Seadete salvestamine ja taastamine",
        "showHeading": "Iga tunni juures näita:",
        "dayHeading": "Päevas näita:",
        "showTeacher": "Õpetaja",
        "showRoom": "Ruum",
        "showGroup": "Õpperühm",
        "showSubject": "Aine",
        "showStart": "Algusaeg",
        "showEnd": "Lõpuaeg",
        "showDuration": "Kui kaua kestab",
        "layoutHeading": "Kuidas need tunni kastis ära mahutada:",
        "layoutStacked": "igaüks oma real",
        "layoutPacked": "kõik ühel real",
        "printMargin": "Paberi äär",
        "printMargin.mm": "{0} mm",
        "printSheet": "Leht",
        "sheet.a4": "Kogu A4 leht",
        "sheet.ipad11a16": "iPad 11\" A16",
        "sheet.custom": "Minu enda mõõt",
        "sheet.mm": "mm",
        "sheet.width": "Lehe laius millimeetrites",
        "sheet.height": "Lehe kõrgus millimeetrites",
        "sheet.cut": ("See leht on A4-st väiksem. Trüki see A4 peale "
                      "täissuuruses ja lõika mööda katkendjoont."),
        "sheet.cutMany": ("Ühele A4 lehele mahub {0} sellist lehte. Trüki "
                          "täissuuruses ja lõika mööda katkendjooni."),
        "showGaps": "Vaba aeg tundide vahel",
        "showAxis": "Kellaajad ääres",
        "gap": "Paus",
        "dur.hour": "{0} tund",
        "dur.hours": "{0} tundi",
        "dur.min": "{0} min",
        "nameFull": "täisnimi",
        "nameShort": "lühend",
        "subjectFull": "täisnimi",
        "subjectShort": "lühinimi",
        "colorsHeading": "Kuidas tunnid välja näevad:",
        "paletteColors": "Automaatsed värvid",
        "schoolColors": "Tunniplaani värvid",
        "customColors": "Minu omad värvid",
        "colLabel": "Nimetus",
        "colShort": "Lühinimi",
        "colShortLabel": "Lühinimetus",
        "colShow": "Näita",
        "colNote": "Teine rida",
        "fontHeading": "Kiri tunni kastis:",
        "fontName": "Õppeaine nimi",
        "fontTime": "Kellaaeg",
        "fontDetail": "Ruum ja õpetaja",
        "face.sans": "Groteskkiri",
        "face.serif": "Seriifkiri",
        "face.mono": "Püsisammkiri",
        "size.percent": "{0}%",
        "showQr": "QR-kood",
        "nameLastFirst": "Kask Mari",
        "nameFirstLast": "Mari Kask",
        "clash.says": "Selle lingi seaded ei ole samad, mis siia brauserisse "
                      "salvestatud. Näidatakse lingi omi ja sinu omi ei "
                      "kirjutata üle enne, kui oled valinud.",
        "clash.merge.means": "Liitmine võtab lingi seaded ja ülejäänu sinu "
                             "omadest.",
        "clash.useLink": "Jäta lingi omad",
        "clash.useMerge": "Liida",
        "clash.useMine": "Kasuta minu omi",
        "clash.copy": "Kopeeri enne minu omad",
        "clash.copied": "Sinu seaded on lõikelaual.",
        "clash.inBox": "Sinu seaded on lahtris \"Seadete salvestamine ja "
                       "taastamine\".",
        "link.unreadable": "See link sisaldab seadeid, mida leht ei oska lugeda, "
                           "seega allolev tunniplaan ei tule sellest lingist. "
                           "Kopeerimisel jääb link sageli poolikuks, seega küsi "
                           "terve link uuesti.",
        "colSubject": "Õppeaine",
        "breaks.heading": "Pikemad vahetunnid",
        "colBackground": "Taustavärv",
        "colTextColor": "Teksti värv",
        "colSample": "Kuidas välja näeb",
        "colWeekday": "Nädalapäev",
        "colStartTime": "Algusaeg",
        "colEndTime": "Lõpuaeg",
        "events.add": "Lisa sündmus",
        "events.remove": "Eemalda",
        "color.own": "oma värv",
        "color.fromSubject": "kopeeri õppeainelt",
        "color.fromTimetable": "tunniplaanist",
        "color.automatic": "automaatne",
        "subjects.summary": "Iga õppeaine nimi ja värv",
        "appName": "Kooli tunniplaan",
        "filter": "Filter",
        "groupsHeading": "Näita ainult neid õpperühmi:",
        "titleHeading": "Pealkiri:",
        "studentName": "Õpilase nimi",
        "schoolName": "Kooli nimi",
        "className": "Klassi nimi",
        "print": "Prindi…",
        "backup": "Sinu seaded tekstina",
        "reset": "Lähtesta kõik seaded",
        "share": "Jaga",
        "shared": "Link kopeeritud",
        "shareManual": "Kopeeri allpool",
        "shareHint": ("Aadressiribal on kõik sinu valikud. Järjehoidja või "
                      "jagatud link kannab need kaasa."),
        "qrHint": "Muuda siin",
        "all": "— kõik —",
        "nothing": "Pole midagi näidata.",
        "paired": "paaristund (2 tundi)",
        "single": "üksiktund",
        "noExactTime": "täpset aega päevaplaanis pole",
        "noTimeShort": "aeg puudub päevaplaanis",
        "slotsShown": "näidatud {0} tunnipesa {1}-st",
        "noFilter": "(rühmafilter puudub)",
        "noBells": "see kool ei avalda kellaaegu",
        "lessonCount": "{0} tundi",
        "mineCount": "{0} minu oma",
        "mineCol": "Minu oma",
        "events.summary": "Minu enda sündmused",
        "events.label": "Väljaspool kooli tunniplaani:",
        "events.badRange": "kellaajad on vahemikus 00:00-23:59",
        "events.backwards": "lõpuaeg peab olema pärast algusaega",
        "events.badColor": "{0} ei ole värv",
        "events.line": "rida {0}: {1}",
        "settings.label": ("Selles kastis on kõik valikud, mis sa oled sellel "
                           "lehel teinud. Soovi korral võid selle teksti "
                           "kopeerida faili, et see alles hoida. Kui kleebid "
                           "selle hiljem tagasi, siis saad sama tunniplaani "
                           "samade seadetega avada uuesti teises "
                           "veebilehitsejas (kasvõi teises arvutis)."),
        "settings.share": ("Sinu seaded on ka selle lehe aadressi sees. "
                           "Saates selle aadressi kellelegi teisele (või "
                           "avades selle ise teisest arvutist) avaneb "
                           "tunniplaan täpselt nii, nagu sa selle seadistasid. "
                           "Võid aadressi kopeerida otse aadressirealt või "
                           "kasutades üleval paremas nurgas asuvat nuppu {0}."),
        "settings.printed": ("Valik {0} paneb sama aadressi väljatrüki "
                             "alumisse paremasse nurka."),
        "say": "Tagasiside",
        "say.link": "tagasiside",
        "say.intro": ("Kõik, mida soovid selle lehe kohta öelda: mis on puudu, "
                      "mis on valesti, mida saaks paremaks teha, või et kõik "
                      "toimib. See on ainus asi sellel lehel, mis meile "
                      "saadetakse, nii et kirjuta ainult seda, mida soovid, et "
                      "me loeksime."),
        "say.placeholder": "Mida soovid öelda?",
        "say.withSettings": "Saada ka minu seaded, et näeksime sedasama mida sina",
        "say.shown": "Koos sõnumiga saadetakse see:",
        "say.send": "Saada",
        "say.sent": "Saadetud. Aitäh!",
        "say.failed": "Saatmine ebaõnnestus. Palun proovi hiljem uuesti.",
        "say.empty": "Kirjuta kõigepealt midagi.",
        "settings.copy": "Kopeeri lõikelauale",
        "settings.apply": "Rakenda kleebitud seaded",
        "settings.copied": "Kopeeritud lõikelauale.",
        "settings.selected": "Valitud. Vajuta kopeerimiseks Cmd/Ctrl+C.",
        "settings.badJson": "See ei ole korrektne JSON: {0}",
        "settings.notObject": "Ootasin JSON-objekti seadetega.",
        "settings.applied": "Rakendatud.",
        "footer.disclaimer": ("Mitteametlik. Koostatud kooli avalikest tunniplaani "
                              "andmetest. Kool seda lehte ei avalda ega halda."),
        "sourceLink": "allikas",
        "footer.built": "andmed laaditud {0}",
        "footer.counts": "Külastusi loeb GoatCounter. Küpsiseid ei kasutata.",
        "footer.reports": ("Kui leht katki läheb, teatab ta sellest meile ja "
                           "saadab kaasa sinu anonümiseeritud seaded. Kõik "
                           "nimed ja sildid, mis sa ise kirjutasid, "
                           "asendatakse X-idega."),
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

# When the published timetable is in force, and which days inside it are not
# school days. Needed only by the calendar export: everything else on the page
# is a repeating week and never asks what date it is.
#
# aSc carries none of this. Its `terms` table is one nameless "Semester 1" with
# no dates at all, and two of the four timetables leave even the free-text
# "Kehtivus:" line empty. So the dates are written here, from the school's own
# calendar and from what the schools tell parents.
#
# Source: tartuerakool.ee/<school>/koolielu/ and /tera-gumnaasium/, 28.08.2026.
SCHOOL_YEAR = {
    # "Kooliaasta algus on 24. augustil." The first days are not on the
    # timetable, though — see FIRST_LESSONS. This is the fallback for a school
    # that has not said which day its own week starts on.
    "start": "2026-08-24",
    # The last day this timetable covers. EduPage says so itself for two of the
    # four — "Kehtivus: 24/08/2026-18/12/2026" — and the winter break settles
    # the other two, because it opens on Monday 21.12 and leaves Friday 18.12
    # as the last teaching day either way.
    #
    # The gümnaasium's first half-year runs to 17.01.2027, past this date. What
    # it teaches between the winter break and then is not in this timetable, so
    # the export stops here rather than inventing a fortnight. A reader whose
    # school publishes a new plan exports again.
    "end": "2026-12-18",
    # Whole days with no lessons, as ranges, ends included. Every break the
    # school publishes is here and every national holiday of both years, not
    # only the ones that bite: then a new timetable needs no more than its own
    # two dates above. Only the autumn break falls inside the window as it
    # stands — the winter break opens after the last day, 20.08 falls before
    # the first, and the rest are next year's.
    "off": [
        ("2026-10-26", "2026-11-01", "Sügisvaheaeg"),
        ("2026-12-21", "2027-01-04", "Jõuluvaheaeg"),
        ("2027-02-22", "2027-02-28", "Talvevaheaeg"),
        ("2027-04-12", "2027-04-18", "Kevadvaheaeg"),
        ("2027-06-02", "2027-08-31", "Suvevaheaeg"),
        # Riigipühad. Christmas and Midsummer sit inside a break already; these
        # are the ones that would otherwise fall on a school day.
        ("2026-08-20", "2026-08-20", "Taasiseseisvumispäev"),
        ("2027-02-24", "2027-02-24", "Iseseisvuspäev"),
        ("2027-03-26", "2027-03-26", "Suur reede"),
        ("2027-05-01", "2027-05-01", "Kevadpüha"),
        ("2027-06-23", "2027-06-23", "Võidupüha"),
        ("2027-06-24", "2027-06-24", "Jaanipäev"),
    ],
}

# What one school does that the others do not. Keyed the way BELLS is.
#
# The year opens before the timetable does: the first days are spent with the
# class rather than on the published plan, and each school starts its own week
# on its own day. A school missing here falls back to SCHOOL_YEAR, which is the
# year's first day and so the earliest the week could start.
#
# Source: the schools, through parents. Both entries below are first-hand;
# SädeTERA and LõunaTERA have said nothing, and their readers get the fallback.
SCHOOL_DATES = {
    "TäheTERA": {
        "start": "2026-08-27",
        # An hour that takes the lessons around it with it. The school counts
        # the concert as replacing the first two lessons, and every class loses
        # exactly two periods to a 9.15-10.15 hour — for most of them that is
        # one paired block, for the first years two singles. So the rule is
        # overlap and not a count: whatever a class has at that hour goes.
        "instead": [
            {"date": "2026-12-16", "start": "9:15", "end": "10:15",
             "name": "Jõulukontsert Pauluse kirikus"},
        ],
        "off": [
            # Iseõppepäevad: the class works, but not at school and not to this
            # plan, so the day carries no lesson.
            ("2026-09-21", "2026-09-21", "Iseõppepäev"),
            ("2027-01-05", "2027-01-05", "Iseõppepäev"),
            ("2027-03-25", "2027-03-25", "Iseõppepäev"),
        ],
    },
    # This one also reaches the gümnaasium, which shares ProTERA's timetable
    # and is matched by the same name. Whether the gümnaasium keeps the same
    # two days has not been confirmed.
    "ProTERA": {
        "start": "2026-08-26",
        "off": [
            # "Sellel päeval õppetunde ei toimu" — the TERA20 aktus.
            ("2026-08-31", "2026-08-31", "TERA20 aktus"),
            ("2027-01-05", "2027-01-05", "Iseõppepäev"),
        ],
    },
}


# What a ride is called. One word for both of them: each sits immediately in
# front of the lesson it serves, so the destination is already on the screen —
# and a twenty-minute band has no room for it anyway. One name is also one row
# in the subject table, which a reader recolors once.
BUS = "Buss"

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
            # The school's own word for it, off the published Päevakava:
            # "*PROAEG (sh SÖÖMINE) 11:50 - 12:50". The hour is Proaeg and
            # the sitting is inside it, which is why a class's sitting is
            # cut out of this band rather than laid over it.
            {"after": 2, "minutes": 60, "name": "Proaeg"},
            {"after": 3, "minutes": 20, "name": "Amps"},
        ],
        "defaultGap": 5,
        # One EduPage timetable, two schools in the dropdown. They share
        # nothing but the file: the gümnaasium keeps its own day (see
        # variants), starts its year on its own date, and a reader of one has
        # no use for the other's classes in their list.
        #
        # The first part keeps the timetable's own number, so a link written
        # before the split still names it. What a reader's settings are filed
        # under is the timetable number for both — see classKey in page.js — so
        # the split moves nobody's groups or events.
        # In the order they are offered. ProTERA first: it keeps the
        # timetable's own number, and it is the school the page opens on.
        "split": [
            {"label": "ProTERA"},
            {"label": "TERA gümnaasium", "classPrefix": "G", "suffix": "G"},
        ],
        # Estonian and English in the ninth year are one aSc division — I A,
        # I B, II A, II B, III A, III B — and they are two choices, not one.
        #
        # The letter is which half of the class you are in. The halves swap the
        # two subjects at the same hour: on Tuesday at 12.50 the A half takes
        # English while the B half takes Estonian. So a reader keeps one letter
        # all week. The numeral is the set within that half, and it can differ
        # between the two subjects — a reader can be Estonian II and English I.
        # No single code says that, and picking one gave them the right lesson
        # in one subject and the wrong one in the other.
        #
        # So that division is offered once per subject. The seventh and eighth
        # years keep English in a division of its own, which is the same
        # arrangement written the way aSc can hold it.
        # Source: a reader, who has Estonian 2a and English 1a. Being checked
        # with the school.
        "perSubject": [
            {"classes": ["9"], "subjects": ["Eesti keel", "Inglise keel"]},
        ],
        # When each class eats. The hour after the second lesson is the same
        # hour for every class and the canteen does not hold them all at once,
        # so the plan gives each year a third of it and rotates which third
        # through the week. Read off the Proaeg table on the published
        # Päevakava: a column per weekday, a row per twenty minutes, and the
        # year that eats in it.
        #
        # Hand-copied, so it goes stale when the sittings move. The build stops
        # on a sitting that does not land inside a break of the day plan, which
        # is what a changed plan looks like from here.
        # A question the timetable does not answer and the school does. aSc
        # holds a division only where the lessons differ, so a split that
        # changes nothing about which lesson you sit in cannot be written there
        # at all — and the eighth year's Friday is exactly that.
        #
        # Offered like any other division, so a reader answers it in the same
        # place as the rest and it rides in a shared link with them. It hides no
        # lesson, because no lesson carries these groups.
        #
        # Every year that has a Proaeg sitting, because the Friday split is not
        # by class: the plan splits it by where your Praktikum is.
        "asked": [
            {"classes": ["7", "8", "9"],
             "label": "Praktikum",
             "groups": ["Väljaspool koolimaja", "Koolimajas"]},
        ],
        # And the lesson the question is about. aSc carries one Praktikum for
        # the whole class at 12.50, which is the one in the schoolhouse. The
        # Päevakava carries the other: a bus at 12.15 and Praktikum in the other
        # building from 12.30 to 14.00.
        #
        # So the one entry becomes two, one per group, and the page filters them
        # the way it filters any lesson a class splits for. A reader who has not
        # answered sees both side by side, which is what the page does with two
        # groups at one hour everywhere else.
        # A lesson you reach by bus. Liikumisõpetus after Proaeg is somewhere
        # else in town, and the plan puts a bus to it at 12.50 — the same minute
        # aSc starts the lesson. A lesson cannot start before the class arrives,
        # so the ride comes out of the front of it: the bus is drawn for the
        # minutes it takes and the lesson begins when it lands.
        #
        # Twenty minutes, which is the school's own figure. The plan does not
        # carry it: it names the bus and leaves the arrival to whoever is on it.
        #
        # The end does not move with the start. The rest of the day is where it
        # was, and Amps follows at 14.10, so the ride comes out of the lesson
        # rather than pushing the afternoon along in front of it.
        "busToLesson": [
            {"classes": ["7", "8", "9"], "subject": "Liikumisõpetus",
             "at": "12:50", "minutes": 20, "name": BUS},
        ],
        # How they get there. The Päevakava puts a bus at 12.15, which is why
        # this group eats in the first sitting.
        #
        # Only for a reader who has answered, and that is the difference between
        # this and a sitting. Both sittings can stand on a Friday at once
        # because they follow one another; a bus at 12.15 stands in the middle
        # of the other group's meal, and drawn beside it the two would be half a
        # column each saying the class is doing both.
        "rides": [
            {"classes": ["7", "8", "9"], "day": "Fri",
             "at": "12:15", "until": "12:30", "name": BUS,
             "group": "Väljaspool koolimaja"},
        ],
        "splitLessons": [
            {"classes": ["7", "8", "9"], "day": "Fri", "subject": "Praktikum",
             # The moved one waits to be asked for. Drawn beside the other
             # group's meal it is half a column, and a Friday showing both
             # alternatives at once has no room left to say which is which.
             # Unanswered the day keeps aSc's Praktikum, which is the one in
             # the schoolhouse and the one most of the class has.
             "into": [{"group": "Väljaspool koolimaja", "whenAnswered": True,
                       "at": "12:30", "until": "14:00"},
                      {"group": "Koolimajas"}]},
        ],
        "meals": {
            "7": [
                {"day": "Mon", "at": "11:50", "until": "12:10"},
                {"day": "Tue", "at": "12:10", "until": "12:30"},
                {"day": "Wed", "at": "12:30", "until": "12:50"},
                {"day": "Thu", "at": "11:50", "until": "12:10"},
                # Friday is not split by class at all. Every year has
                # Praktikum at the same hour, and the plan splits the sitting by
                # where yours is: out of the schoolhouse first, because they
                # take the 12.15 bus. That is a thing about the reader and not
                # about their class, so the page asks — see "asked" below.
                #
                # A group and a note. The group is what the answer is matched
                # against. The note is what the box adds to its name while both
                # sittings are on the day, because two bands one above the other
                # called the same thing tell a reader nothing — and a twenty
                # minute band has no second line to say it on. Once the reader
                # has answered, only one is left and the note goes with the
                # other.
                {"day": "Fri", "at": "11:50", "until": "12:10",
                 "group": "Väljaspool koolimaja", "note": "praktikum väljas"},
                {"day": "Fri", "at": "12:10", "until": "12:50",
                 "group": "Koolimajas", "note": "praktikum koolis"},
            ],
            "8": [
                {"day": "Mon", "at": "12:10", "until": "12:30"},
                {"day": "Tue", "at": "12:30", "until": "12:50"},
                {"day": "Wed", "at": "11:50", "until": "12:10"},
                {"day": "Thu", "at": "12:10", "until": "12:30"},
                # Friday, as above.
                {"day": "Fri", "at": "11:50", "until": "12:10",
                 "group": "Väljaspool koolimaja", "note": "praktikum väljas"},
                {"day": "Fri", "at": "12:10", "until": "12:50",
                 "group": "Koolimajas", "note": "praktikum koolis"},
            ],
            "9": [
                {"day": "Mon", "at": "12:30", "until": "12:50"},
                {"day": "Tue", "at": "11:50", "until": "12:10"},
                {"day": "Wed", "at": "12:10", "until": "12:30"},
                {"day": "Thu", "at": "12:30", "until": "12:50"},
                # Friday, as above.
                {"day": "Fri", "at": "11:50", "until": "12:10",
                 "group": "Väljaspool koolimaja", "note": "praktikum väljas"},
                {"day": "Fri", "at": "12:10", "until": "12:50",
                 "group": "Koolimajas", "note": "praktikum koolis"},
            ],
        },
        # TERA gümnaasium is in the same published timetable and does not keep
        # the same day. Four lessons of eighty minutes, its own two breaks, and
        # nothing after half past three. Read against the grades below it, its
        # afternoon ran ten and then twenty minutes late.
        # Source: tartuerakool.ee/tera-gymnaasium/ — Päevakava
        "variants": [{
            "classPrefix": "G",
            "name": "Gümnaasiumi päevakava",
            "start": "9:00",
            # Every lesson is a pair. `single` is here for a card that is not,
            # which the published plan does not have and the data does not use.
            "single": 80,
            "paired": 80,
            "alwaysPaired": 4,
            "gaps": [
                {"after": 0, "name": "Hommikuamps", "start": "8:30", "end": "8:55"},
                {"after": 1, "minutes": 10},
                {"after": 2, "minutes": 50, "name": "Lõuna"},
                {"after": 3, "minutes": 10},
            ],
            "defaultGap": 10,
        }],
    },
    # SädeTERA is a third shape again. Its periods are at fixed times, like an
    # ordinary school, so there is no clock to run — but a paired lesson does
    # not run to the end of its second period. It runs eighty minutes from
    # where it starts, and ends before the second period would.
    #
    # EduPage carries period times for this school, and they are placeholders:
    # 8.00, 9.00, 10.00, one an hour. That is what the page drew until now.
    # Source: tartuerakool.ee/sadetera/ — I ja II kooliaste
    # SädeTERA publishes a day plan per class, and a class is the unit here:
    # the school is small enough that a class stays together for every lesson,
    # so there are no groups to split. What it does have is two lunch sittings,
    # grades 1-3 and grades 4-6, which is why the fourth lesson ends at 12.05
    # for the younger half and 12.20 for the older, and why one plan for the
    # school cannot be right for all of it.
    #
    # This was a clock with fixed periods, and it was wrong on one box in five:
    # it had to guess which lessons in a row were a double, and the guess is
    # not derivable — the school decides. The plan says. Read off the published
    # sheet, "SädeTERA päevakava 2026/2027".
    #
    #   (first period, how many periods, start, end)
    #
    # Hand-copied, so it goes stale when the school republishes. The build
    # warns when a lesson lands where the plan has no slot, which is what a
    # changed plan looks like from here.
    "SädeTERA": {
        "name": "Päevakava",
        # When a class eats is where its lessons stop, so the band is read off
        # the plan. What makes a space lunch rather than a corridor is that it
        # is at least twenty minutes and starts in the middle of the day.
        "blockGaps": [
            {"name": "Lõuna + loovaeg", "least": 20,
             "after": "12:00", "before": "12:45"},
        ],
        # And the sheet's own heading, for a day that stops before lunch and so
        # leaves no space to read.
        "lunch": ("12:00", "13:00"),
        "bands": [
            {
                "classes": ["1. S"],
                "days": {
                    (0,): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:05"),
                                (5, 1, "13:00", "13:45")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 2, "10:45", "12:05"), (5, 1, "13:00", "13:45")],
                    (2,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 2, "10:45", "12:05"), (5, 1, "13:00", "13:45"),
                                (6, 1, "13:50", "14:35")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 2, "10:45", "12:05"), (5, 1, "13:00", "13:45")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 1, "10:45", "11:30")],
                },
            },
            {
                "classes": ["2. S"],
                "days": {
                    (0,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 2, "10:45", "12:05"), (5, 1, "13:00", "13:45")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:05"),
                                (5, 1, "13:00", "13:45"), (6, 1, "13:50", "14:35")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:05"),
                                (5, 1, "13:00", "13:45"), (6, 1, "13:50", "14:35")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 2, "10:45", "12:05"), (5, 1, "13:00", "13:45")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20")],
                },
            },
            {
                "classes": ["3. S"],
                "days": {
                    (0,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 2, "10:45", "12:05"), (5, 1, "13:00", "13:45"),
                                (6, 2, "14:00", "15:25")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 2, "10:45", "12:05"), (5, 1, "12:45", "13:30"),
                                (6, 1, "13:50", "14:35")],
                    (2,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 2, "10:45", "12:05"), (5, 1, "13:00", "13:45"),
                                (6, 1, "13:50", "14:35")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 2, "9:50", "11:10"),
                                (4, 1, "11:20", "12:05"), (5, 1, "13:00", "13:45")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20")],
                },
            },
            {
                "classes": ["4. S"],
                "days": {
                    (0,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 2, "10:45", "12:05"), (5, 1, "13:00", "13:45"),
                                (6, 1, "13:50", "14:35")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 2, "9:50", "11:10"),
                                (4, 1, "11:35", "12:20"), (5, 1, "13:00", "13:45")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:05"),
                                (5, 1, "13:00", "13:45"), (6, 1, "13:50", "14:35")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 2, "9:50", "11:10"),
                                (4, 1, "11:35", "12:20"), (5, 1, "13:00", "13:45")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20")],
                },
            },
            {
                "classes": ["5. S"],
                "days": {
                    (0,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                                (4, 1, "11:35", "12:20"), (5, 1, "13:00", "13:45"),
                                (6, 1, "13:50", "14:35")],
                    (1,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                                (4, 1, "11:35", "12:20"), (5, 1, "13:00", "13:45"),
                                (6, 1, "13:50", "14:35")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                                (4, 1, "11:35", "12:20"), (5, 1, "13:00", "13:45"),
                                (6, 1, "13:50", "14:35")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                                (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                                (5, 1, "13:00", "13:45"), (6, 1, "13:50", "14:35")],
                    (4,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                                (4, 1, "11:35", "12:20"), (5, 1, "13:00", "13:45"),
                                (6, 1, "13:50", "14:35")],
                },
            },
            {
                "classes": ["6. S"],
                "days": {
                    (0,): [(1, 1, "9:00", "9:45"), (2, 2, "9:50", "11:10"),
                                (4, 1, "11:35", "12:20"), (5, 1, "13:00", "13:45"),
                                (6, 1, "13:50", "14:35"), (7, 1, "14:40", "15:25")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 2, "9:50", "11:10"),
                                (4, 1, "11:35", "12:20"), (5, 1, "12:45", "13:30"),
                                (6, 1, "13:50", "14:35")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 2, "10:55", "12:15"),
                                (5, 1, "13:00", "13:45"), (6, 1, "13:50", "14:35"),
                                (7, 1, "14:40", "15:25")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 2, "9:50", "11:10"),
                                (4, 2, "11:25", "12:35"), (6, 1, "13:50", "14:35")],
                    (4,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                                (4, 1, "11:35", "12:20"), (5, 1, "13:00", "13:45"),
                                (6, 1, "13:50", "14:35"), (7, 1, "14:40", "15:25")],
                },
            },
        ],
    },
    # TäheTERA publishes nothing to EduPage — no day plan and no period times,
    # so the clock comes from the school's own sheets instead, one per grade
    # band. Every class is here, and no two of them run the same week. Nor does
    # one day settle another: 5.a alone has the fourth lesson ending at 12.05 on
    # a Monday and 12.20 on a Wednesday.
    #
    # aSc keeps a fifth period that only the fifth years use — the one EduPage
    # labels "HA", which reads as a break and is not one. It is their language
    # lesson, on Monday and Thursday, and the other eleven classes step straight
    # from the fourth lesson to the sixth. So the school's own numbering and
    # aSc's part company after the fourth: the sheet's 5, 6 and 7 are periods 6,
    # 7 and 8 here. The two HA rows are periods 5 and 6.
    #
    # Around midday the fifth years split. The sheet writes two rows, and each
    # holds a lesson and lunch in the opposite order: one group takes the
    # language at 12.10 and eats after, the other eats first and takes the
    # language at 12.55. Two rows, two aSc periods, so both are drawn — and a
    # reader who picks their language group sees only their own, with their own
    # lunch showing up as the free time between it and the lesson either side.
    #
    # That is why the fifth years get no named lunch on those two days. It is a
    # different hour for each group, and a band drawn across the class would be
    # wrong for half of them. The five minutes the sheet marks there are a
    # changeover, and the windows below are set not to call that lunch.
    #
    # The eighth period is the choir, and it carries a slot on Wednesday and
    # Thursday both. The sheets put it on Wednesday and the frozen fixtures
    # under tests are one fetch behind and still say Thursday. Which day a
    # lesson falls on is the timetable's to say, not this table's. All this
    # decides is whether there is a time to draw it at, and an unused slot costs
    # nothing where a missing one loses the lesson.
    #
    # Source: "Päevaplaanid klasside kaupa", the school's day plans for the
    # first half of 2026/27, one sheet for years 1-3 and one for years 4-6.
    "TäheTERA": {
        "name": "Tunniplaan",
        "blockGaps": [
            # Amps opens when the morning's lessons stop: 10.20 after a double
            # first block, 10.35 after two singles, and 9.45 where the day opens
            # with one single. Ten minutes is the floor, because the older half
            # steps from the first lesson to the second in five, and five
            # minutes is a changeover rather than a snack.
            {"name": "Amps", "least": 10, "after": "9:40", "before": "10:44"},
            # The younger half eats at 12.20, after the fourth lesson. The older
            # half eats at 13.15, after the fifth — except 6.k on a Wednesday,
            # which eats at 12.20, and that is why the second window opens
            # before midday. Fifteen minutes is the floor for both: the older
            # half's fourth and fifth lessons are ten minutes apart.
            # Two sittings, and the windows overlap in the minutes around
            # 12.20, so each names the classes it feeds. A class in both lists
            # would be given lunch twice over the same hole.
            {"name": "Lõuna", "least": 15, "after": "12:00", "before": "12:30",
             "classes": ["1.i", "1.k", "2.l", "2.t", "3.a", "3.k"]},
            {"name": "Lõuna", "least": 15, "after": "12:15", "before": "13:20",
             "classes": ["4.a", "4.e", "4.i", "5.a", "5.l", "5.t", "6.k", "6.v"]},
        ],
        # Lunch on the two days the fifth years split is whatever the language
        # split leaves over, and that is a different hour for each group. So it
        # is not a band across the class: it is the hole the reader's own
        # lessons leave, and this says what to call one that falls in the middle
        # of the day and is long enough to eat in. Fifteen minutes between two
        # lessons is not lunch.
        "lunchGap": {"name": "Lõuna", "from": "12:00", "to": "13:00", "least": 30},
        # 5.a takes Spanish in two groups, and aSc cannot say so. It names one
        # group per lesson, which assumes a group meets at the same period
        # every week, and here it does not. Both days hold a Spanish lesson at
        # 12.10 and another at 12.55, and the half that goes first on Monday
        # goes second on Thursday. aSc writes that as two groups fixed to their
        # periods — "HK" always at 12.10, "HK1" always at 12.55 — so a reader
        # who picks one is shown the wrong lesson on one of the two days.
        #
        # Those two names mean nothing on their own, so they are mapped onto
        # the two groups the school itself names. HK1 is the group that takes
        # the language at 12.10 on Monday and at 12.55 on Thursday, HK2 the
        # other way round.
        #
        # This is 5.a as the school stated it. 5.l and 5.t sit in the same two
        # lessons and are listed the same way, and whether they swap too is not
        # in the data: it is one more line here once somebody says.
        # Source: the school, on the split.
        "regroup": [
            {
                "classes": ["5.a"],
                "days": {
                    (0,): {"HK": "HK1", "HK1": "HK2"},
                    (3,): {"HK": "HK2", "HK1": "HK1"},
                },
            },
        ],
        "bands": [
            {
                "classes": ["1.i"],
                "days": {
                    (0, 3): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                             (3, 2, "10:50", "12:10"), (6, 1, "12:40", "13:25")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:40", "13:25"), (7, 1, "13:30", "14:15")],
                    (2,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 2, "10:45", "12:05"), (6, 1, "12:40", "13:25"),
                           (7, 1, "13:30", "14:15")],
                    (4,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25")],
                },
            },
            {
                "classes": ["1.k"],
                "days": {
                    (0, 4): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                             (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:40", "13:25")],
                    (2,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 2, "10:50", "12:10"), (6, 1, "12:40", "13:25"),
                           (7, 1, "13:30", "14:15")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 2, "10:50", "12:10"), (6, 1, "12:40", "13:25")],
                },
            },
            {
                "classes": ["2.l"],
                "days": {
                    (0,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:40", "13:25")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 2, "10:50", "12:10"), (6, 1, "12:40", "13:25")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25"),
                           (7, 1, "13:30", "14:15")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 2, "10:50", "12:10"), (6, 1, "12:40", "13:25"),
                           (7, 1, "13:30", "14:15")],
                    (4,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25")],
                },
            },
            {
                "classes": ["2.t"],
                "days": {
                    (0,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 2, "10:45", "12:05"), (6, 1, "12:40", "13:25")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25"),
                           (7, 1, "13:30", "14:15")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 2, "12:40", "14:00")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 2, "10:00", "11:20"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25")],
                },
            },
            {
                "classes": ["3.a"],
                "days": {
                    (0,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 2, "12:40", "14:00")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:05"),
                           (6, 1, "12:40", "13:25"), (7, 1, "13:30", "14:15")],
                    (3, 4): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                             (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25"),
                             (7, 1, "13:30", "14:15")],
                },
            },
            {
                "classes": ["3.k"],
                "days": {
                    (0,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25")],
                    (1, 4): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                             (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                             (6, 2, "12:40", "14:00")],
                    (2, 3): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                             (4, 1, "11:35", "12:20"), (6, 1, "12:40", "13:25"),
                             (7, 1, "13:30", "14:15")],
                },
            },
            {
                "classes": ["4.a"],
                "days": {
                    (0,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 2, "10:45", "12:05"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30")],
                    (1,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30"), (8, 1, "14:35", "15:20")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30"),
                           (8, 1, "14:35", "15:20")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:30", "13:15")],
                },
            },
            {
                "classes": ["4.e"],
                "days": {
                    (0, 1): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                             (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                             (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30")],
                    (2, 3): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                             (4, 1, "11:35", "12:20"), (6, 1, "12:30", "13:15"),
                             (7, 1, "13:45", "14:30"), (8, 1, "14:35", "15:20")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:30", "13:15")],
                },
            },
            {
                "classes": ["4.i"],
                "days": {
                    (0,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30")],
                    (1,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 3, "11:45", "13:05"), (7, 1, "13:45", "14:30"),
                           (8, 1, "14:35", "15:20")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:30", "13:15"), (7, 1, "13:30", "14:15"),
                           (8, 1, "14:35", "15:20")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:30", "13:15")],
                },
            },
            {
                "classes": ["5.a"],
                "days": {
                    (0,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:05"), (5, 1, "12:10", "12:55"),
                           (6, 1, "12:55", "13:40"), (7, 1, "13:45", "14:30")],
                    (1,): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:10"),
                           (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30"), (8, 1, "14:35", "15:20")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 2, "10:45", "12:05"), (5, 1, "12:10", "12:55"),
                           (6, 1, "12:55", "13:40"), (7, 1, "13:45", "14:30"),
                           (8, 1, "14:35", "15:20")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 2, "10:45", "12:05"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30")],
                },
            },
            {
                "classes": ["5.l"],
                "days": {
                    (0,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:05"), (5, 1, "12:10", "12:55"),
                           (6, 1, "12:55", "13:40"), (7, 1, "13:45", "14:30")],
                    (1,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 2, "10:45", "12:20"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30"), (8, 1, "14:35", "15:20")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 2, "10:45", "12:05"), (5, 1, "12:10", "12:55"),
                           (6, 1, "12:55", "13:40"), (7, 1, "13:45", "14:30"),
                           (8, 1, "14:35", "15:20")],
                    (4,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30")],
                },
            },
            {
                "classes": ["5.t"],
                "days": {
                    (0,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:05"),
                           (5, 1, "12:10", "12:55"), (6, 1, "12:55", "13:40"),
                           (7, 1, "13:45", "14:30")],
                    (1,): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:05"),
                           (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30")],
                    (2,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30"),
                           (8, 1, "14:35", "15:20")],
                    (3,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 2, "10:45", "12:05"), (5, 1, "12:10", "12:55"),
                           (6, 1, "12:55", "13:40"), (7, 1, "13:45", "14:30"),
                           (8, 1, "14:35", "15:20")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 2, "10:45", "12:05"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30")],
                },
            },
            {
                "classes": ["6.k"],
                "days": {
                    (0,): [(1, 1, "9:00", "9:45"), (2, 1, "9:50", "10:35"),
                           (3, 2, "10:45", "12:05"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30")],
                    (1,): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:05"),
                           (6, 1, "12:30", "13:15"), (7, 2, "13:45", "15:05")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 2, "12:50", "14:10"),
                           (8, 1, "14:15", "15:00")],
                    (3,): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:05"),
                           (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30"),
                           (8, 1, "14:35", "15:20")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 1, "9:55", "10:40"),
                           (3, 1, "10:45", "11:30"), (4, 1, "11:35", "12:20"),
                           (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30")],
                },
            },
            {
                "classes": ["6.v"],
                "days": {
                    (0,): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:05"),
                           (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30")],
                    (1, 3): [(1, 2, "9:00", "10:20"), (3, 2, "10:45", "12:05"),
                             (6, 1, "12:30", "13:15"), (7, 1, "13:45", "14:30"),
                             (8, 1, "14:35", "15:20")],
                    (2,): [(1, 2, "9:00", "10:20"), (3, 1, "10:45", "11:30"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:30", "13:15"),
                           (7, 2, "13:45", "15:00")],
                    (4,): [(1, 1, "9:00", "9:45"), (2, 2, "10:00", "11:20"),
                           (4, 1, "11:35", "12:20"), (6, 1, "12:30", "13:15"),
                           (7, 1, "13:45", "14:30")],
                },
            },
        ],
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
        # Its breaks are lessons in the timetable, with a supervisor and a
        # length, so they arrive as subjects rather than as gaps. They are
        # still breaks, and reading a week is easier when they look like the
        # breaks every other school draws.
        "breakSubjects": ["Puder", "Lõuna/Õue", "Hea aeg"],
        # Classes here are named after their teacher, and the year is a row of
        # its own in the list: a class called `3`, carrying no lessons, in front
        # of the classes in the third year. See class_grades.
        "gradeRows": True,
        "bands": [
            {
                "grades": [1, 2, 3],          # I kooliaste
                "days": {
                    # The first two periods are the settling-in half hour and
                    # the lesson after it. The timetable runs one lesson across
                    # both, so they are one block here.
                    (0, 1, 2, 3): [(1, 2, "9:00", "10:30"), (3, 1, "10:30", "10:50"),
                                   (4, 1, "10:50", "11:50"), (5, 1, "12:00", "13:00"),
                                   (6, 1, "13:00", "13:50"), (7, 1, "13:50", "14:50"),
                                   (8, 1, "15:00", "16:00")],
                    (4,): [(1, 1, "9:00", "10:00"), (2, 1, "10:10", "11:10"),
                           (3, 1, "11:10", "12:00"), (4, 1, "12:00", "13:00")],
                },
            },
            {
                "grades": [4, 5, 6],          # II kooliaste
                "days": {
                    # Ten minutes between the fourth period and "hea aeg" that
                    # the sheet names as a break of its own, and the fifth
                    # period in its two shapes: on its own to 14.00, or run on
                    # into the sixth and finished at 14.35.
                    (0, 1, 2, 3): [(1, 2, "9:00", "10:20"), (3, 1, "10:20", "10:40"),
                                   (4, 2, "10:40", "12:00"), (6, 1, "12:10", "12:45"),
                                   (7, 1, "12:45", "13:15"),
                                   (8, 1, "13:15", "14:00", "14:35"),
                                   (9, 1, "14:10", "14:55"), (10, 1, "15:00", "15:45")],
                    (4,): [(1, 2, "9:00", "10:20"), (3, 2, "10:30", "11:50"),
                           (5, 1, "11:50", "12:15"), (6, 1, "12:15", "13:00")],
                },
            },
        ],
    },
}


def for_class(cfg, class_name):
    """The day plan one class runs.

    A published timetable can hold more than one school. School 68 is
    "ProTERA ja TERA gümnaasium", and the gümnaasium classes keep a day of
    their own.
    """
    for variant in (cfg or {}).get("variants", ()):
        if (class_name or "").strip().startswith(variant["classPrefix"]):
            return variant
    return cfg


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
    # A break before the first lesson. It has its own clock rather than a
    # length, because there is nothing in front of it to measure from.
    opener = gaps.get(0)
    if opener:
        first, last = _minutes(opener["start"]), _minutes(opener["end"])
        breaks.append({"after": 0, "name": opener["name"], "at": first,
                       "until": last, "start": _fmt_time(first),
                       "end": _fmt_time(last)})
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
        # A running clock has no break after the last lesson: the gap it would
        # sit in is the end of the day.
        if gap and gap.get("name") and i < len(slot_kinds):
            breaks.append({"after": i, "name": gap["name"], "at": clock,
                           "until": clock + minutes,
                           "start": _fmt_time(clock), "end": _fmt_time(clock + minutes)})
        clock += minutes
    return slots, breaks


def _minutes(text):
    hour, _, minute = text.partition(":")
    return int(hour) * 60 + int(minute)


# The order aSc counts days in, which is what a sitting is written against.
MEAL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MEAL_NAME = "Söömine"


def bus_to_lesson(cfg, class_name, entries, shape):
    """A lesson the class rides to, and the ride out of the front of it.

    ProTERA's Liikumisõpetus after Proaeg is somewhere else in town. The plan
    puts a bus to it at 12.50, which is the same minute aSc starts the lesson —
    and a lesson cannot start before the class arrives. So the ride is drawn for
    the minutes it takes and the lesson begins when it lands.

    The end stays where it was. The rest of the day has not moved and Amps
    follows at 14.10, so the ride comes out of the lesson rather than pushing
    the afternoon along in front of it.

    The band carries the lesson's own groups, so a reader who does not have the
    lesson does not have the bus either.
    """
    rules = [r for r in (cfg or {}).get("busToLesson", [])
             if (class_name or "").strip() in [c.strip() for c in r["classes"]]]
    if not rules:
        return entries
    for entry in entries:
        for rule in rules:
            leaves = _minutes(rule["at"])
            if entry["subject"] != rule["subject"] or entry.get("startMin") != leaves:
                continue
            lands = leaves + rule["minutes"]
            entry.update(startMin=lands,
                         time=f"{_fmt_time(lands)}–{_fmt_time(entry['endMin'])}")
            day = shape.get(entry["day"])
            if not day:
                continue
            already = any(b["name"] == rule["name"] and b["at"] == leaves
                          and b.get("group") == list(entry["groups"])
                          for b in day["breaks"])
            if already:
                continue
            day["breaks"].append(
                {"after": 0, "name": rule["name"], "at": leaves, "until": lands,
                 "start": _fmt_time(leaves), "end": _fmt_time(lands),
                 # Every group the lesson has, so a reader in any of them keeps
                 # the ride they are on.
                 "group": list(entry["groups"]), "note": "",
                 "wasNamed": "", "onlyAnswered": False})
            day["breaks"].sort(key=lambda b: b["at"])
    return entries


def rides_for(cfg, class_name, day):
    """A bus this class takes on this day, for the group that takes it.

    Drawn only for a reader who has answered, unlike a sitting. Two sittings can
    stand on one day because they follow one another; a bus that leaves in the
    middle of the other group's meal cannot stand beside it without both being
    half a column wide and the day saying the class is doing both.
    """
    wanted = (cfg or {}).get("rides", [])
    return [r for r in wanted
            if (class_name or "").strip() in [c.strip() for c in r["classes"]]
            and MEAL_DAYS.index(r["day"]) == day]


def split_lessons(cfg, class_name, entries):
    """One lesson the school runs twice, which aSc records once.

    ProTERA's Friday Praktikum is one row for the whole class, and it is the one
    held in the schoolhouse. The Päevakava carries the other: a bus at 12.15 and
    the same lesson in another building from 12.30. Nothing in aSc says who goes
    where, because as far as the timetable is concerned it is one lesson.

    So the row becomes one per group, each with its own clock, and the page
    filters them the way it filters any lesson a class splits for. Answering the
    question is what picks one.
    """
    rules = [r for r in (cfg or {}).get("splitLessons", [])
             if (class_name or "").strip() in [c.strip() for c in r["classes"]]]
    if not rules:
        return entries
    out = []
    for entry in entries:
        rule = next((r for r in rules
                     if entry["subject"] == r["subject"]
                     and entry["day"] == MEAL_DAYS.index(r["day"])), None)
        if not rule or entry["part"]:
            out.append(entry)
            continue
        for half in rule["into"]:
            copy = dict(entry, groups=[half["group"]])
            if half.get("whenAnswered"):
                copy["onlyAnswered"] = True
            if half.get("at"):
                at, until = _minutes(half["at"]), _minutes(half["until"])
                # Marked as the day plan's hours rather than aSc's. A break of
                # the same plan gives way to it; a break the school's own data
                # happens to overlap is left where it is, because that
                # disagreement is the school's and not ours to settle.
                copy.update(startMin=at, endMin=until, fromPlan=True,
                            time=f"{_fmt_time(at)}–{_fmt_time(until)}")
            out.append(copy)
    return out


def asked_divisions(cfg, class_name):
    """The questions the school answers and the timetable cannot.

    A division exists in aSc only where the lessons differ. A split that changes
    nothing about which lesson you sit in has nowhere to live there, so it lives
    here and is offered to the reader in the same row as the rest.

    It carries no lessons of its own on purpose: `visible` skips a division
    whose groups no lesson names, so answering this one hides nothing.
    """
    out = []
    for rule in (cfg or {}).get("asked", []):
        wanted = [c.strip() for c in rule["classes"]]
        if (class_name or "").strip() not in wanted:
            continue
        out.append({"id": rule["label"], "groups": list(rule["groups"]),
                    "label": rule["label"], "subjects": [], "who": 0,
                    "lessons": []})
    return out


def meals_for(cfg, class_name, day):
    """This class's sittings on this day, earliest first."""
    wanted = (cfg or {}).get("meals", {}).get((class_name or "").strip(), [])
    return sorted((m for m in wanted if MEAL_DAYS.index(m["day"]) == day),
                  key=lambda m: _minutes(m["at"]))


def with_meals(breaks, cfg, class_name, day):
    """Cut a class's own sittings out of the break they fall in.

    The plan gives every class the same hour of free time. Twenty minutes of it
    is this class's turn in the canteen and the rest is still free time, so the
    hour becomes up to three bands rather than two that overlap. Overlapping,
    the two would be packed side by side at half the width each, which says the
    class is doing both at once.

    A sitting that lands in no break is refused rather than drawn somewhere
    near. It means the day plan moved under the copied times, and a meal drawn
    at the wrong hour is worse than a build that stops and says so.
    """
    sittings = meals_for(cfg, class_name, day)
    if not sittings:
        return breaks
    out, taken = [], set()
    for band in breaks:
        inside = [m for m in sittings
                  if band["at"] <= _minutes(m["at"])
                  and _minutes(m["until"]) <= band["until"]]
        if not inside:
            out.append(band)
            continue
        # Free time, sitting, free time, sitting, ... in clock order. A stretch
        # of no minutes between two of them is not a band and is left out.
        clock = band["at"]
        for meal in inside:
            taken.add(id(meal))
            at, until = _minutes(meal["at"]), _minutes(meal["until"])
            if at > clock:
                out.append(dict(band, at=clock, until=at,
                                start=_fmt_time(clock), end=_fmt_time(at)))
            out.append(dict(band, name=meal.get("name", MEAL_NAME), at=at,
                            until=until, start=_fmt_time(at),
                            end=_fmt_time(until),
                            group=[meal["group"]] if meal.get("group") else [],
                            note=meal.get("note", ""),
                            # What the plan called this stretch before the
                            # sitting was cut out of it. Where two sittings
                            # tile the whole break, the one that is not the
                            # reader's has to fall back to something, and this
                            # is what the same minutes are called on every
                            # other day.
                            wasNamed=band["name"]))
            clock = until
        if clock < band["until"]:
            out.append(dict(band, at=clock, until=band["until"],
                            start=_fmt_time(clock), end=_fmt_time(band["until"])))
    missed = [m for m in sittings if id(m) not in taken]
    if missed:
        raise SystemExit(
            "%s on %s: no break of the day plan holds %s-%s. The plan moved "
            "under the sittings written in BELLS." %
            (class_name, MEAL_DAYS[day], missed[0]["at"], missed[0]["until"]))
    for ride in rides_for(cfg, class_name, day):
        at, until = _minutes(ride["at"]), _minutes(ride["until"])
        out.append({"after": out[0]["after"] if out else 0, "name": ride["name"],
                    "at": at, "until": until, "start": _fmt_time(at),
                    "end": _fmt_time(until), "group": [ride["group"]],
                    "note": "", "wasNamed": "", "onlyAnswered": True})
    out.sort(key=lambda b: b["at"])
    return out


def block_gaps(cfg, slots, class_name=""):
    """Lunch, on a day the school publishes as a list of blocks.

    A published plan lists lessons, not the spaces between them. Most of those
    spaces are a corridor and one is lunch, so both when and how long decide
    it: SädeTERA's corridors are five minutes and its lunches start between
    12.05 and 12.35, but one Tuesday has a twenty-minute gap at half past one
    that is neither.

    A day can also stop before lunch, and then there is no second block to
    measure a space against. Those children still eat, so the school's own
    window is drawn instead, starting no earlier than the last lesson ends.
    """
    windows = (cfg or {}).get("blockGaps") or []
    if not windows or not slots:
        return []
    found = []
    for window in windows:
        # Which class eats when is a canteen decision, not a school-wide one,
        # so a window can name the classes it belongs to.
        wanted = window.get("classes")
        if wanted and class_name.strip() not in [c.strip() for c in wanted]:
            continue
        least = window.get("least", 30)
        opens = _minutes(window.get("after", "0:00"))
        closes = _minutes(window.get("before", "23:59"))
        for i, (before, after) in enumerate(zip(slots, slots[1:]), start=1):
            at = _minutes(before["end"].replace(".", ":"))
            until = _minutes(after["start"].replace(".", ":"))
            if until - at >= least and opens <= at < closes:
                found.append({"after": i, "name": window["name"], "at": at,
                              "until": until, "start": before["end"],
                              "end": after["start"]})
                break
    if found:
        return found

    window = (cfg or {}).get("lunch")
    if not window:
        return []
    ends = _minutes(slots[-1]["end"].replace(".", ":"))
    at, until = max(_minutes(window[0]), ends), _minutes(window[1])
    if at >= until:
        return []                     # the day runs through it, so nobody stops
    # Only a school with one window has a fallback, so its name is the one.
    return [{"after": len(slots), "name": windows[0]["name"], "at": at, "until": until,
             "start": _fmt_time(at), "end": _fmt_time(until)}]


def class_grades(names, cfg):
    """Which year each class is in, and which names are not classes at all.

    Most schools write the year into the name: `5.a` and `6. S` are the fifth
    and sixth years, and the number at the front is the answer.

    LõunaTERA names its classes after their teacher — Maarja, Heliis, Sille —
    so the name says nothing. It marks the years with rows of their own: a
    class called `3`, carrying no lessons, standing in the list in front of the
    classes in the third year. The order of the list is the only place that
    says which teacher teaches which year, and the school's own page reads it
    the same way.

    A row like that is not a class and must not be offered as one. Only for a
    school that says it works this way, because `7` and `8` are real classes at
    ProTERA and dropping those would lose two years of the school.
    """
    grades, markers, year = {}, set(), None
    for name in names:
        plain = (name or "").strip()
        if cfg and cfg.get("gradeRows") and re.fullmatch(r"\d+", plain):
            year = int(plain)
            markers.add(name)
            continue
        first = re.match(r"(\d+)", plain)
        grades[name] = int(first.group(1)) if first else year
    return grades, markers


def _regroup_rule(cfg, class_name):
    """The day-by-day group remapping this class needs, if the school needs one."""
    for rule in (cfg or {}).get("regroup", []):
        # Trailing space and all, the way band_slots matches.
        if class_name.strip() in [c.strip() for c in rule["classes"]]:
            return rule["days"]
    return None


def regroup(cfg, class_name, day, names):
    """What the class really calls these groups on this day.

    aSc names one group per lesson, which assumes that a group meets at the
    same period every week. Where a school swaps two groups between two periods
    from one day to the next, that assumption is wrong: the names aSc keeps are
    placeholders, and a reader who picks one is shown the wrong lesson on one of
    the days. This maps them onto the groups the school itself names.
    """
    days = _regroup_rule(cfg, class_name)
    if not days:
        return names
    for wanted, mapping in days.items():
        if day in wanted:
            return [mapping.get(n, n) for n in names]
    return names


def regroup_all(cfg, class_name, names):
    """Every name the remapping can produce, which is what a picker offers.

    One aSc group becomes two, because the two days disagree about which group
    it is. A name no rule touches comes through as it is.
    """
    days = _regroup_rule(cfg, class_name)
    if not days:
        return names
    return sorted({mapping.get(name, name)
                   for name in names for mapping in days.values()})


def band_slots(cfg, class_name, day, grade=None):
    """The published blocks for this class on this day, if the school lists them.

    A block covering two aSc periods is one box, as a paired slot is. The dicts
    are not interchangeable though: these carry `at`/`start`/`end` and no
    `used`, because a published block has no clock to run and nothing to trim.
    `extract` branches on which of the two it is holding.
    """
    for band in cfg.get("bands", []):
        # By year where the school's own list says which year a class is in,
        # and by name where the name is all there is. A year is worth
        # preferring: a school renames a class when its teacher changes, and a
        # list of names here would then quietly stop covering it.
        if "grades" in band:
            if grade not in band["grades"]:
                continue
        # aSc hands back what someone typed, trailing space and all: LõunaTERA
        # has a class called "Silva ". Matching it literally lost that class its
        # times, and a class with no times draws nothing at all.
        elif class_name.strip() not in [c.strip() for c in band["classes"]]:
            continue
        for days, blocks in band["days"].items():
            if day not in days:
                continue
            out = []
            for block in blocks:
                period, span, start, end = block[:4]
                slot = {"period": period, "periods": span, "at": _minutes(start),
                        "start": _fmt_time(_minutes(start)),
                        "end": _fmt_time(_minutes(end))}
                # A fifth time, where a lesson that runs on from this slot
                # stops somewhere other than the end of the next one. LõunaTERA
                # gives its fifth and sixth periods two shapes: two lessons of
                # 45 minutes with a break between them, or one of 80 that ends
                # before the second would have.
                if len(block) > 4:
                    slot["runsOn"] = _fmt_time(_minutes(block[4]))
                out.append(slot)
            return out
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
                    # Otherwise a half-written file stays a permanent cache
                    # hit, and fails the same way on every run.
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
            try:
                with open(tmp, "w", encoding="utf-8") as fh:
                    json.dump(payload, fh, ensure_ascii=False)
                os.replace(tmp, path)
            finally:
                # A run stopped between the write and the move would otherwise
                # leave the part behind, and the cache directory is checked in.
                if os.path.exists(tmp):
                    os.unlink(tmp)
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
        # The school's own clock, when it kept one. aSc leaves every period at
        # 00:00 unless somebody filled the times in, so a period with real ones
        # is a deliberate answer and can be used as the day plan.
        "periodTimes": {p["num"]: (p["start"], p["end"]) for p in periods
                        if p["start"] not in ("", "00:00")
                        and p["end"] not in ("", "00:00")} or None,
        "validity": worth_showing(settings.get("m_strDateBellowTimeTable", "")),
        "classNames": [c["name"] for c in T["classes"]],
    }


def day_slots(blocks, n_periods, always_paired=0):
    """Split a day into lesson slots — "the 1st lesson", "the 2nd lesson", ….

    A slot is as long as the longest lesson that starts on it. Different
    groups of the same class can pair the same periods differently. On one
    ProTERA Tuesday, one group has a single at period 7 and another has a pair
    over 7-8. Both are the day's 4th lesson, so both belong to slot 4.
    """
    longest = {}
    for start, duration in blocks:
        longest[start] = max(longest.get(start, 1), duration)
    slots, pos = [], 1
    while pos <= n_periods:
        # A school that teaches its first slots as doubles does so whatever card
        # happens to sit there: a single in slot 1 is still the first lesson,
        # and 45 minutes for it starts every later slot early.
        forced = 2 if len(slots) < always_paired else 1
        step = max(longest.get(pos, 1), forced)
        # Used if a lesson starts anywhere inside it, not only on its first
        # period. A slot widened by `forced` can hold a lesson that begins
        # half-way through it, and calling that slot free let the trim below
        # delete it out from under the lesson — which then had no time at all.
        slots.append({"period": pos, "periods": step,
                      "used": any(pos + k in longest for k in range(step))})
        pos += step
    while slots and not slots[-1]["used"]:      # trim trailing free slots
        slots.pop()
    return slots


def name_whole_class_groups(T, cls, groups, lessons):
    """A lesson the school marked "whole class" but which runs beside groups.

    One aSc lesson can serve several classes, and the group it names is per
    class. TäheTERA's fourth maths group is "Mat 4" in 5.a and "whole class" in
    5.l and 5.t, which is a slip: those classes are already split three ways at
    that hour, so a fourth lesson at the same hour cannot be for all of the
    class. Read as written, it was drawn beside whichever group the reader
    picked, and no pick ever removed it.

    So: where a subject runs at one hour both in groups and as the whole class,
    the whole-class card is a further group. Where the same lesson names exactly
    one real group in another class, that name is the school's own word for it
    and is what the reader picks. Where it names none, nothing is invented and
    the lesson is left as it is.

    Returns {lesson id: (group name, division id)}.
    """
    placed = {}
    for card in T["cards"]:
        lesson = lessons.get(card["lessonid"])
        if not lesson or cls["id"] not in lesson["classids"]:
            continue
        if not card["period"] or "1" not in (card["days"] or ""):
            continue
        start = int(card["period"])
        for day_idx, flag in enumerate(card["days"]):
            if flag != "1":
                continue
            for step in range(lesson.get("durationperiods") or 1):
                placed.setdefault((day_idx, start + step), []).append(lesson)

    def own_groups(lesson):
        return [groups[g] for g in lesson["groupids"]
                if g in groups and groups[g]["classid"] == cls["id"]
                and not groups[g]["entireclass"]]

    named = {}
    for here in placed.values():
        by_subject = {}
        for lesson in here:
            by_subject.setdefault(lesson["subjectid"], []).append(lesson)
        for beside in by_subject.values():
            grouped = [x for x in beside if own_groups(x)]
            if not grouped:
                continue
            for lesson in beside:
                if own_groups(lesson) or lesson["id"] in named:
                    continue
                elsewhere = sorted({groups[g]["name"] for g in lesson["groupids"]
                                    if g in groups and not groups[g]["entireclass"]})
                if len(elsewhere) != 1:
                    continue
                division = own_groups(grouped[0])[0]["divisionid"]
                named[lesson["id"]] = (elsewhere[0], division)
    return named


def extract(result, class_name, n_periods=None, cfg=None, period_times=None,
            grade=None):
    """Flatten the aSc relational tables into one lesson row per (day, period)."""
    T = tables(result)
    subjects, teachers = index(T["subjects"]), index(T["teachers"])
    classrooms, groups, lessons = index(T["classrooms"]), index(T["groups"]), index(T["lessons"])

    matches = [c for c in T["classes"] if c["name"] == class_name]
    if not matches:
        available = ", ".join(c["name"] for c in T["classes"])
        raise SystemExit(f"Class {class_name!r} not in this timetable. Available: {available}")
    cls = matches[0]

    # A group the school forgot to name here. See name_whole_class_groups.
    unnamed = name_whole_class_groups(T, cls, groups, lessons)

    # Divisions are the "pick one group" axes a student chooses along.
    divisions = []
    for div in T["divisions"]:
        if div["classid"] != cls["id"] or not div["ascttdivision"]:
            continue
        members = [groups[g]["name"] for g in div["groupids"]
                   if g in groups and not groups[g]["entireclass"]]
        # A group read back off the timetable belongs on the same axis as the
        # groups it runs beside, or the reader is never offered it.
        members += [name for name, where in unnamed.values() if where == div["id"]]
        if members:
            # A picker offers every group the reader could be in, which is not
            # always what aSc lists. See regroup_all.
            divisions.append({"id": div["id"],
                              "groups": regroup_all(cfg, class_name,
                                                    sorted(set(members)))})
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
        if not grp and lesson["id"] in unnamed:
            grp = [unnamed[lesson["id"]][0]]
        base = {
            # aSc's own id for this placed lesson. Nothing on the page shows
            # it; the calendar export names its events after it, so a lesson
            # the school later moves keeps its identity and a second import
            # corrects the entry instead of drawing a second one beside it.
            "card": card["id"],
            "subject": subject.get("name", "?"),
            "subjectShort": subject.get("short", "?"),
            "schoolColor": subject.get("color", ""),
            "groups": grp,
            "teachers": [teachers[t]["name"] for t in lesson["teacherids"] if t in teachers],
            "teacherShorts": [teachers[t]["short"] for t in lesson["teacherids"] if t in teachers],
            # Stripped: the school writes some of these with a trailing space
            # — "305 " — and on a card the width of a bus ticket that space is
            # the difference between a room number and an ellipsis.
            "rooms": [classrooms[c]["short"].strip()
                      for c in card["classroomids"] if c in classrooms],
            "duration": lesson.get("durationperiods") or 1,
        }
        start = int(card["period"])
        for day_idx, flag in enumerate(card["days"]):
            if flag != "1":
                continue
            # Which group this is can depend on the day. See regroup.
            here = dict(base, groups=regroup(cfg, class_name, day_idx, grp))
            for step in range(base["duration"]):
                entries.append(dict(here, day=day_idx, period=start + step,
                                    startPeriod=start, part=step))

    for e in entries:
        if e["subject"] in (cfg or {}).get("breakSubjects", ()):
            e["isBreak"] = True
            # aSc wants a teacher on every card, so a break carries one that is
            # not a person: LõunaTERA's is "Vahe Paus", which is "break pause".
            # Nobody reads a break to find out who is supervising it.
            e["teachers"], e["teacherShorts"] = [], []
    entries.sort(key=lambda e: (e["day"], e["period"], e["subject"], "/".join(e["groups"])))

    # Slot the day, so a paired lesson is one cell and the breaks land in a
    # fixed column whatever shape the day happens to take.
    n_periods = n_periods or max((e["period"] for e in entries), default=0)
    # EduPage's own period times, for a school with no hand-written plan.
    clock = period_times
    shape = {}
    for day in {e["day"] for e in entries}:
        published = band_slots(cfg, cls["name"], day, grade) if cfg else None
        if published:
            used = {e["startPeriod"] + k for e in entries if e["day"] == day
                    for k in range(e["duration"])}
            slots = [s for s in published
                     if any(s["period"] + k in used for k in range(s["periods"]))]
            breaks = block_gaps(cfg, slots, class_name)
        else:
            blocks = {(e["startPeriod"], e["duration"]) for e in entries
                      if e["day"] == day and e["part"] == 0}
            slots = day_slots(blocks, n_periods, (cfg or {}).get("alwaysPaired", 0))
            # A school whose plan is published as blocks has no clock to run, so
            # a class its bands do not cover — the empty markers standing in for
            # a grade, say — goes without times.
            if cfg and not cfg.get("bands"):
                kinds = ["P" if s["periods"] > 1 else "L" for s in slots]
                times, breaks = day_times(kinds, cfg)
                breaks = with_meals(breaks, cfg, class_name, day)
                for slot, time in zip(slots, times):
                    slot.update(time)
            elif clock:
                # EduPage's own period clock. A slot runs from the start of its
                # first period to the end of its last, so a pair is one box
                # spanning both and the gap between them stays a gap.
                breaks = []
                for slot in slots:
                    first = clock.get(slot["period"])
                    last = clock.get(slot["period"] + slot["periods"] - 1, first)
                    if not first:
                        continue
                    at = _minutes(first[0])
                    slot.update({"at": at, "start": _fmt_time(at),
                                 "end": _fmt_time(_minutes(last[1]))})
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
                # Where the school says a run-on lesson stops early, it stops
                # there. Otherwise it stops where the last slot it covers does.
                ends = last["end"]
                if last is not slot and slot.get("runsOn"):
                    ends = slot["runsOn"]
                e["startMin"] = slot["at"]
                e["endMin"] = _minutes(ends.replace(".", ":"))
                e["time"] = f"{slot['start']}–{ends}"
            elif clock and e["slot"] and "at" in slots[e["slot"] - 1]:
                first = clock.get(e["startPeriod"])
                last = clock.get(e["startPeriod"] + e["duration"] - 1, first)
                if first:
                    at, end = _minutes(first[0]), _minutes(last[1])
                    e["startMin"], e["endMin"] = at, end
                    e["time"] = f"{_fmt_time(at)}–{_fmt_time(end)}"
            elif cfg and not cfg.get("bands") and e["slot"]:
                slot = slots[e["slot"] - 1]
                if e["startPeriod"] != slot["period"]:
                    # Starts part-way through a slot another group takes whole.
                    # The day plan never splits a pair, so the exact time is
                    # unknown. Span the slot, and let the view mark it.
                    e["offSlot"] = True
                    e["startMin"] = slot["at"]
                    e["endMin"] = slot["at"] + (cfg["paired"] if slot["periods"] > 1
                                                else cfg["single"])
                else:
                    length = cfg["paired"] if e["duration"] > 1 else cfg["single"]
                    e["startMin"] = slot["at"]
                    e["endMin"] = slot["at"] + length
                    e["time"] = f"{_fmt_time(slot['at'])}–{_fmt_time(slot['at'] + length)}"

    if cfg and cfg.get("bands") and any(band_slots(cfg, cls["name"], d, grade)
                                        for d in shape):
        entries = merge_blocks(entries)

    entries = bus_to_lesson(cfg, class_name,
                            split_lessons(cfg, class_name, entries), shape)
    label_divisions(divisions, entries)
    # A division that asks two questions at once. See split_by_subject.
    divisions = split_by_subject(cfg, class_name, divisions, entries)
    name_the_groups(divisions, entries)
    divisions = [d for d in divisions if d["lessons"]]
    # After the filter above, which drops a division no lesson uses. These are
    # exactly that by construction.
    divisions += asked_divisions(cfg, class_name)

    return {
        "name": cls["name"],
        # Which year, where the school says. Read by the day plan, and shown
        # to a reader whose school leaves the year out of the name.
        "grade": grade,
        "divisions": divisions,
        "subjects": sorted({e["subject"] for e in entries}),
        "entries": entries,
        "shape": shape,
        "maxSlots": max((len(v["slots"]) for v in shape.values()), default=0),
    }


def merge_blocks(entries):
    """One box per lesson the school publishes, whatever way aSc records it.

    A published block covers one or two aSc periods. Inside it there can be a
    sequence — Häälestus and then Üldõpetus, which the school writes as a single
    9.00-10.50 — or a set of choices running side by side, Kodundus or Käsitöö
    or Puutöö. Both can also be recorded as one card per period rather than one
    card spanning two, and then the same lesson appears twice over.

    So: entries naming a group are left alone, because a group is already the
    thing that tells them apart. Otherwise, if every entry starts on its own
    period the block is a sequence and becomes one box naming each subject in
    turn. If any two share a period, the block holds choices, and each subject's
    entries merge among themselves so the choices stay side by side.

    The color goes to whichever subject fills more of the block, and to the
    later one when they fill it equally: a block that opens with a warm-up
    must look like what it becomes.
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
        if len(here) == 1:
            out.extend(here)
            continue
        if any(x["groups"] for x in here):
            # A block the class splits across. Two groups at once are two
            # boxes side by side, which is the point of a group — but one
            # group taking the same subject on both halves of the block is one
            # lesson, and it was drawn beside itself. TäheTERA 5.a has English
            # on both periods of a Tuesday block, once for each of its three
            # groups, and every group saw two of itself.
            split = {}
            for x in here:
                split.setdefault((x["subject"], tuple(x["groups"])), []).append(x)
            for run in split.values():
                one = len(run) > 1 and len({x["startPeriod"] for x in run}) == len(run)
                out.append(_one_box(run)) if one else out.extend(run)
            continue
        starts = {x["startPeriod"] for x in here}
        if len(starts) == len(here):
            out.append(_one_box(here))
            continue
        by_subject = {}
        for x in here:
            by_subject.setdefault(x["subject"], []).append(x)
        for group in by_subject.values():
            # Only a subject spread across distinct periods is one lesson. The
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
    names, shorts = [], []
    for x in here:
        if x["subject"] not in names:
            names.append(x["subject"])
            shorts.append(x["subjectShort"])
    joined["names"] = names if len(names) > 1 else None
    joined["nameShorts"] = shorts if len(names) > 1 else None
    # The span the parts cover, not the sum of their lengths. Otherwise two
    # cards that overlap on a period make a box longer than the block it sits
    # in, and the page draws it past the end of the day.
    last = max(x["startPeriod"] + x["duration"] for x in here)
    joined["duration"] = last - here[0]["startPeriod"]
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


def split_by_subject(cfg, class_name, divisions, entries):
    """One picker per subject, where the two choices are really independent.

    aSc gives a class one division per way it splits, and a group of that
    division carries every subject taught to it. Usually that is the truth: a
    class divided into science sets keeps the same sets across the sciences.
    Sometimes it is not, and then one picker asks one question where a reader
    has two to answer. See perSubject in BELLS for the case that says so.

    Only the subjects the rule names are pulled apart, and only where the
    division carries more than one of them. Each half offers the groups that
    take that subject, and is filed under a key of its own so the two picks are
    free of one another, and so that neither inherits an answer given before
    the split.
    """
    rule = None
    for entry in (cfg or {}).get("perSubject", []):
        # Trailing space and all, the way band_slots matches.
        if class_name.strip() in [c.strip() for c in entry["classes"]]:
            rule = entry["subjects"]
            break
    if not rule:
        return divisions

    out = []
    for div in divisions:
        wanted = [s for s in rule if s in div["subjects"]]
        if len(wanted) < 2:
            out.append(div)
            continue
        for subject in wanted:
            groups = [g for g in div["groups"]
                      if any(g in e["groups"] and e["subject"] == subject
                             for e in entries if not e["part"])]
            if not groups:
                continue
            part = dict(div, id=div["id"] + "/" + subject, only=subject,
                        groups=groups, subjects=[subject], label=subject)
            # What the reader's pick is filed under. Every other division falls
            # back to its group list, and both halves have the same one, so
            # both are named here instead.
            #
            # Both, and not only the second: a pick saved before the split
            # answered one of the two subjects, and nothing records which. Let
            # the first half keep the plain key and that old answer lands on it
            # whatever it meant, so a reader who picked their English set is
            # shown that set's Estonian lessons and is told nothing. Neither
            # half matches now, both are asked again, and an unanswered picker
            # is on the screen where a wrong one was not.
            part["key"] = subject + ": " + "/".join(groups)
            out.append(part)
    return out


def label_divisions(divisions, entries):
    """Name each group picker after what is actually taught in it.

    A division that only ever carries one subject is that subject. A couple of
    subjects are listed. More than that is shortened, and the page keeps the
    whole list for the tooltip.
    """
    for div in divisions:
        counts = {}
        for e in entries:
            if e["part"]:
                continue
            if div.get("only") and e["subject"] != div["only"]:
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


# A group is named by a code the school keeps for itself: "HK1", "IK2",
# "Grupp 1". A reader knows who teaches them and not which code that is, so
# the picker says the teacher too.
#
# Three is where a list of names stops being a hint. Beyond that the group is
# not a language set but a whole half of the class, taking its own six or seven
# subjects — and there the code is already something a reader recognises,
# because it is their own class: "7.a", "Alfa".
MOST_TEACHERS = 3


def name_the_groups(divisions, entries):
    """Who teaches each group, for the picker to say beside its code.

    Where a division carries one subject, the subject is already in the heading
    above the picker and the names go on their own. Where it carries several,
    each name is prefixed by what that teacher takes, because the whole
    question is which of them the reader has.
    """
    for div in divisions:
        who = []
        for group in div["groups"]:
            # Subjects per teacher, in the order the day runs.
            taught, wants = {}, {}
            for e in entries:
                if e["part"] or group not in e["groups"]:
                    continue
                if div.get("only") and e["subject"] != div["only"]:
                    continue
                for name in e["teachers"]:
                    taught.setdefault(name, [])
                    wants.setdefault(name, [])
                    if e["subjectShort"] not in taught[name]:
                        taught[name].append(e["subjectShort"])
                    if e["subject"] not in wants[name]:
                        wants[name].append(e["subject"])
            if not taught or len(taught) > MOST_TEACHERS:
                who.append([])
                continue
            with_subject = len(div["subjects"]) > 1 and len(taught) > 1
            # In the division's own subject order, so every option in one
            # picker lists its teachers the same way round. Read off the day
            # instead, two groups of the same division came out in different
            # orders and could not be compared at a glance.
            rank = {name: i for i, name in enumerate(div["subjects"])}
            order = sorted(taught, key=lambda name: (
                min(rank.get(s, len(rank)) for s in wants[name]), name))
            who.append([[name, "/".join(taught[name]) if with_subject else ""]
                        for name in order])
        div["who"] = who if any(who) else None


def _year_first(grade, name):
    """The name with the year in front, or nothing if it is there already."""
    if not grade:
        return ""
    name = name.strip()
    if re.match(r"\s*0*%d\D" % grade, name) or name == str(grade):
        return ""
    return "%d. %s" % (grade, name)


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
            meta = timetable_meta(result)
            label = short_label(entry["text"])
            cfg = bell_config(label, entry["text"])
            n_periods = len(meta["periods"])
            # A school with no hand-written day plan can still publish its own
            # period times in EduPage. Those are as good as a bell schedule and
            # better than nothing, which is what the fallback grid is.
            own_times = None if cfg else meta["periodTimes"]
            grades, markers = class_grades(meta["classNames"], cfg)
            classes = [extract(result, name, n_periods, for_class(cfg, name),
                               own_times, grades.get(name))
                       for name in meta["classNames"] if name not in markers]
        except (RuntimeError, KeyError, TypeError, IndexError, ValueError) as exc:
            print(f"warning: skipping timetable {entry['tt_num']} "
                  f"({type(exc).__name__}: {exc})", file=sys.stderr)
            continue
        classes = [c for c in classes if c["entries"]]
        if not classes:
            continue
        if bool(cfg) or meta["periodTimes"]:
            # A timed school draws a timeline, and a timeline can only draw a
            # lesson it has a time for. Anything left untimed here is a lesson
            # the day plan does not cover — say the school moved a period, or
            # added one past the end of a published block. Such a lesson does
            # not appear at all. Say so rather than lose it in silence.
            #
            # Only for a class the plan claims. A school can have a sheet for
            # one class and none for the others — TäheTERA has one of fourteen
            # — and those others fall back to the plain grid on purpose. That
            # is not a plan that has gone stale, and saying so nightly for
            # thirteen classes would bury the one time it has.
            for c in classes:
                covered = cfg and (not cfg.get("bands") or
                                   any(band_slots(cfg, c["name"], d, c.get("grade"))
                                       for d in range(7)))
                lost = [e for e in c["entries"]
                        if not e["part"] and e.get("startMin") is None]
                if lost and covered:
                    where = ", ".join(sorted({f"day {e['day']} period {e['period']}"
                                              for e in lost})[:4])
                    print(f"warning: {label} class {c['name'].strip()!r}: "
                          f"{len(lost)} lesson(s) the day plan has no time for "
                          f"({where}) — they will not be drawn", file=sys.stderr)
        schools.append({
            "ttNum": entry["tt_num"],
            "label": label,
            "text": entry["text"],
            "validity": meta["validity"],
            "days": meta["days"],
            "periods": meta["periods"],
            "showTimes": meta["showTimes"],
            "bells": bool(cfg) or bool(meta["periodTimes"]),
            "lunchGap": (cfg or {}).get("lunchGap"),
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
# The lightest comes first, and the family's most common subject is put there:
# it covers the most paper, so it is the one that should recede. A week of
# Üldõpetus in a deep slate reads as a wall.
LIGHTNESS_STEPS = [0.86, 0.42, 0.72, 0.56, 0.34, 0.79, 0.49, 0.64]


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


def palette(names, counts=None):
    """Print-friendly color per subject, with related subjects kept close.

    Each family owns a hue band. Members are spread across it and given
    well-separated lightness steps, which is what keeps them distinct on paper.
    Text color is picked from the background's luminance so every label stays
    legible.

    `counts` says how many lessons each subject has. The most common member of
    a family goes first, which is where the lightest step is. Only the leader
    is moved, and by a wide margin — Inglise keel has 282 lessons against the
    next language's 32 — so a rebuild does not shuffle the week's colors.

    Deterministic: everything else derives from the sorted subject list.
    """
    counts = counts or {}
    families = {}
    for name in sorted(names):
        family, hue = subject_family(name)
        families.setdefault(family, {"hue": hue, "members": []})["members"].append(name)
    for info in families.values():
        top = max(info["members"], key=lambda n: (counts.get(n, 0), n))
        if counts.get(top):
            info["members"].remove(top)
            info["members"].insert(0, top)

    # Subjects with no family keyword still need hues. Give them the gaps left
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


def _hue_of(hex_color):
    """The hue of a rendered color, for checking a family really is spread."""
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return colorsys.rgb_to_hsv(r, g, b)[0] * 360


def _hexpair(hue, light, sat):
    """A background plus whichever of the two text colors reads better on it.

    Mid-luminance backgrounds are the awkward ones: there is a band where
    neither text color clears AA, so step the lightness away from it until one
    does. Deterministic, and it only moves the colors that need moving.
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
# page. Anything that is not plainly a color is dropped rather than trusted.
HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


# A timetable that holds two schools sometimes says which one a subject belongs
# to. "Gümn Matemaatika" is maths, and a reader looking at a gümnaasium class
# knows which school they are in. The prefix comes off the name shown, not off
# the name the subject is filed under: five of these have a twin taught in the
# grades below, with an abbreviation of its own — "Inglise k (B2)" against
# "Eng" — and one entry cannot hold both.
SUBJECT_PREFIXES = ("Gümn ",)


def year_for_school(label, text):
    """The year one school keeps: the shared one, with its own dates over it.

    Matched the way bell_config matches, so "ProTERA ja TERA gümnaasium" finds
    ProTERA. A school that has told us nothing keeps the shared dates.
    """
    year = dict(SCHOOL_YEAR)
    for key, mine in SCHOOL_DATES.items():
        if key.casefold() in (label or "").casefold() or \
           key.casefold() in (text or "").casefold():
            year = dict(year, **mine)
            year["off"] = list(SCHOOL_YEAR["off"]) + list(mine.get("off", ()))
            break
    return year


def split_schools(payload):
    """One EduPage timetable shown as two entries, where a school says so.

    A part with a classPrefix takes the classes whose names start with it; the
    part without takes whatever is left, so the two cannot overlap and nothing
    is dropped. A school with no rule comes through untouched.

    Every part carries `tt`, the timetable it came from. That is what the page
    files a reader's settings under, so splitting a school renames nothing they
    have saved.
    """
    out = []
    for school in payload:
        parts = (bell_config(school["l"], school["t"]) or {}).get("split")
        if not parts:
            out.append(dict(school, tt=school["n"]))
            continue
        claimed = {c["n"] for part in parts if part.get("classPrefix")
                   for c in school["c"]
                   if c["n"].strip().startswith(part["classPrefix"])}
        for part in parts:
            prefix = part.get("classPrefix")
            here = ([c for c in school["c"] if c["n"].strip().startswith(prefix)]
                    if prefix else
                    [c for c in school["c"] if c["n"] not in claimed])
            if not here:
                continue
            piece = dict(school, n=school["n"] + part.get("suffix", ""),
                         tt=school["n"], l=part["label"], c=here)
            # The dates follow the new name, not the timetable's. The old title
            # says "ProTERA ja TERA gümnaasium" and would match both halves, so
            # only the label the part chose gets a say.
            piece.pop("cal", None)
            piece.update(_calendar_of({"label": part["label"], "text": ""}))
            out.append(piece)
    return out


def _calendar_of(school):
    """The `cal` block for one school, or nothing where it has no dates."""
    year = year_for_school(school["label"], school["text"])
    window = term_days(year)
    if not window:
        return {}
    cal = dict(zip(("a", "z", "x"), window))
    # The same days again, named and as stretches, for the panel to show. The
    # export reads `x`; nothing reads both, and a test holds them to agreeing.
    cal["o"] = [{"n": name, "a": first, "z": last}
                for name, first, last in window[3]]
    inside = [e for e in term_events(year) if cal["a"] <= e["date"] <= cal["z"]]
    if inside:
        cal["e"] = [{"d": e["date"], "a": e["from"], "z": e["to"], "n": e["name"]}
                    for e in inside]
    return {"cal": cal}


def term_events(year):
    """One-off hours that replace the lessons they sit on.

    A whole day off is a date in `off`. This is the other kind: an hour the
    school fills with something else, which cancels whatever a class has then
    and puts the event in its place. Only the calendar knows about these — the
    page draws a week that repeats, and a dated hour has no place in one.

    Returns [{"date", "from", "to", "name"}] with the times in minutes, or [].
    """
    out = []
    for one in (year or {}).get("instead", ()):
        out.append({
            "date": one["date"],
            "from": _minutes(one["start"]), "to": _minutes(one["end"]),
            "name": one["name"],
        })
    return out


def _minutes(clock):
    hour, _, minute = str(clock).partition(":")
    return int(hour) * 60 + int(minute or 0)


def term_days(year):
    """The window the export covers, and the school days taken out of it.

    Returns (start, end, [dates off], [named stretches]) as ISO strings, or
    None where no dates are written down — which is also what nothing at all
    answers, so a school with no year is asked about the same way as one with
    half of one. The dates off are only the ones that cost a lesson: inside the
    window, and on a weekday, because a Saturday holiday takes nothing away
    from a timetable that never runs then.

    The named stretches are the same thing said the way a reader reads it: what
    each run of missing days is called, and the first and last school day of
    it. A stretch that costs no school day at all — a holiday on a Saturday —
    is not named, because nothing about the week changes.
    """
    if not (year or {}).get("start") or not (year or {}).get("end"):
        return None
    start = datetime.date.fromisoformat(year["start"])
    end = datetime.date.fromisoformat(year["end"])
    if end < start:
        return None
    off, named = set(), []
    for first, last, name in year.get("off", ()):
        day = datetime.date.fromisoformat(first)
        stop = datetime.date.fromisoformat(last)
        mine = []
        while day <= stop:
            if start <= day <= end and day.weekday() < 5:
                off.add(day.isoformat())
                mine.append(day)
            day += datetime.timedelta(days=1)
        if mine:
            named.append((name, mine[0].isoformat(), mine[-1].isoformat()))
    named.sort(key=lambda x: (x[1], x[0]))
    return year["start"], year["end"], sorted(off), named


def plain_subject(name):
    """The subject's name without the prefix its own timetable puts on it."""
    for prefix in SUBJECT_PREFIXES:
        if not name.startswith(prefix):
            continue
        rest = name[len(prefix):].strip()
        if not rest:
            return name
        # The prefix was carrying the capital. Take it away and the name
        # starts mid-sentence: "Gümn programmeerimise algkursus". Only the
        # first letter, so the words after it keep the school's own casing.
        return rest[0].upper() + rest[1:] if prefix[:1].isupper() else rest
    return name


def break_names(schools):
    """Every break, across every class, however the school writes it.

    A break is drawn like a lesson and can be recolored like one, so it needs a
    color of its own. Most schools write one as a gap between two lessons.
    LõunaTERA writes its own as lessons, with a supervisor and a length.
    """
    gaps = {b["name"] for school in schools for cls in school["classes"]
            for day in cls["shape"].values() for b in day["breaks"] if b["name"]}
    # LõunaTERA's arrive as subjects instead. Same thing to a reader, so the
    # same quiet grey.
    return gaps | {e["subject"] for school in schools for cls in school["classes"]
                   for e in cls["entries"] if e.get("isBreak")}


# A break is a gap, not a lesson. Through the subject palette it came out a
# muddy beige, and a break runs the full width of the day, so the mud won. The
# quiet grey the hatch always used reads as background, which is what a gap is.
# The reader can still recolor it.
BREAK_BG, BREAK_FG = "#EDEFF2", "#4a5058"

# Except the ones that are a meal, which are their own thing. Eating and free
# time are two different answers to "what is this hour", and in one grey with
# labels of much the same length they were a column of identical boxes.
#
# Warm rather than another grey, because a hue is the fastest thing to read at a
# glance — and a step darker as well, because a card is printed as often as it
# is looked at and a printer with no color has only the step. Fifteen points of
# greyscale between them.
#
# Quiet all the same: this is the beige that lost to the lessons, thinned until
# it reads as background. A meal is still a gap in the day.
MEAL_BG = "#EADFC8"

# And a firmer label on it. The grey breaks are the quietest thing on the day
# and a meal is not quite that quiet: it is the one gap a reader plans around.
# Warm, so it belongs to the background it sits on rather than looking borrowed
# from the grey ones, and darker — 8.9:1 against 7.1 for the grey — so the two
# read as two even where the boxes are small and the labels the same length.
MEAL_FG = "#453520"

# Which breaks those are. The names are the schools' own, and a school that
# invents another one fails the test that pins every break name — which is the
# moment to decide which of the two it is, rather than have it quietly land in
# whichever came first.
MEAL_BREAKS = frozenset({"Söömine", "Amps", "Hommikuamps", "Lõuna",
                         "Lõuna + loovaeg"})

# And the page's own name for a hole it worked out to be lunch, where the school
# left the meal to arithmetic instead of naming a band. Same hour, same meal,
# same color — a reader should not be told two different things about it
# depending on which school wrote the timetable. The page calls it this; see
# gapKind in page.js.
WORKED_OUT_LUNCH = "lunch"

# The page's own mark: a week, one column a day, hanging from the morning
# down. Inline, so no browser asks for /favicon.ico and is handed the 404
# page as an image.
ICON = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Crect%20width='16'%20height='16'%20rx='3.5'%20fill='%231C53BA'/%3E%3Crect%20x='1.4'%20y='3.5'%20width='2.0'%20height='9.0'%20rx='1.0'%20fill='%23fff'/%3E%3Crect%20x='4.2'%20y='3.5'%20width='2.0'%20height='3.8'%20rx='1.0'%20fill='%23fff'/%3E%3Crect%20x='7.0'%20y='3.5'%20width='2.0'%20height='7.0'%20rx='1.0'%20fill='%23fff'/%3E%3Crect%20x='9.8'%20y='3.5'%20width='2.0'%20height='3.8'%20rx='1.0'%20fill='%23fff'/%3E%3Crect%20x='12.6'%20y='3.5'%20width='2.0'%20height='9.0'%20rx='1.0'%20fill='%23fff'/%3E%3C/svg%3E"


def break_palette(names):
    meals = MEAL_BREAKS | {WORKED_OUT_LUNCH}
    return {name: ({"bg": MEAL_BG, "fg": MEAL_FG} if name in meals
                   else {"bg": BREAK_BG, "fg": BREAK_FG})
            for name in names}


def compact(schools):
    """Shrink the model for embedding: short keys, subject facts hoisted out.

    The --json export keeps the verbose shape. This form only has to be read by
    the page's own script, and halves the size of the generated file.
    """
    # Per school, not per name. The four timetables are separate aSc documents. They reuse subject
    # names, and abbreviate and color them differently. "Inglise keel" is
    # Eng/#990000 in one and Ik/#00FFCC in another. So one table keyed by name
    # alone hands whichever school was read first to all of them. It is still hoisted out of the entries, which is where the size is.
    subject_meta = {}
    for school in schools:
        here = subject_meta.setdefault(school["ttNum"], {})
        for cls in school["classes"]:
            for e in cls["entries"]:
                # Every subject the box names, not only the one it is filed
                # under. A merged box leads with one subject and mentions the
                # others. Those others need an abbreviation and a color of
                # their own, or the page draws them long and nobody can
                # recolor them.
                for name, short in zip(e.get("names") or [e["subject"]],
                                       e.get("nameShorts") or [e["subjectShort"]]):
                    meta = here.setdefault(name, {})
                    meta.setdefault("short", short)
                    plain = plain_subject(name)
                    if plain != name:
                        meta["label"] = plain
                if HEX_COLOR.match(e["schoolColor"] or ""):
                    here[e["subject"]].setdefault("color", e["schoolColor"])
    out = []
    for school in schools:
        out.append({
            "sj": subject_meta.get(school["ttNum"], {}),
            "n": school["ttNum"],
            "l": school["label"],
            # What the calendar export covers: first day, last day, and the
            # school days taken out between them. Per school, because they do
            # not open their weeks on the same day. Absent where no dates are
            # written down, and then that school offers no export at all.
            **_calendar_of(school),
            "t": school["text"],
            "v": school["validity"],
            "d": [{"i": d["idx"], "n": d["name"]} for d in school["days"]],
            "p": [{"n": p["num"], "l": p["name"], "s": p["start"], "e": p["end"]}
                  for p in school["periods"]],
            "ts": school["showTimes"],
            "b": school["bells"],
            # When a hole in the middle of the day is lunch rather than a
            # corridor, and what to call it. See block_gaps for the bands a
            # school publishes; this is for the ones it leaves to arithmetic.
            "lg": ({"n": school["lunchGap"]["name"],
                    "a": _minutes(school["lunchGap"]["from"]),
                    "z": _minutes(school["lunchGap"]["to"]),
                    "m": school["lunchGap"]["least"]}
                   if school.get("lunchGap") else 0),
            "c": [{
                "n": cls["name"],
                # What to call it, when that is not the name itself. A school
                # that names a class after its teacher says the year in the
                # order of its list rather than in the name, and "Maarja" alone
                # leaves a reader counting rows to find out which one it is.
                # Only where the name is silent about it: most schools open the
                # name with the year, and "7. 7" says it twice.
                #
                # The name itself stays as it is. It is what a shared link
                # carries and what a reader's own settings are filed under, and
                # renaming it would drop both.
                **({"d": _year_first(cls["grade"], cls["name"])}
                   if _year_first(cls["grade"], cls["name"]) else {}),
                "v": [{"id": d["id"], "groups": d["groups"], "l": d["label"],
                       "sj": d["subjects"],
                       # What the pick is filed under, where the group list is
                       # not enough on its own. See split_by_subject.
                       **({"k": d["key"]} if d.get("key") else {}),
                       # Who teaches each group, in the same order. See
                       # name_the_groups: the names are raw, so the page can
                       # write them the way round the reader asked for.
                       "w": d["who"] or 0}
                      for d in cls["divisions"]],
                "m": cls["maxSlots"],
                "h": {str(day): {
                    "s": [{"p": s["period"], "d": s["periods"],
                           "a": s.get("start", ""), "z": s.get("end", "")}
                          for s in v["slots"]],
                    "b": [{"a": b["after"], "n": b["name"],
                           "s": b["start"], "e": b["end"],
                           "m": b["at"], "x": b["until"],
                           # Whose sitting this is, where the class splits,
                           # and what the box adds to its name while the other
                           # one is still on the day beside it.
                           **({"g": b["group"]} if b.get("group") else {}),
                           **({"q": b["note"]} if b.get("note") else {}),
                           **({"f": b["wasNamed"]}
                              if b.get("wasNamed") and b.get("group") else {}),
                           # Drawn only once the reader has answered. See
                           # rides_for.
                           **({"o": 1} if b.get("onlyAnswered") else {})}
                          for b in v["breaks"]],
                } for day, v in cls["shape"].items()},
                "e": [{
                    "d": e["day"], "p": e["period"], "s": e["subject"],
                    "S": e.get("names") or 0,
                    "g": e["groups"], "t": e["teacherShorts"],
                    "T": e["teachers"], "r": e["rooms"], "c": e["part"],
                    "k": e["slot"], "u": e["duration"], "w": e.get("time", ""),
                    "o": 1 if e.get("offSlot") else 0,
                    # Its hours come from the day plan and not from aSc. See
                    # split_lessons and trimBands.
                    **({"D": 1} if e.get("fromPlan") else {}),
                    # Drawn only for a reader who answered for it. See visible.
                    **({"A": 1} if e.get("onlyAnswered") else {}),
                    
                    "B": 1 if e.get("isBreak") else 0,
                    "a": e.get("startMin"), "z": e.get("endMin"),
                    # Only the calendar export reads this. See `card` above.
                    "i": e.get("card", ""),
                } for e in cls["entries"]],
            } for cls in school["classes"]],
        })
    return split_schools(out), subject_meta


# --------------------------------------------------------------------------
# Render
# --------------------------------------------------------------------------

PAGE = """<!DOCTYPE html>
<html lang="et">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Inline, so no browser asks for /favicon.ico and gets the 404 page
     back. It is a week: one column a day, hanging from the morning down. -->
<link rel="icon" href="__ICON__">
<title>__TITLE__</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1b1d21; --muted: #6b7280;
    --line: #d6d9de; --panel: #f6f7f9; --accent: #1f5c8b;
    /* A step darker than --panel, so a heading row still reads as a heading
       above rows that are themselves striped with --panel. */
    --head: #e8ecf1;

    /* The three kinds of type in a lesson box, each the reader's to set: the
       clock, the subject name, and the line of room, teacher and group.
       `--face-*` is which typeface; `--grow-*` is how much larger than the
       page's own size. Both are 1 or inherited until somebody asks otherwise,
       so every size below is written as the size it has always been times a
       number that is normally one. The timeline overrides `--grow-*` on each
       box, because how much larger a name can be is a question about the box
       it is in. */
    --face-time: inherit; --face-name: inherit; --face-detail: inherit;
    --grow-time: 1; --grow-name: 1; --grow-detail: 1;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: var(--fg); background: var(--bg);
  }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .brandline { display: flex; align-items: center; gap: 9px; }
  .mark { flex: 0 0 auto; }
  .sub { color: var(--muted); font-size: 13px; }
  .help { margin: 4px 0 8px; max-width: 62ch; line-height: 1.45; }
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
  /* Wide enough for three digits and no wider: the box says how many characters
     belong in it, and a full-width field invites a sentence. */
  #sheetOwn input[type="number"] { width: 4.5rem; }
  #sheetOwn { display: flex; align-items: center; gap: 6px; }
  .times { color: var(--muted); }
  #subjectPanel { margin-top: 10px; }
  #subjectPanel > summary { cursor: pointer; font-size: 13px; color: var(--accent);
                            padding: 4px 0; }
  #subjectPanel[open] > summary { margin-bottom: 4px; }
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
  .sharebox { width: 100%; margin: 0 0 10px; padding: 7px 9px; font-size: 13px;
              border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .sharebox.off { display: none; }
  /* Both lists — subjects and my own events — are this table, so the columns
     they share sit in the same places and line up down the page. */
  .evtable { width: auto; max-width: 100%; border-collapse: collapse;
             margin: 6px 0 10px; }
  /* A cell here holds several controls, so where one column ends and the next
     begins is the thing that needs saying. A rule down each boundary says it;
     the row stripes are for reading along a row, which is a different job. */
  .evtable th, .evtable td { padding: 3px 12px; white-space: nowrap;
                             border: none; border-left: 1px solid var(--line); }
  .evtable th:first-child, .evtable td:first-child { padding-left: 0;
                                                     border-left: none; }
  .evtable th { font-size: 11px; font-weight: 600; color: var(--muted);
                text-align: left; padding-top: 5px; padding-bottom: 5px;
                background: var(--head); border-bottom: 1px solid var(--line); }
  /* The rule between headings is drawn on the heading itself, so it stays
     visible against the darker background. */
  .evtable th + th { border-left-color: #cdd3da; }
  .evtable td { vertical-align: middle; }
  .evtable tbody tr:nth-child(even) td { background: var(--panel); }
  .evtable .rowlabel { font-size: 13px; padding-right: 18px; }
  /* One color, however it is arrived at: the radio and the control that goes
     with it stay together, and the alternatives line up underneath. */
  /* Side by side while they fit, stacking only once they do not — hence wrap
     rather than a column, and a cell that is allowed to break. */
  .colors { white-space: normal; }
  /* A real lesson box, minus the timeline's absolute placement. 46px is what
     45 minutes comes to at the on-screen scale. */
  .sample { width: 150px; }
  .sample .ev { position: static; width: auto; height: 46px; }
  .colcell { display: flex; flex-wrap: wrap; gap: 3px 14px; align-items: center; }
  .pickrow { display: flex; gap: 6px; align-items: center; }
  /* Not the uppercase treatment .field label gets: these are choices to read,
     not a heading over them. */
  /* `label.pick`, not `.pick`: these sit inside a .field, whose labels are
     styled as small-caps headings, and a heading is not what a choice is. */
  .field label.pick { display: flex; gap: 4px; align-items: center;
          font-size: 12px; text-transform: none; letter-spacing: 0;
          color: inherit; white-space: nowrap; }
  .evtable input[type=time], .evtable input[type=text], .evtable select {
    padding: 4px 6px; font-size: 13px; border: 1px solid var(--line);
    border-radius: 5px; background: #fff; }
  .evtable input[type=text] { width: 100%; }
  .evtable .evlabel { width: 99%; }
  .evtable .subjlabel { width: 11rem; }
  .evtable td.show { text-align: center; width: 3rem; }
  /* A row that draws nothing says so, and still reads well enough to find. */
  .evtable tr.hide td.rowlabel { color: #9aa1ab; text-decoration: line-through; }
  .evtable tr.hide .sample { opacity: .35; }
  /* A gap is not a lesson, so the two do not run together as one list. */
  .evtable tr.grouphead td { padding-top: 14px; font-size: 11px; font-weight: 600;
                             color: var(--muted); text-transform: uppercase;
                             letter-spacing: .05em; border-top: 1px solid var(--line);
                             border-left: none; background: none; }
  .evtable input[type=color] { width: 34px; height: 24px; padding: 0;
    border: 1px solid var(--line); border-radius: 5px; background: #fff; }
  .evtable .drop { border: none; background: none; color: var(--muted);
                   cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px; }
  .evtable .drop:hover { color: #b3261e; }
  .addrow { width: auto; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; min-width: 720px; background: #fff; }
  /* --grid scales the whole table down when a class has too many rows to fit
     one sheet. It is 1 on screen and solved for when printing, the same
     measure-and-shrink the timeline gets; a class with no day plan is drawn
     here and used to print on two or three pages. */
  th, td { border: 1px solid var(--line); vertical-align: top;
           padding: calc(5px * var(--grid, 1)) calc(7px * var(--grid, 1)); }
  .week table { font-size: calc(14px * var(--grid, 1)); }
  thead th { background: var(--panel); font-size: calc(12px * var(--grid, 1));
             text-align: center; white-space: nowrap; }
  tbody th { background: var(--panel); font-size: calc(13px * var(--grid, 1));
             text-align: left; white-space: nowrap; }
  td { min-width: calc(96px * var(--grid, 1)); }
  .lesson { border-radius: 4px; margin-bottom: calc(4px * var(--grid, 1));
            padding: calc(4px * var(--grid, 1)) calc(6px * var(--grid, 1)); }
  .lesson:last-child { margin-bottom: 0; }
  /* The one line in this view that ignored the print scale. It could, while
     it was the size the browser gave it; asked to grow, it has to shrink with
     everything else or the fitter has nothing left to give. */
  .lesson .name { font-weight: 600; font-family: var(--face-name);
                  font-size: calc(14px * var(--grid, 1) * var(--grow-name)); }
  .lesson .meta, .lesson .who {
      font-size: calc(11px * var(--grid, 1) * var(--grow-detail));
      font-family: var(--face-detail); opacity: .85; }
  .lesson .time { font-size: calc(11px * var(--grid, 1) * var(--grow-time));
                  font-family: var(--face-time); opacity: .85;
                  font-variant-numeric: tabular-nums; }
  /* Everything on one line, in this view too. The clock and the quiet line read
     lighter than the name, as they do when the three are stacked. Nothing here
     stops the line wrapping: a table cell grows with what is in it, so there is
     no bottom edge to cut against and nothing to be gained by cutting. */
  .lesson.packed .name .clock {
      font-weight: 400; opacity: .85; font-family: var(--face-time);
      font-variant-numeric: tabular-nums;
      font-size: calc(11px * var(--grid, 1) * var(--grow-time)); }
  .lesson.packed .name .who3 {
      font-weight: 400; opacity: .85; font-family: var(--face-detail);
      font-size: calc(11px * var(--grid, 1) * var(--grow-detail)); }
  .cont { opacity: .62; }
  .brk { background: #f2f3f5; min-width: 60px; }
  /* Scaled like every other clock. It was a fixed size, which is the same fault
     the timeline's breaks had: a reader who asked the page for smaller type got
     it everywhere but here. */
  .brk .time { font-size: calc(11px * var(--grid, 1) * var(--grow-time));
               color: #3d444d; font-variant-numeric: tabular-nums; }
  thead th.brk, tbody th.brk { font-weight: 500; color: var(--muted); font-size: 11px;
                               white-space: normal; min-width: 80px; }
  /* The period column. It holds "1" or "HA", not a weekday, so it needs no
     width of its own and reads better centred. */
  tbody th.slot { text-align: center; }
  .slottime { font-weight: 400; color: #6b7280; font-variant-numeric: tabular-nums; }
  textarea { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; width: 100%;
             padding: 6px 8px; border: 1px solid var(--line); border-radius: 5px;
             resize: vertical; }
  /* Exactly what leaves the browser, in the same monospace the settings box
     uses. Nothing is sent that is not on screen here first. */
  .shown { font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
           background: var(--panel); border: 1px solid var(--line);
           border-radius: 5px; padding: 6px 8px; margin: 4px 0 0;
           max-height: 190px; overflow: auto; white-space: pre-wrap;
           word-break: break-word; }
  .evwarn { font-size: 12px; color: #a33; margin-top: 5px; white-space: pre-line; }
  /* Said once, at the top, and never printed: the sheet is the timetable, not
     a note about how the reader arrived at it. */
  .linkwarn { margin: 0 0 14px; padding: 9px 12px; border-radius: 8px;
              border: 1px solid #f0c9c9; background: #fdf3f3; color: #8a2b2b;
              font-size: 13px; line-height: 1.45; }
  @media print { .linkwarn { display: none; } }
  /* The same voice as the notice above it, with the answers underneath. Amber
     rather than red: nothing is broken, there are two answers and only the
     reader knows which. */
  .linkask { margin: 0 0 14px; padding: 10px 12px; border-radius: 8px;
             border: 1px solid #e8d29a; background: #fdf8ec; color: #6b5320;
             font-size: 13px; line-height: 1.45; }
  .linkask p { margin: 0; }
  .linkask .asked { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
  .linkask .said:empty { display: none; }
  .linkask .said { margin-top: 8px; font-size: 12px; }
  @media print { .linkask { display: none; } }
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
  /* The clock strip and the day headings are furniture, sized in points rather
     than fitted, so on a sheet smaller than a page they crowd out the week they
     are labelling. They shrink with the sheet, down to a floor that keeps them
     readable. See --sheetscale in page.js. */
  .tl { --ppm: 1; --gut: max(26px, calc(58px * var(--sheetscale, 1))); border: 1px solid var(--line); border-radius: 8px;
        overflow: hidden; background: #fff; }
  .tlhead { display: flex; border-bottom: 1px solid var(--line); background: var(--panel); }
  .tlhead .cell { flex: 1 1 0; text-align: center; font-weight: 600;
                  font-size: max(6px, calc(12px * var(--sheetscale, 1)));
                  padding: 6px 4px; border-left: 1px solid var(--line); }
  .tlhead .gut { flex: 0 0 var(--gut); border-left: none; }
  /* The clock runs down a strip of its own, carried on through from the day
     headings above it. The strip is what makes a cut readable: where the axis
     jumps, the strip is torn across and the page shows through the gap. */
  /* Opaque at both ends, never `transparent`. A printer turned the translucent
     half of a gradient solid black — on paper only, never in a PDF viewer,
     which is what a driver does with alpha it does not want to composite. So
     the far half is written as the color behind it rather than as nothing. See
     hatch() in page.js, which was bitten first. */
  .tlbody { display: flex; position: relative; padding: 9px 0 11px;
            background: linear-gradient(to right,
              var(--panel) 0 var(--gut), var(--bg) var(--gut)); }
  .tlaxis { flex: 0 0 var(--gut); position: relative; }
  /* Switched off, the strip takes no width and the days have all of it. The
     gradient behind the body is drawn to the same --gut, so zeroing the one
     variable moves the panel edge with it.
     What goes with it is the mark for an axis cut, which is drawn on the strip.
     A day with hours taken out of it then says so only through the boxes either
     side of the join. */
  .tl.noaxis { --gut: 0px; }
  .tl.noaxis .tlaxis, .tl.noaxis .tlhead .gut { display: none; }
  .tlaxis .t { position: absolute; right: 6px; color: var(--muted);
               font-size: max(5.5px, calc(10.5px * var(--sheetscale, 1)));
               transform: translateY(-50%); font-variant-numeric: tabular-nums; }
  .tlaxis .t.hour { color: #4b5563; font-weight: 600; }
  /* Every half hour is more clock than a small sheet has room for: the labels
     ran into each other and read as a grey smear. The rules behind them stay,
     so the half hours are still there to be seen. */
  body.tight .tlaxis .t:not(.hour) { display: none; }
  /* Nothing here hides the clock inside a box. It did, on any sheet under
     170mm, and on screen as well as on paper because the class follows the size
     of the sheet rather than the printing. The reason was sound while it was
     the only answer available: the strip already says when a lesson is, and a
     copy of it inside a 59-pixel box costs the subject its name.
   *
   * It was still the page reversing the reader. Now that the clock is three
   * checkboxes, a rule here leaves all three doing nothing on the one sheet
   * they were added for — which is how it reads from the outside: a switch that
   * does not switch. What it cost is real, and the reader pays it with the
   * controls instead. */
  /* The half-hour rules, one gradient rather than two stacked. An hour is
     exactly two halves, so one period holds both lines: the darker one on the
     hour and the lighter one between. Stacking them needed the top layer to be
     see-through, and see-through is what a printer turns black. It also meant
     the two layers drew their lines at the same offsets, where the top one
     covered the hour line it was supposed to leave showing. */
  .tlcol { flex: 1 1 0; position: relative; border-left: 1px solid var(--line);
           background-image:
             repeating-linear-gradient(to bottom,
               #d8dbe0 0 1px,
               var(--bg) 1px var(--half),
               #eceef1 var(--half) calc(var(--half) + 1px),
               var(--bg) calc(var(--half) + 1px) var(--hour));
  }
  .ev { position: absolute; border-radius: 4px; padding: 2px 5px; overflow: hidden;
        box-sizing: border-box; border: 1px solid rgba(0,0,0,.18); }
  /* A clock never wraps. In a narrow column "14.10–15.30" broke over two
     lines and took the room the name needed. */
  .ev .when { font-size: calc(10px * var(--grow-time)); opacity: .85;
              font-family: var(--face-time);
              font-variant-numeric: tabular-nums;
              line-height: 1.25; white-space: nowrap; }
  /* Three lines at most, then an ellipsis. "Teadus, fantaasia ja
     ulmekirjandus II" wraps to six in a narrow column, and the box cut it
     mid-word. The tooltip and the subject table carry the whole name. */
  .ev .what { font-weight: 600; font-size: calc(12px * var(--grow-name));
              font-family: var(--face-name); line-height: 1.25;
              display: -webkit-box; -webkit-box-orient: vertical;
              -webkit-line-clamp: 3; overflow: hidden; }
  .ev.snug .what { -webkit-line-clamp: 1; }
  /* Room, teacher and group on one line, cut with an ellipsis. It is the
     secondary line: wrapped, it pushed itself past the bottom of the box and
     was sliced instead, which loses more than an ellipsis does. */
  .ev .who2 { font-size: calc(10.5px * var(--grow-detail)); opacity: .85;
              font-family: var(--face-detail); line-height: 1.25;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ev.tight .what { font-size: calc(11px * var(--grow-name)); }
  /* A box with room for exactly three lines gets exactly three lines. Each is
     cut with an ellipsis rather than wrapped and then sliced by the bottom
     edge, and they are set a little tighter so all three clear 45 minutes:
     10 + 12 + 10.5px of text at 1.1 is 36, and a 45-minute box holds 40. */
  .ev.snug .what, .ev.snug .who2, .ev.snug .when {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      line-height: 1.1; }
  /* One line in a box only tall enough for one, and one line in every box
     where the reader asked for one. The clock reads lighter than the name, as
     it does when the two are stacked, and a name too long for the column is cut
     rather than wrapped out of sight. */
  .ev .what.oneline { font-weight: 600; white-space: nowrap; overflow: hidden;
                      text-overflow: ellipsis; }
  /* Given a second line by `wrapPacked`, because the line did not fit on one and
     the box had another to spare. The clamp is however many lines the box
     measured room for, and it puts the ellipsis on the last of them.

     The clock and the quiet line never break inside themselves: a room number
     split over two lines is not a room number, and neither is half a time. So
     the break falls between the parts, which is what moves the room to the next
     line whole. The subject name is left breakable on purpose — it is the long
     one, and an atom wider than the column has nowhere to go but over the
     edge. */
  .ev .what.oneline.wrap { white-space: normal; text-overflow: clip;
                           display: -webkit-box; -webkit-box-orient: vertical;
                           -webkit-line-clamp: var(--lines, 2); }
  .ev .what.oneline.wrap .clock,
  .ev .what.oneline.wrap .who3 { white-space: nowrap; }
  .ev .what.oneline .clock { font-weight: 400; opacity: .85;
                             font-family: var(--face-time);
                             font-variant-numeric: tabular-nums;
                             font-size: calc(10px * var(--grow-time)); }
  /* Room, teacher and group where they share the line rather than have one of
     their own. Same type as the line they came off, so a packed box reads as
     the same box with the lines pushed together. */
  .ev .what.oneline .who3 { font-weight: 400; opacity: .85;
                            font-family: var(--face-detail);
                            font-size: calc(10.5px * var(--grow-detail)); }
  .ev.approx { border-style: dashed; border-width: 2px; }
  /* Where the axis is cut, the clock strip is torn across: a piece the shape
     of the gap is lifted out, and the two edges left behind match each other
     the way the two halves of a torn sheet do.
     Nothing is drawn across the days. A band there wore the same stripes as a
     break, and the day's own boxes covered it, so it added confusion rather
     than reading as a scale. */
  .tlbreak { position: absolute; left: 0; width: var(--gut); z-index: 1;
             pointer-events: none; display: block; }
  .tlbreak .gap { fill: var(--bg); }
  .tlbreak .edge { fill: none; stroke: #c2c7cf; stroke-width: 1; }
  /* Worked out here, not published by the school, so it does not wear the
     school's hatch. An outline and nothing inside it: the lessons on either
     side already say when it starts and ends. */
  /* An outline rather than a fill, so a worked-out break does not look like
     one the school gave. Fifteen minutes is the shortest it is drawn at, and
     the padding comes off so the one line still fits. */
  .ev.gap { border-style: dashed; border-color: #c3c9d1; padding: 0 5px;
            display: flex; align-items: center; justify-content: center; }
  .ev.gap .what { font-weight: 500; font-size: calc(9.5px * var(--grow-name));
                  line-height: 1.15;
                  text-align: center; white-space: nowrap; overflow: hidden;
                  text-overflow: ellipsis; width: 100%; }
  /* The stripes are translucent, so the color underneath shows through. A
     break is the reader's to recolor like any lesson, and the hatch is what
     still says "not a lesson". */
  /* The hatch itself is written onto the box by hatch() in page.js, mixed
     opaque against whatever color the band carries. It used to live here as
     translucent white, and a printer turned the translucent part solid black
     — on paper only, never in a PDF. */
  .ev.brk { color: #6b7280; border-color: #e2e5ea; }
  /* Smaller than a lesson, and the reader's to size like one. Fixed in pixels,
     these were the one set of boxes that ignored the setting: on a card small
     enough to need 60% type, the breaks stayed at full size and came out the
     largest words on the sheet. `baseSizes` in page.js carries the same three
     numbers, and a test holds the two together. */
  .ev.brk .what { font-weight: 500; font-size: calc(11px * var(--grow-name)); }
  /* A ten-minute band, which at 1.8 pixels a minute is 18 tall. Barely room
     for a line, so the padding thins rather than disappears. */
  .ev.brk.tiny { padding: 1px 4px; }
  .ev.brk.tiny .what { font-size: calc(10.5px * var(--grow-name));
                       line-height: 1.2; }
  /* Shorter than one line of type. A printed sheet is scaled to fit the paper,
     and a ten-minute band on a full week comes out under fourteen pixels —
     where the line no longer fits and the box cuts it. The clock is what a
     reader cannot work out from the lessons either side, so it stays, and the
     type gives way instead. */
  .ev.brk.squeeze { padding: 0 3px; }
  .ev.brk.squeeze .what { font-size: calc(9px * var(--grow-name));
                          line-height: 1; }
  .ev.brk.squeeze .clock { font-size: calc(8.5px * var(--grow-time)); }
  /* A personal event is drawn over the timetable, so it needs to be above it —
     but it should not look like a different kind of thing. It is a lesson in
     every visible respect, whichever way its text color was arrived at: the
     same event used to grow a heavier border for choosing its own, which made
     one choice about text look like a choice about borders. */
  .ev.mine { z-index: 2; }
  input[type=text] { font: inherit; padding: 5px 8px; border: 1px solid var(--line);
                     border-radius: 5px; background: #fff; color: inherit; }
  .hiddenpick { position: absolute; width: 1px; height: 1px; padding: 0; border: none;
                opacity: 0; pointer-events: none; }
  .ev[data-subject], .lesson[data-subject] { cursor: pointer; }
  .divsub { font-size: 10px; color: #9aa1ab; text-transform: none; letter-spacing: 0; }
  .field label[title] { cursor: help; }

  /* Print: the same timeline, laid out at the width of the sheet so what is
     measured on screen is what comes out of the printer. */
  /* The heading shrinks with the sheet. Nineteen point on an A4 page is the
     right weight; on a card the size of a bus ticket it was a third of the
     card. The floor keeps it readable where the arithmetic would not. */
  .ptitle.sheet { font-size: max(8px, calc(19px * var(--sheetscale, 1)));
                  font-weight: 700; text-align: center;
                  padding: 0 0 calc(10px * var(--sheetscale, 1)); border: none; }
  body.printview .count, body.printview .topbar { display: none; }
  body.printview #grid { width: 1054px; }          /* 297mm less two 9mm margins */
  body.printview #grid table { min-width: 0; }
  /* A sheet cut out of the A4 page. The printer is still handed an A4 page, so
     nothing here asks it for paper it does not hold: the smaller sheet is drawn
     on that page with the line to cut along, and the timetable is fitted to the
     line rather than to the paper.

     The measurements arrive as custom properties, and the same two rules serve
     the preview and the printout — what was measured on screen is what comes
     out. `max-width` is the safety net: a sheet as wide as A4 itself cannot
     also clear the printer's margin, and it is held to what the page has. */
  body.printview.cutsheet { box-sizing: border-box; padding: var(--cutpad);
                            width: var(--cutw); height: var(--cuth);
                            border: 1px dashed #b6bcc4; }
  body.printview.cutsheet #grid, body.printview.cutsheet .foot { width: auto; }

  /* Several copies of one small sheet, filling the page. The originals stay in
     the document and go out of sight; #tiles holds the copies.

     The copies sit flush against each other, so one straight cut separates a
     whole row and every line runs the full width or height of the block. Space
     between them would mean two cuts at every boundary and a strip of waste to
     pick off, and it would protect the type no better — the room for a
     wandering scissors is the white inside each copy, which is already there.

     Each copy draws its own right and bottom edge and the block draws its top
     and left, so a line between two copies is one line and not two. The copies
     size those edges inside themselves, but the block's two cannot be: they are
     pulled back by their own width instead. A row of copies can fill the page
     exactly, and one more pixel of line then cost a second sheet of paper. A
     quarter of a millimetre inside a five-millimetre paper edge still prints. */
  /* While there are copies to make, the original is laid out at the width of
     one copy. The fitter measures the original, so measuring it at the width of
     the whole page would scale the week for a sheet three times wider than the
     one it is going on — and a hidden original measures nothing at all, which
     scaled it not at all. It goes out of sight only once the copies are made,
     which is what `copied` says. */
  /* `#grid` and not `.week`, which is the same element: `body.printview #grid`
     sets the A4 width above, and an id beats any number of classes. With that
     rule winning, the original stood at 1054px while the copies were drawn at
     the width of a card, so everything measured on it was measured against a
     week three times wider than the one going on the paper — and the pass that
     gives type back to a box that cannot hold it never had anything to act on.
     The copies have their ids taken off, so this does not catch them. */
  body.printview.tiled > .scroll #grid,
  body.printview.tiled > .foot { width: calc(var(--cutw) - 2 * var(--cutpad)); }
  body.printview.copied > .scroll, body.printview.copied > .foot { display: none; }
  #tiles .tile > .week { width: auto; }
  body.printview.tiled #tiles { display: grid; margin: -1px auto 0;
                                grid-template-columns: repeat(var(--cols), var(--cutw));
                                grid-auto-rows: var(--cuth);
                                width: calc(var(--cols) * var(--cutw));
                                border-top: 1px dashed #b6bcc4;
                                border-left: 1px dashed #b6bcc4; }
  #tiles .tile { box-sizing: border-box; padding: var(--cutpad); overflow: hidden;
                 border-right: 1px dashed #b6bcc4;
                 border-bottom: 1px dashed #b6bcc4; }
  #tiles .tile .foot { width: auto; margin: 8px 0 0; }
  /* The margin is written from the setting into #pagerule below. This copy is
     what a browser gets if the script never runs. */
  /* What a browser gets if the script never runs. The script writes the real
     rule into #pagerule below, which comes after this one and so wins — it has
     to, because two @page rules are resolved by which is written last and not
     by which is more specific. It sat before this one once, where the reader's
     paper edge was worked out, drawn to, and then quietly overridden on the
     way to the printer. */
  @page { size: A4 landscape; margin: 5mm; }
  @media print {
    /* Chrome leaves "Background graphics" off by default, which would drop
       every lesson color — and white-on-white text with it. */
    *, *::before, *::after {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body { padding: 0; }
    .panel, .count, .topbar { display: none; }
    #grid { width: auto; }
    /* The cut sheet again, on paper. `max-width` belongs here and not in the
       preview: on paper the page is what the sheet has to fit inside, and on
       screen it would be the window, which would shrink the preview on a narrow
       one and measure a sheet nobody is printing. */
    body.cutsheet { box-sizing: border-box; padding: var(--cutpad);
                    width: var(--cutw); height: var(--cuth);
                    max-width: 100%; border: 1px dashed #b6bcc4; }
    /* The same block on paper. The page is turned by the @page rule to
       whichever way round fits more copies, so the block is centred in
       whatever shape that leaves. */
    body.tiled > .scroll .week,
    body.tiled > .foot { width: calc(var(--cutw) - 2 * var(--cutpad)); }
    body.copied > .scroll, body.copied > .foot { display: none; }
    body.tiled #tiles { display: grid; margin: -1px auto 0;
                        grid-template-columns: repeat(var(--cols), var(--cutw));
                        grid-auto-rows: var(--cuth);
                        width: calc(var(--cols) * var(--cutw));
                        border-top: 1px dashed #b6bcc4;
                        border-left: 1px dashed #b6bcc4; }

    .ptitle { font-size: 17px; font-weight: 700; text-align: center; }
  }
  .foot { margin: 24px 0 10px; font-size: 11.5px; color: var(--muted); line-height: 1.5; }
  /* Flex, not a float: a floated child adds nothing to its parent's height, so
     the fitting would size the table as if the code were not there and push it
     off the sheet. */
  .foot { display: flex; align-items: flex-start; gap: 16px; }
  .foot .lines { flex: 1 1 auto; }
  /* The sheet leaves the screen behind, so it has to say where it came from.
     The code in the other corner goes to this reader's own timetable; this
     goes to the page itself, for somebody who wants their own. */
  .foot .brand { flex: 0 0 auto; display: flex; align-items: center; gap: 5px; }
  .foot .brand img { width: 13px; height: 13px; }
  .foot .brand span { font-size: 8.5px; white-space: nowrap; }
  .qrbox { flex: 0 0 auto; text-align: center; }
  .qrhint { font-size: 7.5px; max-width: 32mm; line-height: 1.2; margin-top: 2px; }
  .qr { display: block; }
  .foot a { color: inherit; }
  body.printview .foot { width: 1054px; margin: 8px 0 0; font-size: 9px; }
  @media print { .foot { width: auto; margin: 7px 0 0; font-size: 9px; } }
  .count { color: var(--muted); font-size: 12px; margin: 10px 0; }
  @media print { body { padding: 0; } .panel, .count { display: none; } }
</style>
<!-- An @page rule cannot be reached through a class or a custom property, so
     the whole rule is rewritten here when the reader picks a paper edge or a
     sheet. Last in the head, because the stylesheet above carries a copy for a
     browser running no script, and the later of two @page rules wins. -->
<style id="pagerule">@page { size: A4 landscape; margin: 5mm; }</style>
</head>
<body>
<div class="topbar">
  <div>
    <div class="brandline">
      <img class="mark" alt="" width="24" height="24" src="__ICON__">
      <h1 id="heading" data-i18n="appName"></h1>
    </div>
    <div class="sub" id="subtitle"></div>
  </div>
  <div class="topactions">
    <select id="lang" data-i18n-aria="lang"></select>
    <button id="share" data-i18n="share"></button>
    <button id="doprint" class="go" data-i18n="print"></button>
  </div>
</div>
<!-- Only ever shown when the clipboard refused: the link has to be somewhere
     the reader can actually select it. -->
<input id="shareBox" class="sharebox off" readonly aria-label="Link">

<!-- A link this page wrote and cannot read. Above the filter, because it is
     about the whole page rather than about any one control in it. -->
<p class="linkwarn" id="linkwarn" role="status" hidden></p>

<!-- A link and a browser that has been here before, saying different things.
     The link's settings are showing; nothing of the reader's is written over
     until they answer, so every one of the three is still open to them. -->
<div class="linkask" id="linkask" role="status" hidden>
  <p id="linkasksays"></p>
  <div class="asked">
    <button id="clashLink" class="go" type="button"></button>
    <button id="clashMerge" type="button"></button>
    <button id="clashMine" type="button"></button>
    <button id="clashCopy" type="button"></button>
  </div>
  <p class="said" id="linkaskmsg"></p>
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
          <label class="inline"><input type="checkbox" id="showStudentName">
            <span data-i18n="studentName"></span></label>
          <input type="text" id="studentName" size="18">
        </div>
        <div class="line">
          <label class="inline"><input type="checkbox" id="showSchoolName">
            <span data-i18n="schoolName"></span></label>
          <input type="text" id="schoolName" size="30">
        </div>
        <div class="line">
          <label class="inline"><input type="checkbox" id="showClassName">
            <span data-i18n="className"></span></label>
          <input type="text" id="className" size="18">
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
            <label class="inline"><input type="radio" name="teacherNameStyle" value="full">
              <span data-i18n="nameFull"></span></label>
            <label class="inline"><input type="radio" name="teacherNameStyle" value="short">
              <span data-i18n="nameShort"></span></label>
          </span>
          <span class="choice" id="teacherOrder">
            <label class="inline"><input type="radio" name="teacherNameOrder" value="last">
              <span data-i18n="nameLastFirst"></span></label>
            <label class="inline"><input type="radio" name="teacherNameOrder" value="first">
              <span data-i18n="nameFirstLast"></span></label>
          </span>
        </div>
        <!-- The clock, one end at a time. A card the size of a bus ticket has
             room for one of them, and which one is the reader's to say. -->
        <div class="line">
          <label class="inline"><input type="checkbox" id="showStart">
            <span data-i18n="showStart"></span></label>
          <label class="inline"><input type="checkbox" id="showEnd">
            <span data-i18n="showEnd"></span></label>
          <label class="inline"><input type="checkbox" id="showDuration">
            <span data-i18n="showDuration"></span></label>
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
            <label class="inline"><input type="radio" name="subjectNameStyle" value="full">
              <span data-i18n="subjectFull"></span></label>
            <label class="inline"><input type="radio" name="subjectNameStyle" value="short">
              <span data-i18n="subjectShort"></span></label>
          </span>
        </div>
      </div>
    </div>
  </div>
  <!-- Which of the checkboxes above are on is one question; whether what they
       leave on takes a line each or shares one is another. On a sheet the size
       of a card a box is one line tall, so the second question is the one that
       decides how much of the first a reader gets to keep. -->
  <div class="row">
    <div class="field" style="width:100%">
      <label data-i18n="layoutHeading"></label>
      <div class="checklist">
        <div class="line">
          <label class="inline"><input type="radio" name="boxLayout"
            value="stacked"><span data-i18n="layoutStacked"></span></label>
          <label class="inline"><input type="radio" name="boxLayout"
            value="packed"><span data-i18n="layoutPacked"></span></label>
        </div>
      </div>
    </div>
  </div>
  <!-- Free time is not something a lesson says about itself. It is a box the
       page adds to the day where the school left a hole, so it belongs to the
       day and not to the lesson beside it. -->
  <div class="row">
    <div class="field" style="width:100%">
      <label data-i18n="dayHeading"></label>
      <div class="checklist">
        <div class="line">
          <label class="inline"><input type="checkbox" id="showGaps">
            <span data-i18n="showGaps"></span></label>
        </div>
        <!-- The scale, which is a thing the day has and not a thing a lesson
             says about itself. -->
        <div class="line">
          <label class="inline"><input type="checkbox" id="showAxis">
            <span data-i18n="showAxis"></span></label>
        </div>
      </div>
    </div>
  </div>
  <!-- Three kinds of type in a lesson box, each with a typeface and a size.
       The size is what the reader would like; a box with no room for it draws
       what the page has always drawn instead. -->
  <div class="row">
    <div class="field" style="width:100%">
      <label data-i18n="fontHeading"></label>
      <div class="checklist">
        <div class="line">
          <label class="inline" for="nameFace"><span data-i18n="fontName"></span></label>
          <select id="nameFace"></select>
          <select id="nameSize"></select>
        </div>
        <div class="line">
          <label class="inline" for="timeFace"><span data-i18n="fontTime"></span></label>
          <select id="timeFace"></select>
          <select id="timeSize"></select>
        </div>
        <div class="line">
          <label class="inline" for="detailFace"><span data-i18n="fontDetail"></span></label>
          <select id="detailFace"></select>
          <select id="detailSize"></select>
        </div>
      </div>
    </div>
  </div>
  <div class="row">
    <div class="field" style="width:100%">
      <label data-i18n="colorsHeading"></label>
      <div class="checklist">
        <div class="line">
          <label class="inline"><input type="radio" name="subjectColorStyle"
            value="palette"><span data-i18n="paletteColors"></span></label>
          <label class="inline"><input type="radio" name="subjectColorStyle"
            value="school"><span data-i18n="schoolColors"></span></label>
          <label class="inline"><input type="radio" name="subjectColorStyle"
            value="custom"><span data-i18n="customColors"></span></label>
        </div>
      </div>
      <details id="subjectPanel">
        <summary data-i18n="subjects.summary"></summary>
        <div class="scroll">
          <table class="evtable">
            <thead><tr>
              <th data-i18n="colShow"></th>
              <th data-i18n="colSubject"></th>
              <th data-i18n="colLabel"></th>
              <th data-i18n="colShort"></th>
              <th data-i18n="colShortLabel"></th>
              <th data-i18n="colBackground"></th>
              <th data-i18n="colTextColor"></th>
              <th data-i18n="colSample"></th>
            </tr></thead>
            <tbody id="legend"></tbody>
          </table>
        </div>
      </details>
    </div>
  </div>
</details>

<!-- Paper, not screen. These change nothing until the sheet comes out of the
     printer, so they are a section of their own rather than a row among the
     settings that change what is on the screen in front of the reader. -->
<details class="panel" id="printPanel">
  <summary data-i18n="print.summary"></summary>
  <div class="row">
    <div class="field" style="width:100%">
      <div class="checklist">
        <div class="line">
          <label class="inline"><input type="checkbox" id="showQr">
            <span data-i18n="showQr"></span></label>
        </div>
        <div class="line">
          <label class="inline" for="printMargin"><span data-i18n="printMargin"></span></label>
          <select id="printMargin"></select>
        </div>
        <!-- The sheet, and the reader's own measurements beside it. The boxes
             are dimmed rather than hidden while another sheet is chosen, the
             way every other dependent control here behaves. -->
        <div class="line">
          <label class="inline" for="printSheet"><span data-i18n="printSheet"></span></label>
          <select id="printSheet"></select>
          <span class="choice" id="sheetOwn">
            <input type="number" id="printWidth" step="1" data-i18n-aria="sheet.width">
            <span class="times">&times;</span>
            <input type="number" id="printHeight" step="1" data-i18n-aria="sheet.height">
            <span data-i18n="sheet.mm"></span>
          </span>
        </div>
      </div>
      <p class="sub help" id="cutNote" hidden></p>
    </div>
  </div>
</details>

<!-- Next to Print, because the two are the page's ways of taking a week
     away with you. Hidden whole where the school has published no dates: an
     export that guessed them would be worse than none. -->
<details class="panel" id="calendarPanel">
  <summary data-i18n="cal.summary"></summary>
  <div class="row">
    <div class="field" style="width:100%">
      <div class="checklist">
        <!-- What this school's own year does: the days it takes out and the
             hours it fills itself. A reader who knows the week is missing on
             the twenty-first trusts the rest of the file. -->
        <div class="line"><span class="sub" id="calCovers"></span></div>
        <div class="line"><span class="sub" id="calOff" hidden></span></div>
        <div class="line"><span class="sub" id="calInstead" hidden></span></div>
        <div class="line">
          <label class="inline"><input type="checkbox" id="calMine">
            <span data-i18n="cal.mine"></span></label>
        </div>
        <!-- A reminder belongs to those events, so it sits under them and goes
             dim with them. The lessons never get one: a phone that rings thirty
             times a week is a phone with notifications turned off. -->
        <div class="line choice" id="calAlarmRow">
          <label class="inline"><input type="checkbox" id="calAlarm">
            <span data-i18n="cal.alarm"></span></label>
          <span class="choice" id="calLead">
            <label class="inline" for="calAlarmMinutes"
              ><span data-i18n="cal.lead"></span></label>
            <select id="calAlarmMinutes"></select>
          </span>
        </div>
        <div class="line">
          <button id="calGet" data-i18n="cal.download"></button>
        </div>
      </div>
      <p class="sub help" data-i18n="cal.advice"></p>
      <!-- The only links off this page. Neither carries a locale: both articles
           are English whatever is asked for, and pinning one would hand a
           reader whose account runs in some third language ours instead of
           theirs. -->
      <p class="sub"><span data-i18n="cal.apple"></span>
        <a id="calHelpApple" target="_blank" rel="noopener noreferrer"
           href="https://support.apple.com/guide/calendar/import-or-export-calendars-icl1023/mac"
           data-i18n="cal.help.apple"></a></p>
      <p class="sub"><span data-i18n="cal.google"></span>
        <a id="calHelpGoogle" target="_blank" rel="noopener noreferrer"
           href="https://support.google.com/calendar/answer/37118"
           data-i18n="cal.help.google"></a></p>
    </div>
  </div>
</details>

<details class="panel" id="eventsPanel">
  <summary data-i18n="events.summary"></summary>
  <div class="field" style="width:100%;margin-top:12px">
    <label data-i18n="events.label"></label>
    <div class="scroll">
      <table class="evtable">
        <!-- When, then what, then how it looks. The subject list has no when,
             so lining the two up was never going to work past the first column
             and is not worth bending this order for. -->
        <thead><tr>
          <th data-i18n="colWeekday"></th>
          <th data-i18n="colStartTime"></th>
          <th data-i18n="colEndTime"></th>
          <th data-i18n="colLabel"></th>
          <th data-i18n="colNote"></th>
          <th data-i18n="colBackground"></th>
          <th data-i18n="colTextColor"></th>
          <th data-i18n="colSample"></th>
          <th></th>
        </tr></thead>
        <tbody id="evrows"></tbody>
      </table>
    </div>
    <button id="evadd" class="addrow" data-i18n="events.add"></button>
    <div class="evwarn" id="evwarn"></div>
  </div>
</details>

<details class="panel" id="advancedPanel">
  <summary data-i18n="advanced"></summary>
  <div class="field" style="width:100%;margin-top:12px">
    <label for="settingsText" data-i18n="backup"></label>
    <p class="sub help" data-i18n="settings.label"></p>
    <p class="sub help" id="shareNote"></p>
    <p class="sub help" id="printedNote"></p>
    <textarea id="settingsText" rows="5" spellcheck="false"></textarea>
  </div>
  <div class="row" style="margin-top:8px;padding-top:0;border-top:none">
    <button id="copySettings" data-i18n="settings.copy"></button>
    <button id="applySettings" data-i18n="settings.apply"></button>
    <button id="reset" data-i18n="reset"></button>
    <span class="evwarn" id="settingsMsg"></span>
  </div>
</details>

<details class="panel" id="sayPanel">
  <summary data-i18n="say"></summary>
  <div class="field" style="width:100%;margin-top:12px">
    <p class="sub help" data-i18n="say.intro"></p>
    <textarea id="sayText" rows="4" data-i18n-ph="say.placeholder"></textarea>
  </div>
  <div class="field" style="width:100%;margin-top:8px">
    <label class="pick"><input type="checkbox" id="sayWithSettings">
      <span data-i18n="say.withSettings"></span></label>
    <div id="sayPreview" hidden>
      <p class="sub help" data-i18n="say.shown"></p>
      <pre class="shown" id="sayShown"></pre>
    </div>
  </div>
  <div class="row" style="margin-top:8px;padding-top:0;border-top:none">
    <button id="saySend" data-i18n="say.send"></button>
    <span class="evwarn" id="sayMsg"></span>
  </div>
</details>

<input type="color" id="pick" class="hiddenpick" tabindex="-1" aria-hidden="true">

<div class="count" id="count"></div>
<div class="scroll"><div id="grid" class="week"></div></div>
<footer class="foot" id="foot"></footer>
<!-- Copies of the sheet above, when it is small enough that several fit on one
     page. Filled only while printing, and emptied on the way out, so the page
     carries one timetable and not several. -->
<div id="tiles" hidden></div>

__ANALYTICS__
<script>__QRLIB__</script>
<script>__ZIPLIB__</script>
<script id="data" type="application/json">__DATA__</script>
<script>
__APP__</script>
</body>
</html>
"""


def _same_name(a, b):
    """Class names as aSc returns them: one of them has a trailing space."""
    return (a or "").strip().casefold() == (b or "").strip().casefold()


def _class_named(classes, want):
    """The class --class asks for, by its name or by the year in front of it.

    A school that names its classes after their teacher is listed with the year
    said as well, and that is the only form anybody has seen. Asking for
    "1. Maarja" and being told there is no such class would be a poor joke.
    """
    return next((c for c in classes
                 if _same_name(c["name"], want)
                 or _same_name(_year_first(c.get("grade"), c["name"]), want)),
                None)


def _class_list(classes):
    """The names to offer when --class matched none of them."""
    return ", ".join(_year_first(c.get("grade"), c["name"]) or c["name"]
                     for c in classes)


def school_year(today=None):
    """aSc names a school year by the calendar year it starts in.

    Derived rather than pinned: a year written into the source is right until
    the summer it silently is not, and the nightly rebuild keeps asking
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
        hit = _class_named(school["classes"], want_class)
        if not hit:
            # The class can live in another timetable. Find it there instead.
            # Only when no school was named. --school pins the search, and a
            # search in a different timetable ignores what was asked for.
            for other in schools if not want_school else []:
                match = _class_named(other["classes"], want_class)
                if match:
                    return other["ttNum"], match["name"]
            raise SystemExit(
                f"Class {want_class!r} not in {school['label']!r}. Available: "
                + _class_list(school["classes"]))
        klass = hit["name"]
    return school["ttNum"], klass


# Page counts, with the label decided here rather than taken from the page.
#
# Left to itself the counter reports document.title, and this page puts the
# child's name in the title. Such a name then goes to a third party on every
# visit, which is exactly what the page tells the reader does not happen.
# So the count is made by hand instead (`no_onload`), once page.js knows which
# timetable is on screen, out of the school's own names for it. What the reader
# typed is never part of it.
#
# The label goes out as a path as well as a title. The counter keeps one title
# per path, so a title alone collapses every class into a single row, and shows
# whichever one arrived last. The address the reader sees is untouched. This is
# only what the beacon says.
#
# The script is only in the file when a site is named at build time, so a local
# build makes no third-party request at all.
GOATCOUNTER = ('<script>window.goatcounter = {{no_onload: true, referrer: ""}};</script>'
               # crossorigin, because without it a browser hides everything
               # about an error in a script from another origin: the message
               # becomes "Script error." and the stack is empty. gc.zgo.at
               # sends access-control-allow-origin, so this costs nothing.
               '<script id="gc" crossorigin="anonymous"'
               ' data-goatcounter="https://{site}.goatcounter.com/count"'
               ' async src="https://gc.zgo.at/count.js"></script>')


def beside(name, *parts):
    """A file that ships with the generator, read at build time."""
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, *parts, name), encoding="utf-8") as fh:
        return fh.read()


def vendored(name):
    """Third-party code copied into the page. A fetch at run time hands
    the reader's settings to whoever served it."""
    return beside(name, "vendor")


def render_html(schools, edupage, year, initial_school, initial_class, lang="en",
                built="", goatcounter="", report_path=""):
    entries_data, subject_meta = compact(schools)
    # One palette across all four timetables, so a subject looks the same
    # whichever school is on screen. Only the school's own abbreviation and its
    # own color are per-school. Those live on the school, not here.
    # The worked-out lunch is not a name any school wrote, so it is not among
    # the names collected from them. It is drawn all the same.
    gaps = break_names(schools) | {WORKED_OUT_LUNCH}
    all_subjects = sorted({name for per in subject_meta.values() for name in per}
                          - gaps)
    # How much paper each subject covers. The most common one in its family
    # takes the lightest color, so the week reads light where it repeats.
    lessons = collections.Counter(
        e["subject"] for school in schools for cls in school["classes"]
        for e in cls["entries"] if e["part"] == 0 and not e.get("isBreak"))
    payload = {
        "edupage": edupage,
        "year": year,
        "initialSchool": initial_school,
        "initialClass": initial_class,
        "lang": lang,
        "built": built,
        "counts": bool(goatcounter),
        "icon": ICON,
        "report": report_path,
        "languages": [list(x) for x in LANGUAGES],
        "strings": STRINGS,
        "palette": dict(palette(all_subjects, lessons), **break_palette(gaps)),
        "schools": entries_data,
    }
    # A literal "</" closes the block early. A literal "<!--<script" opens a
    # nested one, and swallows the real close. So no "<" survives as itself.
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True).replace("<", "\\u003c")
    tag = GOATCOUNTER.format(site=html.escape(goatcounter, quote=True)) if goatcounter else ""
    return (PAGE
            .replace("__ICON__", ICON)
            .replace("__APP__", beside("page.js"))
            .replace("__QRLIB__", vendored("qrcode-generator.js"))
            .replace("__ZIPLIB__", vendored("fflate.js"))
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
    # Timetables and not schools: one file can be offered as two. See
    # split_schools, which the page's own dropdown counts.
    print(f"wrote {args.out} — {len(schools)} timetables, {classes} classes, {total} lesson slots "
          f"(opens on {initial_school}/{initial_class})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as exc:
        sys.exit(f"network error: {exc}")
