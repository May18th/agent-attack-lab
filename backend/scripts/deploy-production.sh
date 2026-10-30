#!/usr/bin/env bash
set -euo pipefail

repo_dir=${DEPLOY_REPO_DIR:-/opt/agent-attack-lab}
release_root=${DEPLOY_RELEASE_ROOT:-/home/deployer/agent-attack-lab-releases}
deploy_ref=${DEPLOY_REF:-main}
deploy_sha=${DEPLOY_SHA:?DEPLOY_SHA must be set}
source_dir=${DEPLOY_SOURCE_DIR:-}
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
command -v curl >/dev/null 2>&1 || fail "curl is not installed"
if [[ -n "$source_dir" ]]; then
  [[ -d "$source_dir/backend" ]] || fail "deployment source directory is invalid: $source_dir"
  [[ "$deploy_sha" =~ ^[0-9a-f]{40}$ ]] || fail "archive deployment requires a full commit SHA"
else
  [[ -d "$repo_dir/.git" ]] || fail "production checkout not found: $repo_dir"
  command -v git >/dev/null 2>&1 || fail "git is not installed"
fi
python_bin="$runtime_backend/.venv/bin/python"
[[ -x "$python_bin" ]] || fail "production Python virtualenv not found: $python_bin"

target_sha="$deploy_sha"
if [[ -z "$source_dir" ]]; then
  cd "$repo_dir"

  status=$(git status --porcelain --untracked-files=all)
  if [[ -n "$status" ]]; then
    printf 'INFO: preserving local production checkout changes:\n%s\n' "$status" >&2
  fi

  git fetch --no-tags origin "$deploy_ref"
  target_sha=$(git rev-parse "origin/$deploy_ref")
  [[ "$target_sha" == "$deploy_sha" ]] || fail "target ref moved: expected $deploy_sha, got $target_sha"
fi

mkdir -p "$release_root"
if [[ -e "$release_dir" ]]; then
  [[ -d "$release_dir" ]] || fail "release path is not a directory: $release_dir"
  if [[ -n "$source_dir" && -f "$release_dir/.deploy-sha" ]]; then
    release_current_sha=$(<"$release_dir/.deploy-sha")
  else
    release_current_sha=$(git -C "$release_dir" rev-parse HEAD 2>/dev/null || true)
  fi
  [[ "$release_current_sha" == "$target_sha" ]] || fail "source release has an unexpected commit: $release_dir"
else
  if [[ -n "$source_dir" ]]; then
    mkdir -p "$release_dir"
    cp -a "$source_dir"/. "$release_dir"/
    printf '%s\n' "$target_sha" > "$release_dir/.deploy-sha"
  else
    git -C "$repo_dir" worktree add --detach "$release_dir" "$target_sha"
  fi
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

# PDF 导出依赖 CJK 字体；先建运行时目录，保证下面的软链在首次部署时也能建起来。
mkdir -p "$runtime_backend/.fonts" 2>/dev/null || true

for runtime_entry in .env .data .venv .wit .acps-cli keyfiles packages acps .fonts; do
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

ensure_amp_dependency() {
  # AMP 心跳直投平台 Kafka 需要 kafka-python。缺失时 amp.py 只会写本地 NDJSON，
  # 表现为「本机服务一停，梧桐平台三只智能体立刻掉线」。venv 在部署流程之外
  # 创建，所以这里幂等补齐；补齐失败只告警，不影响业务服务启动。
  if "$python_bin" -c 'import kafka' >/dev/null 2>&1; then
    return 0
  fi
  local uv_bin=""
  if command -v uv >/dev/null 2>&1; then
    uv_bin=$(command -v uv)
  elif [[ -x "$HOME/.local/bin/uv" ]]; then
    uv_bin="$HOME/.local/bin/uv"
  fi
  if [[ -n "$uv_bin" ]]; then
    "$uv_bin" pip install --python "$python_bin" 'kafka-python>=3.0' >&2 || true
  else
    "$python_bin" -m pip install 'kafka-python>=3.0' >&2 || true
  fi
  if "$python_bin" -c 'import kafka' >/dev/null 2>&1; then
    printf 'installed kafka-python for AMP heartbeat\n'
  else
    printf 'WARNING: kafka-python missing; AMP heartbeat only writes NDJSON\n' >&2
  fi
}

ensure_pdf_dependency() {
  # venv 在部署流程之外创建，新增的 Python 依赖不会自动进环境。
  # reportlab 缺失时导出接口只会 503（后台表现为「服务暂时不可用」），这里幂等补齐。
  if "$python_bin" -c 'import reportlab' >/dev/null 2>&1; then
    return 0
  fi
  local uv_bin=""
  if command -v uv >/dev/null 2>&1; then
    uv_bin=$(command -v uv)
  elif [[ -x "$HOME/.local/bin/uv" ]]; then
    uv_bin="$HOME/.local/bin/uv"
  fi
  if [[ -n "$uv_bin" ]]; then
    "$uv_bin" pip install --python "$python_bin" 'reportlab>=4.0' >&2 || true
  else
    "$python_bin" -m pip install 'reportlab>=4.0' >&2 || true
  fi
  if "$python_bin" -c 'import reportlab' >/dev/null 2>&1; then
    printf 'installed reportlab for PDF export\n'
  else
    printf 'WARNING: reportlab missing; export.pdf will return 503\n' >&2
  fi
}

pdf_font_is_usable() {
  # reportlab 的 TTFont 只认 TrueType 轮廓；Noto 的 .otf 是 CFF 轮廓，加载会抛错。
  # 所以只看文件大小不够，必须让 reportlab 真解析一次再决定留不留。
  "$python_bin" - "$1" >/dev/null 2>&1 <<'PY'
import sys

from reportlab.pdfbase.ttfonts import TTFont

TTFont("probe", sys.argv[1])
PY
}

ensure_pdf_font() {
  # 生产机是精简 Linux，没有 fontconfig，也没有任何中文字体；
  # PDF 排版必须有 CJK 字体，否则接口只能 503。字体落在运行时目录的 .fonts 下，
  # release 通过软链共享，不需要 root，也不改动系统。
  local font_dir="$runtime_backend/.fonts"
  mkdir -p "$font_dir" 2>/dev/null || true
  # 运行时目录不一定对 deployer 可写，退到 ~/.fonts —— 代码的系统扫描也认这个位置。
  if [[ ! -w "$font_dir" ]]; then
    font_dir="$HOME/.fonts"
    if ! mkdir -p "$font_dir" 2>/dev/null; then
      printf 'WARNING: no writable font directory; export.pdf will keep returning 503\n' >&2
      return 0
    fi
  fi
  # 幂等：已有任意可用字体文件就跳过，避免每次部署重复下载 10MB。
  if compgen -G "$font_dir/*.ttf" >/dev/null || compgen -G "$font_dir/*.ttc" >/dev/null \
    || compgen -G "$font_dir/*.otf" >/dev/null; then
    printf 'PDF font already present in %s\n' "$font_dir"
    return 0
  fi

  local url name target
  while IFS='|' read -r url name; do
    [[ -n "${url:-}" ]] || continue
    target="$font_dir/$name"
    if ! curl --fail --location --silent --show-error --retry 2 --connect-timeout 10 --max-time 420 \
      "$url" --output "$target.part"; then
      printf 'font download failed: %s\n' "$url" >&2
      rm -f "$target.part"
      continue
    fi
    if [[ -s "$target.part" ]] && [[ "$(wc -c < "$target.part" 2>/dev/null || echo 0)" -gt 500000 ]] \
      && pdf_font_is_usable "$target.part"; then
      mv "$target.part" "$target"
      printf 'downloaded PDF font from %s\n' "$url"
      return 0
    fi
    printf 'discarded unusable font from %s\n' "$url" >&2
    rm -f "$target.part"
  done <<'FONTS'
https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf|NotoSansSC.ttf
https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf|NotoSansSC.ttf
https://raw.gitmirror.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf|NotoSansSC.ttf
https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf|NotoSansSC.ttf
FONTS
  printf 'WARNING: PDF font unavailable; export.pdf will keep returning 503 until a CJK font exists\n' >&2
}

verify_pdf_export() {
  # 部署即验证：缺依赖或缺字体在这里就暴露，而不是等用户点「导出」才 503。
  local output
  if output=$(cd "$release_backend" && PYTHONPATH="$release_backend/src" "$python_bin" -c \
    'from agent_attack_lab import survey_pdf; rows=[{"q1_role":"自检","q2_pain_point":"自检","q3_ranking":["A","B","C","D"],"q4_can_judge":"能，证据链清晰","q5_willingness":"敢，有授权就敢用","q6_reuse_score":5}]; print("pdf-bytes", len(survey_pdf.build_survey_pdf(rows, part="summary")))' 2>&1); then
    printf 'PDF export self-check: %s\n' "$output"
  else
    printf 'WARNING: PDF export self-check failed: %s\n' "$output" >&2
  fi
}

ensure_amp_dependency
ensure_pdf_dependency
ensure_pdf_font
verify_pdf_export
(cd "$release_backend" && "$python_bin" -m alembic -c alembic.ini upgrade head)

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

unit_fragment_path=$(systemctl --user show "${services[0]}" -p FragmentPath --value)
[[ -n "$unit_fragment_path" ]] || fail "could not locate ${services[0]} unit"
user_unit_dir=$(dirname "$unit_fragment_path")
snapshot_dir=$(mktemp -d)
dropins_changed=0

restore_dropins() {
  local service path snapshot
  for service in "${services[@]}"; do
    path="$user_unit_dir/$service.d/production-release.conf"
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
  local path="$user_unit_dir/$service.d/production-release.conf"
  mkdir -p "$(dirname "$path")"
  printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=%s/scripts/start-service.sh %s %s\n' \
    "$release_backend" "$release_backend" "$app" "$port" > "$path"
}

for service in "${services[@]}"; do
  existing_path="$user_unit_dir/$service.d/production-release.conf"
  if [[ -f "$existing_path" ]]; then
    cp "$existing_path" "$snapshot_dir/$service.conf"
  fi
done

dropins_changed=1
write_dropin agent-attack-lab-api.service agent_attack_lab.service:app 8787
write_dropin agent-attack-lab-attacker.service agent_attack_lab.agents.attacker:app 8788
write_dropin agent-attack-lab-defender.service agent_attack_lab.agents.defender:app 8789
systemctl --user daemon-reload

wait_for_active() {
  local service=$1 attempt
  for attempt in {1..30}; do
    if systemctl --user is-active --quiet "$service"; then
      return 0
    fi
    sleep 1
  done
  systemctl --user status "$service" --no-pager >&2 || true
  systemctl --user show "$service" -p FragmentPath -p DropInPaths -p WorkingDirectory -p ExecStart -p MainPID >&2 || true
  systemctl --user cat "$service" >&2 || true
  journalctl --user -u "$service" -n 50 --no-pager >&2 || true
  fail "$service is not active after 30 seconds"
}

for service in "${services[@]}"; do
  systemctl --user restart "$service"
done

for service in "${services[@]}"; do
  wait_for_active "$service"
done

verify_runtime_context() {
  local service=$1
  local pid actual_cwd pythonpath expected_pythonpath
  dump_service_context() {
    systemctl --user show "$service" -p FragmentPath -p DropInPaths -p WorkingDirectory -p ExecStart -p MainPID >&2 || true
    systemctl --user cat "$service" >&2 || true
  }
  pid=$(systemctl --user show "$service" -p MainPID --value)
  if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]]; then
    dump_service_context
    fail "$service has no running MainPID"
  fi
  actual_cwd=$(readlink -f "/proc/$pid/cwd")
  if [[ "$actual_cwd" != "$release_backend" ]]; then
    dump_service_context
    fail "$service has unexpected WorkingDirectory: $actual_cwd"
  fi
  pythonpath=$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^PYTHONPATH=//p')
  expected_pythonpath="$release_backend/src"
  if [[ "$pythonpath" != "$expected_pythonpath"* ]]; then
    dump_service_context
    fail "$service does not prioritize release PYTHONPATH"
  fi
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
