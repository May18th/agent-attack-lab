#!/usr/bin/env bash
set -uo pipefail

public_health_url=${1:-https://api.yuanyiagentzhandui.cn/health}
deploy_user=${DEPLOY_USER:-$(id -un)}
failures=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; failures=$((failures + 1)); }

check_user_service() {
  local service=$1
  local enabled active
  enabled=$(systemctl --user is-enabled "$service" 2>/dev/null || true)
  active=$(systemctl --user is-active "$service" 2>/dev/null || true)
  [[ $enabled == enabled ]] && pass "$service enabled" || fail "$service enabled (actual: ${enabled:-unknown})"
  [[ $active == active ]] && pass "$service active" || fail "$service active (actual: ${active:-unknown})"
}

check_health() {
  local label=$1
  local url=$2
  if curl --fail --silent --show-error --max-time 15 --output /dev/null "$url"; then
    pass "$label"
  else
    fail "$label ($url)"
  fi
}

printf 'Agent Attack Lab VPS runtime verification\n'
printf 'User: %s\n' "$deploy_user"
printf 'Boot ID: %s\n' "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf unknown)"

linger=$(loginctl show-user "$deploy_user" -p Linger --value 2>/dev/null || true)
[[ $linger == yes ]] && pass "login linger enabled" || fail "login linger enabled (actual: ${linger:-unknown})"

services=(
  agent-attack-lab-api.service
  agent-attack-lab-attacker.service
  agent-attack-lab-defender.service
)
for service in "${services[@]}"; do
  check_user_service "$service"
done

if systemctl --user cat cloudflared.service >/dev/null 2>&1; then
  check_user_service cloudflared.service
elif systemctl cat cloudflared.service >/dev/null 2>&1; then
  cloudflared_enabled=$(systemctl is-enabled cloudflared.service 2>/dev/null || true)
  cloudflared_active=$(systemctl is-active cloudflared.service 2>/dev/null || true)
  [[ $cloudflared_enabled == enabled ]] && pass "cloudflared.service enabled (system)" || fail "cloudflared.service enabled (system; actual: ${cloudflared_enabled:-unknown})"
  [[ $cloudflared_active == active ]] && pass "cloudflared.service active (system)" || fail "cloudflared.service active (system; actual: ${cloudflared_active:-unknown})"
else
  fail "cloudflared.service installed"
fi

check_health "API local health" "http://127.0.0.1:8787/health"
check_health "Attacker local health" "http://127.0.0.1:8788/health"
check_health "Defender local health" "http://127.0.0.1:8789/health"
check_health "Public API health" "$public_health_url"

for service in "${services[@]}"; do
  systemctl --user show "$service" \
    --property=ActiveEnterTimestamp \
    --property=MainPID \
    --no-pager 2>/dev/null || true
done

if ((failures > 0)); then
  printf 'Verification failed: %d check(s) did not pass.\n' "$failures" >&2
  exit 1
fi

printf 'Verification passed: VPS services are enabled, active, and healthy.\n'
