"""Read-only access to the provenance-first external case library."""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from pathlib import Path
from typing import Any


def _connect_read_only(database: Path) -> sqlite3.Connection:
    """Open the external database without allowing the API to create or mutate it."""
    uri = f"file:{database.resolve().as_posix()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def describe_external_cases(database: Path) -> dict[str, Any]:
    """Lightweight availability probe for ``/health``.

    This library ships as a standalone file that ``.gitignore`` keeps out of the
    repository, so it can silently be absent on a deployment host: queries then
    return ``available: False`` with an empty list while the service still looks
    healthy. This probe makes that state observable. It never raises -- health
    must report degradation instead of failing the whole endpoint.
    """
    if not database.is_file():
        return {
            "status": "missing",
            "path": str(database),
            "records": 0,
            "sources": 0,
            "schemaVersion": None,
            "modifiedAt": None,
        }

    try:
        with _connect_read_only(database) as connection:
            records = connection.execute(
                "SELECT COUNT(DISTINCT external_id) FROM external_cases"
            ).fetchone()[0]
            sources = connection.execute(
                "SELECT COUNT(*) FROM external_sources"
            ).fetchone()[0]
            latest = connection.execute(
                "SELECT schema_version FROM external_sources "
                "ORDER BY retrieved_at DESC LIMIT 1"
            ).fetchone()
    except sqlite3.DatabaseError as exc:
        return {
            "status": "error",
            "path": str(database),
            "records": 0,
            "sources": 0,
            "schemaVersion": None,
            "modifiedAt": None,
            "reason": type(exc).__name__,
        }

    modified_at = dt.datetime.fromtimestamp(
        database.stat().st_mtime, tz=dt.UTC
    ).isoformat(timespec="seconds")
    return {
        "status": "ok" if records else "empty",
        "path": str(database),
        "records": int(records),
        "sources": int(sources),
        "schemaVersion": latest[0] if latest else None,
        "modifiedAt": modified_at,
    }


def _case_from_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        cwes = json.loads(row["cwes_json"])
    except TypeError, json.JSONDecodeError:
        cwes = []
    if not isinstance(cwes, list):
        cwes = []
    return {
        "id": row["id"],
        "externalId": row["external_id"],
        "vendorProject": row["vendor_project"],
        "product": row["product"],
        "title": row["title"],
        "dateAdded": row["date_added"],
        "dueDate": row["due_date"],
        "description": row["description"],
        "requiredAction": row["required_action"],
        "knownRansomwareUse": row["known_ransomware_use"],
        "forensicTriage": row["forensic_triage"],
        "notes": row["notes"],
        "cwes": cwes,
        "sourceUrl": row["source_url"],
        "provenanceStatus": row["provenance_status"],
        "synthetic": bool(row["synthetic"]),
        "recordKind": row["record_kind"],
        "source": {
            "publisher": row["publisher"],
            "sourceType": row["source_type"],
            "catalogVersion": row["catalog_version"],
            "releasedAt": row["released_at"],
            "retrievedAt": row["retrieved_at"],
            "contentSha256": row["content_sha256"],
        },
    }


def query_external_cases(
    database: Path,
    *,
    query: str | None = None,
    vendor: str | None = None,
    product: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Return externally sourced records and provenance metadata without mutation."""
    if not database.is_file():
        return {
            "available": False,
            "reason": "database_missing",
            "items": [],
            "total": 0,
            "sourceCount": 0,
        }

    clauses: list[str] = []
    parameters: list[Any] = []
    if query:
        clauses.append(
            "(c.external_id LIKE ? OR c.title LIKE ? OR c.description LIKE "
            "? OR c.vendor_project LIKE ? OR c.product LIKE ?)"
        )
        pattern = f"%{query}%"
        parameters.extend([pattern] * 5)
    if vendor:
        clauses.append("c.vendor_project LIKE ?")
        parameters.append(f"%{vendor}%")
    if product:
        clauses.append("c.product LIKE ?")
        parameters.append(f"%{product}%")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    preferred_cases = f"""
        WITH ranked AS (
            SELECT c.id, c.external_id, c.vendor_project, c.product, c.title,
                   c.date_added, c.due_date, c.description, c.required_action,
                   c.known_ransomware_use, c.forensic_triage, c.cwes_json, c.notes, c.source_url,
                   c.provenance_status, c.synthetic, c.record_kind,
                   s.publisher, s.source_type, s.catalog_version, s.released_at,
                   s.retrieved_at, s.content_sha256,
                   ROW_NUMBER() OVER (
                       PARTITION BY c.external_id
                       ORDER BY CASE s.publisher WHEN 'CISA' THEN 0 WHEN 'NVD' THEN 1 ELSE 2 END,
                                s.retrieved_at DESC, c.id DESC
                   ) AS source_rank
            FROM external_cases AS c
            JOIN external_sources AS s ON s.id = c.source_id
        ), matched AS (
            SELECT DISTINCT c.external_id
            FROM external_cases AS c
            {where}
        ), preferred AS (
            SELECT * FROM ranked WHERE source_rank = 1
        )
    """
    try:
        with _connect_read_only(database) as connection:
            total_row = connection.execute(
                f"{preferred_cases} SELECT COUNT(*) FROM preferred AS c "
                "JOIN matched AS m ON m.external_id = c.external_id",
                parameters,
            ).fetchone()
            rows = connection.execute(
                f"{preferred_cases} SELECT c.id, c.external_id, c.vendor_project, c.product, c.title, "
                "c.date_added, c.due_date, c.description, c.required_action, "
                "c.known_ransomware_use, c.forensic_triage, c.cwes_json, c.notes, c.source_url, "
                "c.provenance_status, c.synthetic, c.record_kind, c.publisher, c.source_type, "
                "c.catalog_version, c.released_at, c.retrieved_at, c.content_sha256 "
                "FROM preferred AS c JOIN matched AS m ON m.external_id = c.external_id "
                "ORDER BY c.date_added DESC, c.external_id LIMIT ? OFFSET ?",
                [*parameters, limit, offset],
            ).fetchall()
            source_count = connection.execute(
                "SELECT COUNT(DISTINCT publisher) FROM external_sources"
            ).fetchone()[0]
    except sqlite3.DatabaseError:
        return {
            "available": False,
            "reason": "database_unavailable",
            "items": [],
            "total": 0,
            "sourceCount": 0,
        }

    return {
        "available": True,
        "items": [_case_from_row(row) for row in rows],
        "total": int(total_row[0]),
        "sourceCount": int(source_count),
    }
