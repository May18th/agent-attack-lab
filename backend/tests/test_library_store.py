from __future__ import annotations

from agent_attack_lab import library_store

THEMES = [
    "通用安全测试",
    "电商支付接口越权测试",
    "订单查询权限校验",
    "儿童教育陪伴机器人的越狱诱导",
    "智能简历筛选系统的偏见注入攻击",
    "公网接入前的本地链路验证",
]


def test_catalog_exposes_role_boundaries_and_empty_learning_libraries() -> None:
    result = library_store.catalog()
    roles = {item["role"] for item in result["roles"]}
    assert roles == {"common", "attacker", "defender", "arbiter"}
    attacker = next(item for item in result["roles"] if item["role"] == "attacker")
    assert any(item["libraryId"] == "LIB-03" for item in attacker["libraries"])
    assert (
        next(item for item in attacker["libraries"] if item["libraryId"] == "LIB-03")[
            "recordCount"
        ]
        == 60
    )
    assert (
        next(item for item in attacker["libraries"] if item["libraryId"] == "LIB-06")[
            "recordCount"
        ]
        == 0
    )
    assert (
        next(item for item in attacker["libraries"] if item["libraryId"] == "LIB-17A")[
            "recordCount"
        ]
        == 0
    )
    defender = next(item for item in result["roles"] if item["role"] == "defender")
    assert (
        next(item for item in defender["libraries"] if item["libraryId"] == "LIB-17D")[
            "recordCount"
        ]
        == 0
    )


def test_published_records_are_returned_and_learning_libraries_stay_empty() -> None:
    result = library_store.records("attacker", library_ids={"LIB-17A"})
    assert result["records"] == []
    baseline = library_store.records("attacker", library_ids={"LIB-03"})
    assert len(baseline["records"]) == 60
    assert {item["status"] for item in baseline["records"]} == {"approved"}


def test_attacker_filters_samples_and_intent_strategies_by_theme_and_difficulty() -> (
    None
):
    result = library_store.records(
        "attacker", library_ids={"LIB-03"}, topic=THEMES[0], difficulty="low"
    )
    assert len(result["records"]) == 3
    assert all(item["themeId"] == "T01" for item in result["records"])
    assert all(item["difficulty"] == "low" for item in result["records"])
    context = library_store.agent_context("attacker", topic=THEMES[0], difficulty="low")
    assert {item["selectionKind"] for item in context["records"]} == {
        "sample",
        "intent-strategy",
    }
    assert all(item["difficulty"] == "low" for item in context["records"])


def test_agent_context_combines_only_common_and_role_catalogs() -> None:
    result = library_store.agent_context("defender", topic=THEMES[0], difficulty="mid")
    assert result["role"] == "defender"
    assert result["records"]
    assert result["libraryVersion"].startswith("defender-")
    assert all(item["condition"] for item in result["records"])


def test_all_six_themes_have_ten_samples() -> None:
    for theme in THEMES:
        selected = library_store.records(
            "attacker", library_ids={"LIB-03"}, topic=theme
        )
        assert len(selected["records"]) == 10
