from __future__ import annotations

import json
from pathlib import Path
from typing import Self
from unittest.mock import patch

import scripts.import_external_cases as external_import
from scripts.check_sensitive_files import violations
from scripts.compare_external_cases import compare_catalog
from scripts.import_external_cases import (
    fetch_nvd_catalog,
    import_catalog,
    import_nvd_catalog,
)


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


def _nvd_record(cve_id: str, *, status: str = "Analyzed") -> dict[str, object]:
    return {
        "cve": {
            "id": cve_id,
            "vulnStatus": status,
            "published": "2026-10-10T00:00:00.000Z",
            "descriptions": [{"lang": "en", "value": "A public NVD vulnerability record."}],
            "weaknesses": [{"description": [{"lang": "en", "value": "CWE-79"}]}],
            "configurations": [{"nodes": [{"cpeMatch": [{
                "vulnerable": True,
                "criteria": "cpe:2.3:a:example:gateway:1.0:*:*:*:*:*:*:*",
            }]}]}],
        }
    }


def test_nvd_import_is_idempotent_and_excludes_rejected_records(tmp_path: Path) -> None:
    import sqlite3

    database = tmp_path / "external.sqlite3"
    catalog = {
        "catalogVersion": "2.0:window@snapshot",
        "timestamp": "snapshot",
        "vulnerabilities": [
            _nvd_record("CVE-2099-0300"),
            _nvd_record("CVE-2099-0301", status="Rejected"),
        ],
    }
    payload = json.dumps(catalog, sort_keys=True).encode()

    first = import_nvd_catalog(database, payload=payload, catalog=catalog)
    second = import_nvd_catalog(database, payload=payload, catalog=catalog)

    assert first["imported"] == 1
    assert first["skippedRejected"] == 1
    assert second["totalCases"] == 1
    assert second["storedSourceRecords"] == 1
    with sqlite3.connect(database) as connection:
        row = connection.execute(
            "SELECT external_id, vendor_project, product, record_kind, synthetic, source_url "
            "FROM external_cases"
        ).fetchone()
    assert row == (
        "CVE-2099-0300", "example", "gateway", "external_fact", 0,
        "https://nvd.nist.gov/vuln/detail/CVE-2099-0300",
    )


def test_fetch_nvd_catalog_paginates_and_normalizes_dates() -> None:
    responses = [
        {
            "timestamp": "snapshot",
            "totalResults": 2,
            "vulnerabilities": [_nvd_record("CVE-2099-0310")],
        },
        {
            "timestamp": "snapshot",
            "totalResults": 2,
            "vulnerabilities": [_nvd_record("CVE-2099-0311")],
        },
    ]
    urls: list[str] = []

    class Response:
        def __init__(self, body: dict[str, object]):
            self.body = json.dumps(body).encode()

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def read(self) -> bytes:
            return self.body

    def open_request(request: object, timeout: int) -> Response:
        urls.append(request.full_url)
        return Response(responses.pop(0))

    with patch.object(external_import.urllib.request, "urlopen", side_effect=open_request), patch.object(
        external_import.time, "sleep"
    ) as sleep:
        payload, catalog = fetch_nvd_catalog(
            "2026-10-01T00:00:00+08:00", "2026-10-02T00:00:00+08:00"
        )

    assert len(payload.splitlines()) == 2
    assert len(urls) == 2
    assert "pubStartDate=2026-09-30T16%3A00%3A00.000Z" in urls[0]
    assert catalog["publicationWindow"] == {
        "start": "2026-09-30T16:00:00.000Z",
        "end": "2026-10-01T16:00:00.000Z",
    }
    sleep.assert_called_once_with(6)
