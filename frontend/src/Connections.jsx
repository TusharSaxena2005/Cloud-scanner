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
  const connections = (state.connections || []).filter(connection => connection.provider === 'gcp');

  async function connect() {
    if (busy || !workspaceId) return;
    setBusy(true);
    setError('');
    try {
      const result = await connectGcp(workspaceId);
      window.location.assign(result.url);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function disconnect(id) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await disconnectCloud(id);
      const result = await fetchConnections();
      patchState({ connections: result.connections });
      if (state.connectionId === id) {
        selectCloudConnection(result.connections[0]?.id || '', { preserveResults: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="connections-page">
    <span className="eyebrow">WORKSPACE / CLOUD CONNECTIONS</span>
    <div className="connections-hero">
      <div className="connections-hero-copy">
        <span className="connections-hero-label"><span className="connection-live-dot" /> CLOUD ACCESS</span>
        <Heading title="Cloud connections">Bring your cloud accounts into one secure workspace. Choose which account powers your scans.</Heading>
        <div className="connections-hero-actions">
          <a className="btn primary" href="#/scanner">Open scanner <span aria-hidden="true">→</span></a>
          <span className="connections-readonly"><span aria-hidden="true">⌑</span> Read-only access</span>
        </div>
      </div>
      <div className="connections-hero-art" aria-hidden="true">
        <div className="connection-orbit connection-orbit-one" />
        <div className="connection-orbit connection-orbit-two" />
        <div className="connection-cloud"><span /><span /><span /></div>
        <div className="connection-art-node node-google">G</div>
        <div className="connection-art-node node-shield">✓</div>
        <div className="connection-art-line" />
      </div>
    </div>

    {(error || oauthError) && <p role="alert" className="auth-message">{error || oauthError}</p>}
    {demo && <p className="connections-demo-note"><strong>Demo workspace</strong><span>Sample data only — connecting cloud accounts is disabled.</span></p>}

    <div className="connections-section-heading">
      <div><span className="eyebrow">YOUR CLOUD</span><h2>Accounts & providers</h2></div>
      <span className="connections-count">{connections.length} connected {connections.length === 1 ? 'account' : 'accounts'}</span>
    </div>

    <div className="connections-layout">
      <section className="panel connections-provider-card">
        <div className="connections-provider-heading">
          <div className="provider-logo gcp-logo" aria-hidden="true"><span>G</span></div>
          <div className="provider-title"><h3>Google Cloud</h3><p>Discover load balancers and Cloud Armor coverage.</p></div>
          <span className="quiet-badge">Available now</span>
        </div>

        <div className="connections-workspace">
          <label htmlFor="connection-workspace"><span>Connect to workspace</span></label>
          <select id="connection-workspace" value={workspaceId} disabled={busy || demo} onChange={event => setWorkspace(event.target.value)}>
            {!state.workspaces?.length && <option value="">No workspace available</option>}
            {(state.workspaces || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button className="btn primary" disabled={busy || demo || !workspaceId} onClick={connect}>
            {busy ? 'Please wait...' : <><span aria-hidden="true">+</span> Connect GCP</>}
          </button>
        </div>

        <div className="connections-security-note">
          <span className="security-note-icon" aria-hidden="true">✓</span>
          <p>Authorize with Google to grant <strong>read-only cloud access</strong>. Your website sign-in and cloud permissions are managed separately.</p>
        </div>

        <div className="connections-divider"><span>CONNECTED ACCOUNTS</span></div>
        {connections.length ? <div className="connected-account-list">
          {connections.map(connection => {
            const selected = state.connectionId === connection.id;
            const workspaceName = state.workspaces?.find(item => item.id === connection.workspace_id)?.name || 'Workspace';
            return <article className={`connected-account${selected ? ' is-selected' : ''}`} key={connection.id}>
              <div className="connected-account-icon" aria-hidden="true">G</div>
              <div className="connected-account-details">
                <strong title={connection.label}>{connection.label}</strong>
                <span>{workspaceName}</span>
              </div>
              <span className={`connection-state${selected ? ' active' : ''}`}><span />{selected ? 'Selected for scans' : 'Connected'}</span>
              <div className="connected-account-actions">
                {!selected && <button className="btn secondary" disabled={busy} onClick={() => selectCloudConnection(connection.id)}>Use for scans</button>}
                <button className="btn ghost" disabled={busy} onClick={() => disconnect(connection.id)}>Disconnect</button>
              </div>
            </article>;
          })}
        </div> : <div className="connections-empty">
          <span className="connections-empty-icon" aria-hidden="true">G</span>
          <div><strong>No Google Cloud accounts yet</strong><p>Connect an account to start checking project permissions and scanning resources.</p></div>
        </div>}
        <p className="connections-revoke-note">Disconnect removes this workspace's stored access. To revoke Google's authorization entirely, use your Google Account settings.</p>
      </section>

      <aside className="connections-howto panel">
        <span className="connections-howto-icon" aria-hidden="true">⌘</span>
        <span className="eyebrow">SIMPLE BY DESIGN</span>
        <h3>How connections work</h3>
        <ol className="connections-steps">
          <li><span>01</span><div><strong>Choose a workspace</strong><p>Keep cloud access organized by team or project.</p></div></li>
          <li><span>02</span><div><strong>Authorize with Google</strong><p>Approve read-only access for resource discovery.</p></div></li>
          <li><span>03</span><div><strong>Scan with confidence</strong><p>We check IAM permissions before every scan.</p></div></li>
        </ol>
        <div className="connections-privacy"><span aria-hidden="true">◈</span><p>Cloud tokens are encrypted and stay on the backend. CloudScanner never receives your Google password.</p></div>
      </aside>
    </div>

    <section className="connections-roadmap">
      <div className="connections-section-heading">
        <div><span className="eyebrow">ON THE ROADMAP</span><h2>More clouds, one view</h2></div>
        <span className="roadmap-caption">Additional providers are in development</span>
      </div>
      <div className="connections-future-grid">
        <article className="future-provider-card"><span className="future-provider-logo aws-logo" aria-hidden="true">AWS</span><div><h3>Amazon Web Services</h3><p>Account connections and resource scanning are coming later.</p></div><span className="future-badge">Coming soon</span></article>
        <article className="future-provider-card"><span className="future-provider-logo azure-logo" aria-hidden="true">Azure</span><div><h3>Microsoft Azure</h3><p>Account connections and resource scanning are coming later.</p></div><span className="future-badge">Coming soon</span></article>
      </div>
    </section>
  </div>;
}
