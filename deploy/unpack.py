"""Unpack the answers the build Lambda handed over.

    python3 deploy/unpack.py <reply.json> <directory>

`aws lambda invoke` writes the reply to a file. Asked to fetch, the function
answers with the school's own responses, gzipped into one tar and written in
base64. This puts them in a directory the generator can be pointed at.

Its own file rather than a few lines in the workflow, because it decides
something: whether the reply is an answer at all, and whether a name in it is
safe to write. The CLI exits nought even when the function raised, so a reply
that is an error reads as success everywhere except here.
"""

import base64
import io
import json
import pathlib
import sys
import tarfile


def answers(reply):
    """The files in a reply, by name. Raises if the reply is not one."""
    if not isinstance(reply, dict) or not reply.get("ok") or "cache" not in reply:
        raise SystemExit("the fetch did not answer: " +
                         json.dumps(reply)[:400])
    raw = base64.b64decode(reply["cache"])
    out = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        for member in tar.getmembers():
            # The tar is written by us, one directory deep and no deeper. A
            # name that walks anywhere else is not a thing to write and then
            # wonder about.
            if not member.isfile() or "/" in member.name or \
                    member.name.startswith("."):
                raise SystemExit(f"refusing {member.name!r} from the reply")
            out[member.name] = tar.extractfile(member).read()
    if not out:
        raise SystemExit("the fetch answered with no files at all")
    return out


def main(argv):
    if len(argv) != 2:
        raise SystemExit(__doc__.strip().splitlines()[2].strip())
    reply, into = pathlib.Path(argv[0]), pathlib.Path(argv[1])
    into.mkdir(parents=True, exist_ok=True)
    files = answers(json.loads(reply.read_text(encoding="utf-8")))
    for name, body in files.items():
        (into / name).write_bytes(body)
    print(f"unpacked {len(files)} answers into {into}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
