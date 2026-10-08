#!/usr/bin/env bash
# Prints the site release candidates awaiting approval: staging is frozen while
# one is open. An open rc is an rc-* pre-release whose body lacks the
# superseded marker and whose commit is not yet in the latest prod-* release.
# (Not the production branch: promote.yml moves that branch before deploy.yml
# runs, so the rc being deployed would already look live.)
# Used by promote.yml and deploy.yml. Needs: git fetch --tags, gh with GH_TOKEN.
set -euo pipefail

live=$(git tag -l 'prod-*' | sort -V | tail -1)
gh release list --limit 100 --json tagName,isPrerelease \
  --jq '.[] | select(.isPrerelease and (.tagName | startswith("rc-"))) | .tagName' |
while read -r tag; do
  body=$(gh release view "$tag" --json body --jq .body)
  [[ "$body" == *"<!-- dfs:superseded -->"* ]] && continue
  sha=$(git rev-parse "$tag^{commit}")
  if [ -n "$live" ] && git merge-base --is-ancestor "$sha" "$live"; then continue; fi
  echo "$tag"
done
