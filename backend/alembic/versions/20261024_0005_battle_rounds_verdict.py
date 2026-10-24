"""Persist requested round count and verified battle verdict."""

from __future__ import annotations

from alembic import context, op
import sqlalchemy as sa


revision = "20261024_0005"
down_revision = "20261024_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = None if context.is_offline_mode() else sa.inspect(bind)
    tables = set() if inspector is None else set(inspector.get_table_names())
    if inspector is not None and "battles" not in tables:
        return
    columns = set() if inspector is None else {column["name"] for column in inspector.get_columns("battles")}
    if "rounds" not in columns:
        op.add_column("battles", sa.Column("rounds", sa.Integer(), nullable=False, server_default="3"))
    if "verdict" not in columns:
        op.add_column("battles", sa.Column("verdict", sa.String(32), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("battles")}
    if "verdict" in columns:
        op.drop_column("battles", "verdict")
    if "rounds" in columns:
        op.drop_column("battles", "rounds")
