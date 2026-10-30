"""MySQL 逻辑备份/恢复工具。

背景：backup.ps1 / restore.ps1 原本只支持 SQLite 文件复制。战局库切到 MySQL 后，
脚本会静默去备份 .data/battles.sqlite3（一个已经不再写入的历史文件），等于没有备份。

本脚本用项目已有依赖（sqlalchemy + pymysql）完成逻辑备份，不依赖 mysqldump，
因此目标机上没有安装 MySQL 客户端也能工作。

用法：
    python scripts/db_backup_mysql.py dump    --url mysql+pymysql://... --output x.sql
    python scripts/db_backup_mysql.py restore --url mysql+pymysql://... --input  x.sql

备份文件是自包含的标准 SQL（UTF-8，无 BOM）：
    - 每条语句独占一行，单行以分号结尾，字符串内的换行被转义 -> 恢复时可按行安全切分
    - DDL 中的换行被压平，避免多行语句破坏按行解析
"""

from __future__ import annotations

import argparse
import datetime as dt
import decimal
import os
import sys
from pathlib import Path

HEADER_PREFIX = "--"


def _resolve_url(raw: str) -> str:
    """连接串优先级：显式参数 > 进程环境变量 > backend/.env。"""
    if raw:
        return raw
    from_env = os.getenv("AGENT_BATTLE_DATABASE_URL", "").strip()
    if from_env:
        return from_env
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("AGENT_BATTLE_DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("缺少连接串：请设置 AGENT_BATTLE_DATABASE_URL 或传 --url。")


def _make_url(raw: str):
    from sqlalchemy.engine import make_url

    url = make_url(raw)
    if url.drivername == "mysql":
        url = url.set(drivername="mysql+pymysql")
    if url.drivername != "mysql+pymysql":
        raise SystemExit(f"不是 MySQL 连接串：{url.drivername}")
    return url


def _connect(raw_url: str, autocommit: bool = True):
    import pymysql

    url = _make_url(raw_url)
    if not url.database:
        raise SystemExit("连接串缺少数据库名。")
    return pymysql.connect(
        host=url.host or "127.0.0.1",
        port=url.port or 3306,
        user=url.username,
        password=url.password or "",
        database=url.database,
        charset="utf8mb4",
        autocommit=autocommit,
        connect_timeout=10,
    )


def _quote(value) -> str:
    """把 Python 值渲染成 MySQL 字面量。输出中不含裸换行。"""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, decimal.Decimal)):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "0x" + bytes(value).hex()
    if isinstance(value, dt.datetime):
        return "'" + value.strftime("%Y-%m-%d %H:%M:%S.%f").rstrip("0").rstrip(".") + "'"
    if isinstance(value, dt.date):
        return "'" + value.isoformat() + "'"
    if isinstance(value, dt.time):
        return "'" + value.isoformat() + "'"
    if isinstance(value, (set, frozenset)):
        text = ",".join(sorted(str(item) for item in value))
    else:
        text = str(value)
    escaped = (
        text.replace("\\", "\\\\")
        .replace("\0", "\\0")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\x1a", "\\Z")
        .replace("'", "\\'")
    )
    return "'" + escaped + "'"


def _flatten(ddl: str) -> str:
    return " ".join(ddl.split())


def dump(raw_url: str, output: Path, database_label: str = "") -> int:
    connection = _connect(raw_url)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT DATABASE()")
            current_database = cursor.fetchone()[0]

            cursor.execute("SHOW TABLES")
            tables = [row[0] for row in cursor.fetchall()]

            now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            lines: list[str] = [
                f"{HEADER_PREFIX} agent_attack_lab MySQL logical backup",
                f"{HEADER_PREFIX} generated: {now}",
                f"{HEADER_PREFIX} database: {database_label or current_database}",
                f"{HEADER_PREFIX} tables: {len(tables)}",
                "SET NAMES utf8mb4;",
                "SET FOREIGN_KEY_CHECKS=0;",
            ]
            total_rows = 0
            for table in tables:
                cursor.execute(f"SHOW CREATE TABLE `{table}`")
                ddl = _flatten(cursor.fetchone()[1])
                lines.append(f"DROP TABLE IF EXISTS `{table}`;")
                lines.append(ddl + ";")

                cursor.execute(f"SELECT * FROM `{table}`")
                columns = [d[0] for d in cursor.description]
                column_sql = ", ".join(f"`{name}`" for name in columns)
                table_rows = cursor.fetchall()
                for row in table_rows:
                    values = ", ".join(_quote(value) for value in row)
                    lines.append(f"INSERT INTO `{table}` ({column_sql}) VALUES ({values});")
                total_rows += len(table_rows)
                print(f"  {table}: {len(table_rows)} rows")
            lines.append("SET FOREIGN_KEY_CHECKS=1;")
    finally:
        connection.close()

    output.parent.mkdir(parents=True, exist_ok=True)
    payload = "\n".join(lines) + "\n"
    output.write_text(payload, encoding="utf-8", newline="\n")
    print(f"tables={len(tables)} rows={total_rows} bytes={len(payload.encode('utf-8'))}")
    return 0


def restore(raw_url: str, source: Path) -> int:
    """保守恢复：不 DROP 表。

    业务账号（如 agent_attack_lab_app）通常只有 SELECT/INSERT/UPDATE/DELETE/CREATE，
    没有 DROP。因此这里不执行备份文件里的 DROP TABLE：
      - 表已存在 -> 保留现有结构，改为 DELETE 清空后回灌
      - 表不存在 -> 执行备份里的 CREATE TABLE
    清空与回灌在同一个事务里完成，中途失败会整表回滚，不会留下半份数据。
    """
    if not source.exists():
        raise SystemExit(f"备份文件不存在：{source}")
    if source.suffix.lower() in {".sqlite3", ".sqlite", ".db"}:
        raise SystemExit(
            f"当前配置是 MySQL，但传入的是 SQLite 备份文件（{source.suffix}）。"
            "请改用 restore.ps1 的 SQLite 模式，或指定 .sql 备份。"
        )
    statements = _split_statements(source.read_text(encoding="utf-8"))
    if not statements:
        raise SystemExit("备份文件中没有可执行语句。")

    connection = _connect(raw_url, autocommit=False)
    executed = 0
    cleared: set[str] = set()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET FOREIGN_KEY_CHECKS=0")
            cursor.execute("SHOW TABLES")
            existing = {row[0] for row in cursor.fetchall()}
            connection.commit()

            skipped_ddl = 0
            for statement in statements:
                verb = statement.split(None, 2)[0].upper() if statement.split() else ""

                if verb == "DROP":
                    skipped_ddl += 1
                    continue

                if verb == "CREATE":
                    table = _table_name_from_create(statement)
                    if table and table in existing:
                        skipped_ddl += 1
                        continue

                if verb == "INSERT":
                    table = _table_name_from_insert(statement)
                    if table and table not in cleared:
                        if table not in existing:
                            raise SystemExit(f"备份中的表 {table} 在目标库不存在，且无可用的建表语句。")
                        cursor.execute(f"DELETE FROM `{table}`")
                        cleared.add(table)

                try:
                    cursor.execute(statement)
                except Exception as exc:  # noqa: BLE001 - 需要给出具体语句上下文
                    connection.rollback()
                    preview = statement if len(statement) <= 200 else statement[:200] + "..."
                    raise SystemExit(
                        f"恢复失败（第 {executed + 1} 条），已回滚本次清空：{exc}\n语句：{preview}"
                    ) from exc
                executed += 1

            connection.commit()
            cursor.execute("SET FOREIGN_KEY_CHECKS=1")
    finally:
        connection.close()
    print(f"statements={executed} cleared_tables={len(cleared)} skipped_ddl={skipped_ddl}")
    return 0


def _table_name_from_create(statement: str) -> str | None:
    marker = "CREATE TABLE"
    if marker not in statement.upper():
        return None
    tail = statement[statement.upper().index(marker) + len(marker) :].strip()
    if tail.upper().startswith("IF NOT EXISTS"):
        tail = tail[len("IF NOT EXISTS") :].strip()
    if not tail.startswith("`"):
        return None
    return tail[1 : tail.index("`", 1)] or None


def _table_name_from_insert(statement: str) -> str | None:
    marker = "INSERT INTO"
    if not statement.upper().startswith(marker):
        return None
    tail = statement[len(marker) :].strip()
    if not tail.startswith("`"):
        return None
    return tail[1 : tail.index("`", 1)] or None


def _split_statements(text: str) -> list[str]:
    """按行切分语句。dump 阶段保证每条语句独占一行且以分号结尾。"""
    statements: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(HEADER_PREFIX):
            continue
        if not line.endswith(";"):
            raise SystemExit(f"备份文件格式异常（语句未以分号结尾）：{line[:120]}")
        statement = line[:-1].strip()
        if statement:
            statements.append(statement)
    return statements


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MySQL 逻辑备份/恢复")
    sub = parser.add_subparsers(dest="command", required=True)

    dump_parser = sub.add_parser("dump", help="导出数据库")
    dump_parser.add_argument("--url", default=os.getenv("AGENT_BATTLE_DATABASE_URL", ""))
    dump_parser.add_argument("--output", required=True)

    restore_parser = sub.add_parser("restore", help="恢复数据库")
    restore_parser.add_argument("--url", default=os.getenv("AGENT_BATTLE_DATABASE_URL", ""))
    restore_parser.add_argument("--input", required=True)

    args = parser.parse_args(argv)
    resolved = _resolve_url(args.url)
    if not resolved:
        raise SystemExit("缺少连接串：请设置 AGENT_BATTLE_DATABASE_URL 或传 --url。")

    if args.command == "dump":
        return dump(resolved, Path(args.output))
    return restore(resolved, Path(args.input))


if __name__ == "__main__":
    sys.exit(main())
