"""Add optional human-readable battle codes."""

from __future__ import annotations

from alembic import context, op
import sqlalchemy as sa


revision = "20261024_0004"
down_revision = "20261018_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = None if context.is_offline_mode() else sa.inspect(bind)
    tables = set() if inspector is None else set(inspector.get_table_names())
    if "battles" not in tables:
        return
    columns = set() if inspector is None else {column["name"] for column in inspector.get_columns("battles")}
    if "code" not in columns:
        op.add_column("battles", sa.Column("code", sa.String(16), nullable=True))
    indexes = set() if inspector is None else {item["name"] for item in inspector.get_indexes("battles")}
    if "uq_battles_code" not in indexes:
        op.create_index("uq_battles_code", "battles", ["code"], unique=True)
    if "battle_code_sequence" not in tables:
        options = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"} if dialect in {"mysql", "mariadb"} else {}
        op.create_table(
            "battle_code_sequence",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("value", sa.Integer(), nullable=False),
            **options,
        )
    if dialect in {"mysql", "mariadb"}:
        op.execute("INSERT IGNORE INTO battle_code_sequence (id, value) VALUES (1, 0)")
    elif dialect == "postgresql":
        op.execute("INSERT INTO battle_code_sequence (id, value) VALUES (1, 0) ON CONFLICT (id) DO NOTHING")
    else:
        op.execute("INSERT OR IGNORE INTO battle_code_sequence (id, value) VALUES (1, 0)")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "battle_code_sequence" in inspector.get_table_names():
        op.drop_table("battle_code_sequence")
    if "uq_battles_code" in {item["name"] for item in inspector.get_indexes("battles")}:
        op.drop_index("uq_battles_code", table_name="battles")
    if "code" in {column["name"] for column in inspector.get_columns("battles")}:
        op.drop_column("battles", "code")
