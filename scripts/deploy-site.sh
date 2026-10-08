#!/usr/bin/env bash
# Copy a built Gatefit docs site to any static host. GATEFIT-H11.
# Does not use GitHub Actions. Does not change repository visibility.
# Does not write the npm registry, cut a git tag, or open a GitHub Release.
#
# GitHub Pages needs a public repository or a paid plan before it will
# serve this site. Until then, point this script at another static host.
#
# Inputs:
#   GATEFIT_SITE_DIST       Built static directory. Default: <repo>/site/dist
#   GATEFIT_DEPLOY_TARGET   local | rsync | s3
#   GATEFIT_DEPLOY_DEST     Destination.
#     local: absolute directory. Created if needed.
#     rsync: user@host:path (requires rsync). Replaces remote contents.
#     s3:    s3://bucket/prefix (requires the aws CLI). Replaces prefix contents.
#   GATEFIT_DEPLOY_REPLACE  Set to 1 to replace a non-empty local dest, or to
#                           allow rsync and s3 (those targets always replace).
#
# Example:
#   (cd site && npm ci && npm run build)
#   GATEFIT_DEPLOY_TARGET=local GATEFIT_DEPLOY_DEST=/tmp/gatefit-site \
#     bash scripts/deploy-site.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${GATEFIT_SITE_DIST:-$ROOT/site/dist}"
TARGET="${GATEFIT_DEPLOY_TARGET:-}"
DEST="${GATEFIT_DEPLOY_DEST:-}"

fail() { echo "deploy-site: FAIL: $*" >&2; exit 1; }

[[ -n "$TARGET" ]] || fail "GATEFIT_DEPLOY_TARGET is required (local, rsync, or s3)"
[[ -n "$DEST" ]] || fail "GATEFIT_DEPLOY_DEST is required"

case "$TARGET" in
  local|rsync|s3) ;;
  *) fail "unknown GATEFIT_DEPLOY_TARGET: $TARGET (use local, rsync, or s3)" ;;
esac

assert_safe_local_dest() {
  local dest_real="$1"
  local repo_real segments
  [[ "$dest_real" == /* ]] || fail "local dest must be absolute: $DEST"
  [[ "$dest_real" != "/" ]] || fail "refusing dest /"
  repo_real="$(realpath "$ROOT")"
  [[ "$dest_real" != "$repo_real" ]] || fail "refusing repo root as dest"
  case "$repo_real" in
    "$dest_real"|"$dest_real"/*) fail "refusing dest that contains the repo" ;;
  esac
  case "$dest_real" in
    /bin|/bin/*|/sbin|/sbin/*|/usr|/usr/*|/etc|/etc/*|/lib|/lib/*|/lib64|/lib64/*|/boot|/boot/*|/proc|/proc/*|/sys|/sys/*|/dev|/dev/*|/root|/root/*)
      fail "refusing system dest: $dest_real"
      ;;
    /tmp|/var|/var/tmp|/opt|/srv|/home|/Users)
      fail "refusing shallow dest: $dest_real"
      ;;
  esac
  if [[ -n "${HOME:-}" && "$dest_real" == "$HOME" ]]; then
    fail "refusing home directory as dest"
  fi
  if [[ "$dest_real" =~ ^/home/[^/]+$ || "$dest_real" =~ ^/Users/[^/]+$ ]]; then
    fail "refusing a home directory as dest"
  fi
  segments="$(awk -F/ '{print NF-1}' <<<"$dest_real")"
  [[ "$segments" -ge 2 ]] || fail "refusing shallow dest: $dest_real"
}

if [[ "$TARGET" == "local" ]]; then
  DEST="$(realpath -m "$DEST")"
  assert_safe_local_dest "$DEST"
fi

if [[ "$TARGET" == "s3" ]]; then
  case "$DEST" in
    s3://*/*) ;;
    *) fail "s3 target requires GATEFIT_DEPLOY_DEST=s3://bucket/prefix" ;;
  esac
  [[ "${GATEFIT_DEPLOY_REPLACE:-}" == "1" ]] || fail "s3 replaces dest contents; set GATEFIT_DEPLOY_REPLACE=1"
fi

if [[ "$TARGET" == "rsync" ]]; then
  case "$DEST" in
    *@*:*) ;;
    *) fail "rsync target expects user@host:path" ;;
  esac
  [[ "${GATEFIT_DEPLOY_REPLACE:-}" == "1" ]] || fail "rsync replaces dest contents; set GATEFIT_DEPLOY_REPLACE=1"
fi

[[ -d "$DIST" ]] || fail "site dist missing: $DIST (build site/ first)"
index_found="$(find "$DIST" -name 'index.html' -type f -print -quit || true)"
[[ -n "$index_found" ]] || fail "site dist has no index.html: $DIST"
landing="${DIST}/index.html"
[[ -f "$landing" ]] || fail "site dist missing landing index.html: $landing"
if ! grep -q 'href="https://buy.polar.sh/polar_cl_' "$landing"; then
  fail "landing CTA is not a Polar Checkout Link; build site/ so the committed link or a polar_cl_ override is in the CTA"
fi

if [[ "$TARGET" == "local" ]]; then
  dist_real="$(realpath "$DIST")"
  [[ "$DEST" != "$dist_real" ]] || fail "refusing to deploy dist onto itself"
  case "$dist_real" in
    "$DEST"|"$DEST"/*) fail "refusing dest that contains site dist" ;;
  esac
  if [[ -n "$(find "$DEST" -mindepth 1 -print -quit 2>/dev/null || true)" && "${GATEFIT_DEPLOY_REPLACE:-}" != "1" ]]; then
    fail "dest is not empty; set GATEFIT_DEPLOY_REPLACE=1 to replace contents"
  fi
fi

case "$TARGET" in
  local)
    mkdir -p "$DEST"
    if [[ "${GATEFIT_DEPLOY_REPLACE:-}" == "1" ]] && command -v rsync >/dev/null 2>&1; then
      rsync -a --delete "$DIST"/ "$DEST"/
    else
      cp -a "$DIST"/. "$DEST"/
    fi
    ;;
  rsync)
    command -v rsync >/dev/null 2>&1 || fail "rsync is not installed"
    rsync -a --delete "$DIST"/ "$DEST"/
    ;;
  s3)
    command -v aws >/dev/null 2>&1 || fail "aws CLI is not installed"
    aws s3 sync "$DIST" "$DEST" --delete
    ;;
esac

echo "deploy-site: ok: $TARGET -> $DEST" >&2
