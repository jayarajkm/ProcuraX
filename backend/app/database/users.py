"""User admin CLI.   python -m app.database.users set-password EMAIL   (prompts; never pass passwords on the command line)"""
import getpass
import sys
from sqlalchemy import select
from app.core.security import hash_password
from app.database.session import SessionLocal
from app.models import User


def main():
    if len(sys.argv) != 3 or sys.argv[1] != "set-password":
        raise SystemExit(__doc__)
    pw = getpass.getpass("New password (min 12 chars): ")
    if len(pw) < 12 or pw != getpass.getpass("Repeat: "):
        raise SystemExit("Password too short or mismatch")
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.email == sys.argv[2].lower()))
        if not u:
            raise SystemExit("No such user")
        u.password_hash = hash_password(pw); db.commit()
        print("Password updated for", u.email)


if __name__ == "__main__":
    main()
