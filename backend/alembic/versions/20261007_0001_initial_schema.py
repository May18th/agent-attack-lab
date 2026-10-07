"""Create battle and event tables with lookup indexes."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261007_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "battles" not in tables:
        op.create_table(
            "battles",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("difficulty", sa.Text(), nullable=False),
            sa.Column("topic", sa.Text(), nullable=False),
            sa.Column("status", sa.Text(), nullable=False),
            sa.Column("created_at", sa.Text(), nullable=False),
            sa.Column("attacker_out", sa.Text(), nullable=False),
            sa.Column("defender_out", sa.Text(), nullable=False),
        )
    if "battle_events" not in tables:
        op.create_table(
            "battle_events",
            sa.Column("id", sa.Text(), primary_key=True),
            sa.Column("battle_id", sa.Text(), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.Text(), nullable=False),
            sa.Column("status", sa.Text(), nullable=False),
            sa.Column("created_at", sa.Text(), nullable=False),
            sa.Column("data", sa.Text(), nullable=False),
            sa.UniqueConstraint("battle_id", "sequence", name="uq_battle_event_sequence"),
        )
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("battle_events")}
    if "idx_battle_events_battle" not in indexes:
        op.create_index("idx_battle_events_battle", "battle_events", ["battle_id", "sequence"])
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("battles")}
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
