"""用户调研问卷的落盘与导出。

问卷页由本项目托管（``GET /survey``），提交到 ``POST /api/survey/submit``。
数据以 JSONL 追加写入 ``.data/survey/responses.jsonl``：不建表、不做迁移，
避免在材料冻结期改动数据库结构。

设计约束：
- 追加写必须原子到"一行"，且并发安全（进程内锁 + 单次 write）；
- 任何存储异常都不能让提交方看到 500 之外的细节，也不能丢已写内容；
- 导出按提交顺序输出，字段与问卷页一致，便于直接贴进材料。
"""

from __future__ import annotations

import csv
import io
import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

_LOCK = threading.Lock()

CSV_COLUMNS = [
    "id",
    "received_at",
    "client_ip",
    "user_agent",
    "q1_role",
    "q2_method",
    "q2_pain_point",
    "q2_pain_other",
    "q3_ranking",
    "q4_can_judge",
    "q4_distrust_areas",
    "q4_distrust_other",
    "q5_willingness",
    "q5_concern",
    "q6_reuse_score",
    "q6_must_fix",
]


def store_path() -> Path:
    """Return the JSONL path, overridable for tests and non-default deployments."""
    raw = os.getenv("AGENT_SURVEY_STORE", ".data/survey/responses.jsonl")
    return Path(raw)


def append_response(payload: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """Append one response and return the stored record."""
    record = {
        "id": uuid.uuid4().hex,
        "received_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        **meta,
        **payload,
    }
    line = json.dumps(record, ensure_ascii=False, default=str) + "\n"
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, path.open("a", encoding="utf-8", newline="") as handle:
        handle.write(line)
        handle.flush()
        os.fsync(handle.fileno())
    return record


def load_all() -> list[dict[str, Any]]:
    """Load every stored response, skipping malformed lines instead of failing."""
    path = store_path()
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for raw in handle:
            raw = raw.strip()
            if not raw:
                continue
            try:
                item = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict):
                rows.append(item)
    return rows


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return " > ".join(str(item) for item in value)
    return str(value)


def to_csv(rows: list[dict[str, Any]] | None = None) -> str:
    """Render responses as CSV text (UTF-8 with BOM so Excel opens it correctly)."""
    data = load_all() if rows is None else rows
    buffer = io.StringIO()
    buffer.write("\ufeff")
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for row in data:
        writer.writerow({key: _cell(row.get(key)) for key in CSV_COLUMNS})
    return buffer.getvalue()
