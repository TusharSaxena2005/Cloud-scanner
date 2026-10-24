import React, { useState } from 'react';
import { connectGcp, disconnectCloud, fetchConnections } from './api.js';
import { patchState, selectCloudConnection } from './store.js';
import { Heading } from './components.jsx';

export default function Connections({ state, demo }) {
  const [workspace, setWorkspace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const workspaceId = workspace || state.workspaces?.[0]?.id || '';
  const oauthError = new URLSearchParams(location.hash.split('?')[1] || '').get('oauth_error');
  async function connect() {
    if (busy || !workspaceId) return;
    setBusy(true); setError('');
    try { const result = await connectGcp(workspaceId); window.location.assign(result.url); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  async function disconnect(id) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await disconnectCloud(id);
      const result = await fetchConnections();
      patchState({ connections: result.connections });
      if (state.connectionId === id) selectCloudConnection(result.connections[0]?.id || '');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <><span className="eyebrow">WORKSPACE / CLOUD CONNECTIONS</span>
    <Heading title="Cloud connections">Connect cloud accounts independently of your website sign-in.</Heading>
    {(error || oauthError) && <p role="alert" className="auth-message">{error || oauthError}</p>}
    {demo && <p className="panel-note">Demo accounts use sample data and cannot connect cloud accounts.</p>}
    <section className="panel"><div className="panel-header"><div><h2>Google Cloud</h2><p className="panel-subtitle">Scan with your Google account's existing project permissions.</p></div><span className="quiet-badge">Available</span></div>
      <label><span>Workspace</span><select value={workspaceId} disabled={busy || demo} onChange={e => setWorkspace(e.target.value)}>{!state.workspaces?.length && <option value="">No workspace available</option>}{(state.workspaces || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <p className="panel-note">Connect the same Google account you use to sign in. Approve read-only cloud access, then check your project's permissions in Scanner.</p>
      <div className="action-row"><button className="btn primary" disabled={busy || demo || !workspaceId} onClick={connect}>{busy ? 'Please wait...' : 'Connect GCP'}</button></div>
      {(state.connections || []).filter(c => c.provider === 'gcp').map(c => <div className="connection-row" key={c.id}><div><strong>{c.label}</strong><p className="panel-note">{state.workspaces?.find(w => w.id === c.workspace_id)?.name || 'Workspace'}</p></div><button className="btn secondary" disabled={busy} onClick={() => disconnect(c.id)}>Disconnect</button></div>)}
      {!state.connections?.length && <p className="panel-note">No cloud accounts connected yet.</p>}
      <p className="panel-note">Disconnect removes stored access from this workspace. You can also revoke the application's grant in your Google account settings.</p>
    </section>
    <div className="metric-grid two">{['AWS', 'Azure'].map(provider => <section className="panel" key={provider}><h2>{provider}</h2><span className="quiet-badge">Coming later</span><p className="panel-note">Connections and scanning are not available yet.</p></section>)}</div>
    <a href="#/scanner" className="btn secondary">Go to scanner</a>
  </>;
}
