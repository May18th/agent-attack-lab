from __future__ import annotations

import json
from pathlib import Path

from scripts.import_external_cases import import_catalog, import_nvd_catalog
from agent_attack_lab.external_cases import query_external_cases


def _catalog() -> dict[str, object]:
    return {
        "catalogVersion": "test-query-1",
        "dateReleased": "2026-10-11T00:00:00Z",
        "vulnerabilities": [
            {
                "cveID": "CVE-2099-0099",
                "vendorProject": "Example Vendor",
                "product": "Example Gateway",
                "vulnerabilityName": "Example gateway issue",
                "dateAdded": "2026-10-11",
                "shortDescription": "A documented external security issue.",
                "requiredAction": "Apply the vendor fix.",
                "knownRansomwareCampaignUse": "Unknown",
                "cwes": ["CWE-79"],
            }
        ],
    }


def test_query_returns_provenance_without_raw_payload(tmp_path: Path) -> None:
    catalog = _catalog()
    database = tmp_path / "external.sqlite3"
    import_catalog(
        database,
        payload=json.dumps(catalog, sort_keys=True).encode(),
        catalog=catalog,
        source_url="https://example.invalid/catalog.json",
    )

    result = query_external_cases(database, query="CVE-2099", limit=10)

    assert result["available"] is True
    assert result["total"] == 1
    assert result["sourceCount"] == 1
    item = result["items"][0]
    assert item["externalId"] == "CVE-2099-0099"
    assert item["provenanceStatus"] == "verified_primary"
    assert item["recordKind"] == "external_fact"
    assert item["synthetic"] is False
    assert item["cwes"] == ["CWE-79"]
    assert item["source"]["publisher"] == "CISA"
    assert len(item["source"]["contentSha256"]) == 64
    assert "rawJson" not in item


def test_query_supports_vendor_and_product_filters(tmp_path: Path) -> None:
    catalog = _catalog()
    database = tmp_path / "external.sqlite3"
    import_catalog(
        database,
        payload=json.dumps(catalog, sort_keys=True).encode(),
        catalog=catalog,
        source_url="https://example.invalid/catalog.json",
    )

    assert query_external_cases(database, vendor="Example Vendor")["total"] == 1
    assert query_external_cases(database, product="Other Product")["total"] == 0


def test_query_deduplicates_cisa_and_nvd_by_cve_and_prefers_cisa(tmp_path: Path) -> None:
    database = tmp_path / "external.sqlite3"
    cisa = _catalog()
    import_catalog(
        database,
        payload=json.dumps(cisa, sort_keys=True).encode(),
        catalog=cisa,
        source_url="https://example.invalid/cisa.json",
    )
    nvd = {
        "catalogVersion": "NVD snapshot",
        "vulnerabilities": [
            {"cve": {
                "id": "CVE-2099-0099",
                "published": "2026-10-12T00:00:00.000Z",
                "descriptions": [{"lang": "en", "value": "NVD duplicate record."}],
            }},
            {"cve": {
                "id": "CVE-2099-0100",
                "published": "2026-10-12T00:00:00.000Z",
                "descriptions": [{"lang": "en", "value": "NVD-only record."}],
            }},
        ],
    }
    payload = json.dumps(nvd, sort_keys=True).encode()
    import_nvd_catalog(database, payload=payload, catalog=nvd)

    all_cases = query_external_cases(database, limit=10)
    duplicate = query_external_cases(database, query="CVE-2099-0099")

    assert all_cases["total"] == 2
    assert all_cases["sourceCount"] == 2
    assert duplicate["total"] == 1
    assert duplicate["items"][0]["source"]["publisher"] == "CISA"


def test_query_matches_all_sources_before_returning_preferred_record(tmp_path: Path) -> None:
    database = tmp_path / "external.sqlite3"
    cisa = _catalog()
    import_catalog(
        database,
        payload=json.dumps(cisa, sort_keys=True).encode(),
        catalog=cisa,
        source_url="https://example.invalid/cisa.json",
    )
    nvd = {
        "catalogVersion": "NVD snapshot",
        "vulnerabilities": [{"cve": {
            "id": "CVE-2099-0099",
            "published": "2026-10-12T00:00:00.000Z",
            "descriptions": [{"lang": "en", "value": "NVD-only searchable phrase."}],
        }}],
    }
    payload = json.dumps(nvd, sort_keys=True).encode()
    import_nvd_catalog(database, payload=payload, catalog=nvd)

    result = query_external_cases(database, query="NVD-only searchable phrase")

    assert result["total"] == 1
    assert result["items"][0]["externalId"] == "CVE-2099-0099"
    assert result["items"][0]["source"]["publisher"] == "CISA"


def test_missing_database_is_reported_without_creating_file(tmp_path: Path) -> None:
    database = tmp_path / "missing.sqlite3"

    result = query_external_cases(database)

    assert result == {
        "available": False,
        "reason": "database_missing",
        "items": [],
        "total": 0,
        "sourceCount": 0,
    }
    assert not database.exists()
