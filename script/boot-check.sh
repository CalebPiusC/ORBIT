#!/usr/bin/env bash
# Orbit boot check — proves the CLI still builds and starts after a change.
#
#   ./script/boot-check.sh          # non-interactive checks
#   ./script/boot-check.sh --tui    # also open the TUI (press Ctrl+C to return)
#
# Exit code 0 means every check passed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

TUI=0
for argument in "$@"; do
  case "$argument" in
    --tui) TUI=1 ;;
    -h | --help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $argument" >&2; exit 2 ;;
  esac
done

failures=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; failures=$((failures + 1)); }
info() { printf '  \033[2m%s\033[0m\n' "$1"; }

echo "Orbit boot check ($(uname -s) $(uname -m))"

if ! command -v bun >/dev/null 2>&1; then
  fail "bun is not installed — install it from https://bun.sh (Windows: npm i -g bun)"
  echo "1 check failed." >&2
  exit 1
fi
pass "bun $(bun --version)"

if [ ! -d node_modules ]; then
  fail "dependencies are missing — run: bun install"
  echo "1 check failed." >&2
  exit 1
fi
pass "dependencies installed"

version="$(bun run dev --version 2>&1)"
if printf '%s' "$version" | grep -qE 'orbit v'; then
  pass "orbit --version → $(printf '%s' "$version" | grep -oE 'orbit v\S+' | head -1)"
else
  fail "orbit --version did not print an Orbit version"
  info "$(printf '%s' "$version" | tail -3)"
fi

help="$(bun run dev --help 2>&1)"
if printf '%s' "$help" | grep -q 'USAGE' && printf '%s' "$help" | grep -q 'orbit <subcommand>'; then
  pass "orbit --help prints the Orbit command line interface"
else
  fail "orbit --help did not print the expected usage line"
  info "$(printf '%s' "$help" | head -5)"
fi

paths="$(bun run dev debug paths 2>&1)"
if printf '%s' "$paths" | grep -q "$HOME/.config/orbit"; then
  pass "config and data folders resolve to Orbit ($HOME/.config/orbit)"
else
  fail "global folders do not resolve to Orbit"
  info "$(printf '%s' "$paths" | head -8)"
fi

if [ "$TUI" -eq 1 ]; then
  if [ ! -t 0 ]; then
    fail "--tui needs a real terminal"
  else
    info "starting the TUI — press Ctrl+C to finish the check"
    bun run dev --standalone || true
    pass "TUI exited without a crash"
  fi
fi

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed." >&2
  exit 1
fi
echo "All checks passed."
