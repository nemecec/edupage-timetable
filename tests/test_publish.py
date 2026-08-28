"""The nightly publisher, with the bucket and CloudFront stood in for.

This is the one piece of the system that runs with nobody watching. It decides
what reaches the site, when to leave the live page alone, and when to refuse.
None of that had a test: the failure it guards against is a page that quietly
loses a school, which is exactly the failure nobody notices.

Nothing here reaches AWS. `publish.store` is swapped for a fake, and the two
real stores are exercised against a fake `subprocess` and a fake boto3 client,
so what would have gone over the wire is read off the calls they make.
"""

import importlib
import io
import os
import re
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "tests", "fixtures")


class FakeStore:
    """A bucket in a dict, and a note of every invalidation asked for."""

    def __init__(self, start=None):
        self.objects = dict(start or {})
        self.invalidations = []

    def get(self, key):
        return self.objects.get(key)

    def put(self, key, body):
        self.objects[key] = body

    def invalidate(self, paths):
        self.invalidations.append(list(paths))


def load(**environment):
    """Import the publisher fresh, under a given environment.

    Its settings are read at import: the bucket, the prefix, the year. A test
    that changes one has to import again, or it is testing the last test's
    settings.
    """
    keep = dict(os.environ)
    os.environ.update({"BUCKET": "a-bucket", "DISTRIBUTION": "E123",
                       "CACHE_DIR": FIXTURES, "EDUPAGE": "tera"})
    for name, value in environment.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    try:
        sys.path.insert(0, os.path.join(ROOT, "deploy"))
        sys.modules.pop("publish", None)
        return importlib.import_module("publish")
    finally:
        os.environ.clear()
        os.environ.update(keep)


PAGE = (b'<!DOCTYPE html><script id="data" type="application/json">'
        b'{"built":"2026-08-26","schools":[{"n":"1"},{"n":"2"}]}</script>')


def page_of(schools, built="2026-08-26"):
    rows = ",".join('{"n":"%d"}' % (i + 1) for i in range(schools))
    return ('<!DOCTYPE html><script id="data" type="application/json">'
            '{"built":"%s","schools":[%s]}</script>' % (built, rows)).encode("utf-8")


class Deciding(unittest.TestCase):
    """What reaches the site, and what does not."""

    def setUp(self):
        self.publish = load()
        # No prefix, so the timetable is `index.html` and every assertion below
        # names one key. Where the prefix lands things is Addressing's job.
        self.publish.PREFIX = ""
        self.store = FakeStore()
        self.publish.store = self.store
        self.out = io.StringIO()

    def run_main(self, built=2, live=None, **environment):
        """One run, with a canned build and a given live page."""
        if live is not None:
            self.store.objects["index.html"] = live
        self.publish.build = lambda: (page_of(built), built, built * 100)
        for name, value in environment.items():
            os.environ[name] = value
        keep, sys.stdout = sys.stdout, self.out
        try:
            return self.publish.main()
        finally:
            sys.stdout = keep
            for name in environment:
                os.environ.pop(name, None)

    def test_the_first_run_publishes_the_timetable(self):
        """Nothing live yet. The timetable goes up and the cache is told. Only
        the timetable: the landing page and the 404 belong to the site, which
        publishes them itself."""
        self.assertEqual(self.run_main(), 0)
        self.assertEqual(set(self.store.objects), {"index.html"})
        self.assertEqual(self.store.invalidations, [["/*"]])
        self.assertIn("published index.html: 2 schools", self.out.getvalue())

    def test_a_page_that_only_moved_its_date_is_left_alone(self):
        """The build stamp changes every day on its own. Uploading a page that
        is otherwise identical would invalidate the cache for nothing."""
        yesterday = page_of(2, built="2026-08-25")
        self.assertEqual(self.run_main(built=2, live=yesterday), 0)
        self.assertEqual(self.store.objects["index.html"], yesterday,
                         "the live page was replaced with the same page")
        self.assertIn("unchanged", self.out.getvalue())

    def test_a_quiet_day_publishes_nothing_at_all(self):
        """The timetable did not change, so there is nothing to upload and
        nothing to invalidate. It used to put the site's own pages up on every
        run, which is the site's job now — and a cache told to drop everything
        daily for no reason is a cost with no reader behind it."""
        self.run_main(built=2, live=page_of(2, built="2026-08-25"))
        self.assertNotIn("404.html", self.store.objects)
        self.assertEqual(self.store.invalidations, [])

    def test_a_changed_timetable_is_published(self):
        self.run_main(built=3, live=page_of(2))
        self.assertEqual(self.store.objects["index.html"], page_of(3))
        self.assertIn("published", self.out.getvalue())

    def test_it_refuses_to_publish_fewer_schools_than_are_live(self):
        """A school that fails to fetch is skipped with a warning rather than
        failing the build. Left alone, that would quietly replace a page of
        four schools with a page of one."""
        live = page_of(4)
        with self.assertRaises(SystemExit) as caught:
            self.run_main(built=1, live=live)
        self.assertIn("1 schools built, 4 are live", str(caught.exception))
        self.assertEqual(self.store.objects["index.html"], live,
                         "the smaller page went up anyway")
        self.assertEqual(self.store.invalidations, [],
                         "the cache was cleared for a refused publish")

    def test_the_refusal_can_be_overridden(self):
        """A school really closing is a thing that happens."""
        self.run_main(built=1, live=page_of(4), PUBLISH_ANYWAY="1")
        self.assertEqual(self.store.objects["index.html"], page_of(1))

    def test_more_schools_than_are_live_is_never_refused(self):
        self.run_main(built=5, live=page_of(2))
        self.assertEqual(self.store.objects["index.html"], page_of(5))

    def test_a_live_page_it_cannot_read_does_not_block_the_publish(self):
        """The guard needs the count out of the live page. A page it cannot
        read gives none, and no count means no reason to refuse."""
        self.run_main(built=1, live=b"<!DOCTYPE html><p>something else</p>")
        self.assertEqual(self.store.objects["index.html"], page_of(1))


class Reading(unittest.TestCase):
    """The three small answers the decision above is built out of."""

    def setUp(self):
        self.publish = load()

    def test_only_the_build_stamp_is_ignored_when_comparing(self):
        self.assertTrue(self.publish.same(page_of(2, "2026-01-01"),
                                          page_of(2, "2026-12-31")))
        self.assertFalse(self.publish.same(page_of(2), page_of(3)))
        self.assertFalse(self.publish.same(page_of(2), page_of(2) + b" "))

    def test_the_school_count_is_read_from_the_data_not_the_markup(self):
        """The keys are shortened on the way in, so counting a long name finds
        nothing and answers "no schools live" without a word."""
        self.assertEqual(self.publish.timetables_in(page_of(4)), 4)
        self.assertIsNone(self.publish.timetables_in(b"<p>no data here</p>"))
        self.assertIsNone(self.publish.timetables_in(
            b'<script id="data" type="application/json">not json</script>'))
        self.assertIsNone(self.publish.timetables_in(
            b'<script id="data" type="application/json">{"other":1}</script>'))

    def test_a_setting_comes_from_the_environment_then_the_file(self):
        self.assertEqual(self.publish.configured("PREFIX_NOT_A_THING", "fell back"),
                         "fell back")
        os.environ["PREFIX_NOT_A_THING"] = "from the environment"
        try:
            self.assertEqual(self.publish.configured("PREFIX_NOT_A_THING", "fell back"),
                             "from the environment")
        finally:
            del os.environ["PREFIX_NOT_A_THING"]
        # An empty variable is not an answer, it is an unset one. So a setting
        # written in the file cannot be turned off from the environment, only
        # replaced. Worth knowing before trying it in a deploy.
        os.environ["PREFIX"] = ""
        try:
            self.assertEqual(self.publish.configured("PREFIX"),
                             self.publish.configured("PREFIX", "x"))
            self.assertNotEqual(self.publish.configured("PREFIX"), "")
        finally:
            del os.environ["PREFIX"]
        # And the file, which is the one place the site's address is written.
        with open(os.path.join(ROOT, "deploy", "tool.conf"), encoding="utf-8") as fh:
            named = re.findall(r"^([A-Z_]+)=", fh.read(), re.M)
        self.assertTrue(named, "tool.conf names no settings")
        for name in named:
            self.assertNotEqual(self.publish.configured(name), "",
                                f"{name} is in tool.conf and reads as empty")


class Addressing(unittest.TestCase):
    """Where the pages land, which the prefix decides."""

    def test_with_no_prefix_the_timetable_is_the_root_page(self):
        publish = load()
        publish.PREFIX = ""
        store = FakeStore()
        publish.store = store
        publish.build = lambda: (page_of(2), 2, 200)
        keep, sys.stdout = sys.stdout, io.StringIO()
        try:
            publish.main()
        finally:
            sys.stdout = keep
        # And nothing is published over it: the root page would be that page.
        self.assertEqual(sorted(store.objects), ["index.html"])

    def test_a_prefix_puts_the_timetable_under_it(self):
        publish = load()
        publish.PREFIX = "timetable"
        store = FakeStore()
        publish.store = store
        publish.build = lambda: (page_of(2), 2, 200)
        keep, sys.stdout = sys.stdout, io.StringIO()
        try:
            publish.main()
        finally:
            sys.stdout = keep
        self.assertEqual(sorted(store.objects), ["timetable/index.html"])
        # And only under it. The root page and the 404 are the site's, and it
        # publishes them itself — a page that lists every tool cannot be
        # written by one of them.
        self.assertEqual(store.invalidations, [["/timetable/*"]])

    def test_the_report_path_follows_the_switch_that_builds_the_endpoint(self):
        """The page must not post to a path nothing answers."""
        self.assertEqual(load(REPORT_ERRORS="yes").REPORT_PATH, "/report")
        self.assertEqual(load(REPORT_ERRORS="no").REPORT_PATH, "")


class OverTheWire(unittest.TestCase):
    """What the two stores would actually send.

    The headers are the part that fails silently: a page served as
    `binary/octet-stream` downloads instead of opening, and nobody sees it
    until a reader says the link is broken.
    """

    def setUp(self):
        self.publish = load()
        self.calls = []

    def fake_run(self, argv, **kwargs):
        self.calls.append(list(argv))
        return subprocess.CompletedProcess(argv, 0, b"", b"")

    def test_the_cli_store_sends_the_content_type_and_the_cache_rule(self):
        self.publish.subprocess.run = self.fake_run
        try:
            self.publish.ThroughCli().put("timetable/index.html", b"<p>hi</p>")
        finally:
            self.publish.subprocess.run = subprocess.run
        argv = self.calls[0]
        self.assertIn("--content-type", argv)
        self.assertEqual(argv[argv.index("--content-type") + 1], self.publish.HTML)
        self.assertEqual(argv[argv.index("--cache-control") + 1], self.publish.CACHE)
        self.assertIn("s3://a-bucket/timetable/index.html", argv)

    def test_a_missing_object_reads_as_nothing_published_and_nothing_else_does(self):
        """A 403 here is a broken policy, and "nothing published yet" turns off
        the guard at exactly the moment it is needed."""
        def missing(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 1, b"", b"An error: does not exist")
        def refused(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 1, b"", b"An error: AccessDenied")
        self.publish.subprocess.run = missing
        try:
            self.assertIsNone(self.publish.ThroughCli().get("index.html"))
            self.publish.subprocess.run = refused
            with self.assertRaises(SystemExit):
                self.publish.ThroughCli().get("index.html")
        finally:
            self.publish.subprocess.run = subprocess.run

    def test_every_invalidation_carries_a_reference_of_its_own(self):
        """Reuse the reference and CloudFront hands back the first
        invalidation instead of making a new one, so every night after the
        first then does nothing at all."""
        seen = []

        class FakeCloudFront:
            def create_invalidation(self, **kwargs):
                seen.append(kwargs["InvalidationBatch"]["CallerReference"])

        class FakeS3:
            pass

        store = self.publish.ThroughBoto.__new__(self.publish.ThroughBoto)
        store.s3, store.cloudfront = FakeS3(), FakeCloudFront()
        store.invalidate(["/*"])
        store.invalidate(["/*"])
        self.assertEqual(len(set(seen)), 2, "two invalidations, one reference")

    def test_the_boto_store_sends_the_same_headers_as_the_cli_one(self):
        """Two paths to one bucket. A header set on one and not the other is a
        page that behaves differently depending on where it was published
        from, which is the hardest kind of fault to see."""
        sent = {}

        class FakeS3:
            def put_object(self, **kwargs):
                sent.update(kwargs)

        store = self.publish.ThroughBoto.__new__(self.publish.ThroughBoto)
        store.s3 = FakeS3()
        store.put("index.html", b"<p>hi</p>")
        self.assertEqual(sent["ContentType"], self.publish.HTML)
        self.assertEqual(sent["CacheControl"], self.publish.CACHE)
        self.assertEqual(sent["Bucket"], "a-bucket")


    def test_the_cli_store_reads_back_what_the_bucket_holds(self):
        """The success path. `aws s3 cp` writes to a file and says nothing, so
        the answer is the file, not the output."""
        def wrote(argv, **kwargs):
            with open(argv[-1], "wb") as fh:
                fh.write(b"<p>what is live</p>")
            return subprocess.CompletedProcess(argv, 0, b"", b"")
        self.publish.subprocess.run = wrote
        try:
            self.assertEqual(self.publish.ThroughCli().get("index.html"),
                             b"<p>what is live</p>")
        finally:
            self.publish.subprocess.run = subprocess.run

    def test_the_cli_store_clears_the_cache_for_the_right_distribution(self):
        self.publish.subprocess.run = self.fake_run
        try:
            self.publish.ThroughCli().invalidate(["/*", "/timetable/*"])
        finally:
            self.publish.subprocess.run = subprocess.run
        argv = self.calls[0]
        self.assertEqual(argv[argv.index("--distribution-id") + 1], "E123")
        self.assertEqual(argv[-2:], ["/*", "/timetable/*"])
        self.assertIn("us-east-1", argv, "CloudFront was asked in the wrong region")

    def test_the_boto_store_tells_a_missing_object_from_a_refused_one(self):
        """A 403 here is a broken policy. Read as "nothing published yet" it
        turns off the guard at exactly the moment it is needed."""
        class Refused(Exception):
            def __init__(self, code):
                self.response = {"Error": {"Code": code}}

        class NoSuchKey(Exception):
            pass

        class FakeS3:
            exceptions = type("E", (), {"NoSuchKey": NoSuchKey,
                                        "ClientError": Refused})
            def __init__(self, raises):
                self.raises = raises
            def get_object(self, **kwargs):
                raise self.raises

        store = self.publish.ThroughBoto.__new__(self.publish.ThroughBoto)
        store.s3 = FakeS3(NoSuchKey())
        self.assertIsNone(store.get("index.html"))
        store.s3 = FakeS3(Refused("404"))
        self.assertIsNone(store.get("index.html"))
        store.s3 = FakeS3(Refused("AccessDenied"))
        with self.assertRaises(Refused):
            store.get("index.html")


class Building(unittest.TestCase):
    """The generator, called the way the nightly run calls it."""

    def test_it_builds_a_whole_page_and_counts_what_went_into_it(self):
        """The count in the log is what a person reads to know the run was
        real. It is worked out here, not by the generator, so it can drift
        from the page beside it without anything noticing.

        The real run refetches — that is the point of it — so the client is
        stood in for by one that reads the frozen answers instead.
        """
        publish = load()
        real = publish.tt.EduPage
        publish.tt.EduPage = lambda edupage, **kwargs: real(
            edupage, cache_dir=FIXTURES, refresh=False)
        try:
            body, schools, slots = publish.build()
        finally:
            publish.tt.EduPage = real
        self.assertEqual(schools, 4)
        self.assertGreater(slots, 1700)
        self.assertTrue(body.startswith(b"<!DOCTYPE html>"))
        # And the page agrees with the numbers logged beside it.
        self.assertEqual(publish.timetables_in(body), schools)


class TheLambdaWrapper(unittest.TestCase):
    """The handler around it, which turns a non-zero exit into a raised error
    so the alarm on the log actually fires."""

    def load(self):
        sys.path.insert(0, os.path.join(ROOT, "deploy"))
        sys.modules.pop("lambda_function", None)
        return importlib.import_module("lambda_function")

    def setUp(self):
        """The handler prints what the build said, which is how it reaches the
        log the alarm watches. Here it would only litter the suite."""
        self.said = io.StringIO()
        self.keep = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = self.said

    def tearDown(self):
        sys.stdout, sys.stderr = self.keep

    def test_a_failed_build_is_raised_not_returned(self):
        module = self.load()
        keep = module.subprocess.run
        module.subprocess.run = lambda *a, **k: subprocess.CompletedProcess(
            a[0], 1, "part of a page", "it broke")
        try:
            with self.assertRaises(RuntimeError) as caught:
                module.handler({}, None)
            self.assertIn("exited 1", str(caught.exception))
        finally:
            module.subprocess.run = keep

    def test_a_good_build_hands_back_what_it_said(self):
        module = self.load()
        keep = module.subprocess.run
        module.subprocess.run = lambda *a, **k: subprocess.CompletedProcess(
            a[0], 0, "published index.html: 4 schools\n", "")
        try:
            self.assertEqual(module.handler({}, None),
                             {"ok": True, "output": "published index.html: 4 schools"})
        finally:
            module.subprocess.run = keep

    def test_it_gives_the_build_somewhere_to_write(self):
        """/tmp is the only writable place in a Lambda, and the AWS CLI wants a
        home to put its cache in. Without it the run dies on the first write."""
        module = self.load()
        seen = {}
        keep = module.subprocess.run

        def watch(argv, **kwargs):
            seen.update(kwargs.get("env") or {})
            return subprocess.CompletedProcess(argv, 0, "ok", "")

        module.subprocess.run = watch
        try:
            module.handler({}, None)
        finally:
            module.subprocess.run = keep
        self.assertEqual(seen["HOME"], "/tmp")
        self.assertTrue(seen["AWS_CONFIG_FILE"].startswith("/tmp"))


if __name__ == "__main__":
    unittest.main()
