"""Mark an existing Google identity as demo-only; no password accounts are created."""
import argparse
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import User, engine

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--google-sub', required=True, help='Verified Google subject of an existing user')
    args = parser.parse_args()
    with Session(engine()) as db:
        user = db.scalar(select(User).where(User.google_sub == args.google_sub))
        if user is None:
            raise SystemExit('Sign in with Google first. No account was changed.')
        user.is_demo = True
        db.commit()
    print('Existing Google identity is now restricted to the demo workspace.')
