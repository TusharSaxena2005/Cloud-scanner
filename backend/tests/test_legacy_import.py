from importlib.util import find_spec
from types import SimpleNamespace
from unittest import TestCase, skipUnless
from unittest.mock import Mock

from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session

from app.database import Base, User, Membership
from scripts.import_mongo_users import import_users


@skipUnless(find_spec("bson"), "Install requirements-migration.txt to test the optional Mongo importer")
class LegacyImportTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.source = SimpleNamespace(users=Mock())
        self.source.users.find_one.return_value = {"name": "Legacy User", "email": "old@example.com",
            "is_demo": True, "password_hash": "never-import-this"}
        self.mapping = {"012345678901234567890123": "verified-google-sub"}

    def tearDown(self):
        self.engine.dispose()

    def test_import_is_idempotent_and_omits_passwords(self):
        with Session(self.engine) as db:
            self.assertEqual(import_users(self.source, self.mapping, db), (1, 0))
            db.commit()
            self.assertEqual(import_users(self.source, self.mapping, db), (0, 1))
            user = db.scalar(select(User))
            self.assertTrue(user.is_demo)
            self.assertEqual(user.google_sub, "verified-google-sub")
            self.assertFalse(hasattr(user, "password_hash"))
            self.assertEqual(db.scalar(select(func.count()).select_from(Membership)), 1)
        self.source.users.insert_one.assert_not_called()
        self.source.users.update_one.assert_not_called()

    def test_preview_can_roll_back_all_destination_changes(self):
        with Session(self.engine) as db:
            import_users(self.source, self.mapping, db)
            db.rollback()
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(User)), 0)

    def test_duplicate_destination_mapping_is_rejected(self):
        with Session(self.engine) as db:
            with self.assertRaises(ValueError):
                import_users(self.source, {**self.mapping, "123456789012345678901234": "verified-google-sub"}, db)
            self.assertEqual(db.scalar(select(func.count()).select_from(User)), 0)
