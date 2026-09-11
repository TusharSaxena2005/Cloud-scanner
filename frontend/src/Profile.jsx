import React, { useState } from 'react';
import { updateProfile } from './api.js';
import ChangePassword from './ChangePassword.jsx';
import { Heading } from './components.jsx';
export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.filter((_, index) => index === 0 || index === parts.length - 1).map(part => Array.from(part)[0]).join('').toUpperCase() || '?';
}
export default function Profile({ user, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();
  function edit() { setName(user.name); setEmail(user.email); setPassword(''); setError(''); setSaved(false); setEditing(true); }
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) { setError('Enter your full name.'); return; }
    setSaving(true); setError('');
    try {
      const result = await updateProfile({ name: name.trim(), email: email.trim(), ...(emailChanged ? { current_password: password } : {}) });
      onUpdated(result.user); setEditing(false); setPassword(''); setSaved(true);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }
  return <div className="profile-page">
    <a className="auth-back" href="#/scanner">← Back to scanner</a>
    <Heading title="Your profile">Your account details and workspace access.</Heading>
    <section className="panel profile-summary" aria-label="Account summary">
      <span className="profile-avatar user-initials profile-large" aria-hidden="true">{initials(user.name)}</span>
      <div><h2>{user.name}</h2><p>{user.email}</p><span className="quiet-badge">{user.is_demo ? 'Demo account' : 'Personal account'}</span></div>
    </section>
    <section className="panel"><div className="panel-header"><h2>Account information</h2>{!editing && <button className="btn secondary" onClick={edit}>Edit profile</button>}</div>
      {saved && <p role="status" className="profile-success">Profile updated successfully.</p>}
      {error && <p role="alert" className="auth-message">{error}</p>}
      {editing ? <form className="profile-edit" onSubmit={save}><label><span>Full name</span><input autoFocus autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={100} required disabled={saving} /></label><label><span>Email address</span><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={saving} /></label>{emailChanged && <label><span id="profile-password-label">Current password</span><input aria-labelledby="profile-password-label" aria-describedby="profile-password-hint" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} maxLength={256} required disabled={saving} /><small id="profile-password-hint" className="panel-note">Confirm your password to change your sign-in email.</small></label>}<div className="action-row"><button className="btn primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button><button className="btn ghost" type="button" disabled={saving} onClick={() => { setEditing(false); setPassword(''); setError(''); }}>Cancel</button></div></form> : (
      <dl className="resource-fields"><div className="resource-field"><dt>Full name</dt><dd>{user.name}</dd></div><div className="resource-field"><dt>Email address</dt><dd>{user.email}</dd></div><div className="resource-field"><dt>Workspace access</dt><dd>{user.is_demo ? 'Sample projects only' : 'Google Cloud scanning'}</dd></div></dl>)}
      <p className="panel-note">{user.is_demo ? 'Explore sample resources using the demo projects. Live cloud scans are disabled for this account.' : 'Live scans use the configured service account and require project permissions.'}</p>
    </section>
    <ChangePassword />
  </div>;
}
