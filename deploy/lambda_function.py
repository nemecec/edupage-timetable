"""Rebuild the page on a timer.

Not in anyone's request path: readers are served a static object from an edge
cache, and this only replaces that object. A failed run leaves the previous page
serving, which is the right failure — a timetable a day stale beats an error.

The build itself is publish.py, the same code a person runs by hand.
"""

import os
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent


def handler(event, context):
    """Run the publisher and hand its output back to whoever is watching.

    Asked with `{"fetch": true}` it fetches the school's answers and hands
    those back instead, publishing nothing. That is for the daily check, which
    runs on a GitHub runner: the school's server does not answer one, and this
    function is on the network it does answer.
    """
    fetching = bool((event or {}).get("fetch"))
    result = subprocess.run(
        [sys.executable, str(HERE / "publish.py")] + (["--fetch"] if fetching else []),
        capture_output=True, text=True,
        # /tmp is the only writable place in a Lambda, and the AWS CLI wants a
        # home to put its cache in.
        env={**os.environ, "HOME": "/tmp", "AWS_CONFIG_FILE": "/tmp/aws-config"},
    )
    # The answers themselves are a hundred kilobytes and the caller is about to
    # read them off the reply, so the log is told their size and not them.
    print(f"fetched {len(result.stdout.strip())} characters" if fetching
          else result.stdout.strip() or "(no output)")
    if result.returncode != 0:
        print(result.stderr.strip(), file=sys.stderr)
        raise RuntimeError(f"publish.py exited {result.returncode}")
    if fetching:
        return {"ok": True, "cache": result.stdout.strip()}
    return {"ok": True, "output": result.stdout.strip()}
