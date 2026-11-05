"""``describe_external_cases`` is the /health probe for the external case library.

The library is a standalone SQLite file excluded from version control, so a
missing file on a deployment host used to be invisible: queries returned
``available: False`` with an empty list and the service still reported healthy.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from agent_attack_lab import config
from agent_attack_lab.external_cases import describe_external_cases
from agent_attack_lab.service import app
from scripts.import_external_cases import import_catalog

client = TestClient(app)


def _catalog() -> dict[str, object]:
    return {
        "catalogVersion": "test-health-1",
        "dateReleased": "2026-10-11T00:00:00Z",
        "vulnerabilities": [
            {
                "cveID": "CVE-2099-0100",
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


def _imported_database(tmp_path: Path) -> Path:
    catalog = _catalog()
    database = tmp_path / "external.sqlite3"
    import_catalog(
        database,
        payload=json.dumps(catalog, sort_keys=True).encode(),
        catalog=catalog,
        source_url="https://example.invalid/catalog.json",
    )
    return database


def test_describe_reports_loaded_library(tmp_path: Path) -> None:
    report = describe_external_cases(_imported_database(tmp_path))

    assert report["status"] == "ok"
    assert report["records"] == 1
    assert report["sources"] == 1
    assert report["schemaVersion"] == "1"
    assert report["modifiedAt"]


def test_describe_reports_missing_file(tmp_path: Path) -> None:
    report = describe_external_cases(tmp_path / "absent.sqlite3")

    assert report["status"] == "missing"
    assert report["records"] == 0
    assert report["modifiedAt"] is None


def test_describe_reports_corrupt_file(tmp_path: Path) -> None:
    broken = tmp_path / "broken.sqlite3"
    broken.write_bytes(b"this is not a sqlite database" * 8)

    report = describe_external_cases(broken)

    assert report["status"] == "error"
    assert report["records"] == 0


def test_health_surfaces_missing_library_without_marking_service_degraded(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(config, "external_cases_database", tmp_path / "absent.sqlite3")

    body = client.get("/health").json()

    assert body["status"] == "ok"
    assert body["storage"] == "ok"
    assert body["externalCases"]["status"] == "missing"
    assert "external_cases_missing" in body["warnings"]


def test_health_reports_loaded_library_without_warnings(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(config, "external_cases_database", _imported_database(tmp_path))

    body = client.get("/health").json()

    assert body["status"] == "ok"
    assert body["externalCases"]["status"] == "ok"
    assert body["externalCases"]["records"] == 1
    assert body["warnings"] == []
