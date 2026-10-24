import React, { useState } from 'react';
import { updateProfile } from './api.js';
import { Heading } from './components.jsx';
export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.filter((_, index) => index === 0 || index === parts.length - 1).map(part => Array.from(part)[0]).join('').toUpperCase() || '?';
}
export default function Profile({ user, onUpdated }) {
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setMessage(''); setError('');
    try { const result = await updateProfile({ name: name.trim() }); onUpdated(result.user); setMessage('Profile updated successfully.'); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }
  return <div className="profile-page"><a className="auth-back" href="#/scanner">Back to scanner</a><Heading title="Your profile" />
    <section className="panel profile-summary" aria-label="Account summary"><span className="profile-avatar user-initials profile-large" aria-hidden="true">{initials(user.name)}</span><div><h2>{user.name}</h2><p>{user.email}</p></div><span className="quiet-badge">{user.is_demo ? 'Demo account' : 'Google account'}</span></section>
    <section className="panel"><div className="panel-header"><h2>Account information</h2></div>
      <form className="profile-edit" onSubmit={save}><label><span>Full name</span><input value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={saving} /></label><label><span>Email address</span><input value={user.email} type="email" readOnly /></label><p className="panel-note">Your sign-in email and password are managed by Google.</p>{message && <p role="status">{message}</p>}{error && <p role="alert" className="auth-message">{error}</p>}<div className="action-row"><button className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button></div></form>
      <a href="#/connections" className="btn secondary">Manage cloud connections</a>
    </section></div>;
}
