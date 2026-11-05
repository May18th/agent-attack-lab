#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Prefer the source tree selected by the deployment release over any older
# editable package that may already exist in the shared virtual environment.
export PYTHONPATH="$PWD/src${PYTHONPATH:+:$PYTHONPATH}"

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <app> <port>" >&2
  exit 2
fi

case "$1:$2" in
  agent_attack_lab.service:app:8787|agent_attack_lab.agents.attacker:app:8788|agent_attack_lab.agents.defender:app:8789) ;;
  *)
    echo "Unsupported service/port pair: $1:$2" >&2
    exit 2
    ;;
esac

if [[ -x .venv/bin/python ]]; then
  python=.venv/bin/python
elif [[ -x .venv/Scripts/python.exe ]]; then
  python=.venv/Scripts/python.exe
else
  echo "Virtual environment Python not found under .venv" >&2
  exit 1
fi

# Import only project settings; keep the dotenv file out of shell evaluation.
if [[ -f .env ]]; then
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
  done < .env
fi

# AMP 心跳角色必须按服务区分：三个 systemd 服务共用同一份 .env，
# 单靠 .env 里的 AGENT_AMP_ROLE 会让三个进程都上报同一个 AIC，
# 另外两只在梧桐平台上永远是 unknown。这里按启动模块覆盖。
case "$1" in
  *attacker*) export AGENT_AMP_ROLE=attacker ;;
  *defender*) export AGENT_AMP_ROLE=defender ;;
  *) export AGENT_AMP_ROLE=leader ;;
esac

# 日志级别用 info：模型调用、降级、配置告警全在 INFO 层（见 agents/llm_runtime.py
# 的 model_call_completed / role_llm_config_incomplete），压到 warning 会让这些
# 记录彻底消失，排查"生产到底有没有调模型"时无法取证。
# 访问日志单独用 --no-access-log 关掉，否则每条请求一行会把 journal 刷满。
exec "$python" -m uvicorn "$1" --host 127.0.0.1 --port "$2" --log-level info --no-access-log
