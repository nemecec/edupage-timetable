# Deploying the timetable

The page at `https://little.tools/timetable/`. AWS rebuilds it every night from
the school's public data.

    EventBridge (nightly)  →  Lambda: tt.py  →  S3 (private)  →  CloudFront  →  readers
                                  ↑
                       GitHub Actions, when asked

**The site is a stack of its own**, at
[nemecec/little-tools](https://github.com/nemecec/little-tools): the domain, the
certificate, the bucket, CloudFront, the landing page and the endpoint a page
posts a fault to. Bring that up first. Everything here reads what it needs from
that stack's outputs — the bucket, the distribution, the alarm topic, the
analytics code, and whether `/report` is answered.

Nothing sits in the request path. Readers get a static object from an edge
cache, so a failed build leaves yesterday's page in service rather than an
error. The generator is deterministic, so a day with no timetable change gives
byte-identical output and the run publishes nothing at all.

The schedule lives in AWS rather than in the repository. GitHub switches a
scheduled workflow off after sixty days without repository activity, and a page
that needs rebuilding but never editing reaches that and stops without a word.
The workflow stays as a button. It holds no key: it exchanges a short-lived OIDC
token for a role that can do exactly one thing, ask the build function to run.

## What is here

| file | |
| --- | --- |
| `tool.conf` | the prefix, the domain and the region — read by everything else |
| `tool.yaml` | the build Lambda, its schedule, its alarms, the publish role |
| `publish.py` | build and publish — run by the Lambda, and by hand |
| `lambda_function.py` | the entry point for the nightly run |
| `deploy.sh` | the commands below |

## Bringing it up

    export AWS_PROFILE=little-tools

    ./deploy.sh stack      the Lambda, the schedule, the alarms, the role
    ./deploy.sh code       push the generator into the Lambda
    ./deploy.sh secrets    hand the stack's outputs to the repository
    ./deploy.sh publish    build and publish now, without waiting

`stack` runs `code` after itself, because a Lambda with no code in it is not
worth having. `secrets` sets `AWS_PUBLISH_ROLE` and `AWS_BUILD_FUNCTION`; the
workflow needs both and stops if either is missing, so a fork can never
authenticate against somebody else's account by accident. It writes to `REPO`,
which defaults to `nemecec/edupage-timetable`.

Two environment variables on the build function decide where the page opens and
which language it starts in. `./deploy.sh code` sets them from `INITIAL_SCHOOL`,
`INITIAL_CLASS` and `SITE_LANGUAGE`, whose defaults are ProTERA, 8 and et.

A change to the generator republishes nothing on its own. Push it and run it:

    ./deploy.sh code && ./deploy.sh publish

## When it publishes

Publishing happens on the nightly EventBridge schedule, and when you press *Run
workflow*. It never happens on a push. The school's server limits how often one
address can ask for everything. It starts to time out a caller that has just
done so several times over. A day of ordinary commits can spend that limit
before the nightly run gets its turn. For the same reason, the determinism check
in `check.yml` fetches only when you run it by hand.

The schedule is `cron(20 3 * * ? *)`, which is 03:20 UTC. A fetch that stalls is
retried three times, after 5, 20 and 60 seconds. That is enough to ride out the
throttling seen in practice. If it still fails, nothing is published and
yesterday's page stays in service.

## Before it is public

The page republishes TERA's timetable under your domain: every class, the full
names of teachers, and the rooms. All of it is already public on
`tera.edupage.org`, which is where the script reads it from, anonymously and
without a login. Nothing new is exposed.

But an aggregated copy on somebody else's domain can read as official. It also
goes stale in silence if the build stops.

The page says that it is unofficial, under its heading, beside a link to the
school's own page and the date the data was read. A printed sheet carries the
date, and a QR code back to the page if the reader asks for one, rather than the
whole notice. That is worth knowing if sheets are what circulate. Tell the
school before you publish. It takes five minutes.

## When it goes wrong

**The nightly run publishes nothing.** Two reasons are normal. Either the
timetable did not change, and the page is byte-identical because the generator
is deterministic. Or a school failed to fetch, and the run refused to replace a
full page with a smaller one. The second reason is a hard error, and the log
names the counts. Once you know the cause, `PUBLISH_ANYWAY=1 ./deploy.sh
publish` overrides it.

**Nothing was told about it.** The alarms write to a topic the site's stack
owns, because every tool writes to the same one. If `AlarmTopicArn` came back
empty, the site was brought up without an alarm address: set `ALARM_EMAIL` and
deploy the site again, then `./deploy.sh stack` here.

**The workflow cannot assume the role.** The trust policy names one repository
and one branch. After a rename, deploy the stack again so it names the new one.
