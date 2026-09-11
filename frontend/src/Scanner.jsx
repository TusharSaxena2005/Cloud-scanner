import React, { useEffect, useRef } from 'react';
import { getState, patchState, scanSummary, getSessionEpoch } from './store.js';
import { streamPermissions, streamScan } from './api.js';
import { permissionReason } from './permissions.js';
import { formatDateTime, formatDuration } from './format.js';
import { Heading, Metric, Status } from './components.jsx';
export default function Scanner({ state }) {
  const input = useRef(null), log = useRef(null);
  const busy = ['checking', 'scanning'].includes(state.scanStatus);
  const ready = state.preflight?.all_permissions_granted;
  const unsupported = state.scopeType !== 'project';
  const missing = [...(state.preflight?.missing_permissions || []), ...(state.preflight?.invalid_permissions || [])];
  const summary = state.scanResult ? scanSummary(state.scanResult) : null;
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [state.scanLogs]);
  async function run(scan) {
    const current = getState();
    if (current.sampleMode) return;
    if (['checking', 'scanning'].includes(current.scanStatus) || current.scopeType !== 'project' || (scan && !current.preflight?.all_permissions_granted)) return;
    const id = current.scopeId.trim();
    if (!id) { input.current.setCustomValidity('Enter a Google Cloud project ID.'); input.current.reportValidity(); return; }
    const started = Date.now();
    const epoch = getSessionEpoch();
    patchState({ scopeId: id, scanStatus: scan ? 'scanning' : 'checking', scanLogs: '', ...(!scan ? { preflight: null } : {}) });
    const append = message => { if (epoch === getSessionEpoch()) patchState({ scanLogs: getState().scanLogs + message + '\n' }); };
    try {
      const result = await (scan ? streamScan(id, append) : streamPermissions(id, append));
      if (epoch !== getSessionEpoch()) return;
      if (scan) {
        const now = new Date().toISOString();
        patchState({ scanResult: { ...result, lastScanTime: now }, lastScanTime: now, scanDurationMs: Date.now() - started, scanStatus: result.status || 'completed' });
      } else patchState({ preflight: result, scanStatus: 'idle' });
    } catch (error) { if (epoch !== getSessionEpoch()) return; append(`ERROR: ${error.message}`); patchState({ scanStatus: 'failed', ...(scan ? { scanDurationMs: Date.now() - started } : {}) }); }
  }
  return <><span className="eyebrow">SECURITY WORKSPACE / SCANNER</span><Heading title="Cloud Armor overview">Connect a GCP project, verify permissions, and discover your Cloud Armor coverage.</Heading>
    <section className="panel"><div className="panel-header"><div><h2>Connect to Google Cloud</h2><p className="panel-subtitle">Choose a project and verify access to get started.</p></div><span className="quiet-badge">Read-only scan</span></div>
      <div className="form-grid"><label><span>GCP scope type</span><select value={state.scopeType} disabled={busy || state.sampleMode} onChange={e => patchState({ scopeType: e.target.value, preflight: null })}>{['project', 'folder', 'organization'].map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label><label><span>Project ID</span><input ref={input} value={state.scopeId} disabled={busy || state.sampleMode} placeholder="my-gcp-project" onChange={e => { e.target.setCustomValidity(''); patchState({ scopeId: e.target.value, preflight: null }); }} /></label></div>
      {unsupported && <p className="panel-note warn">Folder and organization scans are not yet supported. Choose Project.</p>}
      <div className="info-row"><span className="info-label">Service account</span><code>{state.serviceAccount?.email || 'Loading...'}</code></div>
      <div className="action-row"><button className="btn secondary" disabled={busy || unsupported || state.sampleMode} onClick={() => run(false)}>{state.scanStatus === 'checking' ? 'Checking permissions...' : 'Check permissions'}</button></div>
      {state.scanLogs && <pre ref={log} className="inline-log" aria-label="Scan activity">{state.scanLogs}</pre>}
    </section>
    {state.preflight && <section className="panel"><div className="panel-header"><h2>Permission status</h2><Status value={ready ? 'ready' : 'not-ready'} /></div><div className="metric-grid four"><Metric label="Service account" value={state.preflight.service_account_email || state.serviceAccount?.email} /><Metric label="Scope" value={state.scopeId} /><Metric label="Granted" value={(state.preflight.permissions || []).filter(p => p.status === 'GRANTED').length} /><Metric label="Missing" value={missing.length} /></div>{missing.length ? <div className="warning-panel"><h3>Missing permissions</h3><ul className="warning-list">{missing.map((p, i) => <li key={i}><code>{p}</code><p>{permissionReason(p)}</p></li>)}</ul></div> : <p className="panel-note">{ready ? 'All required permissions are granted. You can start a scan.' : 'Permission verification is incomplete. Check access and try again.'}</p>}</section>}
    <section className="panel"><div className="panel-header"><div><h2>Security scan</h2><p className="panel-subtitle">Discover public backends and inspect Cloud Armor coverage.</p></div><Status value={state.scanStatus} /></div><div className="metric-grid three compact"><Metric label="Last scan" value={formatDateTime(state.lastScanTime)} /><Metric label="Duration" value={formatDuration(state.scanDurationMs)} /><Metric label="Status" value={state.scanResult?.message || 'No scan results yet'} /></div><div className="action-row"><button className="btn primary large" disabled={!ready || busy || unsupported || state.sampleMode} onClick={() => run(true)}>{state.scanStatus === 'scanning' ? 'Scanning...' : 'Start scan'}</button></div>{!ready && <p className="panel-note">Check project permissions to enable scanning.</p>}{state.scanStatus === 'scanning' && <div className="scan-pipeline" role="status">Discovering resources and checking Cloud Armor policies. Follow progress in the activity log above.</div>}{summary && <><div className="metric-grid four" style={{ marginTop: 20 }}><Metric label="Load balancers" value={summary.loadBalancers} /><Metric label="Backend services" value={summary.backendServices} /><Metric label="Protected backends" value={summary.protectedBackends} /><Metric label="Unprotected backends" value={summary.unprotectedBackends} /></div><div className="action-row"><a className="btn ghost" href="#/unprotected">View backends</a><a className="btn ghost" href="#/flow">Explore traffic flow</a></div></>}</section>
  </>;
}
