"""Import verified external security advisories into a provenance-first SQLite DB.

The imported records are external references, not generated attack samples and
must not be presented as observed incidents in the application UI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode


CISA_KEV_URL = (
    "https://www.cisa.gov/sites/default/files/feeds/"
    "known_exploited_vulnerabilities.json"
)
NVD_CVE_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
SCHEMA_VERSION = "1"
RECORD_KINDS = (
    "external_fact",
    "normalized_case",
    "synthetic_scenario",
    "observed_event",
)


def fetch_catalog(url: str = CISA_KEV_URL) -> tuple[bytes, dict[str, Any]]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "agent-attack-lab-case-import/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
    catalog = json.loads(payload)
    if not isinstance(catalog, dict) or not isinstance(catalog.get("vulnerabilities"), list):
        raise ValueError("external catalog does not contain a vulnerabilities list")
    return payload, catalog


def fetch_nvd_catalog(start_date: str, end_date: str) -> tuple[bytes, dict[str, Any]]:
    """Fetch a bounded NVD publication window, respecting its unauthenticated page rate."""
    start = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
    end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
    if start.tzinfo is None or end.tzinfo is None or start >= end:
        raise ValueError("NVD dates must be timezone-aware and start before end")
    if (end - start).total_seconds() > 120 * 24 * 60 * 60:
        raise ValueError("NVD publication window cannot exceed 120 days")

    def nvd_timestamp(value: datetime) -> str:
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    normalized_start = nvd_timestamp(start)
    normalized_end = nvd_timestamp(end)

    pages: list[bytes] = []
    vulnerabilities: list[dict[str, Any]] = []
    total_results = 0
    timestamp = "unknown"
    start_index = 0
    api_key = os.getenv("NVD_API_KEY")
    while start_index < max(total_results, 1):
        params = urlencode({
            "pubStartDate": normalized_start,
            "pubEndDate": normalized_end,
            "startIndex": start_index,
            "resultsPerPage": 2000,
        })
        headers = {"Accept": "application/json", "User-Agent": "agent-attack-lab-case-import/1.0"}
        if api_key:
            headers["apiKey"] = api_key
        request = urllib.request.Request(f"{NVD_CVE_API_URL}?{params}", headers=headers)
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = response.read()
        page = json.loads(payload)
        records = page.get("vulnerabilities") if isinstance(page, dict) else None
        if not isinstance(records, list):
            raise ValueError("NVD response does not contain a vulnerabilities list")
        pages.append(payload)
        vulnerabilities.extend(records)
        total_results = int(page.get("totalResults") or 0)
        timestamp = str(page.get("timestamp") or timestamp)
        start_index += len(records)
        if not records:
            break
        if start_index < total_results:
            time.sleep(6 if not api_key else 0.7)

    if start_index != total_results:
        raise ValueError(
            f"NVD pagination was incomplete: fetched {start_index} of {total_results} records"
        )

    catalog_version = f"2.0:{normalized_start}..{normalized_end}@{timestamp}"
    aggregate = {
        "format": "NVD_CVE",
        "version": "2.0",
        "catalogVersion": catalog_version,
        "timestamp": timestamp,
        "totalResults": total_results,
        "publicationWindow": {"start": normalized_start, "end": normalized_end},
        "vulnerabilities": vulnerabilities,
    }
    return b"\n".join(pages) or json.dumps(aggregate).encode(), aggregate


def import_nvd_catalog(
    database: Path,
    *,
    payload: bytes,
    catalog: dict[str, Any],
) -> dict[str, Any]:
    """Import NVD CVE facts while retaining each record's source URL and raw evidence."""
    vulnerabilities = catalog.get("vulnerabilities")
    if not isinstance(vulnerabilities, list) or not all(isinstance(item, dict) for item in vulnerabilities):
        raise ValueError("NVD catalog contains an invalid vulnerabilities list")
    retrieved_at = datetime.now(UTC).isoformat()
    content_sha256 = hashlib.sha256(payload).hexdigest()
    version = str(catalog.get("catalogVersion") or catalog.get("timestamp") or "unknown")
    connection = _connect(database)
    try:
        source = connection.execute(
            """
            INSERT INTO external_sources
                (publisher, source_type, source_url, catalog_version, released_at,
                 retrieved_at, content_sha256, record_count, schema_version)
            VALUES ('NVD', 'nvd_cve_api_v2', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source_url, catalog_version, content_sha256) DO UPDATE SET
                retrieved_at = excluded.retrieved_at,
                record_count = excluded.record_count
            RETURNING id
            """,
            (
                NVD_CVE_API_URL,
                version,
                None,
                retrieved_at,
                content_sha256,
                len(vulnerabilities),
                SCHEMA_VERSION,
            ),
        ).fetchone()
        assert source is not None
        source_id = int(source[0])
        imported = 0
        skipped_rejected = 0
        for wrapped in vulnerabilities:
            cve = wrapped.get("cve")
            if not isinstance(cve, dict):
                raise ValueError("NVD record is missing the cve object")
            cve_id = str(cve.get("id") or "").strip()
            if str(cve.get("vulnStatus") or "").casefold() == "rejected":
                skipped_rejected += 1
                continue
            descriptions = cve.get("descriptions") or []
            description = next(
                (str(item.get("value") or "").strip() for item in descriptions
                 if isinstance(item, dict) and item.get("lang") == "en" and item.get("value")),
                "",
            )
            if not cve_id or not description:
                raise ValueError(f"NVD record {cve_id or '<unknown>'} is missing id or English description")

            vendor, product = _nvd_vendor_product(cve)
            cwes = sorted({
                str(value)
                for weakness in cve.get("weaknesses", [])
                if isinstance(weakness, dict)
                for item in weakness.get("description", [])
                if isinstance(item, dict)
                for value in [item.get("value")]
                if isinstance(value, str) and value.startswith("CWE-")
            })
            published = str(cve.get("published") or cve.get("lastModified") or "unknown")
            title = str(cve.get("cisaVulnerabilityName") or f"{cve_id} (NVD CVE record)")
            required_action = str(cve.get("cisaRequiredAction") or "").strip()
            status = str(cve.get("vulnStatus") or "unknown")
            case_url = f"https://nvd.nist.gov/vuln/detail/{cve_id}"
            connection.execute(
                """
                INSERT INTO external_cases
                    (source_id, external_id, vendor_project, product, title, date_added,
                     due_date, description, required_action, known_ransomware_use,
                     forensic_triage, cwes_json, notes, source_url, provenance_status,
                     synthetic, record_kind, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?, ?,
                        'verified_primary', 0, 'external_fact', ?)
                ON CONFLICT (source_id, external_id) DO UPDATE SET
                    vendor_project = excluded.vendor_project,
                    product = excluded.product,
                    title = excluded.title,
                    date_added = excluded.date_added,
                    description = excluded.description,
                    required_action = excluded.required_action,
                    cwes_json = excluded.cwes_json,
                    notes = excluded.notes,
                    source_url = excluded.source_url,
                    raw_json = excluded.raw_json
                """,
                (
                    source_id,
                    cve_id,
                    vendor,
                    product,
                    title,
                    published,
                    description,
                    required_action,
                    json.dumps(cwes),
                    f"NVD vulnerability status: {status}; remediation omitted unless present in NVD record.",
                    case_url,
                    json.dumps(cve, ensure_ascii=False, sort_keys=True),
                ),
            )
            imported += 1
        connection.commit()
        total = connection.execute("SELECT COUNT(DISTINCT external_id) FROM external_cases").fetchone()[0]
        stored = connection.execute("SELECT COUNT(*) FROM external_cases").fetchone()[0]
        return {
            "source": "NVD",
            "catalogVersion": version,
            "imported": imported,
            "skippedRejected": skipped_rejected,
            "totalCases": total,
            "storedSourceRecords": stored,
        }
    finally:
        connection.close()


def _nvd_vendor_product(cve: dict[str, Any]) -> tuple[str, str]:
    affected = cve.get("affectedData") or cve.get("affected") or []
    if isinstance(affected, list):
        for item in affected:
            if isinstance(item, dict) and item.get("vendor") and item.get("product"):
                return str(item["vendor"]), str(item["product"])
    for configuration in cve.get("configurations", []):
        stack = [configuration]
        while stack:
            item = stack.pop()
            if isinstance(item, dict):
                for match in item.get("cpeMatch", []):
                    criteria = match.get("criteria", "") if isinstance(match, dict) else ""
                    parts = criteria.split(":")
                    if len(parts) > 4 and parts[0] == "cpe" and parts[1] == "2.3" and match.get("vulnerable"):
                        return parts[3], parts[4]
                stack.extend(value for value in item.values() if isinstance(value, (dict, list)))
            elif isinstance(item, list):
                stack.extend(item)
    return "Not specified by NVD", "Not specified by NVD"


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS external_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            publisher TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_url TEXT NOT NULL,
            catalog_version TEXT NOT NULL,
            released_at TEXT,
            retrieved_at TEXT NOT NULL,
            content_sha256 TEXT NOT NULL,
            record_count INTEGER NOT NULL,
            schema_version TEXT NOT NULL,
            UNIQUE (source_url, catalog_version, content_sha256)
        );
        CREATE TABLE IF NOT EXISTS external_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL REFERENCES external_sources(id),
            external_id TEXT NOT NULL,
            vendor_project TEXT NOT NULL,
            product TEXT NOT NULL,
            title TEXT NOT NULL,
            date_added TEXT NOT NULL,
            due_date TEXT,
            description TEXT NOT NULL,
            required_action TEXT NOT NULL,
            known_ransomware_use TEXT,
            forensic_triage TEXT,
            cwes_json TEXT NOT NULL,
            notes TEXT,
            source_url TEXT NOT NULL,
            provenance_status TEXT NOT NULL DEFAULT 'verified_primary',
            synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
            record_kind TEXT NOT NULL DEFAULT 'external_fact'
                CHECK (record_kind IN ('external_fact', 'normalized_case',
                                       'synthetic_scenario', 'observed_event')),
            raw_json TEXT NOT NULL,
            UNIQUE (source_id, external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_external_cases_cve ON external_cases (external_id);
        CREATE INDEX IF NOT EXISTS idx_external_cases_vendor ON external_cases (vendor_project, product);
        CREATE INDEX IF NOT EXISTS idx_external_cases_date ON external_cases (date_added DESC);
        """
    )
    columns = {row[1] for row in connection.execute("PRAGMA table_info(external_cases)")}
    if "record_kind" not in columns:
        # Existing local databases predate the provenance taxonomy. The default
        # is conservative: imported primary-source rows are external facts.
        connection.execute(
            "ALTER TABLE external_cases ADD COLUMN record_kind TEXT NOT NULL DEFAULT 'external_fact'"
        )
        connection.commit()
    return connection


def validate_database(database: Path) -> dict[str, Any]:
    """Validate provenance fields without rewriting any records."""

    connection = _connect(database)
    issues: list[dict[str, Any]] = []
    try:
        rows = connection.execute(
            """
            SELECT c.id, c.external_id, c.synthetic, c.record_kind,
                   c.provenance_status, c.raw_json, c.source_url,
                   s.publisher, s.source_type, s.catalog_version,
                   s.content_sha256
            FROM external_cases AS c
            JOIN external_sources AS s ON s.id = c.source_id
            ORDER BY c.id
            """
        ).fetchall()
        for row in rows:
            record = dict(row)
            kind = record["record_kind"]
            if kind not in RECORD_KINDS:
                issues.append({"id": record["id"], "issue": "unknown_record_kind", "value": kind})
            if kind == "synthetic_scenario" and record["synthetic"] != 1:
                issues.append({"id": record["id"], "issue": "synthetic_kind_without_flag"})
            if kind in {"external_fact", "normalized_case", "observed_event"} and record["synthetic"] != 0:
                issues.append({"id": record["id"], "issue": "non_synthetic_kind_with_synthetic_flag"})
            if not record["source_url"] or not record["publisher"]:
                issues.append({"id": record["id"], "issue": "missing_source_metadata"})
            if len(record["content_sha256"] or "") != 64:
                issues.append({"id": record["id"], "issue": "invalid_source_hash"})
            try:
                json.loads(record["raw_json"])
            except (TypeError, json.JSONDecodeError):
                issues.append({"id": record["id"], "issue": "invalid_raw_json"})
        return {
            "database": str(database),
            "records": len(rows),
            "valid": not issues,
            "issues": issues,
        }
    finally:
        connection.close()


def import_catalog(
    database: Path,
    *,
    payload: bytes,
    catalog: dict[str, Any],
    source_url: str = CISA_KEV_URL,
) -> dict[str, Any]:
    vulnerabilities = catalog["vulnerabilities"]
    if not all(isinstance(item, dict) for item in vulnerabilities):
        raise ValueError("catalog contains a non-object vulnerability record")
    retrieved_at = datetime.now(UTC).isoformat()
    content_sha256 = hashlib.sha256(payload).hexdigest()
    version = str(catalog.get("catalogVersion") or "unknown")
    released_at = catalog.get("dateReleased")
    connection = _connect(database)
    try:
        source = connection.execute(
            """
            INSERT INTO external_sources
                (publisher, source_type, source_url, catalog_version, released_at,
                 retrieved_at, content_sha256, record_count, schema_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source_url, catalog_version, content_sha256) DO UPDATE SET
                retrieved_at = excluded.retrieved_at,
                record_count = excluded.record_count
            RETURNING id
            """,
            (
                "CISA",
                "known_exploited_vulnerabilities",
                source_url,
                version,
                released_at,
                retrieved_at,
                content_sha256,
                len(vulnerabilities),
                SCHEMA_VERSION,
            ),
        ).fetchone()
        assert source is not None
        source_id = int(source[0])
        for item in vulnerabilities:
            cve_id = str(item.get("cveID") or "").strip()
            required = ("vendorProject", "product", "vulnerabilityName", "dateAdded", "shortDescription", "requiredAction")
            if not cve_id or any(not str(item.get(field) or "").strip() for field in required):
                raise ValueError(f"catalog record {cve_id or '<unknown>'} is missing required fields")
            connection.execute(
                """
                INSERT INTO external_cases
                    (source_id, external_id, vendor_project, product, title, date_added,
                     due_date, description, required_action, known_ransomware_use,
                     forensic_triage, cwes_json, notes, source_url, provenance_status,
                     synthetic, record_kind, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified_primary', 0,
                        'external_fact', ?)
                ON CONFLICT (source_id, external_id) DO UPDATE SET
                    vendor_project = excluded.vendor_project,
                    product = excluded.product,
                    title = excluded.title,
                    date_added = excluded.date_added,
                    due_date = excluded.due_date,
                    description = excluded.description,
                    required_action = excluded.required_action,
                    known_ransomware_use = excluded.known_ransomware_use,
                    forensic_triage = excluded.forensic_triage,
                    cwes_json = excluded.cwes_json,
                    notes = excluded.notes,
                    source_url = excluded.source_url,
                    provenance_status = excluded.provenance_status,
                    synthetic = excluded.synthetic,
                    record_kind = excluded.record_kind,
                    raw_json = excluded.raw_json
                """,
                (
                    source_id,
                    cve_id,
                    str(item["vendorProject"]).strip(),
                    str(item["product"]).strip(),
                    str(item["vulnerabilityName"]).strip(),
                    str(item["dateAdded"]).strip(),
                    str(item.get("dueDate") or "").strip() or None,
                    str(item["shortDescription"]).strip(),
                    str(item["requiredAction"]).strip(),
                    str(item.get("knownRansomwareCampaignUse") or "").strip() or None,
                    str(item.get("forensicTriage") or "").strip() or None,
                    json.dumps(item.get("cwes") or [], ensure_ascii=False, sort_keys=True),
                    str(item.get("notes") or "").strip() or None,
                    source_url,
                    json.dumps(item, ensure_ascii=False, sort_keys=True),
                ),
            )
        connection.commit()
        count = connection.execute("SELECT COUNT(*) FROM external_cases").fetchone()[0]
        return {"source": "CISA", "catalogVersion": version, "imported": len(vulnerabilities), "totalCases": count}
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path(".data/external_security_cases.sqlite3"))
    parser.add_argument("--source", choices=("cisa-kev", "nvd"), default="cisa-kev")
    parser.add_argument("--url", default=CISA_KEV_URL)
    parser.add_argument("--start-date", help="NVD publication window start, ISO-8601 with timezone")
    parser.add_argument("--end-date", help="NVD publication window end, ISO-8601 with timezone")
    parser.add_argument("--validate", action="store_true", help="validate existing records without fetching data")
    args = parser.parse_args()
    if args.validate:
        print(json.dumps(validate_database(args.database), ensure_ascii=False))
        return
    if args.source == "nvd":
        if not args.start_date or not args.end_date:
            parser.error("--source nvd requires --start-date and --end-date")
        payload, catalog = fetch_nvd_catalog(args.start_date, args.end_date)
        result = import_nvd_catalog(args.database, payload=payload, catalog=catalog)
    else:
        payload, catalog = fetch_catalog(args.url)
        result = import_catalog(args.database, payload=payload, catalog=catalog, source_url=args.url)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
