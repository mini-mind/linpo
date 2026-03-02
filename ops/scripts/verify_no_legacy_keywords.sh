#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "rg is required but not installed" >&2
  exit 2
fi

set +e

k1="we""b3""d"
k2="co""ck""pit"
k3="a""2""a"
k4="ce""o"
k5="api""-""backend"
k6="agent""-""manager"
k7="agent""_""manager""_""url"
k8="/etc/""${k1}"
k9=".""${k1}"
k10="${k1}""-"
k11="${k1}""-""worker"

pat="(\\b(${k1}|${k2}|${k3}|${k4})\\b|${k10}|${k5}|${k6}|${k7}|${k8}|${k9}|${k11})"

rg -n -i --hidden --no-ignore \
  -g "!.git/**" \
  -g "!**/.venv/**" \
  -g "!ops/scripts/verify_no_legacy_keywords.sh" \
  "${pat}" \
  .

rg_status=$?
set -e

if [ "$rg_status" -eq 0 ]; then
  echo "Legacy keyword matches found" >&2
  exit 1
fi

if [ "$rg_status" -ne 1 ]; then
  exit "$rg_status"
fi
