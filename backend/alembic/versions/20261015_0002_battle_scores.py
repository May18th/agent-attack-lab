"""Persist evidence-derived battle score snapshots for fast reads."""

from __future__ import annotations

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "20261015_0002"
down_revision = "20261007_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_mysql = bind.dialect.name in {"mysql", "mariadb"}
    id_type = sa.String(191) if is_mysql else sa.Text()
    version_type = sa.String(64) if is_mysql else sa.Text()
    json_type = mysql.LONGTEXT() if is_mysql else sa.Text()
    options = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"} if is_mysql else {}
    inspector = None if context.is_offline_mode() else sa.inspect(bind)
    tables = set() if inspector is None else set(inspector.get_table_names())
    if "battle_scores" not in tables:
        op.create_table(
            "battle_scores",
            sa.Column("battle_id", id_type, primary_key=True),
            sa.Column("scoring_version", version_type, nullable=False),
            sa.Column("score_json", json_type, nullable=False),
            sa.Column("computed_at", sa.String(40) if is_mysql else sa.Text(), nullable=False),
            **options,
        )


def downgrade() -> None:
    op.drop_table("battle_scores")
