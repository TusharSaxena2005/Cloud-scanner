import unittest
from datetime import datetime, timedelta, timezone
import mongomock
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.auth import router, get_db, initialize_indexes, COOKIE, token_hash
from app.main import app as full_app


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).cloudscanner
        initialize_indexes(self.db)
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)
        self.headers = {"X-CloudScanner-Request": "1"}
        self.user = {"name": "Test User", "email": "user@example.com", "password": "correct-password"}

    def signup(self):
        return self.client.post('/api/auth/signup', json=self.user, headers=self.headers)

    def test_signup_session_logout_and_password_storage(self):
        response = self.signup()
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('password', response.text)
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        stored = self.db.users.find_one()
        self.assertNotEqual(stored['password_hash'], self.user['password'])
        self.assertNotIn('password', stored)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 200)
        token = self.client.cookies.get(COOKIE)
        self.assertIsNotNone(self.db.sessions.find_one({'_id': token_hash(token)}))
        self.client.post('/api/auth/logout', headers=self.headers)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        self.assertEqual(self.db.sessions.count_documents({}), 0)

    def test_duplicate_email_bad_password_and_login(self):
        self.signup()
        self.assertEqual(self.signup().status_code, 409)
        data = {"email": "USER@example.com", "password": "wrong"}
        self.assertEqual(self.client.post('/api/auth/login', json=data, headers=self.headers).status_code, 401)
        data['password'] = self.user['password']
        self.assertEqual(self.client.post('/api/auth/login', json=data, headers=self.headers).status_code, 200)
        self.assertEqual(self.db.sessions.count_documents({}), 1)

    def test_expired_session_rejected(self):
        self.signup()
        self.db.sessions.update_many({}, {'$set': {'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)}})
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_csrf_validation_and_rate_limit(self):
        self.assertEqual(self.client.post('/api/auth/signup', json=self.user).status_code, 403)
        self.assertEqual(self.client.post('/api/auth/signup', json={**self.user, 'password': 'short'}, headers=self.headers).status_code, 422)
        self.signup()
        self.db.auth_attempts.update_many({}, {'$set': {'count': 100}})
        self.assertEqual(self.client.post('/api/auth/login', json=self.user, headers=self.headers).status_code, 429)

    def test_demo_data_is_account_scoped_and_live_scans_are_blocked(self):
        self.signup()
        self.db.users.update_one({"email": self.user["email"]}, {"$set": {"is_demo": True, "sample_workspace": {"sampleMode": True}}})
        response = self.client.get('/api/auth/me')
        self.assertTrue(response.json()['user']['sample_workspace']['sampleMode'])
        full_app.dependency_overrides[get_db] = lambda: self.db
        try:
            with TestClient(full_app) as client:
                client.cookies.set(COOKIE, self.client.cookies.get(COOKIE))
                self.assertEqual(client.get('/api/v1/scan/demo-project/stream').status_code, 403)
        finally:
            full_app.dependency_overrides.clear()
        self.db.users.update_one({"email": self.user["email"]}, {"$set": {"is_demo": False}})
        self.assertIsNone(self.client.get('/api/auth/me').json()['user']['sample_workspace'])

    def test_profile_update_persists_and_email_requires_password(self):
        self.signup()
        values = {"name": "New Name", "email": self.user["email"]}
        self.assertEqual(self.client.patch('/api/auth/profile', json=values, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me').json()['user']['name'], 'New Name')
        values['email'] = 'new@example.com'
        self.assertEqual(self.client.patch('/api/auth/profile', json=values, headers=self.headers).status_code, 400)
        values['current_password'] = self.user['password']
        self.assertEqual(self.client.patch('/api/auth/profile', json=values, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me').json()['user']['email'], 'new@example.com')
        self.db.users.insert_one({'email': 'taken@example.com'})
        values['email'] = 'taken@example.com'
        self.assertEqual(self.client.patch('/api/auth/profile', json=values, headers=self.headers).status_code, 409)
        self.assertEqual(self.client.get('/api/auth/me').json()['user']['email'], 'new@example.com')
        self.client.post('/api/auth/logout', headers=self.headers)
        self.assertEqual(self.client.patch('/api/auth/profile', json=values, headers=self.headers).status_code, 401)

    def test_password_change_verifies_old_password_and_revokes_other_sessions(self):
        self.signup()
        from app.auth import password_hash, token_hash, COOKIE
        from datetime import datetime, timezone, timedelta
        self.db.sessions.insert_one({"_id": "another-session", "user_id": self.db.users.find_one()["_id"],
                                     "expires_at": datetime.now(timezone.utc) + timedelta(hours=1)})
        values = {"current_password": "wrong-password", "new_password": "new-password-123"}
        self.assertEqual(self.client.patch('/api/auth/password', json=values, headers=self.headers).status_code, 400)
        values['current_password'] = self.user['password']
        self.assertEqual(self.client.patch('/api/auth/password', json=values).status_code, 403)
        self.assertEqual(self.client.patch('/api/auth/password', json={**values, 'new_password': 'short'}, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.patch('/api/auth/password', json=values, headers=self.headers).status_code, 200)
        self.assertIsNone(self.db.sessions.find_one({'_id': 'another-session'}))
        self.assertEqual(self.client.get('/api/auth/me').status_code, 200)
        self.assertEqual(self.client.post('/api/auth/login', json=self.user, headers=self.headers).status_code, 401)
        self.assertEqual(self.client.post('/api/auth/login', json={**self.user, 'password': values['new_password']}, headers=self.headers).status_code, 200)

    def test_bcrypt_hashes_and_legacy_login_migration(self):
        import hashlib
        from app.auth import verify_password, password_hash
        self.signup()
        stored = self.db.users.find_one()
        self.assertTrue(stored['password_hash'].startswith('$2b$12$'))
        self.assertTrue(verify_password(self.user['password'], stored['password_hash']))
        self.assertNotEqual(password_hash(self.user['password']), stored['password_hash'])
        salt = b'0123456789abcdef'
        digest = hashlib.scrypt(self.user['password'].encode(), salt=salt, n=32768, r=8, p=3, maxmem=64*1024*1024, dklen=32)
        legacy = f'scrypt${salt.hex()}${digest.hex()}'
        self.db.users.update_one({'_id': stored['_id']}, {'$set': {'password_hash': legacy}})
        self.assertEqual(self.client.post('/api/auth/login', json={**self.user, 'password': 'wrong'}, headers=self.headers).status_code, 401)
        self.assertEqual(self.db.users.find_one()['password_hash'], legacy)
        self.assertEqual(self.client.post('/api/auth/login', json=self.user, headers=self.headers).status_code, 200)
        self.assertTrue(self.db.users.find_one()['password_hash'].startswith('$2b$12$'))

    def test_bcrypt_length_limit_and_long_legacy_password(self):
        import hashlib
        from app.auth import verify_password
        for password in ['x' * 73, '\u00e9' * 37]:
            self.assertEqual(self.client.post('/api/auth/signup', json={**self.user, 'password': password}, headers=self.headers).status_code, 422)
        self.signup()
        self.assertEqual(self.client.patch('/api/auth/password', json={'current_password': self.user['password'], 'new_password': 'x' * 73}, headers=self.headers).status_code, 422)
        long_password = 'x' * 100
        salt = b'0123456789abcdef'
        digest = hashlib.scrypt(long_password.encode(), salt=salt, n=32768, r=8, p=3, maxmem=64*1024*1024, dklen=32)
        legacy = f'scrypt${salt.hex()}${digest.hex()}'
        self.db.users.update_one({'email': self.user['email']}, {'$set': {'password_hash': legacy}})
        self.assertEqual(self.client.post('/api/auth/login', json={**self.user, 'password': long_password}, headers=self.headers).status_code, 200)
        self.assertEqual(self.db.users.find_one()['password_hash'], legacy)
        self.assertFalse(verify_password('password', 'invalid-hash'))

    def test_scanner_api_requires_login(self):
        with TestClient(full_app) as client:
            for path in ['/api/service-account', '/api/permissions/manifest', '/api/v1/scan/demo-project/stream']:
                self.assertEqual(client.get(path).status_code, 401)


if __name__ == '__main__':
    unittest.main()
