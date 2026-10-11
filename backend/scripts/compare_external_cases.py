"""Compare a fetched external catalog with the latest imported local snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

try:
    from scripts.import_external_cases import CISA_KEV_URL, fetch_catalog
except ModuleNotFoundError:  # Direct execution from backend/scripts.
    from import_external_cases import CISA_KEV_URL, fetch_catalog


def compare_catalog(
    database: Path,
    *,
    payload: bytes,
    catalog: dict[str, Any],
    source_url: str = CISA_KEV_URL,
) -> dict[str, Any]:
    """Compare CVE records without writing to the local database."""
    current = {
        str(item.get("cveID")): item
        for item in catalog.get("vulnerabilities", [])
        if isinstance(item, dict) and str(item.get("cveID") or "").strip()
    }
    previous: dict[str, Any] = {}
    previous_version: str | None = None
    if database.is_file():
        uri = f"file:{database.resolve().as_posix()}?mode=ro"
        try:
            with sqlite3.connect(uri, uri=True) as connection:
                row = connection.execute(
                    """
                    SELECT id, catalog_version FROM external_sources
                    WHERE source_url = ? ORDER BY id DESC LIMIT 1
                    """,
                    (source_url,),
                ).fetchone()
                if row:
                    previous_version = str(row[1])
                    rows = connection.execute(
                        "SELECT external_id, raw_json FROM external_cases WHERE source_id = ?",
                        (row[0],),
                    ).fetchall()
                    for external_id, raw_json in rows:
                        try:
                            previous[str(external_id)] = json.loads(raw_json)
                        except (TypeError, json.JSONDecodeError):
                            previous[str(external_id)] = {"rawJson": raw_json}
        except sqlite3.DatabaseError:
            return {
                "available": False,
                "reason": "database_unavailable",
                "sourceUrl": source_url,
                "currentCatalogVersion": str(catalog.get("catalogVersion") or "unknown"),
            }

    added = sorted(set(current) - set(previous))
    removed = sorted(set(previous) - set(current))
    changed = sorted(
        external_id
        for external_id in set(current) & set(previous)
        if json.dumps(current[external_id], ensure_ascii=False, sort_keys=True)
        != json.dumps(previous[external_id], ensure_ascii=False, sort_keys=True)
    )
    return {
        "available": True,
        "source": "CISA",
        "sourceUrl": source_url,
        "previousCatalogVersion": previous_version,
        "currentCatalogVersion": str(catalog.get("catalogVersion") or "unknown"),
        "currentContentSha256": hashlib.sha256(payload).hexdigest(),
        "previousRecordCount": len(previous),
        "currentRecordCount": len(current),
        "added": added,
        "removed": removed,
        "changed": changed,
        "unchangedCount": len(set(current) & set(previous)) - len(changed),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path(".data/external_security_cases.sqlite3"))
    parser.add_argument("--url", default=CISA_KEV_URL)
    args = parser.parse_args()
    payload, catalog = fetch_catalog(args.url)
    print(json.dumps(compare_catalog(args.database, payload=payload, catalog=catalog, source_url=args.url), ensure_ascii=False))


if __name__ == "__main__":
    main()
