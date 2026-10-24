"""OAuth and tenant-isolation regressions; no live Google credentials required."""
from datetime import timedelta
from unittest import TestCase, main
from unittest.mock import patch, Mock
from urllib.parse import urlparse, parse_qs

from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, func, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import COOKIE, token_hash, create_google_user
from app.config import settings
from app.connections import GCP_SCOPE, seal, unseal, verify_identity
from app.database import Base, User, Workspace, Membership, BrowserSession, OAuthAttempt, CloudConnection, get_db, now
from app.main import app


class AuthTests(TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        @event.listens_for(self.engine, 'connect')
        def foreign_keys(connection, record):
            connection.execute('PRAGMA foreign_keys=ON')
        Base.metadata.create_all(self.engine)
        def db_session():
            with Session(self.engine, expire_on_commit=False) as db:
                yield db
        app.dependency_overrides[get_db] = db_session
        self.client = TestClient(app)
        self.headers = {'X-CloudScanner-Request': '1'}
        self.saved = {key: getattr(settings, key) for key in ['google_client_id', 'google_client_secret', 'public_url', 'credential_encryption_key', 'session_cookie_secure']}
        settings.google_client_id = 'test-client'
        settings.google_client_secret = 'test-secret'
        settings.public_url = 'http://testserver'
        # Only loopback HTTP is allowed by the production OAuth configuration guard.
        settings.public_url = 'http://127.0.0.1:5173'
        settings.credential_encryption_key = Fernet.generate_key().decode()
        settings.session_cookie_secure = False
        self.claims = {'sub': 'google-sub-1', 'email': 'one@example.com', 'email_verified': True, 'name': 'User One'}
        self.exchange = patch('app.connections.exchange_code', return_value={'id_token': 'verified-token', 'refresh_token': 'secret-refresh', 'scope': 'openid email profile ' + GCP_SCOPE}).start()
        self.identity = patch('app.connections.verify_identity', side_effect=lambda token, nonce: dict(self.claims)).start()
        self.addCleanup(patch.stopall)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()
        for key, value in self.saved.items():
            setattr(settings, key, value)

    def start(self, path='/api/auth/google/start'):
        response = self.client.post(path, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return parse_qs(urlparse(response.json()['url']).query)

    def finish(self, params, **extra):
        return self.client.get('/api/oauth/google/callback', params={'state': params['state'][0], 'code': 'one-use-code', **extra}, follow_redirects=False)

    def login(self):
        response = self.finish(self.start())
        self.assertEqual(response.status_code, 303, response.text)
        self.assertIn('/#/scanner', response.headers['location'])
        return self.client.get('/api/auth/me').json()['user']

    def workspace(self):
        return self.client.get('/api/workspaces').json()['workspaces'][0]['id']

    def connect(self):
        params = self.start(f'/api/workspaces/{self.workspace()}/connections/gcp/start')
        response = self.finish(params)
        self.assertNotIn('oauth_error', response.headers['location'], response.headers['location'])
        return self.client.get('/api/connections').json()['connections'][0]

    def test_login_session_profile_and_logout(self):
        user = self.login()
        self.assertEqual(user['email'], 'one@example.com')
        self.assertEqual(user['auth_provider'], 'google')
        self.assertNotIn('password', str(user))
        self.assertEqual(len(self.client.get('/api/workspaces').json()['workspaces']), 1)
        with Session(self.engine) as db:
            session = db.scalar(select(BrowserSession))
            self.assertEqual(session.token_hash, token_hash(self.client.cookies.get(COOKIE)))
        response = self.client.patch('/api/auth/profile', json={'name': 'New Name'}, headers=self.headers)
        self.assertEqual(response.json()['user']['name'], 'New Name')
        self.assertEqual(self.client.patch('/api/auth/profile', json={'name': 'X', 'email': 'other@example.com'}, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.post('/api/auth/logout').status_code, 403)
        self.client.post('/api/auth/logout', headers=self.headers)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_csrf_pkce_nonce_and_cookie(self):
        self.assertEqual(self.client.post('/api/auth/google/start').status_code, 403)
        params = self.start()
        self.assertEqual(params['code_challenge_method'], ['S256'])
        self.assertIn('nonce', params)
        self.assertNotIn(GCP_SCOPE, params['scope'][0])
        self.assertNotIn('test-secret', str(params))
        response = self.finish(params)
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        self.assertIn('SameSite=lax', response.headers['set-cookie'])

    def test_wrong_state_cookie_and_replay(self):
        params = self.start()
        self.assertEqual(self.finish({'state': ['wrong-state']}).status_code, 400)
        binding = self.client.cookies.get('cloudscanner_oauth')
        self.client.cookies.clear()
        self.assertEqual(self.finish(params).status_code, 400)
        self.client.cookies.set('cloudscanner_oauth', binding)
        self.assertEqual(self.finish(params).status_code, 303)
        self.assertEqual(self.finish(params).status_code, 400)
        self.assertEqual(self.exchange.call_count, 1)

    def test_expired_oauth_and_session(self):
        params = self.start()
        with Session(self.engine) as db:
            db.scalar(select(OAuthAttempt)).expires_at = now() - timedelta(seconds=1)
            db.commit()
        self.assertEqual(self.finish(params).status_code, 400)
        self.login()
        with Session(self.engine) as db:
            db.scalar(select(BrowserSession)).expires_at = now() - timedelta(seconds=1)
            db.commit()
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_cancelled_consent_can_retry(self):
        response = self.finish(self.start(), error='access_denied')
        self.assertIn('oauth_error', response.headers['location'])
        self.exchange.assert_not_called()
        self.login()

    def test_repeated_login_uses_subject_not_email(self):
        first = self.login()
        self.claims['email'] = 'renamed@example.com'
        second = self.login()
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(second['email'], 'renamed@example.com')
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Workspace)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(BrowserSession)), 1)
        self.claims['sub'] = 'different-google-account'
        third = self.login()
        self.assertNotEqual(first['id'], third['id'])

    def test_connection_credentials_are_encrypted_and_not_public(self):
        self.login()
        connection = self.connect()
        self.assertEqual(connection['provider'], 'gcp')
        with Session(self.engine) as db:
            stored = db.get(CloudConnection, connection['id'])
            self.assertNotIn('secret-refresh', stored.encrypted_credentials)
            self.assertEqual(unseal(stored.encrypted_credentials)['refresh_token'], 'secret-refresh')
        self.assertNotIn('secret-refresh', self.client.get('/api/connections').text)
        self.assertNotIn('encrypted_credentials', self.client.get('/api/connections').text)
        self.assertEqual(len(self.client.get('/api/connections').json()['providers']), 3)

    def test_missing_scope_and_wrong_account_are_rejected(self):
        self.login()
        self.exchange.return_value['scope'] = 'openid email profile'
        params = self.start(f'/api/workspaces/{self.workspace()}/connections/gcp/start')
        self.assertIn('oauth_error', self.finish(params).headers['location'])
        self.exchange.return_value['scope'] += ' ' + GCP_SCOPE
        params = self.start(f'/api/workspaces/{self.workspace()}/connections/gcp/start')
        self.claims['sub'] = 'different-account'
        self.assertIn('oauth_error', self.finish(params).headers['location'])
        self.assertEqual(self.client.get('/api/connections').json()['connections'], [])

    def test_logout_during_connect_invalidates_callback(self):
        self.login()
        params = self.start(f'/api/workspaces/{self.workspace()}/connections/gcp/start')
        self.client.post('/api/auth/logout', headers=self.headers)
        calls = self.exchange.call_count
        self.assertIn('oauth_error', self.finish(params).headers['location'])
        self.assertEqual(self.exchange.call_count, calls)

    def test_foreign_connections_and_workspaces_are_inaccessible(self):
        self.login()
        first_workspace = self.workspace()
        connection = self.connect()
        self.claims['sub'] = 'second-user'
        self.claims['email'] = 'two@example.com'
        self.login()
        self.assertEqual(self.client.get('/api/connections').json()['connections'], [])
        self.assertEqual(self.client.post(f'/api/workspaces/{first_workspace}/connections/gcp/start', headers=self.headers).status_code, 404)
        self.assertEqual(self.client.delete('/api/connections/' + connection['id'], headers=self.headers).status_code, 404)
        for path in [f'/api/v1/scan/my-project?connection_id={connection["id"]}', f'/api/v1/scan/my-project/stream?connection_id={connection["id"]}']:
            self.assertEqual(self.client.get(path).status_code, 404)
        for path in ['/api/check-lb-permissions', '/api/check-lb-permissions/stream']:
            self.assertEqual(self.client.post(path, params={'connection_id': connection['id']}, json={'project_id': 'my-project'}).status_code, 404)

    def test_scan_uses_selected_credentials_and_repeats_preflight(self):
        self.login()
        connection = self.connect()
        with patch('app.connections.Credentials.refresh') as refresh, patch('app.main.ScanOrchestrator') as orchestrator:
            orchestrator.return_value.run.return_value = Mock(model_dump=lambda: {'status': 'completed'})
            response = self.client.get(f'/api/v1/scan/my-project/stream?connection_id={connection["id"]}')
            self.assertEqual(response.status_code, 200)
            self.assertIn('completed', response.text)
            refresh.assert_called_once()
            credentials, label = orchestrator.call_args.args
            self.assertEqual(credentials.refresh_token, 'secret-refresh')
            self.assertEqual(label, 'one@example.com')
        with patch('app.services.scan_orchestrator.LbPermissionChecker') as checker, patch('app.services.scan_orchestrator.ExternalLbScanner') as scanner:
            from app.services.scan_orchestrator import ScanOrchestrator
            checker.return_value.check.return_value = Mock(project_id='my-project', service_account_email='user', all_permissions_granted=False, permissions=[], missing_permissions=['permission'], invalid_permissions=[], message='blocked', logs=[])
            credentials = object()
            self.assertEqual(ScanOrchestrator(credentials, 'user').run('my-project').status, 'blocked')
            checker.assert_called_once_with(credentials, 'user')
            scanner.assert_not_called()

    def test_revoked_tokens_require_reconnect_and_disconnect_removes_access(self):
        from google.auth.exceptions import RefreshError
        self.login()
        connection = self.connect()
        path = f'/api/v1/scan/my-project?connection_id={connection["id"]}'
        with patch('app.connections.Credentials.refresh', side_effect=RefreshError('secret response')):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 409)
            self.assertNotIn('secret response', response.text)
        self.assertEqual(self.client.delete('/api/connections/' + connection['id'], headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_reconnect_preserves_refresh_token_when_google_omits_it(self):
        self.login()
        first = self.connect()
        self.exchange.return_value.pop('refresh_token')
        second = self.connect()
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(len(self.client.get('/api/connections').json()['connections']), 1)

    def test_identity_verifier_checks_nonce_and_verified_email(self):
        with patch('app.connections.id_token.verify_oauth2_token', return_value={**self.claims, 'nonce': 'expected'}) as verify:
            self.assertEqual(verify_identity('token', 'expected')['sub'], 'google-sub-1')
            verify.assert_called_with('token', __import__('unittest.mock', fromlist=['ANY']).ANY, 'test-client')
            with self.assertRaises(HTTPException):
                verify_identity('token', 'wrong')
        with patch('app.connections.id_token.verify_oauth2_token', return_value={**self.claims, 'email_verified': False, 'nonce': 'expected'}):
            with self.assertRaises(HTTPException):
                verify_identity('token', 'expected')

    def test_oauth_rate_limit_and_configuration_errors(self):
        self.start()
        from app.database import AuthRateLimit
        with Session(self.engine) as db:
            db.scalar(select(AuthRateLimit)).attempts = 50
            db.commit()
        self.assertEqual(self.client.post('/api/auth/google/start', headers=self.headers).status_code, 429)
        settings.google_client_secret = ''
        self.assertEqual(self.client.post('/api/auth/google/start', headers=self.headers).status_code, 503)

    def test_missing_encryption_key_fails_before_cloud_consent(self):
        self.login()
        settings.credential_encryption_key = ''
        self.assertEqual(self.client.post(f'/api/workspaces/{self.workspace()}/connections/gcp/start', headers=self.headers).status_code, 503)
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(OAuthAttempt)), 0)

    def test_viewer_cannot_create_or_disconnect_connections(self):
        self.login()
        workspace = self.workspace()
        connection = self.connect()
        with Session(self.engine) as db:
            db.scalar(select(Membership)).role = 'viewer'
            db.commit()
        self.assertEqual(self.client.post(f'/api/workspaces/{workspace}/connections/gcp/start', headers=self.headers).status_code, 403)
        self.assertEqual(self.client.delete('/api/connections/' + connection['id'], headers=self.headers).status_code, 403)

    def test_plain_http_nonlocal_origins_and_insecure_https_are_rejected(self):
        settings.public_url = 'http://example.com'
        self.assertEqual(self.client.post('/api/auth/google/start', headers=self.headers).status_code, 503)
        settings.public_url = 'https://example.com'
        self.assertEqual(self.client.post('/api/auth/google/start', headers=self.headers).status_code, 503)
        settings.session_cookie_secure = True
        response = self.client.post('/api/auth/google/start', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertIn('Secure', response.headers['set-cookie'])

    def test_password_routes_are_removed_and_demo_cannot_scan(self):
        self.login()
        for path in ['signup', 'login', 'forgot-password']:
            self.assertEqual(self.client.post('/api/auth/' + path, headers=self.headers, json={}).status_code, 404)
        with Session(self.engine) as db:
            db.scalar(select(User)).is_demo = True
            db.commit()
        self.assertEqual(self.client.get('/api/auth/me').json()['user']['sample_workspace']['sampleMode'], True)
        self.assertEqual(self.client.post(f'/api/workspaces/{self.workspace()}/connections/gcp/start', headers=self.headers).status_code, 403)
        self.assertEqual(self.client.get('/api/v1/scan/my-project?connection_id=missing').status_code, 403)


if __name__ == '__main__':
    main()
