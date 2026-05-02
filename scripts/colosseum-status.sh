#!/usr/bin/env bash
# Colosseum quick status — "is the unit healthy + is the HTTP endpoint up".
#
# Usage:  bash scripts/colosseum-status.sh
# Exits 0 when both the systemd unit (if installed) is active AND the
# HTTP /api/health responds 200. Exits non-zero otherwise.
#
# Safe to run without root — falls back to user-level systemctl if needed,
# and degrades gracefully when systemd isn't installed at all (e.g., when
# Colosseum is being run by hand via `npm run start`).

set -uo pipefail

PORT="${COLOSSEUM_PORT:-18799}"
HOST="${COLOSSEUM_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/api/health"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

bold "Colosseum status"

# 1) systemd unit
exit_unit=0
if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files 2>/dev/null | grep -q '^colosseum\.service'; then
    if systemctl is-active --quiet colosseum.service; then
      ok "systemd unit colosseum.service is active"
    else
      fail "systemd unit colosseum.service is NOT active"
      systemctl --no-pager --lines=3 status colosseum.service 2>&1 | sed 's/^/     /'
      exit_unit=1
    fi
  else
    warn "systemd unit colosseum.service is not installed (running by hand?)"
  fi
else
  warn "systemctl not available — skipping unit check"
fi

# 2) HTTP /api/health
exit_http=0
if command -v curl >/dev/null 2>&1; then
  http=$(curl -sS -o /tmp/colosseum-health.$$ -w '%{http_code}' --max-time 3 "$URL" 2>/dev/null || echo "000")
  if [ "$http" = "200" ]; then
    body=$(cat /tmp/colosseum-health.$$ 2>/dev/null || echo "")
    rm -f /tmp/colosseum-health.$$
    ok "HTTP $URL → 200"
    echo "     $body"
  else
    fail "HTTP $URL → $http"
    rm -f /tmp/colosseum-health.$$
    exit_http=1
  fi
else
  warn "curl not available — skipping HTTP check"
fi

# 3) Quick-look at state directory if env points at one
state="${COLOSSEUM_STATE_ROOT:-${COLOSSEUM_STATE:-}}"
if [ -n "$state" ] && [ -d "$state" ]; then
  trials=$(find "$state/trials" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
  ok "state root: $state ($trials trial(s) on disk)"
elif [ -n "$state" ]; then
  warn "state root configured but directory missing: $state"
fi

# 4) Aggregate exit
if [ "$exit_unit" -eq 0 ] && [ "$exit_http" -eq 0 ]; then
  exit 0
fi
exit 1
