"""Optional, operator-run import of explicitly mapped legacy users. MongoDB is read-only.

Mapping format: {"mongo_object_id": "verified_google_subject"}.
Passwords and sessions are intentionally not imported into Google-only authentication.
Install pymongo separately to run this one-time tool.
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import Membership, User, Workspace, engine


def import_users(source, mapping, db):
    if not mapping or len(set(mapping.values())) != len(mapping):
        raise ValueError("Each legacy user must map to a distinct, verified Google subject.")
    inserted, skipped = 0, 0
    for legacy_id, subject in mapping.items():
        if not isinstance(subject, str) or not subject.strip() or len(subject) > 255:
            raise ValueError("Invalid Google subject in mapping.")
        from bson import ObjectId
        legacy = source.users.find_one({"_id": ObjectId(legacy_id)})
        if legacy is None:
            raise ValueError(f"Legacy user {legacy_id} was not found; import rolled back.")
        if db.scalar(select(User).where(User.google_sub == subject)):
            skipped += 1
            continue
        user = User(google_sub=subject, name=legacy["name"][:100], email=legacy["email"],
            is_demo=bool(legacy.get("is_demo")), created_at=legacy.get("created_at") or datetime.now(timezone.utc))
        db.add(user)
        db.flush()
        workspace = Workspace(name=f"{user.name}'s workspace"[:150])
        db.add(workspace)
        db.flush()
        db.add(Membership(user_id=user.id, workspace_id=workspace.id, role="owner"))
        inserted += 1
    return inserted, skipped


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--source-database", default="cloudscanner")
    parser.add_argument("--apply", action="store_true", help="Commit; otherwise run a rollback-only preview")
    args = parser.parse_args()
    from pymongo import MongoClient
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise SystemExit("Set MONGODB_URI in this terminal for the read-only source connection.")
    mapping = json.loads(args.mapping.read_text(encoding="utf-8"))
    with MongoClient(uri, serverSelectionTimeoutMS=10000) as source, Session(engine()) as db:
        inserted, skipped = import_users(source[args.source_database], mapping, db)
        if args.apply:
            db.commit()
        else:
            db.rollback()
    print(f"{'Imported' if args.apply else 'Previewed'} {inserted} users; skipped {skipped} existing identities.")
