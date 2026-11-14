import React, { useEffect, useRef } from 'react';
import { getState, patchState, scanSummary, getSessionEpoch, selectCloudConnection } from './store.js';
import { streamPermissions, streamScan, streamScopeScan } from './api.js';
import { permissionReason } from './permissions.js';
import { formatDateTime, formatDuration } from './format.js';
import { Heading, Metric, Status } from './components.jsx';
export default function Scanner({ state }) {
  const input = useRef(null), log = useRef(null);
  const busy = ['checking', 'scanning'].includes(state.scanStatus);
  const ready = state.preflight?.all_permissions_granted;
  const connected = !!state.connectionId;
  const connection = state.connections?.find(c => c.id === state.connectionId);
  const parentScope = state.scopeType === 'folder' || state.scopeType === 'organization';
  const scopeLabel = state.scopeType === 'folder' ? 'Folder ID' : state.scopeType === 'organization' ? 'Organization ID' : 'Project ID';
  const hasScope = !!state.scopeId.trim() && (!parentScope || /^\d+$/.test(state.scopeId.trim()));
  const canScan = parentScope ? hasScope : ready;
  const missing = [...(state.preflight?.missing_permissions || []), ...(state.preflight?.invalid_permissions || [])];
  const summary = state.scanResult ? scanSummary(state.scanResult) : null;
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [state.scanLogs]);
  async function run(scan) {
    const current = getState();
    if (current.sampleMode || !current.connectionId) return;
    if (['checking', 'scanning'].includes(current.scanStatus) || (!scan && current.scopeType !== 'project') || (scan && current.scopeType === 'project' && !current.preflight?.all_permissions_granted)) return;
    const id = current.scopeId.trim();
    if (!id || ((current.scopeType === 'folder' || current.scopeType === 'organization') && !/^\d+$/.test(id))) {
      input.current.setCustomValidity(`Enter a valid Google Cloud ${current.scopeType} ID.`);
      input.current.reportValidity();
      return;
    }
    const started = Date.now();
    const epoch = getSessionEpoch();
    patchState({ scopeId: id, scanStatus: scan ? 'scanning' : 'checking', scanLogs: '', ...(!scan ? { preflight: null } : {}) });
    const append = message => { if (epoch === getSessionEpoch()) patchState({ scanLogs: getState().scanLogs + message + '\n' }); };
    try {
      const result = !scan
        ? await streamPermissions(id, current.connectionId, append)
        : current.scopeType === 'project'
          ? await streamScan(id, current.connectionId, append)
          : await streamScopeScan(current.scopeType, id, current.connectionId, append);
      if (epoch !== getSessionEpoch()) return;
      if (scan) {
        const now = new Date().toISOString();
        patchState({ scanResult: { ...result, lastScanTime: now }, lastScanTime: now, scanDurationMs: Date.now() - started, scanStatus: result.status || 'completed' });
      } else patchState({ preflight: result, scanStatus: 'idle' });
    } catch (error) { if (epoch !== getSessionEpoch()) return; append(`ERROR: ${error.message}`); patchState({ scanStatus: 'failed', ...(scan ? { scanDurationMs: Date.now() - started } : {}) }); }
  }
  return <div className="scanner-page">
    <section className="scanner-hero">
      <div className="scanner-hero-copy">
        <span className="eyebrow">SECURITY WORKSPACE / GCP SCANNER</span>
        <Heading title="Cloud Armor overview">Understand your public cloud perimeter. Verify access, scan a project or a parent scope, and see where protection is needed.</Heading>
        <div className="scanner-hero-meta">
          <span><i className="scanner-live-indicator" /> Google Cloud Platform</span>
          <span className="scanner-readonly"><span aria-hidden="true">⌑</span> Read-only scanning</span>
        </div>
      </div>
      <div className="scanner-hero-visual" aria-hidden="true">
        <span className="scanner-orbit scanner-orbit-outer" />
        <span className="scanner-orbit scanner-orbit-inner" />
        <span className="scanner-shield">✓</span>
        <span className="scanner-signal signal-one" />
        <span className="scanner-signal signal-two" />
      </div>
    </section>

    <div className="scanner-workspace">
      <section className="panel scanner-setup-card">
        <div className="scanner-section-heading">
          <span className="scanner-step-number">01</span>
          <div><h2>Choose scan scope</h2><p>Scan a project, folder, or organization.</p></div>
          <span className="quiet-badge">Setup</span>
        </div>

        {!state.sampleMode && <div className="scanner-connection-field">
          <label><span>Cloud connection</span><select value={state.connectionId} disabled={busy} onChange={e => selectCloudConnection(e.target.value)}><option value="">Select a GCP account</option>{(state.connections || []).filter(c => c.provider === 'gcp').map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <a className="scanner-manage-link" href="#/connections">Manage connections <span aria-hidden="true">↗</span></a>
        </div>}
        {!connected && !state.sampleMode && <p className="scanner-inline-note">Connect a Google Cloud account before checking permissions.</p>}

        <div className="scanner-scope-fields">
          <label><span>Scope type</span><select value={state.scopeType} disabled={busy || state.sampleMode} onChange={e => patchState({ scopeType: e.target.value, preflight: null })}>{['project', 'folder', 'organization'].map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>
          <label><span>{scopeLabel}</span><input ref={input} value={state.scopeId} disabled={busy || state.sampleMode} placeholder={parentScope ? 'Numeric Google Cloud resource ID' : 'e.g. production-project'} onChange={e => { e.target.setCustomValidity(''); patchState({ scopeId: e.target.value, preflight: null }); }} /></label>
        </div>
        {parentScope && <p className="panel-note">Folder and organization scans recursively discover descendant projects and folders. Projects without required access are skipped and reported. The connected identity needs project listing access and folder listing access for descendants.</p>}

        <div className="scanner-identity">
          <span className="scanner-identity-icon" aria-hidden="true">◈</span>
          <span><small>SCANNING IDENTITY</small><strong>{connection?.label || (state.sampleMode ? 'Sample data' : 'No account connected')}</strong></span>
          <span className={`scanner-identity-state${connected || state.sampleMode ? ' connected' : ''}`}><i />{connected || state.sampleMode ? 'Ready' : 'Not connected'}</span>
        </div>

        {!parentScope ? <div className="scanner-check-row">
          <button className="btn secondary" disabled={busy || state.sampleMode || !connected} onClick={() => run(false)}>{state.scanStatus === 'checking' ? 'Checking permissions...' : 'Check permissions'}</button>
          <span>We verify IAM access before scanning.</span>
        </div> : <p className="scanner-check-row">Required project permissions are checked individually for each discovered project during the scan.</p>}
        <div className="scanner-setup-guide">
          <div className="scanner-setup-guide-heading"><span>SETUP CHECKLIST</span><span>3 STEPS</span></div>
          <div className="scanner-setup-guide-items">
            <div><span>1</span><p><strong>Connect an account</strong><small>Use a Google Cloud identity with project read access.</small></p></div>
            <div><span>2</span><p><strong>Choose a scope</strong><small>Enter a project, folder, or organization ID.</small></p></div>
            <div><span>3</span><p><strong>Verify access</strong><small>Run a permission check before starting your scan.</small></p></div>
          </div>
        </div>
        {state.scanLogs && <pre ref={log} className="inline-log scanner-activity" aria-label="Scan activity">{state.scanLogs}</pre>}
      </section>

      <section className="panel scanner-run-card">
        <div className="scanner-section-heading">
          <span className="scanner-step-number">02</span>
          <div><h2>Security scan</h2><p>Discover public backends and inspect Cloud Armor coverage.</p></div>
          <Status value={state.scanStatus} />
        </div>

        <div className="scanner-readiness">
          <span className={`scanner-readiness-icon${canScan ? ' ready' : ''}`} aria-hidden="true">{canScan ? '✓' : '·'}</span>
          <span><strong>{parentScope ? (hasScope ? 'Scope ready to scan' : 'Scope ID required') : (ready ? 'Ready to scan' : 'Permission check required')}</strong><small>{parentScope ? 'Projects are discovered first, then resources are scanned across projects by level.' : (ready ? 'Required project permissions are in place.' : 'Verify project access to enable the security scan.')}</small></span>
        </div>

        <button className="btn primary large scanner-start-button" disabled={!canScan || busy || state.sampleMode || !connected} onClick={() => run(true)}>{state.scanStatus === 'scanning' ? 'Scanning your scope...' : <><span aria-hidden="true">↗</span> Start scan</>}</button>
        {state.scanStatus === 'scanning' && <div className="scan-pipeline scanner-progress" role="status"><span className="scanner-progress-indicator" /> {parentScope ? 'Discovering projects, then scanning resources across the scope by level.' : 'Discovering resources and checking Cloud Armor policies.'} Follow progress in the activity log.</div>}

        <div className="scanner-coverage">
          <div className="scanner-coverage-heading"><span>SCAN COVERAGE</span><span>GCP {state.scopeType.toUpperCase()}</span></div>
          <div className="scanner-coverage-items">
            <div className="scanner-coverage-item"><span className="coverage-icon" aria-hidden="true">↗</span><span><strong>Public entry points</strong><small>External HTTP(S) load balancers</small></span><i /></div>
            <div className="scanner-coverage-item"><span className="coverage-icon" aria-hidden="true">▤</span><span><strong>Traffic destinations</strong><small>Backend services and routing</small></span><i /></div>
            <div className="scanner-coverage-item"><span className="coverage-icon" aria-hidden="true">◇</span><span><strong>Protection controls</strong><small>Cloud Armor policy coverage</small></span><i /></div>
          </div>
        </div>

        <div className="metric-grid three compact scanner-run-metrics">
          <Metric label="Last scan" value={formatDateTime(state.lastScanTime)} />
          <Metric label="Duration" value={formatDuration(state.scanDurationMs)} />
          <Metric label="Result" value={state.scanResult?.message || 'No scan results yet'} />
        </div>

        {summary && <>
          <div className="scanner-results-heading"><span>SCAN RESULTS</span><span>{state.scanResult.project_id || state.scopeId}</span></div>
          {state.scanResult.project_ids?.length > 0 && <p className="panel-note">Discovered {state.scanResult.project_ids.length} project(s); scanned {state.scanResult.scanned_project_ids?.length || 0} accessible project(s).</p>}
          {state.scanResult.skipped_projects?.length > 0 && <div className="warning-panel"><h3>Projects skipped</h3><ul className="warning-list">{state.scanResult.skipped_projects.map(item => <li key={item.project_id}><code>{item.project_id}</code><p>{item.reason}</p></li>)}</ul></div>}
          {state.scanResult.skipped_scopes?.length > 0 && <div className="warning-panel"><h3>Folders skipped</h3><ul className="warning-list">{state.scanResult.skipped_scopes.map((item, index) => <li key={`${item.resource}-${index}`}><code>{item.resource}</code><p>{item.reason}</p></li>)}</ul></div>}
          <div className="metric-grid four scanner-result-metrics">
            <Metric label="Load balancers" value={summary.loadBalancers} />
            <Metric label="Backend services" value={summary.backendServices} />
            <Metric label="Protected" value={summary.protectedBackends} />
            <Metric label="Unprotected" value={summary.unprotectedBackends} />
          </div>
          <div className="scanner-result-links"><a className="btn ghost" href="#/unprotected">View backends</a><a className="btn ghost" href="#/flow">Explore traffic flow</a></div>
        </>}
      </section>

      {state.preflight && <section className={`panel scanner-permission-card${ready ? ' permissions-ready' : ' permissions-attention'}`}>
        <div className="scanner-section-heading">
          <span className="scanner-step-number">03</span>
          <div><h2>Permission status</h2><p>Access verification for this project.</p></div>
          <Status value={ready ? 'ready' : 'not-ready'} />
        </div>
        <div className="metric-grid four scanner-permission-metrics">
          <Metric label="Scanning identity" value={state.preflight.service_account_email || connection?.label} />
          <Metric label="Scope" value={state.scopeId} />
          <Metric label="Granted" value={(state.preflight.permissions || []).filter(p => p.status === 'GRANTED').length} />
          <Metric label="Missing" value={missing.length} />
        </div>
        {missing.length ? <div className="warning-panel"><h3>Missing permissions</h3><ul className="warning-list">{missing.map((p, i) => <li key={i}><code>{p}</code><p>{permissionReason(p)}</p></li>)}</ul></div> : <p className="panel-note">{ready ? 'All required permissions are granted. You can start a scan.' : 'Permission verification is incomplete. Check access and try again.'}</p>}
      </section>}
    </div>
  </div>;
}
