#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
version="$(node -p 'require("./package.json").version')"

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit local changes before publishing a release."
  exit 1
fi
if git rev-parse --verify "refs/tags/$version" >/dev/null 2>&1; then
  echo "Tag $version already exists."
  exit 1
fi
read -r -p "Publish GitHub Release $version? [y/N]: " answer
if [ "$answer" != "y" ]; then
  exit 0
fi
pnpm test
git push origin HEAD:refs/heads/4.0
git tag "$version"
git push origin "refs/tags/$version"
echo "Tag pushed. GitHub Actions will build and publish the release."
