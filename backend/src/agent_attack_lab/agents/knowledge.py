"""Role-scoped projections for knowledge supplied to standalone LLM agents.

The admin tables are intentionally broader than an agent prompt.  This module
keeps the prompt boundary explicit: callers may provide only a projection for
the current role, and each projection drops fields belonging to the other
agent before the data reaches the model.
"""

from __future__ import annotations

from typing import Any

_MAX_RECORDS = 8
_MAX_TEXT = 500

# 领域词表：中文没有通用分词，用安全领域的固定词做「共享关键词」打分。
# 只靠子串包含会让「AI 客服被诱导泄露客户手机号」匹配不到种子里的
# 「AI 客服被诱导泄露用户隐私」，知识库有数据但攻击方拿到的是空。
_LEXICON: tuple[str, ...] = (
    "提示注入",
    "提示词",
    "系统指令",
    "指令覆盖",
    "越权",
    "权限",
    "提权",
    "账户",
    "转账",
    "限额",
    "额度",
    "审批",
    "口令",
    "泄露",
    "隐私",
    "手机号",
    "证件号",
    "身份证",
    "客户",
    "订单",
    "支付",
    "退款",
    "报销",
    "工单",
    "客服",
    "文档",
    "检索",
    "知识库",
    "间接",
    "注入",
    "编码",
    "混淆",
    "零宽",
    "全角",
    "工具调用",
    "元数据",
    "上传",
    "路径",
    "内容审核",
    "违规",
    "偏见",
    "招聘",
    "简历",
    "歧视",
    "供应链",
    "插件",
    "沙箱",
    "逃逸",
    "资源",
    "多轮",
    "假装",
    "冒充",
    "审计",
    "合规",
    "工号",
)


def _keywords(text: str) -> set[str]:
    lowered = text.casefold()
    return {word for word in _LEXICON if word.casefold() in lowered}


def _text(value: Any, *, limit: int = _MAX_TEXT) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None


def _relevance(
    record: dict[str, Any], topic: str, *, extra_keys: tuple[str, ...]
) -> int:
    """How well a library record fits this battle's topic.

    Substring containment on the topic alone is too strict; the fallback is the
    number of shared domain keywords across the record's topic and body.
    """
    record_topic = _text(record.get("topic"), limit=200)
    if not record_topic:
        # 没写主题的记录是兜底候选（通用规则）：能进池子，但排在相关记录后面。
        return 1
    normalized_topic = topic.casefold().strip()
    if not normalized_topic:
        return 0
    normalized_record_topic = record_topic.casefold()
    if (
        normalized_record_topic in normalized_topic
        or normalized_topic in normalized_record_topic
    ):
        return 100
    parts = [record_topic or ""]
    for key in extra_keys:
        value = record.get(key)
        if isinstance(value, str):
            parts.append(value)
    return len(_keywords(" ".join(parts)) & _keywords(topic))


def build_attacker_knowledge(
    records: list[dict[str, Any]] | None,
    *,
    topic: str,
) -> dict[str, Any]:
    """Project synthetic samples into the attacker-visible prompt context."""
    ranked: list[tuple[int, dict[str, str]]] = []
    for record in records or []:
        if not isinstance(record, dict):
            continue
        score = _relevance(record, topic, extra_keys=("content", "source"))
        if score <= 0:
            continue
        item: dict[str, str] = {}
        for key in ("id", "topic", "content"):
            value = _text(record.get(key), limit=200 if key != "content" else _MAX_TEXT)
            if value is not None:
                item[key] = value
        if item.get("content"):
            ranked.append((score, item))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return {
        "role": "attacker",
        "records": [item for _score, item in ranked[:_MAX_RECORDS]],
    }


def build_defender_knowledge(
    records: list[dict[str, Any]] | None,
    *,
    topic: str,
) -> dict[str, Any]:
    """Project defensive rules without exposing attacker samples or hidden truth."""
    ranked: list[tuple[int, dict[str, str]]] = []
    for record in records or []:
        if not isinstance(record, dict):
            continue
        score = _relevance(record, topic, extra_keys=("name", "condition"))
        item: dict[str, str] = {}
        for key in ("id", "name", "condition", "action"):
            value = _text(
                record.get(key), limit=200 if key != "condition" else _MAX_TEXT
            )
            if value is not None:
                item[key] = value
        # score=1 是无主题的通用规则（兜底），score=0 是本主题用不上的规则。
        if item.get("condition") and score > 0:
            ranked.append((score, item))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    # 规则库是防守基线：不按相关度过滤，只把更贴近本主题的排在前面。
    return {
        "role": "defender",
        "records": [item for _score, item in ranked[:_MAX_RECORDS]],
    }


def trusted_attacker_context(value: Any, *, topic: str) -> dict[str, Any] | None:
    """Re-project an untrusted payload context before an attacker model sees it."""
    if not isinstance(value, dict) or value.get("role") != "attacker":
        return None
    records = value.get("records")
    if not isinstance(records, list):
        return None
    context = build_attacker_knowledge(records, topic=topic)
    return context if context["records"] else None


def trusted_defender_context(value: Any, *, topic: str) -> dict[str, Any] | None:
    """Re-project an untrusted payload context before a defender model sees it."""
    if not isinstance(value, dict) or value.get("role") != "defender":
        return None
    records = value.get("records")
    if not isinstance(records, list):
        return None
    context = build_defender_knowledge(records, topic=topic)
    return context if context["records"] else None
