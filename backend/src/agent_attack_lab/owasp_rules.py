"""Local text heuristics mapped to OWASP Top 10 for LLM Applications (2025)."""

from __future__ import annotations

import re
import unicodedata


OWASP_LLM_CATEGORIES = (
    ("LLM01", "提示注入"),
    ("LLM02", "敏感信息泄露"),
    ("LLM03", "供应链"),
    ("LLM04", "数据与模型投毒"),
    ("LLM05", "输出处理不当"),
    ("LLM06", "过度代理"),
    ("LLM07", "系统提示词泄露"),
    ("LLM08", "向量与嵌入弱点"),
    ("LLM09", "错误信息"),
    ("LLM10", "无限消耗"),
)

_CATEGORY_PATTERNS: dict[str, tuple[str, ...]] = {
    "LLM01": (
        r"ignore.{0,32}(previous|prior|system)\s+(instructions|rules)",
        r"忽略.{0,20}(之前|系统|安全).{0,8}(指令|规则)",
        r"(retrieved|检索|知识库|document|文档).{0,60}(instruction|指令).{0,60}(assistant|助手|system|系统)",
    ),
    "LLM02": (
        r"(customer|client|user)\s+(email|address|record|data).{0,50}(send|外传|发送|attacker)",
        r"(邮箱|客户资料|个人信息|敏感信息).{0,40}(发送|外传|泄露|导出|attacker)",
        r"(send|forward|post).{0,40}(email|private|customer).{0,40}(attacker|external|外部)",
    ),
    "LLM03": (
        r"(untrusted|unverified|未验证|不可信).{0,30}(plugin|tool|model|package|插件|工具|模型|依赖)",
        r"(tampered|compromised|被篡改|遭投毒).{0,30}(model|plugin|package|模型|插件|依赖)",
    ),
    "LLM04": (
        r"(poison|poisoned|投毒|后门).{0,40}(training|dataset|embedding|vector|训练|数据集|知识库|向量)",
        r"(training data|训练数据|knowledge base|知识库).{0,50}(hidden trigger|隐藏触发|backdoor|后门)",
    ),
    "LLM05": (
        r"(model|assistant|模型|助手).{0,40}(output|response|输出|结果).{0,60}(execute|eval\(|innerhtml|shell|sql|执行|拼接)",
        r"(without|缺少|未做).{0,16}(validation|sanitization|校验|过滤).{0,40}(execute|render|query|执行|渲染|查询)",
    ),
    "LLM06": (
        r"(agent|assistant|智能体|助手).{0,40}(admin|delete|transfer|send|管理员|删除|转账|发送).{0,40}(without|no approval|未授权|无需确认|无审批)",
        r"(call|invoke|调用).{0,30}(admin tool|privileged tool|管理员工具|高权限工具)",
    ),
    "LLM07": (
        r"(reveal|print|show|输出|泄露|显示).{0,30}(system prompt|hidden prompt|系统提示词|隐藏提示词)",
        r"(system prompt|系统提示词).{0,40}(extract|leak|泄露|套取|输出)",
    ),
    "LLM08": (
        r"(vector|embedding|向量|嵌入|rag|检索库).{0,60}(tenant|organization|permission|access|租户|权限|隔离)",
        r"(retrieve|检索).{0,40}(another tenant|other customer|其他租户|其他客户)",
    ),
    "LLM09": (
        r"(fabricate|invent|伪造|编造).{0,30}(citation|source|reference|引用|来源|依据)",
        r"(unsupported|无依据|未核实).{0,40}(fact|claim|事实|结论).{0,30}(present|state|陈述|输出)",
    ),
    "LLM10": (
        r"(recursive|infinite|unbounded|无限|递归).{0,35}(token|loop|request|消耗|循环|请求)",
        r"(repeat|重复).{0,30}(forever|indefinitely|直到耗尽|无限).{0,30}(token|tokens|令牌)",
        r"(token|tokens|令牌).{0,24}(budget|预算).{0,16}(exhaust|耗尽)",
    ),
}


def classify_owasp_llm_text(text: str) -> list[dict[str, str]]:
    """Return categories with matching text evidence; this is not a vulnerability verdict."""
    normalized = unicodedata.normalize("NFKC", text).casefold()
    findings: list[dict[str, str]] = []
    for category, title in OWASP_LLM_CATEGORIES:
        for pattern in _CATEGORY_PATTERNS[category]:
            match = re.search(pattern, normalized, re.IGNORECASE)
            if match:
                findings.append({
                    "id": category,
                    "title": title,
                    "evidence": match.group(0),
                })
                break
    return findings
