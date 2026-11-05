#!/usr/bin/env bash
# Publishes to (or removes from) the gh-pages branch with a retried push.
#
# Several workflows write to gh-pages (production deploy at the branch
# root, one pr-<N>/ directory per PR preview, preview cleanup). They run
# concurrently, so a push can be rejected as non-fast-forward when another
# workflow pushed first. Each attempt starts from a fresh clone of the
# branch tip, re-applies the change and pushes; a rejected push is retried
# against the new tip. Unrelated paths are never touched, so retries are
# always safe to replay.
#
#   publish-gh-pages.sh publish <src-dir> <dest> <message>
#       <dest> is "." to overlay <src-dir> onto the branch root (existing
#       files, including pr-*/ previews, are kept), or a subdirectory
#       name, which is replaced wholesale.
#   publish-gh-pages.sh remove <subdir> <message>
#
# Environment:
#   GITHUB_TOKEN / GITHUB_REPOSITORY  used to build the push URL
#   REMOTE_URL                        overrides the push URL (tests)
#   GH_PAGES_BRANCH                   defaults to gh-pages
#   MAX_ATTEMPTS                      defaults to 6
set -euo pipefail

mode="${1:-}"
branch="${GH_PAGES_BRANCH:-gh-pages}"
max_attempts="${MAX_ATTEMPTS:-6}"
remote="${REMOTE_URL:-https://x-access-token:${GITHUB_TOKEN:-}@github.com/${GITHUB_REPOSITORY:-}.git}"

case "$mode" in
  publish)
    [ "$#" -eq 4 ] || { echo "usage: $0 publish <src-dir> <dest> <message>" >&2; exit 2; }
    src="$(cd "$2" && pwd)"
    dest="$3"
    message="$4"
    ;;
  remove)
    [ "$#" -eq 3 ] || { echo "usage: $0 remove <subdir> <message>" >&2; exit 2; }
    dest="$2"
    message="$3"
    ;;
  *)
    echo "usage: $0 publish|remove ..." >&2
    exit 2
    ;;
esac

case "$dest" in
  /* | *..*) echo "refusing unsafe destination: $dest" >&2; exit 2 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

attempt=1
while true; do
  rm -rf "$work/repo"
  if git clone --quiet --depth 1 --branch "$branch" "$remote" "$work/repo" 2>/dev/null; then
    :
  else
    echo "Branch $branch not found; creating it."
    git init --quiet "$work/repo"
    git -C "$work/repo" checkout --quiet --orphan "$branch"
    git -C "$work/repo" remote add origin "$remote"
  fi
  cd "$work/repo"
  git config user.name "github-actions[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"

  if [ "$mode" = "publish" ]; then
    if [ "$dest" = "." ]; then
      cp -a "$src"/. .
    else
      rm -rf "./$dest"
      mkdir -p "./$dest"
      cp -a "$src"/. "./$dest"/
    fi
    touch .nojekyll
  else
    if [ ! -d "./$dest" ]; then
      echo "Nothing to remove at $dest."
      exit 0
    fi
    rm -rf "./$dest"
  fi

  git add -A
  if git diff --cached --quiet; then
    echo "No changes to publish."
    exit 0
  fi
  git commit --quiet -m "$message"

  if git push --quiet origin "HEAD:refs/heads/$branch"; then
    echo "Pushed to $branch (attempt $attempt)."
    exit 0
  fi

  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Push to $branch failed after $attempt attempts." >&2
    exit 1
  fi
  delay=$(( (RANDOM % 5) + attempt ))
  echo "Push rejected (attempt $attempt); retrying in ${delay}s against the new tip."
  sleep "$delay"
  attempt=$(( attempt + 1 ))
  cd "$work"
done
