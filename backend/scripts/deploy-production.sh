#!/usr/bin/env bash
set -euo pipefail

repo_dir=${DEPLOY_REPO_DIR:-/opt/agent-attack-lab}
release_root=${DEPLOY_RELEASE_ROOT:-/home/deployer/agent-attack-lab-releases}
deploy_ref=${DEPLOY_REF:-main}
deploy_sha=${DEPLOY_SHA:?DEPLOY_SHA must be set}
public_health_url=${PUBLIC_HEALTH_URL:-https://api.yuanyiagentzhandui.cn/health}
runtime_backend="$repo_dir/backend"
release_dir="$release_root/$deploy_sha"
release_backend="$release_dir/backend"

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
command -v curl >/dev/null 2>&1 || fail "curl is not installed"
python_bin="$runtime_backend/.venv/bin/python"
[[ -x "$python_bin" ]] || fail "production Python virtualenv not found: $python_bin"

cd "$repo_dir"

status=$(git status --porcelain --untracked-files=all)
if [[ -n "$status" ]]; then
  printf 'INFO: preserving local production checkout changes:\n%s\n' "$status" >&2
fi

git fetch --no-tags origin "$deploy_ref"
target_sha=$(git rev-parse "origin/$deploy_ref")
[[ "$target_sha" == "$deploy_sha" ]] || fail "target ref moved: expected $deploy_sha, got $target_sha"

mkdir -p "$release_root"
if [[ -e "$release_dir" ]]; then
  [[ -d "$release_dir" ]] || fail "release path is not a directory: $release_dir"
  release_current_sha=$(git -C "$release_dir" rev-parse HEAD 2>/dev/null || true)
  [[ "$release_current_sha" == "$target_sha" ]] || fail "existing release has an unexpected commit: $release_dir"
else
  git -C "$repo_dir" worktree add --detach "$release_dir" "$target_sha"
fi

link_runtime_entry() {
  local name=$1
  local source="$runtime_backend/$name"
  local destination="$release_backend/$name"
  [[ -e "$source" || -L "$source" ]] || return 0
  if [[ -L "$destination" && "$(readlink "$destination")" == "$source" ]]; then
    return 0
  fi
  [[ ! -e "$destination" && ! -L "$destination" ]] || fail "release path already contains $destination"
  ln -s "$source" "$destination"
}

for runtime_entry in .env .data .venv .wit .acps-cli keyfiles packages acps; do
  link_runtime_entry "$runtime_entry"
done

load_agent_env() {
  local line name value
  [[ -f "$runtime_backend/.env" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ "$line" =~ ^(AGENT_[A-Z0-9_]+)=(.*)$ ]]; then
      name=${BASH_REMATCH[1]}
      value=${BASH_REMATCH[2]}
      if [[ ${#value} -ge 2 && ( ( ${value:0:1} == '"' && ${value: -1} == '"' ) || ( ${value:0:1} == "'" && ${value: -1} == "'" ) ) ]]; then
        value=${value:1:${#value}-2}
      fi
      export "$name=$value"
    fi
  done < "$runtime_backend/.env"
}

load_agent_env
(cd "$release_backend" && "$python_bin" -m alembic -c alembic.ini upgrade head)

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

user_unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
snapshot_dir=$(mktemp -d)
dropins_changed=0

restore_dropins() {
  local service path snapshot
  for service in "${services[@]}"; do
    path="$user_unit_dir/$service.service.d/production-release.conf"
    snapshot="$snapshot_dir/$service.conf"
    if [[ -f "$snapshot" ]]; then
      mkdir -p "$(dirname "$path")"
      cp "$snapshot" "$path"
    else
      rm -f "$path"
    fi
  done
}

rollback_on_failure() {
  local exit_code=$?
  trap - EXIT
  if ((exit_code != 0 && dropins_changed == 1)); then
    restore_dropins || true
    systemctl --user daemon-reload || true
    for service in "${services[@]}"; do
      systemctl --user restart "$service" || true
    done
    printf 'ROLLBACK: restored previous systemd release configuration\n' >&2
  fi
  rm -rf "$snapshot_dir"
  exit "$exit_code"
}
trap rollback_on_failure EXIT

write_dropin() {
  local service=$1 app=$2 port=$3
  local path="$user_unit_dir/$service.service.d/production-release.conf"
  mkdir -p "$(dirname "$path")"
  printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=%s/scripts/start-service.sh %s %s\n' \
    "$release_backend" "$release_backend" "$app" "$port" > "$path"
}

for service in "${services[@]}"; do
  existing_path="$user_unit_dir/$service.service.d/production-release.conf"
  if [[ -f "$existing_path" ]]; then
    cp "$existing_path" "$snapshot_dir/$service.conf"
  fi
done

dropins_changed=1
write_dropin agent-attack-lab-api.service agent_attack_lab.service:app 8787
write_dropin agent-attack-lab-attacker.service agent_attack_lab.agents.attacker:app 8788
write_dropin agent-attack-lab-defender.service agent_attack_lab.agents.defender:app 8789
systemctl --user daemon-reload

for service in "${services[@]}"; do
  systemctl --user restart "$service"
done

for service in "${services[@]}"; do
  systemctl --user is-active --quiet "$service" || fail "$service is not active after restart"
done

verify_runtime_context() {
  local service=$1
  local pid actual_cwd pythonpath expected_pythonpath
  pid=$(systemctl --user show "$service" -p MainPID --value)
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || fail "$service has no running MainPID"
  actual_cwd=$(readlink -f "/proc/$pid/cwd")
  [[ "$actual_cwd" == "$release_backend" ]] || fail "$service has unexpected WorkingDirectory: $actual_cwd"
  pythonpath=$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^PYTHONPATH=//p')
  expected_pythonpath="$release_backend/src"
  [[ "$pythonpath" == "$expected_pythonpath"* ]] || fail "$service does not prioritize release PYTHONPATH"
}

for service in "${services[@]}"; do
  verify_runtime_context "$service"
done

wait_for_health() {
  local endpoint=$1
  local attempt
  for attempt in {1..30}; do
    if curl --fail --silent --show-error --max-time 15 --output /dev/null "$endpoint"; then
      return 0
    fi
    sleep 1
  done
  for service in "${services[@]}"; do
    systemctl --user status "$service" --no-pager >&2 || true
    journalctl --user -u "$service" -n 30 --no-pager >&2 || true
  done
  fail "health check failed after 30 seconds: $endpoint"
}

for endpoint in \
  http://127.0.0.1:8787/health \
  http://127.0.0.1:8788/health \
  http://127.0.0.1:8789/health \
  "$public_health_url"; do
  wait_for_health "$endpoint"
done

trap - EXIT
rm -rf "$snapshot_dir"
printf 'DEPLOY OK: %s (%s)\n' "$target_sha" "$deploy_ref"
