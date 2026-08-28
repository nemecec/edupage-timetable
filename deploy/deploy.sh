#!/usr/bin/env bash
# The AWS side of the timetable at https://little.tools/timetable/. The nightly
# rebuild runs in AWS, from EventBridge into a Lambda; this puts that in place
# and pushes the generator into it.
#
#   ./deploy.sh stack     the build Lambda, its schedule, its alarms and the
#                         role the workflow assumes
#   ./deploy.sh code      push the generator to the Lambda that runs nightly
#   ./deploy.sh secrets   hand the stack's outputs to the GitHub repository
#   ./deploy.sh publish   build and publish from here, without waiting
#
# The site it publishes into is a stack of its own, at
# https://github.com/nemecec/little-tools: the domain, the bucket, CloudFront
# and the landing page. Bring that up first. What this needs from it — the
# bucket, the distribution, the alarm topic, the analytics code — is read from
# that stack's outputs and passed in as parameters.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

# site.conf is the one place the address is written down. The environment wins
# over it, so you can try something out without an edit to the file.
from_env_domain="${DOMAIN:-}" from_env_prefix="${PREFIX:-}" from_env_region="${REGION:-}"
from_env_gc="${GOATCOUNTER:-}" from_env_alarm="${ALARM_EMAIL:-}"
from_env_reports="${REPORT_ERRORS:-}"
# shellcheck source=tool.conf
. "$here/tool.conf"
DOMAIN="${from_env_domain:-$DOMAIN}"
PREFIX="${from_env_prefix:-$PREFIX}"
REGION="${from_env_region:-$REGION}"
GOATCOUNTER="${from_env_gc:-${GOATCOUNTER:-}}"
ALARM_EMAIL="${from_env_alarm:-${ALARM_EMAIL:-}}"   # a failed build writes here
REPORT_ERRORS="${from_env_reports:-${REPORT_ERRORS:-yes}}"

REPO="${REPO:-nemecec/edupage-timetable}"
SITE_STACK="${DOMAIN//./-}-site"          # the site's, read only
TOOL_STACK="${DOMAIN//./-}-${PREFIX}"

aws() { command aws --region "$REGION" "$@"; }

output() {  # stack, key, [region]
  command aws --region "${3:-$REGION}" cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

# "The stack is not there" and "I cannot ask" are different answers, and the
# guards below act on the first. Conflating them turned an expired SSO token
# into "run ./deploy.sh dns first". That advice builds a second hosted zone beside the
# one already serving the site.
maybe_output() {  # stack, key, [region] — empty if absent, exits if unreachable
  local out status
  out="$(output "$1" "$2" "${3:-}" 2>&1)"; status=$?
  if [ $status -eq 0 ]; then printf '%s' "$out"; return 0; fi
  case "$out" in
    *"does not exist"*|*ValidationError*) return 0 ;;
    *) echo "cannot reach CloudFormation: $out" >&2
       echo "  aws sso login --profile ${AWS_PROFILE:-default}" >&2
       exit 1 ;;
  esac
}

case "${1:-}" in



stack)
  # Everything this tool owns. The site's stack is read for what it publishes
  # into: outputs rather than exports, so the site stays free to change.
  bucket="$(maybe_output "$SITE_STACK" BucketName)"
  [ -n "$bucket" ] || { echo "no site stack — bring up nemecec/little-tools first" >&2; exit 1; }
  aws cloudformation deploy --stack-name "$TOOL_STACK" \
    --template-file "$here/tool.yaml" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
      "DomainName=$DOMAIN" \
      "BucketName=$bucket" \
      "BucketArn=$(output "$SITE_STACK" BucketArn)" \
      "DistributionId=$(output "$SITE_STACK" DistributionId)" \
      "AlarmTopicArn=$(maybe_output "$SITE_STACK" AlarmTopicArn)" \
      "GitHubRepo=$REPO"
  "$here/deploy.sh" code
  ;;

code)
  # The nightly build runs from a bundle rather than the checkout, so the layout
  # is flattened: publish.py finds tt.py beside it either way.
  fn="$(maybe_output "$TOOL_STACK" BuildFunctionName)"
  [ -n "$fn" ] || { echo "no stack for this tool; run ./deploy.sh stack first" >&2; exit 1; }
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  cp "$here/../tt.py" "$here/../page.js" "$here/publish.py" \
     "$here/lambda_function.py" "$here/tool.conf" "$work/"
  cp -R "$here/../vendor" "$work/vendor"
  (cd "$work" && zip -qr bundle.zip .)
  aws lambda update-function-code --function-name "$fn" \
    --zip-file "fileb://$work/bundle.zip" --output text --query LastModified
  aws lambda wait function-updated --function-name "$fn"
  # The shorthand parser rejects an empty value, so only what has one goes in.
  # YEAR normally has none: unset, the generator follows the calendar.
  vars="BUCKET=$(output "$SITE_STACK" BucketName)"
  vars="$vars,DISTRIBUTION=$(output "$SITE_STACK" DistributionId)"
  vars="$vars,INITIAL_SCHOOL=${INITIAL_SCHOOL:-ProTERA}"
  vars="$vars,INITIAL_CLASS=${INITIAL_CLASS:-8}"
  vars="$vars,SITE_LANGUAGE=${SITE_LANGUAGE:-et}"
  vars="$vars,PREFIX=$PREFIX"
  # Whether the site answers /report. Asked rather than assumed: a page
  # posting where nothing listens is worse than one that stays quiet.
  vars="$vars,REPORT_ERRORS=$(maybe_output "$SITE_STACK" ReportErrors)"
  counter="${GOATCOUNTER:-$(maybe_output "$SITE_STACK" CounterSite)}"
  [ -n "$counter" ] && vars="$vars,GOATCOUNTER=$counter"
  [ -n "${YEAR:-}" ] && vars="$vars,YEAR=$YEAR"
  aws lambda update-function-configuration --function-name "$fn" \
    --environment "Variables={$vars}" \
    --output text --query LastModified
  echo "pushed the generator to $fn"
  ;;

secrets)
  # gh keeps several accounts and only one is active. The wrong one gets a 403
  # here, which reads like a permissions bug rather than a wrong-hat bug.
  if ! gh api "repos/$REPO" --jq .permissions.push 2>/dev/null | grep -q true; then
    echo "the active gh account cannot write to $REPO." >&2
    echo "  gh auth status          # see which accounts are logged in" >&2
    echo "  gh auth switch --user <account>" >&2
    exit 1
  fi
  gh secret set AWS_PUBLISH_ROLE  --repo "$REPO" --body "$(output "$TOOL_STACK" PublishRoleArn)"
  gh secret set AWS_BUILD_FUNCTION --repo "$REPO" --body "$(output "$TOOL_STACK" BuildFunctionName)"
  echo "set AWS_PUBLISH_ROLE and AWS_BUILD_FUNCTION on $REPO"
  ;;

publish)
  BUCKET="$(output "$SITE_STACK" BucketName)" \
  DISTRIBUTION="$(output "$SITE_STACK" DistributionId)" \
  PREFIX="$PREFIX" \
  GOATCOUNTER="${GOATCOUNTER:-$(maybe_output "$SITE_STACK" CounterSite)}" \
  INITIAL_SCHOOL="${INITIAL_SCHOOL:-ProTERA}" \
  INITIAL_CLASS="${INITIAL_CLASS:-8}" \
  SITE_LANGUAGE="${SITE_LANGUAGE:-et}" \
  REPORT_ERRORS="$(maybe_output "$SITE_STACK" ReportErrors)" \
  AWS_REGION="$REGION" \
    python3 "$here/publish.py"
  ;;

*)
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
