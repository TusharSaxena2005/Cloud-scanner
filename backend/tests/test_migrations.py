from pathlib import Path
from unittest import TestCase

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.config import settings
from app.database import Base


class MigrationTests(TestCase):
    def test_upgrade_matches_models_and_downgrade_removes_tables(self):
        config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        previous_url = settings.database_url
        settings.database_url = "postgresql+psycopg://unused:unused@127.0.0.1/unused"
        engine = create_engine("sqlite://")
        try:
            with engine.connect() as connection:
                config.attributes["connection"] = connection
                command.upgrade(config, "head")
                self.assertEqual(compare_metadata(MigrationContext.configure(connection), Base.metadata), [])
                command.downgrade(config, "base")
                self.assertEqual(inspect(connection).get_table_names(), ["alembic_version"])
        finally:
            settings.database_url = previous_url
            engine.dispose()
