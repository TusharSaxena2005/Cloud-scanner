import React, { useState } from 'react';
import { authenticate } from './api.js';

export default function Auth({ mode, onAuthenticated, serviceError }) {
  const signup = mode === 'signup';
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    if (signup && form.elements.password.value !== form.elements.confirmPassword.value) {
      form.elements.confirmPassword.setCustomValidity('Passwords must match.');
      form.elements.confirmPassword.reportValidity();
      return;
    }
    if (signup && new TextEncoder().encode(form.elements.password.value).length > 72) { setMessage('Use a password of at most 72 bytes; some characters use more than one byte.'); return; }
    setBusy(true);
    setMessage('');
    try {
      const result = await authenticate(mode, { email: form.elements.email.value.trim(), password: form.elements.password.value, ...(signup ? { name: form.elements.name.value.trim() } : {}) });
      onAuthenticated(result.user);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <main className="auth-layout">
    <section className="auth-story">
      <a href="#/scanner" className="brand"><span className="brand-mark" aria-hidden="true" /><span className="brand-text"><strong>Cloud Armor Scanner</strong><small>GCP External LB Security</small></span></a>
      <div className="auth-story-content"><span className="eyebrow">CLOUD SECURITY, IN FOCUS</span><h1>A clearer view of your cloud protection.</h1><p>Explore your public-facing infrastructure and understand where Cloud Armor coverage is missing.</p>
        <div className="auth-path" aria-hidden="true"><span>Google Cloud project</span><span>External load balancer</span><span>Cloud Armor coverage</span></div>
      </div>
      <p className="auth-footnote">Built for visibility. Read-only resource scanning.</p>
    </section>
    <section className="auth-form-side" aria-labelledby="auth-title">
      <a className="auth-back" href="#/scanner">← Back to scanner</a>
      <div className="auth-card">
        <span className="eyebrow">YOUR SECURITY WORKSPACE</span>
        <h2 id="auth-title">{signup ? 'Create your account' : 'Welcome back'}</h2>
        <p className="auth-description">{signup ? 'Set up your account to get started.' : 'Sign in to your Cloud Armor workspace.'}</p>
        <form onSubmit={submit} onChange={() => setMessage('')}>
          {signup && <label><span>Full name</span><input name="name" autoComplete="name" placeholder="Your full name" required maxLength={100} /></label>}
          <label><span>Email address</span><input name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label>
          <label><span>Password</span><div className="auth-password"><input name="password" type={visible ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'Create a password' : 'Enter your password'} maxLength={256} minLength={signup ? 8 : undefined} required onChange={event => { if (signup) event.target.form.elements.confirmPassword.setCustomValidity(''); }} /><button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>{visible ? 'Hide' : 'Show'}</button></div></label>
          {signup && <><p className="auth-hint">Use at least 8 characters, up to 72 bytes.</p><label><span>Confirm password</span><input name="confirmPassword" type={visible ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter your password again" required onChange={event => event.target.setCustomValidity('')} /></label></>}
          
          {(message || serviceError) && <p className="auth-message" role="alert">{message || serviceError}</p>}
          <button disabled={busy} className="btn primary auth-submit" type="submit">{busy ? 'Please wait...' : signup ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span></button>
        </form>
        <p className="auth-switch">{signup ? 'Already have an account?' : 'New to Cloud Armor Scanner?'} <a href={signup ? '#/login' : '#/signup'}>{signup ? 'Sign in' : 'Create an account'}</a></p>
      </div>
    </section>
  </main>;
}
