"""Persist sanitized cross-request audit events."""

from __future__ import annotations

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "20261018_0003"
down_revision = "20261015_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_mysql = bind.dialect.name in {"mysql", "mariadb"}
    id_type = sa.String(191) if is_mysql else sa.Text()
    short_type = sa.String(191) if is_mysql else sa.Text()
    role_type = sa.String(64) if is_mysql else sa.Text()
    status_type = sa.String(32) if is_mysql else sa.Text()
    data_type = mysql.LONGTEXT() if is_mysql else sa.Text()
    options = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"} if is_mysql else {}
    inspector = None if context.is_offline_mode() else sa.inspect(bind)
    tables = set() if inspector is None else set(inspector.get_table_names())
    if "audit_events" not in tables:
        op.create_table(
            "audit_events",
            sa.Column("id", id_type, primary_key=True),
            sa.Column("event_type", sa.String(128) if is_mysql else sa.Text(), nullable=False),
            sa.Column("request_id", short_type, nullable=True),
            sa.Column("battle_id", short_type, nullable=True),
            sa.Column("correlation_id", short_type, nullable=True),
            sa.Column("actor_role", role_type, nullable=True),
            sa.Column("status", status_type, nullable=False),
            sa.Column("created_at", sa.String(40) if is_mysql else sa.Text(), nullable=False),
            sa.Column("data", data_type, nullable=False),
            **options,
        )
    if "battle_idempotency" not in tables:
        op.create_table(
            "battle_idempotency",
            sa.Column("idempotency_key", id_type, primary_key=True),
            sa.Column("request_fingerprint", sa.String(64) if is_mysql else sa.Text(), nullable=False),
            sa.Column("battle_id", id_type, nullable=False),
            sa.Column("created_at", sa.String(40) if is_mysql else sa.Text(), nullable=False),
            **options,
        )
    indexes = set() if inspector is None else {item["name"] for item in inspector.get_indexes("audit_events")}
    if "idx_audit_events_battle" not in indexes:
        op.create_index("idx_audit_events_battle", "audit_events", ["battle_id", "created_at"])
    if "idx_audit_events_request" not in indexes:
        op.create_index("idx_audit_events_request", "audit_events", ["request_id", "created_at"])


def downgrade() -> None:
    op.drop_table("battle_idempotency")
    op.drop_index("idx_audit_events_request", table_name="audit_events")
    op.drop_index("idx_audit_events_battle", table_name="audit_events")
    op.drop_table("audit_events")
