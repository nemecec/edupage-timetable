"""The page in a real browser.

Everything else runs `page.js` under a stub. A stub says nothing about layout,
and nothing at all about the controls: a click reaches a listener through the
DOM, and there is no DOM to reach through. Two whole areas were therefore
untested — what the printed sheet looks like, and whether pressing anything
does what it says.

Chrome is driven over the DevTools protocol by tests/cdp.py, with no automation
framework and nothing to install. Without a browser these tests skip rather
than fail, so a checkout with no Chrome still runs the rest of the suite.

    CHROME_BIN=/path/to/chrome python3 -m unittest tests.test_browser
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "tests", "fixtures")
sys.path.insert(0, os.path.join(ROOT, "tests"))

import cdp

# A4 landscape is 210mm tall. The page's own fitter measures against the same
# number, worked out from the margin the reader picked; this is the default.
SHEET = round(210 * 96 / 25.4) - 2 * round(5 * 96 / 25.4)


def chrome_or_skip():
    try:
        return cdp.find_chrome()
    except RuntimeError as exc:
        raise unittest.SkipTest(str(exc))


def build_once():
    """One build for the whole file. It is the same page every test drives."""
    handle, path = tempfile.mkstemp(prefix="browser-", suffix=".html")
    os.close(handle)
    done = subprocess.run([sys.executable, os.path.join(ROOT, "tt.py"),
                           "--cache", FIXTURES, "--year", "2026", "-o", path],
                          capture_output=True, text=True, cwd=ROOT)
    if done.returncode != 0:
        raise AssertionError(done.stderr)
    return path


class InABrowser(unittest.TestCase):
    """One browser and one page for the whole file. Starting Chrome costs about
    a second, and every test here begins by clearing what the last one left."""

    page = None
    browser = None

    @classmethod
    def setUpClass(cls):
        chrome_or_skip()
        cls.page = build_once()
        cls.browser = cdp.Browser()
        cls.url = "file://" + cls.page
        cls.browser.load(cls.url, "document.body.innerHTML.length > 0")

    @classmethod
    def tearDownClass(cls):
        if cls.browser:
            cls.browser.close()
        if cls.page and os.path.exists(cls.page):
            os.unlink(cls.page)

    def setUp(self):
        """A clean page. Settings live in localStorage and in the address, and
        one test's choices are not the next test's starting point."""
        self.browser.eval("localStorage.clear()")
        self.browser.load(self.url, "document.body.innerHTML.length > 0")

    def visit(self, fragment=""):
        """A real load, fragment and all.

        Going straight from the page to the page-plus-fragment changes only the
        fragment, and a browser answers that without loading anything — so the
        code that reads a link never runs and the test proves nothing. Going by
        way of a blank page makes it a load again.
        """
        self.browser.load("about:blank", "true")
        self.browser.load(self.url + fragment, "typeof render === 'function'")

    def js(self, expression):
        """Evaluate, with objects coming back as objects."""
        return json.loads(self.browser.eval(
            "JSON.stringify((function(){" + expression + "})())"))

    def show(self, school, klass):
        return self.js(
            "state.school=%s; state.class=%s;"
            "renderClasses(); renderDivisions(); syncPerClassInputs(); render();"
            "return {on: [state.school, state.class]};"
            % (json.dumps(school), json.dumps(klass)))


class ThePrintedSheet(InABrowser):
    """What no stub can answer: whether it fits on the paper."""

    def test_every_class_fits_one_page(self):
        """The fitter measures and solves for a scale. A class it cannot fit
        prints a second page with two lessons on it, which is worse than a
        small font. This is the check that used to be run by hand."""
        pairs = self.js(
            "return [].concat.apply([], DATA.schools.map(function (s) {"
            "  return s.c.map(function (c) { return [s.n, c.n]; }); }))")
        self.assertGreaterEqual(len(pairs), 40, "fewer classes than the fixtures hold")
        over = []
        for school, klass in pairs:
            got = self.js(
                "state.school=%s; state.class=%s;"
                "renderClasses(); renderDivisions(); syncPerClassInputs();"
                "printing = true; render();"
                "var g = document.getElementById('grid');"
                "var h = g.getBoundingClientRect().height + footHeight();"
                "var on = [state.school, state.class].join('/');"
                "printing = false; render();"
                "return {h: Math.round(h), on: on};"
                % (json.dumps(school), json.dumps(klass)))
            self.assertEqual(got["on"], school + "/" + klass,
                             "the page did not land on the class it was asked for")
            if got["h"] > SHEET:
                over.append((got["on"], got["h"]))
        self.assertEqual(over, [], "taller than one sheet of %dpx" % SHEET)

    def test_no_box_is_written_wider_or_taller_than_it_is(self):
        """A box gives its text the space it has, and text that does not fit is
        cut by the edge of the box. Cut text reads as a different lesson."""
        pairs = self.js(
            "return [].concat.apply([], DATA.schools.map(function (s) {"
            "  return s.c.map(function (c) { return [s.n, c.n]; }); }))")
        clipped, lines = [], 0
        for school, klass in pairs:
            got = self.js(
                "state.school=%s; state.class=%s;"
                "renderClasses(); renderDivisions(); syncPerClassInputs();"
                "printing = true; render();"
                # The box is what cuts, so the box is what is measured. A
                # line inside it can overflow its own width and still show in
                # full, because the box lets it wrap.
                "var bad = [], seen = 0;"
                "[].forEach.call(document.querySelectorAll('#grid .ev'), function (box) {"
                "  if (box.querySelector('.who2')) seen++;"
                "  if (box.scrollHeight > box.clientHeight + 1) {"
                "    bad.push(box.textContent.slice(0, 30) +"
                "             ' [' + box.clientHeight + '<' + box.scrollHeight + ']'); } });"
                "printing = false; render();"
                "return {bad: bad, seen: seen};"
                % (json.dumps(school), json.dumps(klass)))
            lines += got["seen"]
            clipped += [(school + "/" + klass, text) for text in got["bad"]]
        self.assertGreater(lines, 500, "no detail lines drawn at all")
        self.assertEqual(clipped, [], "text cut by the edge of its box")

    def test_the_qr_code_can_be_asked_for_and_the_address_stays(self):
        """The corner is empty until a reader asks for the code. The address in
        the other corner is where anybody gets a timetable of their own, so it
        stays either way. The code needs the real encoder, which is why this
        is asked of a browser rather than of the stub."""
        self.show("68", "8")
        without = self.js(
            "myOwn().studentName = 'Eva';"
            "printing = true; renderFooter(currentSchool()); printing = false;"
            "return {html: document.getElementById('foot').innerHTML};")["html"]
        self.assertNotIn('class="qr"', without, "the code was printed unasked")

        with_code = self.js(
            "state.showQr = true;"
            "printing = true; renderFooter(currentSchool()); printing = false;"
            "return {html: document.getElementById('foot').innerHTML};")["html"]
        self.assertIn('class="qr"', with_code, "no code on the printed sheet")
        # The address in the other corner is read off location.host, which a
        # page opened from a file does not have. The stub, which does, holds
        # the rule that it stays either way.

        # Through the checkbox, and it survives being written down and read back.
        back = self.js(
            "state.showQr = false;"
            "var box = document.getElementById('showQr');"
            "box.checked = true;"
            "box.dispatchEvent(new Event('change', {bubbles: true}));"
            "return {now: state.showQr,"
            "        back: normalise(JSON.parse(JSON.stringify(slim(state)))).showQr};")
        self.assertTrue(back["now"])
        self.assertTrue(back["back"], "the setting did not survive a saved link")

    def test_a_larger_name_is_given_back_where_it_will_not_fit(self):
        """The arithmetic counts one line per line. A name set larger can wrap
        where it did not before — "Prantsuse keel" is one line at twelve pixels
        and two at fourteen — and only the browser knows how tall that made it.
        Every box that overflows gives its growth back until it fits."""
        self.show("105", "Joanna")
        asked = self.js(
            "state.nameSize = '150'; render();"
            "var boxes = [].map.call(document.querySelectorAll('#grid .ev'),"
            "  function (b) { return {grow: Number(b.style.getPropertyValue("
            "    '--grow-name')) || 1, over: b.scrollHeight > b.clientHeight + 1}; });"
            "return {boxes: boxes,"
            "        full: boxes.filter(function (b) { return b.grow >= 1.5; }).length,"
            "        gaveBack: boxes.filter(function (b) {"
            "                    return b.grow > 1 && b.grow < 1.5; }).length,"
            "        floor: boxes.filter(function (b) { return b.grow < 1; }).length,"
            "        cut: boxes.filter(function (b) { return b.over; }).length};")
        self.assertGreater(len(asked["boxes"]), 10, "nothing was drawn")
        self.assertEqual(asked["cut"], 0, "a box was cut by its own edge")
        self.assertEqual(asked["floor"], 0,
                         "a box was drawn smaller than the page's own size")
        self.assertGreater(asked["full"] + asked["gaveBack"], 0,
                           "nothing grew at all")

        # And at 150% on a tall class, some box really does get the whole ask.
        self.assertGreater(asked["full"], 0, "no box could take the full size")

    def test_the_name_is_larger_than_it_was_and_nothing_is_cut(self):
        """The default asks for the subject name a little larger. Every class
        is checked at print scale by the sweep above; this one checks the
        screen, where the boxes are taller and the type is not scaled down."""
        self.show("68", "8")
        got = self.js(
            "var box = document.querySelector('#grid .ev');"
            "var name = box.querySelector('.what');"
            "var clock = box.querySelector('.when');"
            "return {name: parseFloat(getComputedStyle(name).fontSize),"
            "        clock: clock && parseFloat(getComputedStyle(clock).fontSize),"
            "        grow: box.style.getPropertyValue('--grow-name')};")
        self.assertGreater(got["name"], 12, "the name is no larger than it was")
        self.assertGreater(got["name"], got["clock"],
                           "the name is not larger than the clock beside it")

    def test_a_typeface_reaches_every_view(self):
        """One choice, and the timeline, the fallback grid and the samples in
        the subject table all follow it."""
        self.show("68", "8")
        got = self.js(
            "state.nameFace = 'mono'; render();"
            "var box = document.querySelector('#grid .ev .what');"
            "var sample = document.querySelector('#legend .sample .what');"
            "return {box: getComputedStyle(box).fontFamily,"
            "        sample: sample && getComputedStyle(sample).fontFamily};")
        self.assertIn("mono", got["box"].lower(), "the box kept the old typeface")
        self.assertIn("mono", (got["sample"] or "").lower(),
                      "the sample and the box disagree")

        # The plain grid is what a class no day plan covers falls back to.
        # Every real class has a plan now, so the times come off by hand.
        grid = self.js(
            "currentClass().e.forEach(function (e) { e.a = null; }); render();"
            "var name = document.querySelector('#grid .lesson .name');"
            "return {grid: name && getComputedStyle(name).fontFamily};")
        self.assertIn("mono", (grid["grid"] or "").lower(),
                      "the other view kept the old typeface")

    def test_the_paper_edge_changes_what_there_is_room_for(self):
        """The rule the browser prints by and the height the fitter measures
        against both come from one setting. If they part company, the page is
        scaled for paper of a size nobody is holding."""
        for mm in (5, 9, 14):
            got = self.js(
                "state.printMargin = %d; syncDisplayControls();"
                "return {rule: document.getElementById('pagerule').textContent,"
                "        sheet: sheetHeight(), budget: sheetBudget(),"
                "        picked: document.getElementById('printMargin').value};" % mm)
            self.assertIn("margin: %dmm" % mm, got["rule"])
            self.assertEqual(got["picked"], str(mm))
            self.assertEqual(got["sheet"], round(210 * 96 / 25.4) - 2 * round(mm * 96 / 25.4))
            self.assertLess(got["budget"], got["sheet"])
        # And a narrower edge really does leave more room than a wider one.
        narrow = self.js("state.printMargin = 5; return {h: sheetBudget()};")["h"]
        wide = self.js("state.printMargin = 14; return {h: sheetBudget()};")["h"]
        self.assertGreater(narrow - wide, 60, "the setting barely moved the sheet")


    def test_a_sheet_cut_out_of_a4_is_drawn_at_its_own_size(self):
        """The printer is still handed an A4 page. What changes is the box drawn
        on it, and the box has to measure what it says it does — a sheet cut to
        a line that is a millimetre out is a sheet that does not fit."""
        self.show("68", "8")
        MM = 96 / 25.4
        got = self.js(
            "state.printSheet = 'ipad11a16'; printing = true; render();"
            "var box = document.body.getBoundingClientRect();"
            "var css = getComputedStyle(document.body);"
            "var out = {w: box.width, h: box.height, style: css.borderTopStyle,"
            "           rule: document.getElementById('pagerule').textContent,"
            "           cut: document.body.classList.contains('cutsheet'),"
            "           sheet: sheetHeight(),"
            "           note: !document.getElementById('cutNote').hidden};"
            "printing = false; render();"
            "return out;")
        # Apple's own figures for the device, in the box the reader cuts along.
        self.assertAlmostEqual(got["w"], 248.6 * MM, delta=1)
        self.assertAlmostEqual(got["h"], 179.5 * MM, delta=1)
        self.assertEqual(got["style"], "dashed", "no line to cut along")
        self.assertTrue(got["cut"])
        self.assertTrue(got["note"], "nothing said the sheet has to be cut")
        # The page stays A4, so the printer is never asked for paper it lacks.
        self.assertIn("size: A4 landscape", got["rule"])
        # And the fitter aims at the cut box, less the white around the type.
        self.assertEqual(got["sheet"], round((179.5 - 5) * MM))

    def test_no_gradient_on_the_sheet_has_a_see_through_stop(self):
        """A printer turns the see-through half of a gradient solid black. It
        does it on paper only, never in a PDF viewer, so nothing on screen shows
        it and the reader finds out from the printer. The break hatch was bitten
        first and is mixed opaque in page.js; the half-hour rules and the clock
        strip were bitten next.

        So: every gradient that reaches the sheet must be opaque at every stop.
        Where something needs to look see-through, it is written as the color
        behind it instead. This walks what is really painted, because one of the
        three gradients is built in the script rather than written in the CSS."""
        for school, klass in (("103", "5.a"), ("105", "Maarja"), ("68", "8")):
            self.show(school, klass)
            got = self.js(
                "printing = true; render();"
                "var seen = new Set();"
                "document.querySelectorAll('#grid, #grid *, #foot, #foot *')"
                "  .forEach(function (el) {"
                "    var v = getComputedStyle(el).backgroundImage || '';"
                "    if (v.indexOf('gradient') >= 0) seen.add(v); });"
                "printing = false; render();"
                "return {images: Array.from(seen)};")
            self.assertGreater(len(got["images"]), 0,
                               "no gradients found at all, so nothing was checked")
            for image in got["images"]:
                inside = " ".join(re.findall(r"gradient\((.*)\)", image))
                # rgba(...) is fine only at full alpha. Chrome writes every
                # computed color as rgb() or rgba(), so this sees them all.
                see_through = [c for c in re.findall(r"rgba\([^)]*\)", inside)
                               if not re.search(r",\s*1\s*\)$", c)]
                self.assertEqual(see_through, [],
                                 "%s/%s paints %s" % (school, klass, image[:120]))

    def test_the_paper_edge_caps_the_sheet_without_shrinking_it(self):
        """Two settings that are easy to confuse. The paper edge is the printer's
        own margin and it moves the cut line further in from the paper. It never
        makes the line smaller — an iPad-sized sheet is iPad-sized at every
        edge. What it does do is leave less paper to cut from, so a size that no
        longer fits inside it is brought back in."""
        self.show("68", "8")
        MM = 96 / 25.4
        for mm in (5, 9, 14):
            got = self.js(
                "state.printSheet = 'ipad11a16'; state.printMargin = %d;"
                "printing = true; render();"
                "var box = document.body.getBoundingClientRect();"
                "var out = {w: box.width, h: box.height};"
                "printing = false; render(); return out;" % mm)
            self.assertAlmostEqual(got["w"], 248.6 * MM, delta=1, msg=str(mm))
            self.assertAlmostEqual(got["h"], 179.5 * MM, delta=1, msg=str(mm))

        # A size of one's own is held to what the edge leaves, through the real
        # control, and comes back in when the edge widens.
        got = self.js(
            "state.printSheet = 'custom'; state.printMargin = 5;"
            "syncDisplayControls();"
            "var w = document.getElementById('printWidth');"
            "w.value = '400'; w.dispatchEvent(new Event('change', {bubbles: true}));"
            "return {typed: state.printWidth, max: w.max};")
        self.assertEqual(got["typed"], 287, "not held to the narrowest edge")
        self.assertEqual(got["max"], "287")

        got = self.js(
            "var m = document.getElementById('printMargin');"
            "m.value = '14'; m.dispatchEvent(new Event('change', {bubbles: true}));"
            "return {w: state.printWidth, h: state.printHeight,"
            "        max: document.getElementById('printWidth').max};")
        self.assertEqual(got["w"], 269, "a wider edge left it off the page")
        self.assertEqual(got["max"], "269")

    def test_the_millimetre_boxes_are_live_only_for_a_size_of_ones_own(self):
        """They are dimmed rather than hidden, the way every other dependent
        control here behaves: a reader can see what their own size would be
        before asking for it."""
        self.show("68", "8")
        for sheet, dimmed in (("a4", True), ("ipad11a16", True), ("custom", False)):
            got = self.js(
                "state.printSheet = '%s'; syncDisplayControls();"
                "return {off: document.getElementById('sheetOwn')"
                "                 .classList.contains('off'),"
                "        picked: document.getElementById('printSheet').value};"
                % sheet)
            self.assertEqual(got["off"], dimmed, sheet)
            self.assertEqual(got["picked"], sheet)

    def test_the_whole_a4_page_draws_no_line_and_fills_the_sheet(self):
        """The default. Nothing is cut, so nothing says to cut it."""
        self.show("68", "8")
        got = self.js(
            "state.printSheet = 'a4'; printing = true; render();"
            "var out = {cut: document.body.classList.contains('cutsheet'),"
            "           style: getComputedStyle(document.body).borderTopStyle,"
            "           note: !document.getElementById('cutNote').hidden,"
            "           sheet: sheetHeight()};"
            "printing = false; render();"
            "return out;")
        self.assertFalse(got["cut"])
        self.assertEqual(got["style"], "none")
        self.assertFalse(got["note"])
        self.assertEqual(got["sheet"],
                         round(210 * 96 / 25.4) - 2 * round(5 * 96 / 25.4))


class TheGroupPicker(InABrowser):
    """Which group a reader is in is the one question the page cannot answer
    for them, so the picker has to be answerable from what they do know."""

    def test_a_language_group_is_offered_by_its_teacher(self):
        """The codes are the school's own filing — HK1, PK, SK — and a reader
        knows who teaches them instead."""
        self.show("103", "5.a")
        got = self.js(
            "var box = [...document.querySelectorAll('#divisions select')]"
            "  .find(function (s) { return s.dataset.div.indexOf('HK1') >= 0; });"
            "return {opts: [...box.options].slice(1).map(function (o) {"
            "          return [o.value, o.textContent]; })};")
        self.assertEqual(got["opts"], [
            ["HK1", "HK1 (Maria Martinez)"],
            ["HK2", "HK2 (Maria Martinez)"],
            ["PK", "PK (Eeva Laanemäe)"],
            ["SK", "SK (Tuuli Hiiesalu)"],
        ])
        # Picking one still files the code, not the words beside it.
        picked = self.js(
            "var box = [...document.querySelectorAll('#divisions select')]"
            "  .find(function (s) { return s.dataset.div.indexOf('HK1') >= 0; });"
            "box.value = 'PK';"
            "box.dispatchEvent(new Event('change', {bubbles: true}));"
            "return {stored: Object.values(mine().studyGroups)};")
        self.assertEqual(picked["stored"], ["PK"])


class TheControls(InABrowser):
    """Pressing things. Every listener here was unreachable from a stub."""

    def press(self, selector):
        self.browser.eval(
            "document.querySelector(%s).dispatchEvent("
            "new MouseEvent('click', {bubbles: true}))" % json.dumps(selector))

    def test_the_share_button_writes_the_address_it_shows(self):
        self.show("68", "7")
        got = self.js(
            "state.showRoom = false; save();"
            "return {href: location.href, share: shareUrl()};")
        self.assertEqual(got["href"], got["share"],
                         "the address bar and the Share button disagree")
        self.press("#share")
        said = self.js("return {label: document.getElementById('share').textContent};")
        self.assertTrue(said["label"], "the button said nothing after being pressed")

    def test_applying_a_pasted_backup_moves_the_page(self):
        """The panel is the way back from a lost browser, and the way a link is
        turned into a set of choices. It reaches the page through two elements
        and a button, none of which a stub can press."""
        self.show("68", "7")
        settings = {"school": "68", "class": "8", "showRoom": False,
                    "subjects": {"Matemaatika": {"hide": True}}}
        got = self.js(
            "document.getElementById('settingsText').value = %s;"
            "document.getElementById('applySettings').dispatchEvent("
            "  new MouseEvent('click', {bubbles: true}));"
            "return {msg: document.getElementById('settingsMsg').textContent,"
            "        klass: state.class, room: state.showRoom,"
            "        hidden: (state.subjects.Matemaatika || {}).hide,"
            "        drawn: document.getElementById('grid').innerHTML"
            "                 .indexOf('Matemaatika') >= 0};"
            % json.dumps(json.dumps(settings)))
        self.assertEqual(got["klass"], "8")
        self.assertEqual(got["room"], False)
        self.assertEqual(got["hidden"], True)
        self.assertFalse(got["drawn"], "a hidden subject was still drawn")
        self.assertTrue(got["msg"], "the panel said nothing")

    def test_apply_keeps_a_change_made_while_the_panel_was_open(self):
        """The box is filled from the settings, and Apply reads from the box.
        Filled once when the panel opened, it went stale under every control
        touched afterwards — so Apply put the older settings back, and the
        button undid the change instead of keeping it."""
        self.show("68", "8")
        got = self.js(
            "var panel = document.getElementById('advancedPanel');"
            "panel.open = true; panel.dispatchEvent(new Event('toggle'));"
            "var before = JSON.parse(document.getElementById('settingsText').value)"
            "              .subjectColorStyle;"
            # A control the reader touches with the panel already open.
            "var radio = document.querySelector("
            "  'input[name=subjectColorStyle][value=palette]');"
            "radio.checked = true;"
            "radio.dispatchEvent(new Event('change', {bubbles: true}));"
            "var shown = JSON.parse(document.getElementById('settingsText').value)"
            "             .subjectColorStyle;"
            "document.getElementById('applySettings').dispatchEvent("
            "  new MouseEvent('click', {bubbles: true}));"
            "return {before: before, shown: shown, after: state.subjectColorStyle};")
        self.assertEqual(got["before"], "custom", "the page no longer opens on custom")
        self.assertEqual(got["shown"], "palette", "the box went stale")
        self.assertEqual(got["after"], "palette", "Apply undid the change")

    def test_bad_text_in_the_backup_box_is_refused_without_breaking_the_page(self):
        self.show("68", "7")
        got = self.js(
            "document.getElementById('settingsText').value = '{oh dear';"
            "document.getElementById('applySettings').dispatchEvent("
            "  new MouseEvent('click', {bubbles: true}));"
            "return {msg: document.getElementById('settingsMsg').textContent,"
            "        boxes: document.querySelectorAll('.ev').length,"
            "        klass: state.class};")
        self.assertTrue(got["msg"], "nothing was said about the bad text")
        self.assertGreater(got["boxes"], 0, "the page stopped drawing")
        self.assertEqual(got["klass"], "7", "a refused paste moved the page anyway")

    def test_reset_clears_the_choices_and_stays_on_the_class(self):
        self.show("68", "8")
        got = self.js(
            "state.showRoom = false; myOwn().studentName = 'Eva'; save();"
            "document.getElementById('reset').dispatchEvent("
            "  new MouseEvent('click', {bubbles: true}));"
            "return {klass: state.class, school: state.school,"
            "        room: state.showRoom, name: myOwn().studentName,"
            "        box: document.getElementById('settingsText').value};")
        self.assertEqual(got["klass"], "8", "the reset moved the reader")
        self.assertEqual(got["school"], "68")
        self.assertEqual(got["room"], True)
        self.assertEqual(got["name"], "")
        self.assertNotIn("klass", json.loads(got["box"]))

    def test_a_subject_row_can_be_switched_off_and_back_on(self):
        """Through the checkbox, not through the function behind it."""
        self.show("68", "8")
        name = self.js("return {n: subjectsOnScreen()[0]};")["n"]
        pick = "#legend tr[data-subject=\"%s\"] .subjshow" % name
        off = self.js(
            "var box = document.querySelector(%s);"
            "box.checked = false;"
            "box.dispatchEvent(new Event('change', {bubbles: true}));"
            "return {hidden: (state.subjects[%s] || {}).hide,"
            "        rowKept: !!document.querySelector(%s),"
            "        drawn: document.getElementById('grid').innerHTML.indexOf('>%s<') >= 0};"
            % (json.dumps(pick), json.dumps(name),
               json.dumps("#legend tr[data-subject=\"%s\"]" % name), name))
        self.assertTrue(off["hidden"])
        self.assertTrue(off["rowKept"], "the row went with the subject")
        self.assertFalse(off["drawn"], "the subject is still drawn")

        back = self.js(
            "var box = document.querySelector(%s);"
            "box.checked = true;"
            "box.dispatchEvent(new Event('change', {bubbles: true}));"
            "return {left: Object.keys(state.subjects).length,"
            "        drawn: document.getElementById('grid').innerHTML.indexOf('>%s<') >= 0};"
            % (json.dumps(pick), name))
        self.assertEqual(back["left"], 0, "an entry that says nothing was kept")
        self.assertTrue(back["drawn"], "switching it back on did nothing")

    def test_an_event_is_added_edited_and_dropped_through_its_row(self):
        """The whole editor: the add button, four controls that write to four
        fields, and the drop button. Every one of them is a listener."""
        self.show("68", "8")
        added = self.js(
            "document.getElementById('evadd').dispatchEvent("
            "  new MouseEvent('click', {bubbles: true}));"
            "return {count: myOwn().events.length,"
            "        rows: document.querySelectorAll('#evrows tr').length};")
        self.assertEqual(added["count"], 1)
        self.assertEqual(added["rows"], 1)

        edited = self.js(
            "function set(cls, value, kind) {"
            "  var el = document.querySelector('#evrows tr .' + cls);"
            "  el.value = value;"
            "  el.dispatchEvent(new Event(kind, {bubbles: true})); }"
            "set('evday', 'Wed', 'change');"
            "set('evstart', '17:15', 'input');"
            "set('evend', '18:45', 'input');"
            "set('evlabel', 'Ronimine', 'input');"
            "return myOwn().events[0];")
        self.assertEqual(edited["day"], "Wed")
        self.assertEqual(edited["startTime"], "17:15")
        self.assertEqual(edited["endTime"], "18:45")
        self.assertEqual(edited["label"], "Ronimine")

        drawn = self.js(
            "render();"
            "return {shown: document.getElementById('grid').innerHTML"
            "                 .indexOf('Ronimine') >= 0};")
        self.assertTrue(drawn["shown"], "the event was saved but never drawn")

        gone = self.js(
            "document.querySelector('#evrows tr button.drop').dispatchEvent("
            "  new MouseEvent('click', {bubbles: true}));"
            "return {count: myOwn().events.length,"
            "        rows: document.querySelectorAll('#evrows tr').length};")
        self.assertEqual(gone["count"], 0)
        self.assertEqual(gone["rows"], 0)

    def test_an_event_can_carry_a_second_line(self):
        """Where a lesson shows its room and teacher, a training session can
        show its hall and its coach. It needs the height to earn it, the same
        as a lesson does, so this is asked of a browser."""
        self.show("68", "8")
        drawn = self.js(
            "myOwn().events = [{day: 'Mon', startTime: '16:00', endTime: '17:30',"
            "  label: 'Ronimine', note: 'Saal 2 · Maret', backgroundColor: '#F6EAC1'}];"
            "render();"
            "var box = [].filter.call(document.querySelectorAll('.ev.mine'),"
            "  function (e) { return e.textContent.indexOf('Ronimine') >= 0; })[0];"
            "return {found: !!box,"
            "        second: box && !!box.querySelector('.who2'),"
            "        text: box && (box.querySelector('.who2') || {}).textContent,"
            "        title: box && box.getAttribute('title')};")
        self.assertTrue(drawn["found"], "the event was not drawn")
        self.assertTrue(drawn["second"], "no second line on the box")
        self.assertEqual(drawn["text"], "Saal 2 · Maret")
        self.assertIn("Saal 2", drawn["title"], "the tooltip lost the second line")

        # A short box has no room for it, and drops it rather than cutting it.
        short = self.js(
            "myOwn().events[0].endTime = '16:20'; render();"
            "var box = [].filter.call(document.querySelectorAll('.ev.mine'),"
            "  function (e) { return e.textContent.indexOf('Ronimine') >= 0; })[0];"
            "return {second: box && !!box.querySelector('.who2'),"
            "        clipped: box && box.scrollHeight > box.clientHeight + 1};")
        self.assertFalse(short["second"], "a 20-minute box wrote three lines")
        self.assertFalse(short["clipped"], "the box cut its own text")

        # Through the row, and it survives being written down and read back.
        typed = self.js(
            "myOwn().events = []; render();"
            "document.getElementById('evadd').dispatchEvent("
            "  new MouseEvent('click', {bubbles: true}));"
            "var el = document.querySelector('#evrows tr .evnote');"
            "el.value = 'Saal 2';"
            "el.dispatchEvent(new Event('input', {bubbles: true}));"
            "return {note: myOwn().events[0].note,"
            "        back: normalise(JSON.parse(JSON.stringify(slim(state))))"
            "              .classes['68/8'].events[0].note};")
        self.assertEqual(typed["note"], "Saal 2")
        self.assertEqual(typed["back"], "Saal 2", "the second line was not saved")
        self.js("myOwn().events = []; render(); return {};")

    def test_a_display_switch_reaches_the_drawing(self):
        self.show("68", "8")
        got = self.js(
            "function flip(id) {"
            "  var el = document.getElementById(id);"
            "  el.checked = !el.checked;"
            "  el.dispatchEvent(new Event('change', {bubbles: true}));"
            "  return document.getElementById('grid').innerHTML; }"
            "var before = document.getElementById('grid').innerHTML;"
            "var after = flip('showRoom');"
            "return {changed: before !== after, room: state.showRoom};")
        self.assertFalse(got["room"])
        self.assertTrue(got["changed"], "switching a line off redrew nothing")

    def test_choosing_a_study_group_narrows_the_week(self):
        self.show("68", "8")
        got = self.js(
            "var sel = document.querySelector('#divisions select');"
            "if (!sel || sel.options.length < 2) return {skip: true};"
            "var before = document.querySelectorAll('.ev').length;"
            "sel.value = sel.options[1].value;"
            "sel.dispatchEvent(new Event('change', {bubbles: true}));"
            "return {skip: false, before: before,"
            "        after: document.querySelectorAll('.ev').length,"
            "        picked: Object.keys(myOwn().studyGroups).length};")
        if got.get("skip"):
            self.skipTest("this class has no study groups")
        self.assertGreater(got["picked"], 0, "the pick was not written down")
        self.assertLessEqual(got["after"], got["before"],
                             "picking one group drew more, not less")

    def test_the_language_switch_changes_every_label_at_once(self):
        got = self.js(
            "var sel = document.getElementById('lang');"
            "var before = document.body.textContent;"
            "sel.value = 'et';"
            "sel.dispatchEvent(new Event('change', {bubbles: true}));"
            "return {lang: state.lang, changed: document.body.textContent !== before,"
            "        left: [].filter.call(document.querySelectorAll('[data-i18n]'),"
            "          function (el) { return !el.textContent.trim(); }).length};")
        self.assertEqual(got["lang"], "et")
        self.assertTrue(got["changed"], "the page did not change language")
        self.assertEqual(got["left"], 0, "a label came out empty in Estonian")


class ArrivingWithSettings(InABrowser):
    """The two ways a page opens with choices already made: a link somebody
    shared, and a browser that was here before.

    Both run before the first draw, at the very top of the file, and neither
    can be reached from a stub — the stub has no address bar and no storage.
    A fault there is a page that draws nothing at all, which is what a reader
    following a link sees.
    """

    # A real link: gzipped, base64url, no school or class of its own, so it
    # leans on the page's own opening choice. Two subjects renamed and six
    # events, which is what somebody actually shares.
    LINK = ("#z=H4sIAGL5jWoCA7WSyUoDQRCGXyWUlwgDOooS5hZcboqYAQ_ioWa6zHSmF-lFCMO8"
            "Vl4gL2Z3S5DBPSF1abqW_6vqrg4cYd2QuUVJM7cUBAU8eyEgA-urBdXOQtHBdOGdIVJc"
            "zeNVYEUiZN6gI4noeIvQ9xnUAq2lVHE-OZrEk15JRY3HDhguY41WUdyhcSWXkZefFPlx"
            "8JFiH57T6KmwbudGe8UutNAmRA5YshDb9DBbr9YryRVBn20YpafPjKQ4YJx9w7hM9gvj"
            "gWIXA0b-rjhgpMm2ZZSN3-Wt_sS4Nnw_c4zGLwbbsBteHv7M-2qm___NaOyIW2IB9hQA"
            "daO1iGsdcu6MLq_up2FH-zfLGGdC8gIAAA")

    def test_a_shared_link_draws_the_week_it_carries(self):
        self.visit(self.LINK)
        got = self.js(
            "return {boxes: document.querySelectorAll('.ev').length,"
            "        grid: document.getElementById('grid').innerHTML.length,"
            "        events: myOwn().events.length,"
            "        renamed: (state.subjects['Ajutreening'] || {}).label,"
            "        teacher: state.teacherNameStyle,"
            "        school: state.school, klass: state.class};")
        self.assertGreater(got["boxes"], 0, "a shared link drew nothing at all")
        self.assertGreater(got["grid"], 500)
        self.assertEqual(got["events"], 6, "the events in the link were dropped")
        self.assertEqual(got["renamed"], "Matemaatika")
        self.assertEqual(got["teacher"], "full")
        # It names no class of its own: when it was written, the class it is
        # about was the one the page opened on, so there was nothing to write
        # down. The school has since moved a timetable and the opening class
        # moved with it. The link still says which class it is about, in the
        # one per-class bag it carries, and that is the class shown.
        self.assertEqual([got["school"], got["klass"]], ["68", "8"])
        self.assertNotEqual(
            got["klass"], self.js("return {c: DATA.initialClass};")["c"],
            "this no longer proves anything: the opening class is 8 again")

    def test_a_link_draws_even_with_nothing_stored(self):
        """The reader following it has never been here. Storage is empty, and
        the link is the whole of what the page knows."""
        self.browser.eval("localStorage.clear()")
        self.visit(self.LINK)
        self.assertGreater(
            self.js("return {n: document.querySelectorAll('.ev').length};")["n"], 0)

    def test_what_a_browser_stored_is_read_back(self):
        """Settings are written to storage on every change and read once at
        load. A fault in that read is swallowed by the try around it, so the
        page comes up looking fine and every choice is quietly gone."""
        self.show("68", "8")
        self.js("state.showRoom = false; state.teacherNameStyle = 'full';"
                "state.subjects = {Matemaatika: {hide: true}};"
                "myOwn().studentName = 'Eva'; save(); return {};")
        stored = self.js("return {raw: localStorage.getItem(Object.keys(localStorage)[0])};")
        self.assertIn("showRoom", stored["raw"], "nothing was written down")

        self.visit()
        back = self.js(
            "return {room: state.showRoom, teacher: state.teacherNameStyle,"
            "        hidden: (state.subjects.Matemaatika || {}).hide,"
            "        name: myOwn().studentName, klass: state.class,"
            "        boxes: document.querySelectorAll('.ev').length};")
        self.assertEqual(back["room"], False, "a stored setting was thrown away")
        self.assertEqual(back["teacher"], "full")
        self.assertEqual(back["hidden"], True)
        self.assertEqual(back["name"], "Eva")
        self.assertEqual(back["klass"], "8")
        self.assertGreater(back["boxes"], 0)

    def test_a_fragment_that_is_not_ours_is_ignored_rather_than_fatal(self):
        for junk in ("#z=not-base64!!", "#s=" + "A" * 40, "#something-else", "#"):
            with self.subTest(fragment=junk):
                self.visit(junk)
                self.assertGreater(
                    self.js("return {n: document.querySelectorAll('.ev').length};")["n"],
                    0, "a fragment we did not write took the page down")

    def test_the_filter_opens_only_when_there_is_still_something_to_ask(self):
        """A reader arriving for the first time has one job: to say whose
        timetable this is. A reader coming back has done it, and the panel is
        then a header taking up the room the week wants."""
        self.browser.eval("localStorage.clear()")
        self.visit()
        self.assertTrue(
            self.js("return {o: document.getElementById('filterPanel').open};")["o"],
            "a first visit was asked nothing and shown nothing")

        # Choosing a class writes it down, and the next visit does not ask.
        self.js("state.class = '8'; save(); return {};")
        self.visit()
        self.assertFalse(
            self.js("return {o: document.getElementById('filterPanel').open};")["o"],
            "a returning reader was asked again")

        # A link says whose timetable it is, so it does not ask either.
        self.browser.eval("localStorage.clear()")
        self.visit(self.LINK)
        self.assertFalse(
            self.js("return {o: document.getElementById('filterPanel').open};")["o"],
            "a shared link still asked which class")

        # And the page ships it open, so a browser running no script at all
        # gets the answer that helps somebody who cannot collapse it either.
        with open(os.path.join(ROOT, "tt.py"), encoding="utf-8") as fh:
            self.assertIn('id="filterPanel" open', fh.read())

    MINE = ("state.lang = 'et'; state.school = '68'; state.class = '8';"
            "state.showRoom = false; state.showGroup = false;"
            "state.subjects = {Matemaatika: {label: 'MINE'}}; save();")
    # A link for another class, with rooms on and its own name for a subject.
    THEIRS = ("#s=eyJjbGFzcyI6ICI3IiwgInNob3dSb29tIjogdHJ1ZSwgInN1YmplY3RzIjog"
              "eyJNYXRlbWFhdGlrYSI6IHsibGFiZWwiOiAiRlJPTSBMSU5LIn19fQ")

    def arrive(self):
        """Save one set of settings, then follow a link that disagrees."""
        self.browser.eval("localStorage.clear()")
        self.visit()
        self.js(self.MINE + " return {};")
        self.visit(self.THEIRS)

    def test_a_link_that_disagrees_with_this_browser_asks_before_it_saves(self):
        """Two answers and no way to tell which was meant. The link's is shown
        because following one is a request to see it, and nothing of the
        reader's is written over until they say."""
        self.arrive()
        got = self.js(
            "return {asked: !document.getElementById('linkask').hidden,"
            " klass: state.class, room: state.showRoom,"
            " label: (state.subjects.Matemaatika || {}).label,"
            " lang: state.lang,"
            " stored: JSON.parse(localStorage.getItem("
            "   Object.keys(localStorage)[0]) || '{}')};")
        self.assertTrue(got["asked"], "the disagreement was settled silently")
        self.assertEqual(got["klass"], "7", "the link is not what is showing")
        self.assertEqual(got["label"], "FROM LINK")
        self.assertEqual(got["stored"]["class"], "8",
                         "the reader's own settings were written over")
        self.assertEqual(got["lang"], "et",
                         "the question was asked in the wrong language")

    def test_each_of_the_three_answers_does_what_it_says(self):
        answers = {}
        for button, name in (("clashLink", "link"), ("clashMerge", "merge"),
                             ("clashMine", "mine")):
            self.arrive()
            answers[name] = self.js(
                "document.getElementById('%s').dispatchEvent("
                "  new MouseEvent('click', {bubbles: true}));"
                "return {asked: !document.getElementById('linkask').hidden,"
                " klass: state.class, room: state.showRoom,"
                " group: state.showGroup,"
                " label: (state.subjects.Matemaatika || {}).label,"
                " stored: JSON.parse(localStorage.getItem("
                "   Object.keys(localStorage)[0]) || '{}').class};" % button)

        for name, got in answers.items():
            self.assertFalse(got["asked"], f"{name} left the question up")

        # The link's: everything the link says, and the page's own where it is
        # silent — so a setting of the reader's that the link never mentions
        # goes back to the default.
        self.assertEqual(answers["link"]["klass"], "7")
        self.assertEqual(answers["link"]["label"], "FROM LINK")
        self.assertTrue(answers["link"]["group"], "a silent setting kept mine")

        # Merge: the link's where it speaks, mine where it does not. That one
        # setting is the whole difference between this and the answer above.
        self.assertEqual(answers["merge"]["klass"], "7")
        self.assertEqual(answers["merge"]["label"], "FROM LINK")
        self.assertFalse(answers["merge"]["group"], "merge did not keep mine")

        # Mine: the link is ignored, and what was stored is what stays.
        self.assertEqual(answers["mine"]["klass"], "8")
        self.assertEqual(answers["mine"]["label"], "MINE")
        self.assertFalse(answers["mine"]["room"])

        # And every answer is written down, so the question is asked once.
        for name, got in answers.items():
            self.assertEqual(got["stored"], got["klass"],
                             f"{name} was shown but not saved")

    def test_the_reader_can_take_a_copy_before_answering(self):
        """The one moment their own settings are about to be written over. A
        page opened from a file has no clipboard, so this lands in the box
        under Advanced — which is where a backup is pasted back in."""
        self.arrive()
        import time
        self.js("document.getElementById('clashCopy').dispatchEvent("
                "  new MouseEvent('click', {bubbles: true})); return {};")
        time.sleep(0.5)
        got = self.js(
            "return {said: document.getElementById('linkaskmsg').textContent,"
            " backup: JSON.parse(document.getElementById('settingsText').value"
            "                    || '{}'),"
            " onScreen: state.class,"
            " stillAsking: !document.getElementById('linkask').hidden};")
        self.assertTrue(got["said"], "nothing was said about where it went")
        self.assertEqual(got["backup"]["class"], "8",
                         "the backup is the link's, not the reader's")
        self.assertEqual(
            (got["backup"].get("subjects") or {}).get("Matemaatika", {}).get("label"),
            "MINE")
        self.assertEqual(got["onScreen"], "7", "taking a copy changed the page")
        self.assertTrue(got["stillAsking"], "taking a copy answered the question")

    def test_a_link_that_agrees_asks_nothing(self):
        """Only a disagreement is worth a question. A reader following their
        own link, or one that matches what they already had, is asked nothing
        and the link is saved as it always was."""
        self.browser.eval("localStorage.clear()")
        self.visit(self.THEIRS)
        self.js("save(); return {};")
        self.visit(self.THEIRS)
        got = self.js(
            "return {asked: !document.getElementById('linkask').hidden,"
            " klass: state.class};")
        self.assertFalse(got["asked"], "an agreeing link asked a question")
        self.assertEqual(got["klass"], "7")

    def test_a_link_that_cannot_be_read_tells_the_reader(self):
        """It drew the timetable as the page opens and said nothing, so the
        reader believed that was what was shared. The usual cause is a link cut
        short on its way through a chat window, which they can do something
        about — but only if they know."""
        self.visit(self.LINK[:-10])          # cut short, as a chat window does
        shown = self.js(
            "var note = document.getElementById('linkwarn');"
            "return {hidden: note.hidden, said: note.textContent,"
            "        boxes: document.querySelectorAll('.ev').length};")
        self.assertFalse(shown["hidden"], "a broken link said nothing")
        self.assertGreater(len(shown["said"]), 30)
        self.assertGreater(shown["boxes"], 0, "and the page still draws")

        # A link that reads says nothing, and neither does an anchor.
        for quiet in (self.LINK, "#somewhere", ""):
            with self.subTest(fragment=quiet[:20]):
                self.visit(quiet)
                self.assertTrue(
                    self.js("return {h: document.getElementById('linkwarn').hidden};")["h"],
                    "a good address was called broken")

    def test_the_notice_is_not_printed(self):
        """The sheet is the timetable, not a note about how the reader got
        to it. Asked of the browser with print media in force, because a rule
        inside `@media print` says nothing about the screen."""
        self.visit(self.LINK[:-10])
        on_screen = self.js(
            "return {display: getComputedStyle("
            "  document.getElementById('linkwarn')).display};")
        self.assertNotEqual(on_screen["display"], "none",
                            "the notice is invisible on screen too")
        self.browser.call("Emulation.setEmulatedMedia", media="print")
        try:
            on_paper = self.js(
                "return {display: getComputedStyle("
                "  document.getElementById('linkwarn')).display};")
        finally:
            self.browser.call("Emulation.setEmulatedMedia", media="")
        self.assertEqual(on_paper["display"], "none", "the notice would print")


class WhenItBreaks(InABrowser):
    """The fault reporter, proved by breaking the page.

    It used to be installed at the bottom of the file. A fault near the top
    then took the whole script down with it, including the line that would
    have installed the reporter — so the page came up blank and nobody was
    told. The one page-breaking fault it exists for was the one it could not
    see. This breaks the page on purpose and checks that a report goes out.
    """

    def broken_page(self, injected):
        """A copy of the page with a fault written into it, high up.

        Two things are stood in for. A page built here carries no endpoint —
        that is set when publishing — so one is written in. And a page on disk
        reports nothing at all, by design, so the rule that says so is made to
        answer yes. Everything else is the real code, including the listener
        this is about. Nothing is sent: fetch is replaced before the page runs.
        """
        with open(self.page, encoding="utf-8") as fh:
            html = (fh.read()
                    .replace('"report": ""', '"report": "/report"', 1)
                    .replace('return location.protocol === "https:";',
                             "return true;", 1))
        # Straight after the listener is installed, which is where all the
        # real code now lives. Before it, nothing could be reported and the
        # test would be checking the fault it is meant to have fixed.
        seam = 'addEventListener("unhandledrejection"'
        end = html.index("\n", html.index("}", html.index(seam)))
        hurt = html[:end] + "\n" + injected + html[end:]
        path = self.page.replace(".html", "-broken.html")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(hurt)
        return path

    def load_watching(self, path):
        """Load with fetch stubbed before the page's own script runs, so a
        report posted during load is caught rather than sent."""
        self.browser.call(
            "Page.addScriptToEvaluateOnNewDocument",
            source="window.__posted = [];"
                   "window.fetch = function (url, options) {"
                   "  window.__posted.push({url: String(url),"
                   "    body: options && options.body});"
                   "  return Promise.resolve({ok: true});"
                   "};")
        self.browser.load("about:blank", "true")
        self.browser.load("file://" + path, "typeof window.__posted !== 'undefined'")
        import time
        time.sleep(1)          # the report is posted, not awaited
        return self.js("return {posted: window.__posted,"
                       "        drew: document.querySelectorAll('.ev').length};")

    def test_a_fault_at_the_very_top_is_still_reported(self):
        """The exact shape of the fault that got through: something thrown
        while the script is still being evaluated, long before the last line."""
        path = self.broken_page(
            'throw new ReferenceError("deliberate: a constant read too early");')
        try:
            got = self.load_watching(path)
        finally:
            os.unlink(path)
        self.assertTrue(got["posted"], "the page broke and nobody was told")
        sent = json.loads(got["posted"][0]["body"])
        self.assertEqual(sent["kind"], "page-error")
        self.assertIn("deliberate", json.dumps(sent))
        self.assertEqual(got["drew"], 0, "this test is no longer breaking the page")

    def test_a_report_carries_the_shape_of_the_settings_and_not_the_values(self):
        """Enough to see what the reader had, and nothing that says who they
        are. Every string is replaced by X's of the same length."""
        self.show("68", "8")
        got = self.js(
            "DATA.report = '/report'; reportable = function () { return true; };"
            "window.__sent = null;"
            "var real = window.fetch;"
            "window.fetch = function (u, o) { window.__sent = o && o.body;"
            "  return Promise.resolve({ok: true}); };"
            "myOwn().studentName = 'Eva'; state.subjects = {Matemaatika: {label: 'Maths'}};"
            "report('error', new Error('a deliberate fault'));"
            "window.fetch = real;"
            "return {body: window.__sent};")
        self.assertTrue(got["body"], "nothing was posted")
        sent = json.loads(got["body"])
        self.assertEqual(sent["kind"], "page-error")
        self.assertIn("a deliberate fault", json.dumps(sent))
        blob = json.dumps(sent, ensure_ascii=False)
        self.assertNotIn("Eva", blob, "the child's name went out")
        self.assertNotIn("Maths", blob, "a name the reader typed went out")
        self.assertIn("XXX", blob, "nothing was masked at all")
        # And the shape survives, or the report says nothing about what broke.
        self.assertIn("Matemaatika", blob, "the shape went out with the values")

    def test_a_report_never_carries_the_address_it_came_from(self):
        """The address holds the settings, and the settings can hold a child's
        name. It is the one thing that must not ride along."""
        self.show("68", "8")
        got = self.js(
            "DATA.report = '/report'; reportable = function () { return true; };"
            "myOwn().studentName = 'Eva'; save();"
            "window.__sent = null;"
            "var real = window.fetch;"
            "window.fetch = function (u, o) { window.__sent = o && o.body;"
            "  return Promise.resolve({ok: true}); };"
            "report('error', new Error('x'), location.href);"
            "window.fetch = real;"
            "return {body: window.__sent, href: location.href};")
        sent = json.loads(got["body"])
        blob = json.dumps(sent)
        self.assertNotIn("#", blob, "the fragment rode along")
        self.assertNotIn("z=", blob)


class NothingReachesTheNetwork(InABrowser):
    """The page is one file. A request leaving it is a fault, whatever it is
    for: it is served from a cache the school does not control, and a reader on
    a train has no second chance to fetch anything."""

    def test_the_page_asks_for_nothing(self):
        asked = self.js(
            "return {entries: performance.getEntriesByType('resource')"
            "  .map(function (e) { return e.name; })"
            "  .filter(function (n) { return n.indexOf('file://') !== 0; })};")
        self.assertEqual(asked["entries"], [])

    def test_printing_asks_for_nothing_either(self):
        self.show("68", "8")
        asked = self.js(
            "performance.clearResourceTimings();"
            "printing = true; render(); printing = false; render();"
            "return {entries: performance.getEntriesByType('resource')"
            "  .map(function (e) { return e.name; })"
            "  .filter(function (n) { return n.indexOf('file://') !== 0; })};")
        self.assertEqual(asked["entries"], [])


if __name__ == "__main__":
    unittest.main()
