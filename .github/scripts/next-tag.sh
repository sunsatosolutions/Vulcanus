#!/usr/bin/env bash
# Prints the next site release tag: <prefix>-YYYY-MM-DD.N (Istanbul time).
#   .github/scripts/next-tag.sh rc    ->  rc-2026-10-08.1
# Needs: git fetch --tags.
set -euo pipefail

prefix=$1
day=$(TZ=Europe/Istanbul date +%F)
last=$(git tag -l "$prefix-$day.*" | sed 's/.*\.//' | sort -n | tail -1)
echo "$prefix-$day.$(( ${last:-0} + 1 ))"
