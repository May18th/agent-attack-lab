from __future__ import annotations

import json
from pathlib import Path

from scripts.check_sensitive_files import violations
from scripts.compare_external_cases import compare_catalog
from scripts.import_external_cases import import_catalog


def _catalog(version: str, title: str = "Initial issue") -> dict[str, object]:
    return {
        "catalogVersion": version,
        "dateReleased": "2026-10-11T00:00:00Z",
        "vulnerabilities": [{
            "cveID": "CVE-2099-0200",
            "vendorProject": "Example",
            "product": "Gateway",
            "vulnerabilityName": title,
            "dateAdded": "2026-10-11",
            "shortDescription": "Documented issue",
            "requiredAction": "Apply the fix",
        }],
    }


def test_compare_catalog_reports_changed_and_added_records(tmp_path: Path) -> None:
    database = tmp_path / "external.sqlite3"
    first = _catalog("v1")
    payload = json.dumps(first, sort_keys=True).encode()
    import_catalog(database, payload=payload, catalog=first, source_url="https://example.invalid/feed")
    second = _catalog("v2", title="Updated issue")
    second["vulnerabilities"].append({
        "cveID": "CVE-2099-0201",
        "vendorProject": "Example",
        "product": "Gateway",
        "vulnerabilityName": "New issue",
        "dateAdded": "2026-10-11",
        "shortDescription": "New documented issue",
        "requiredAction": "Apply the fix",
    })

    report = compare_catalog(
        database,
        payload=json.dumps(second, sort_keys=True).encode(),
        catalog=second,
        source_url="https://example.invalid/feed",
    )

    assert report["previousCatalogVersion"] == "v1"
    assert report["currentCatalogVersion"] == "v2"
    assert report["changed"] == ["CVE-2099-0200"]
    assert report["added"] == ["CVE-2099-0201"]
    assert report["removed"] == []


def test_sensitive_file_guard_allows_examples_and_rejects_material(tmp_path: Path) -> None:
    (tmp_path / ".env.example").write_text("API_KEY=<local-secret>", encoding="utf-8")
    (tmp_path / "safe.py").write_text("print('ok')", encoding="utf-8")
    (tmp_path / "client-key.pem").write_text("placeholder", encoding="utf-8")
    private_marker = "-----BEGIN " + "PRIVATE KEY-----"
    (tmp_path / "private.txt").write_text(private_marker, encoding="utf-8")

    findings = violations([".env.example", "safe.py", "client-key.pem", "private.txt"], tmp_path)

    assert {item["path"] for item in findings} == {"client-key.pem", "private.txt"}
