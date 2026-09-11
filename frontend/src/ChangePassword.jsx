import React, { useState } from 'react';
import { changePassword } from './api.js';

export default function ChangePassword() {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const current = form.elements.currentPassword.value;
    const next = form.elements.newPassword.value;
    if (next !== form.elements.confirmPassword.value) {
      form.elements.confirmPassword.setCustomValidity('Passwords must match.');
      form.elements.confirmPassword.reportValidity();
      return;
    }
    if (new TextEncoder().encode(next).length > 72) { setError('Use a password of at most 72 bytes; some characters use more than one byte.'); return; }
    if (next === current) { setError('Choose a new password different from your current password.'); return; }
    setBusy(true); setError('');
    try {
      await changePassword({ current_password: current, new_password: next });
      form.reset(); setEditing(false); setSaved(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section className="panel" aria-labelledby="password-heading">
    <div className="panel-header"><div><h2 id="password-heading">Password &amp; security</h2><p className="panel-subtitle">Keep your account protected with a strong password.</p></div>{!editing && <button className="btn secondary" onClick={() => { setEditing(true); setError(''); setSaved(false); }}>Change password</button>}</div>
    {saved && <p role="status" className="profile-success">Password changed. Other sessions have been signed out.</p>}
    {error && <p role="alert" className="auth-message">{error}</p>}
    {editing ? <form className="profile-edit" onSubmit={save} onChange={event => { setError(''); event.currentTarget.elements.confirmPassword.setCustomValidity(''); }}>
      <label><span>Current password</span><input autoFocus type="password" name="currentPassword" autoComplete="current-password" required maxLength={256} disabled={busy} /></label>
      <label><span>New password</span><input type="password" name="newPassword" autoComplete="new-password" minLength={8} maxLength={256} required disabled={busy} aria-describedby="new-password-hint" /></label>
      <small id="new-password-hint" className="auth-hint">Use at least 8 characters, up to 72 bytes. Your other sessions will be signed out.</small>
      <label><span>Confirm new password</span><input type="password" name="confirmPassword" autoComplete="new-password" minLength={8} maxLength={256} required disabled={busy} /></label>
      <div className="action-row"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Updating...' : 'Update password'}</button><button type="button" className="btn ghost" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Cancel</button></div>
    </form> : <p className="panel-note">You’ll need your current password to set a new one.</p>}
  </section>;
}
