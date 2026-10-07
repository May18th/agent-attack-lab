"""Create battle and event tables with lookup indexes."""

from __future__ import annotations

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "20261007_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_mysql = bind.dialect.name in {"mysql", "mariadb"}
    id_type = sa.String(191) if is_mysql else sa.Text()
    indexed_text_type = sa.String(40) if is_mysql else sa.Text()
    large_text_type = mysql.LONGTEXT() if is_mysql else sa.Text()
    mysql_options = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"} if is_mysql else {}
    offline = context.is_offline_mode()
    inspector = None if offline else sa.inspect(bind)
    tables = set() if inspector is None else set(inspector.get_table_names())
    if "battles" not in tables:
        op.create_table(
            "battles",
            sa.Column("id", id_type, primary_key=True),
            sa.Column("difficulty", sa.String(16) if is_mysql else sa.Text(), nullable=False),
            sa.Column("topic", sa.Text(), nullable=False),
            sa.Column("status", sa.String(32) if is_mysql else sa.Text(), nullable=False),
            sa.Column("created_at", indexed_text_type, nullable=False),
            sa.Column("attacker_out", large_text_type, nullable=False),
            sa.Column("defender_out", large_text_type, nullable=False),
            **mysql_options,
        )
    if "battle_events" not in tables:
        op.create_table(
            "battle_events",
            sa.Column("id", id_type, primary_key=True),
            sa.Column("battle_id", id_type, nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(64) if is_mysql else sa.Text(), nullable=False),
            sa.Column("status", sa.String(32) if is_mysql else sa.Text(), nullable=False),
            sa.Column("created_at", indexed_text_type, nullable=False),
            sa.Column("data", large_text_type, nullable=False),
            sa.UniqueConstraint("battle_id", "sequence", name="uq_battle_event_sequence"),
            **mysql_options,
        )
    indexes = (
        set()
        if inspector is None
        else {index["name"] for index in inspector.get_indexes("battle_events")}
    )
    if "idx_battle_events_battle" not in indexes:
        op.create_index("idx_battle_events_battle", "battle_events", ["battle_id", "sequence"])
    indexes = (
        set()
        if inspector is None
        else {index["name"] for index in inspector.get_indexes("battles")}
    )
    for name, columns in (
        ("idx_battles_created", ["created_at"]),
        ("idx_battles_difficulty_created", ["difficulty", "created_at"]),
        ("idx_battles_status_created", ["status", "created_at"]),
    ):
        if name not in indexes:
            op.create_index(name, "battles", columns)


def downgrade() -> None:
    op.drop_index("idx_battles_status_created", table_name="battles")
    op.drop_index("idx_battles_difficulty_created", table_name="battles")
    op.drop_index("idx_battles_created", table_name="battles")
    op.drop_index("idx_battle_events_battle", table_name="battle_events")
    op.drop_table("battle_events")
    op.drop_table("battles")
