import React, { useState } from 'react';
import { beginGoogleSignIn } from './api.js';

export default function Auth({ serviceError }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const oauthError = new URLSearchParams(location.hash.split('?')[1] || '').get('oauth_error');
  async function signIn() {
    if (busy) return;
    setBusy(true); setMessage('');
    try { const result = await beginGoogleSignIn(); window.location.assign(result.url); }
    catch (error) { setMessage(error.message); setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-story">
      <a href="#/scanner" className="brand"><span className="brand-mark" aria-hidden="true" /><span className="brand-text"><strong>CloudScanner</strong><small>Cloud security visibility</small></span></a>
      <div className="auth-story-content"><span className="eyebrow">CLOUD SECURITY, IN FOCUS</span><h1>A clearer view of your cloud protection.</h1><p>Explore public infrastructure and understand where protection is missing.</p><div className="auth-path" aria-hidden="true"><span>Your workspace</span><span>Your cloud connections</span><span>Your security coverage</span></div></div>
      <p className="auth-footnote">Read-only resource scanning. GCP available today.</p>
    </section>
    <section className="auth-form-side" aria-labelledby="auth-title"><div className="auth-card">
      <span className="eyebrow">YOUR SECURITY WORKSPACE</span><h2 id="auth-title">Welcome to CloudScanner</h2>
      <p className="auth-description">Sign in or create your account with Google. Connect Google Cloud separately when you are ready to scan.</p>
      {(message || oauthError || serviceError) && <p className="auth-message" role="alert">{message || oauthError || serviceError}</p>}
      <button className="btn primary auth-submit" disabled={busy} onClick={signIn}>{busy ? 'Opening Google...' : 'Continue with Google'}</button>
      <p className="auth-hint">Your Google password stays with Google. Cloud access requires a separate permission request.</p>
    </div></section>
  </main>;
}
