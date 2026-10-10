"""Import verified external security advisories into a provenance-first SQLite DB.

The imported records are external references, not generated attack samples and
must not be presented as observed incidents in the application UI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


CISA_KEV_URL = (
    "https://www.cisa.gov/sites/default/files/feeds/"
    "known_exploited_vulnerabilities.json"
)
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
    parser.add_argument("--url", default=CISA_KEV_URL)
    parser.add_argument("--validate", action="store_true", help="validate existing records without fetching data")
    args = parser.parse_args()
    if args.validate:
        print(json.dumps(validate_database(args.database), ensure_ascii=False))
        return
    payload, catalog = fetch_catalog(args.url)
    print(json.dumps(import_catalog(args.database, payload=payload, catalog=catalog, source_url=args.url), ensure_ascii=False))


if __name__ == "__main__":
    main()
