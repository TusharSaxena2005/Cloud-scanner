import React, { useState } from 'react';
import { beginGoogleSignIn, loginDemo } from './api.js';

export default function Auth({ serviceError, onAuthenticated }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const oauthError = new URLSearchParams(location.hash.split('?')[1] || '').get('oauth_error');

  async function signIn() {
    if (busy || demoBusy) return;
    setBusy(true); setMessage('');
    try { const result = await beginGoogleSignIn(); window.location.assign(result.url); }
    catch (error) { setMessage(error.message); setBusy(false); }
  }

  async function signInDemo() {
    if (busy || demoBusy) return;
    setDemoBusy(true); setMessage('');
    try {
      const result = await loginDemo();
      if (onAuthenticated) {
        onAuthenticated(result.user);
      } else {
        location.hash = '#/dashboard';
      }
    } catch (error) {
      setMessage(error.message);
      setDemoBusy(false);
    }
  }

  return <main className="auth-layout">
    <section className="auth-story">
      <a href="#/dashboard" className="brand"><span className="brand-mark" aria-hidden="true" /><span className="brand-text"><strong>CloudScanner</strong><small>Cloud security visibility</small></span></a>
      <div className="auth-story-content"><span className="eyebrow">CLOUD SECURITY, IN FOCUS</span><h1>A clearer view of your cloud protection.</h1><p>Explore public infrastructure and understand where protection is missing.</p><div className="auth-path" aria-hidden="true"><span>Your workspace</span><span>Your cloud connections</span><span>Your security coverage</span></div></div>
      <p className="auth-footnote">Read-only resource scanning. GCP available today.</p>
    </section>
    <section className="auth-form-side" aria-labelledby="auth-title"><div className="auth-card">
      <span className="eyebrow">YOUR SECURITY WORKSPACE</span><h2 id="auth-title">Welcome to CloudScanner</h2>
      <p className="auth-description">Sign in or create your account with Google. Connect Google Cloud separately when you are ready to scan.</p>
      {(message || oauthError || serviceError) && <p className="auth-message" role="alert">{message || oauthError || serviceError}</p>}
      <button className="btn primary auth-submit" disabled={busy || demoBusy} onClick={signIn}>{busy ? 'Opening Google...' : 'Continue with Google'}</button>
      <p className="auth-hint">Your Google password stays with Google. Cloud access requires a separate permission request.</p>

      <div className="auth-divider" role="separator" aria-label="or explore with sample data">
        <span>or try demo workspace</span>
      </div>

      <div className="auth-demo-card">
        <div className="auth-demo-header">
          <h3>Explore Demo Account</h3>
          <span className="auth-demo-badge">Sample Data</span>
        </div>
        <p className="auth-demo-desc">
          Test-drive CloudScanner with synthetic cloud security data across 9 projects, external HTTPS load balancers, and Cloud Armor policies.
        </p>
        <ul className="auth-demo-features" aria-label="Demo features">
          <li>9 Multi-tier projects</li>
          <li>Cloud Armor WAF rules</li>
          <li>Interactive traffic flow</li>
          <li>Unprotected backend detection</li>
        </ul>
        <button
          type="button"
          className="btn secondary auth-demo-submit"
          disabled={busy || demoBusy}
          onClick={signInDemo}
        >
          {demoBusy ? 'Launching demo account...' : 'Continue with Demo Account'}
        </button>
      </div>
    </div></section>
  </main>;
}
