from __future__ import annotations

import json
from pathlib import Path

from scripts.import_external_cases import import_catalog, validate_database


def test_import_preserves_primary_provenance_and_is_idempotent(tmp_path: Path) -> None:
    catalog = {
        "catalogVersion": "test-1",
        "dateReleased": "2026-10-11T00:00:00Z",
        "vulnerabilities": [
            {
                "cveID": "CVE-2099-0001",
                "vendorProject": "Example",
                "product": "Example Product",
                "vulnerabilityName": "Example vulnerability",
                "dateAdded": "2026-10-11",
                "shortDescription": "A documented example vulnerability.",
                "requiredAction": "Apply the vendor fix.",
                "knownRansomwareCampaignUse": "Unknown",
                "cwes": ["CWE-89"],
                "notes": "https://example.invalid/advisory",
            }
        ],
    }
    database = tmp_path / "external.sqlite3"
    payload = json.dumps(catalog, sort_keys=True).encode()

    first = import_catalog(database, payload=payload, catalog=catalog, source_url="https://example.invalid/feed.json")
    second = import_catalog(database, payload=payload, catalog=catalog, source_url="https://example.invalid/feed.json")

    assert first["imported"] == 1
    assert second["totalCases"] == 1
    import sqlite3

    with sqlite3.connect(database) as connection:
        row = connection.execute(
            "SELECT external_id, provenance_status, synthetic, record_kind, cwes_json, raw_json FROM external_cases"
        ).fetchone()
    assert row[0] == "CVE-2099-0001"
    assert row[1] == "verified_primary"
    assert row[2] == 0
    assert row[3] == "external_fact"
    assert json.loads(row[4]) == ["CWE-89"]
    assert json.loads(row[5])["cveID"] == "CVE-2099-0001"
    report = validate_database(database)
    assert report["valid"] is True
    assert report["records"] == 1


def test_validation_rejects_provenance_mismatch(tmp_path: Path) -> None:
    catalog = {
        "catalogVersion": "test-2",
        "dateReleased": "2026-10-11T00:00:00Z",
        "vulnerabilities": [
            {
                "cveID": "CVE-2099-0002",
                "vendorProject": "Example",
                "product": "Example Product",
                "vulnerabilityName": "Another vulnerability",
                "dateAdded": "2026-10-11",
                "shortDescription": "A documented example vulnerability.",
                "requiredAction": "Apply the vendor fix.",
            }
        ],
    }
    database = tmp_path / "external.sqlite3"
    payload = json.dumps(catalog, sort_keys=True).encode()
    import_catalog(database, payload=payload, catalog=catalog, source_url="https://example.invalid/feed.json")

    import sqlite3

    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE external_cases SET record_kind = 'synthetic_scenario' WHERE external_id = ?",
            ("CVE-2099-0002",),
        )
        connection.commit()

    report = validate_database(database)
    assert report["valid"] is False
    assert report["issues"] == [{"id": 1, "issue": "synthetic_kind_without_flag"}]
