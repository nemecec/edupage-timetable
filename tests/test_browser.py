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
        self.assertGreaterEqual(len(pairs), 41, "fewer classes than the fixtures hold")
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
