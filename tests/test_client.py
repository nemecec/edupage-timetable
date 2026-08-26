"""Talking to EduPage, with the network stood in for.

The school's server is somebody else's, it rations how often one address may
ask, and it answers a lapsed session with a login page and HTTP 200. All three
are handled, and none of it was tested: a build reaches this code every night
and a checkout never does, because the fixtures answer first.

Nothing here opens a socket. `urllib.request.urlopen` is replaced for the
length of a test, and `time.sleep` with it, so a backoff of eighty-five
seconds costs nothing.
"""

import io
import json
import os
import sys
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import tt


class Answer:
    """What urlopen hands back: a body, and the headers that came with it."""

    def __init__(self, body=b"{}", cookies=()):
        self.body = body
        self.headers = self
        self._cookies = list(cookies)

    def get_all(self, name):
        return self._cookies if name.lower() == "set-cookie" else None

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Wire:
    """Stands in for the network. Answers in turn, and keeps every request."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.asked = []
        self.slept = []

    def urlopen(self, req, timeout=None):
        self.asked.append(req)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    def sleep(self, seconds):
        self.slept.append(seconds)

    def __enter__(self):
        self.keep = urllib.request.urlopen, tt.time.sleep
        urllib.request.urlopen = self.urlopen
        tt.time.sleep = self.sleep
        return self

    def __exit__(self, *exc):
        urllib.request.urlopen, tt.time.sleep = self.keep
        return False


def http(code):
    return urllib.error.HTTPError("http://x", code, "no", {}, None)


class Retrying(unittest.TestCase):
    """The school rations how often one address may ask, and a nightly job can
    afford to wait. What it must not do is retry a refusal for ever."""

    def setUp(self):
        self.said = io.StringIO()
        self.keep, sys.stderr = sys.stderr, self.said

    def tearDown(self):
        sys.stderr = self.keep

    def test_a_first_answer_is_not_retried(self):
        with Wire(Answer(b"ok")) as wire:
            self.assertEqual(tt.open_url("req", 30).read(), b"ok")
        self.assertEqual(len(wire.asked), 1)
        self.assertEqual(wire.slept, [])

    def test_too_many_requests_is_waited_out(self):
        with Wire(http(429), http(429), Answer(b"ok")) as wire:
            self.assertEqual(tt.open_url("req", 30).read(), b"ok")
        self.assertEqual(len(wire.asked), 3)
        self.assertEqual(wire.slept, [5, 20], "the wait did not widen")

    def test_a_broken_server_is_waited_out_and_then_given_up_on(self):
        with Wire(http(503), http(503), http(503), http(503)) as wire:
            with self.assertRaises(urllib.error.HTTPError):
                tt.open_url("req", 30)
        self.assertEqual(len(wire.asked), tt.ATTEMPTS)
        self.assertEqual(len(wire.slept), tt.ATTEMPTS - 1)

    def test_a_refusal_is_not_retried_at_all(self):
        """403 and 404 mean the same thing on the tenth attempt as on the
        first. Retrying them wastes the ration that a real outage needs."""
        for code in (400, 403, 404):
            with self.subTest(code=code):
                with Wire(http(code)) as wire:
                    with self.assertRaises(urllib.error.HTTPError):
                        tt.open_url("req", 30)
                self.assertEqual(len(wire.asked), 1)
                self.assertEqual(wire.slept, [])

    def test_a_dropped_connection_is_worth_another_go(self):
        """Timeout, reset, refused, no route: none of them say anything about
        whether the next attempt will work."""
        self.assertTrue(tt._transient(OSError("connection reset")))
        self.assertTrue(tt._transient(urllib.error.URLError("timed out")))
        self.assertTrue(tt._transient(http(500)))
        self.assertTrue(tt._transient(http(429)))
        self.assertFalse(tt._transient(http(403)))
        with Wire(OSError("reset"), Answer(b"ok")) as wire:
            self.assertEqual(tt.open_url("req", 30).read(), b"ok")
        self.assertEqual(len(wire.asked), 2)

    def test_it_says_it_is_waiting(self):
        """A nightly run that pauses for eighty-five seconds in silence looks
        like a hung job."""
        with Wire(http(429), Answer(b"ok")):
            tt.open_url("req", 30)
        self.assertIn("retrying", self.said.getvalue())


class TheSession(unittest.TestCase):
    """The RPC endpoints refuse a request with no session behind it, which is
    why a bare POST answers "Insufficient privileges"."""

    def test_the_cookie_is_taken_from_the_view_page(self):
        client = tt.EduPage("tera")
        with Wire(Answer(cookies=["PHPSESSID=abc123; path=/; HttpOnly"])) as wire:
            self.assertEqual(client._session(), "PHPSESSID=abc123")
        self.assertIn("view.php", wire.asked[0].full_url)

    def test_the_cookie_is_fetched_once_and_kept(self):
        client = tt.EduPage("tera")
        with Wire(Answer(cookies=["PHPSESSID=abc123"])) as wire:
            client._session()
            client._session()
        self.assertEqual(len(wire.asked), 1, "a session was fetched twice")

    def test_a_page_with_no_session_in_it_is_an_error_not_a_blank_cookie(self):
        """A blank cookie would reach the RPC and come back as "Insufficient
        privileges", which says nothing about what went wrong."""
        client = tt.EduPage("tera")
        with Wire(Answer(cookies=["other=1"])):
            with self.assertRaises(RuntimeError) as caught:
                client._session()
        self.assertIn("PHPSESSID", str(caught.exception))


class TheAnswers(unittest.TestCase):
    """What comes back, and what is made of it."""

    def client(self, cache_dir=None, refresh=False):
        client = tt.EduPage("tera", cache_dir=cache_dir, refresh=refresh)
        client.cookie = "PHPSESSID=already"       # no session fetch to stub
        return client

    def rpc(self, body, cache_dir=None):
        with Wire(Answer(body)):
            return self.client(cache_dir).rpc("regulartt", "getData", [1])

    def test_a_good_answer_comes_back_whole(self):
        got = self.rpc(b'{"r": {"rows": [1, 2]}}')
        self.assertEqual(got["r"]["rows"], [1, 2])

    def test_a_login_page_is_reported_as_what_came_back(self):
        """EduPage answers a lapsed session with a login page, HTTP 200 and
        all. Saying where the parser gave up helps nobody."""
        with self.assertRaises(RuntimeError) as caught:
            self.rpc(b"<!DOCTYPE html><title>Log in</title>")
        said = str(caught.exception)
        self.assertIn("expected JSON", said)
        self.assertIn("DOCTYPE", said, "it did not say what came back")

    def test_an_answer_that_is_not_an_object_is_refused(self):
        with self.assertRaises(RuntimeError) as caught:
            self.rpc(b"[1, 2, 3]")
        self.assertIn("expected an object", str(caught.exception))

    def test_an_error_in_the_answer_is_raised_with_its_own_words(self):
        with self.assertRaises(RuntimeError) as caught:
            self.rpc(b'{"r": {"error": "Insufficient privileges"}}')
        self.assertIn("Insufficient privileges", str(caught.exception))

    def test_an_answer_with_no_result_at_all_is_refused(self):
        with self.assertRaises(RuntimeError) as caught:
            self.rpc(b'{"e": "something went wrong"}')
        self.assertIn("something went wrong", str(caught.exception))

    def test_the_call_carries_the_session_and_says_where_it_came_from(self):
        with Wire(Answer(b'{"r": {}}')) as wire:
            self.client().rpc("regulartt", "getData", [1])
        req = wire.asked[0]
        self.assertEqual(req.get_header("Cookie"), "PHPSESSID=already")
        self.assertIn("tera.edupage.org", req.get_header("Origin"))
        self.assertIn("__func=getData", req.full_url)
        self.assertEqual(json.loads(req.data)["__args"], [1])


class TheCache(unittest.TestCase):
    """The fixtures are this cache, frozen. It is what keeps the suite off the
    school's server, so what it does when it goes wrong matters."""

    def setUp(self):
        import tempfile
        self.dir = tempfile.mkdtemp(prefix="cache-")
        self.said = io.StringIO()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.dir, ignore_errors=True)

    def client(self, refresh=False):
        client = tt.EduPage("tera", cache_dir=self.dir, refresh=refresh,
                            verbose=True)
        client.cookie = "PHPSESSID=already"
        return client

    def call(self, client, answers):
        keep, sys.stderr = sys.stderr, self.said
        try:
            with Wire(*answers) as wire:
                return client.rpc("regulartt", "getData", [1], cache_key="k"), wire
        finally:
            sys.stderr = keep

    def test_a_second_call_is_answered_from_the_file(self):
        self.call(self.client(), [Answer(b'{"r": {"rows": [1]}}')])
        got, wire = self.call(self.client(), [])
        self.assertEqual(got["r"]["rows"], [1])
        self.assertEqual(wire.asked, [], "the cache was written but not read")

    def test_refresh_asks_anyway(self):
        """The nightly run refetches. That is the whole point of it."""
        self.call(self.client(), [Answer(b'{"r": {"rows": [1]}}')])
        got, wire = self.call(self.client(refresh=True),
                              [Answer(b'{"r": {"rows": [2]}}')])
        self.assertEqual(got["r"]["rows"], [2])
        self.assertEqual(len(wire.asked), 1)

    def test_a_half_written_file_is_fetched_again_rather_than_kept_for_ever(self):
        """Otherwise it stays a permanent cache hit and fails the same way on
        every run, which is the worst kind of cache."""
        path = os.path.join(self.dir, "tera-k.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write('{"r": {"rows"')
        got, wire = self.call(self.client(), [Answer(b'{"r": {"rows": [3]}}')])
        self.assertEqual(got["r"]["rows"], [3])
        self.assertEqual(len(wire.asked), 1)
        self.assertIn("unreadable cache", self.said.getvalue())
        # And the good answer replaced it, so the next run is a hit.
        with open(path, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["r"]["rows"], [3])

    def test_a_run_stopped_mid_write_leaves_the_last_good_answer(self):
        """Written beside and moved into place. A truncated file here is a
        cache that fails for ever, so it is never written where it is read."""
        self.call(self.client(), [Answer(b'{"r": {"rows": [1]}}')])
        keep = os.replace
        os.replace = lambda *a: (_ for _ in ()).throw(KeyboardInterrupt())
        try:
            with self.assertRaises(KeyboardInterrupt):
                self.call(self.client(refresh=True), [Answer(b'{"r": {"rows": [9]}}')])
        finally:
            os.replace = keep
        got, _ = self.call(self.client(), [])
        self.assertEqual(got["r"]["rows"], [1], "the old answer was lost")
        self.assertEqual([n for n in os.listdir(self.dir) if n.endswith(".part")], [],
                         "a part file was left behind")

    def test_an_error_is_never_written_down(self):
        """A cached failure is a build that keeps failing after the school has
        fixed whatever it was."""
        keep, sys.stderr = sys.stderr, self.said
        try:
            with Wire(Answer(b'{"r": {"error": "nope"}}')):
                with self.assertRaises(RuntimeError):
                    self.client().rpc("regulartt", "getData", [1], cache_key="k")
        finally:
            sys.stderr = keep
        self.assertEqual(os.listdir(self.dir), [])


if __name__ == "__main__":
    unittest.main()
