#!/usr/bin/env bash
set -euo pipefail

repo_dir=${DEPLOY_REPO_DIR:-/opt/agent-attack-lab}
deploy_ref=${DEPLOY_REF:-main}
deploy_sha=${DEPLOY_SHA:?DEPLOY_SHA must be set}
public_health_url=${PUBLIC_HEALTH_URL:-https://api.yuanyiagentzhandui.cn/health}

services=(
  agent-attack-lab-api.service
  agent-attack-lab-attacker.service
  agent-attack-lab-defender.service
)

fail() {
  printf 'DEPLOY FAILED: %s\n' "$1" >&2
  exit 1
}

[[ "$repo_dir" == "/opt/agent-attack-lab" ]] || fail "refusing unexpected repository path: $repo_dir"
[[ -d "$repo_dir/.git" ]] || fail "production checkout not found: $repo_dir"
command -v git >/dev/null 2>&1 || fail "git is not installed"
if ! command -v uv >/dev/null 2>&1 && [[ -x /home/deployer/.local/bin/uv ]]; then
  export PATH="/home/deployer/.local/bin:$PATH"
fi
command -v uv >/dev/null 2>&1 || fail "uv is not installed (checked PATH and /home/deployer/.local/bin/uv)"
command -v curl >/dev/null 2>&1 || fail "curl is not installed"

cd "$repo_dir"

status=$(git status --porcelain --untracked-files=all)
unexpected_status=$(printf '%s\n' "$status" | awk '!($1 == "??" && $2 ~ /^\.deploy-backups(\/|$)/)')
if [[ -n "$unexpected_status" ]]; then
  printf '%s\n' "$unexpected_status" >&2
  fail "production checkout is dirty; refusing to overwrite local changes"
fi

git fetch --no-tags origin "$deploy_ref"
target_sha=$(git rev-parse "origin/$deploy_ref")
[[ "$target_sha" == "$deploy_sha" ]] || fail "target ref moved: expected $deploy_sha, got $target_sha"

current_sha=$(git rev-parse HEAD)
if [[ "$current_sha" != "$target_sha" ]]; then
  git merge-base --is-ancestor "$current_sha" "$target_sha" || fail "target is not a fast-forward from current production commit"
  git switch --detach "$target_sha"
fi

uv sync --locked
uv run alembic upgrade head

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

for service in "${services[@]}"; do
  systemctl --user restart "$service"
done

for service in "${services[@]}"; do
  systemctl --user is-active --quiet "$service" || fail "$service is not active after restart"
done

for endpoint in \
  http://127.0.0.1:8787/health \
  http://127.0.0.1:8788/health \
  http://127.0.0.1:8789/health \
  "$public_health_url"; do
  curl --fail --silent --show-error --max-time 15 --output /dev/null "$endpoint" \
    || fail "health check failed: $endpoint"
done

printf 'DEPLOY OK: %s (%s)\n' "$target_sha" "$deploy_ref"
