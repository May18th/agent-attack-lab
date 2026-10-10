#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

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

exec "$python" -m uvicorn "$1" --host 127.0.0.1 --port "$2" --log-level warning
