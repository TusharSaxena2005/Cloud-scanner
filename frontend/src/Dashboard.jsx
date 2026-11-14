import React from 'react';
import { scanSummary, flattenBackends } from './store.js';
import { Heading, Metric } from './components.jsx';
import { formatDateTime } from './format.js';

export default function Dashboard({ state, user, onInspectResource }) {
  const summary = state.scanResult ? scanSummary(state.scanResult) : null;
  const backends = state.scanResult ? flattenBackends(state.scanResult) : [];
  const unprotectedList = backends.filter(b => b.status === 'UNPROTECTED');
  const protectedList = backends.filter(b => b.status === 'PROTECTED');

  const totalBackends = summary?.totalPublicBackends || 0;
  const protectionPct = totalBackends > 0
    ? Math.round((summary.protectedBackends / totalBackends) * 100)
    : 0;

  const hasResults = !!state.scanResult;

  const uniquePolicies = new Set();
  const edgePolicies = new Set();
  const previewPolicies = new Set();
  if (state.scanResult?.load_balancers) {
    for (const lb of state.scanResult.load_balancers) {
      for (const entry of lb.backend_services || []) {
        if (entry.security_policy?.name) {
          uniquePolicies.add(entry.security_policy.name);
          const rules = entry.security_policy.details?.rules || [];
          if (rules.some(r => r.preview)) {
            previewPolicies.add(entry.security_policy.name);
          }
        }
        if (entry.edge_security_policy?.name) {
          uniquePolicies.add(entry.edge_security_policy.name);
          edgePolicies.add(entry.edge_security_policy.name);
        }
      }
    }
  }
  const edgePolicyServices = backends.filter(item => item.backendNode?.edge_security_policy?.name && !item.backendNode.edge_security_policy.error).length;

  return (
    <div className="dashboard-page">
      <div className="dashboard-header-row">
        <div>
          <span className="eyebrow">SECURITY WORKSPACE / DASHBOARD</span>
          <Heading title="Cloud Security Posture">
            Real-time visibility into external attack surface, public load balancers, and Cloud Armor protections.
          </Heading>
        </div>
        <div className="dashboard-actions">
          <a href="#/scanner" className="btn primary">
            Scan Project
          </a>
          <a href="#/unprotected" className="btn secondary">
            View Unprotected
          </a>
        </div>
      </div>

      {hasResults ? (
        <>
          <section className="panel dashboard-posture-panel">
            <div className="posture-summary-header">
              <div className="posture-headline">
                <span className="posture-kicker">OVERALL PERIMETER HEALTH</span>
                <h2>
                  {unprotectedList.length === 0 ? (
                    <span className="text-success">All Public Backends Protected</span>
                  ) : (
                    <span className="text-warning">{unprotectedList.length} Exposed Backend{unprotectedList.length > 1 ? 's' : ''} Need Protection</span>
                  )}
                </h2>
                <p className="posture-subtext">
                  Scope: <strong>{state.scopeId === 'all-projects' ? 'All Organization Projects' : (state.scopeId || 'Active Project')}</strong>
                  {state.lastScanTime && <> · Last analyzed: {formatDateTime(state.lastScanTime)}</>}
                </p>
              </div>
              <div className="posture-score-badge">
                <div className="score-ring">
                  <span className="score-number">{protectionPct}%</span>
                  <span className="score-label">Protected</span>
                </div>
              </div>
            </div>

            <div className="posture-bar-wrapper">
              <div className="posture-bar" role="progressbar" aria-valuenow={protectionPct} aria-valuemin="0" aria-valuemax="100">
                <div
                  className="posture-bar-protected"
                  style={{ width: `${protectionPct}%` }}
                  title={`${summary.protectedBackends} protected backends (${protectionPct}%)`}
                />
                <div
                  className="posture-bar-unprotected"
                  style={{ width: `${100 - protectionPct}%` }}
                  title={`${summary.unprotectedBackends} unprotected backends (${100 - protectionPct}%)`}
                />
              </div>
              <div className="posture-bar-legend">
                <span><span className="legend-dot protected" /> {summary.protectedBackends} Protected with WAF</span>
                <span><span className="legend-dot unprotected" /> {summary.unprotectedBackends} Unprotected & Exposed</span>
              </div>
            </div>
          </section>

          <div className="metric-grid four">
            <div className="metric-card">
              <span>Public Load Balancers</span>
              <strong>{summary.loadBalancers}</strong>
            </div>
            <div className="metric-card">
              <span>Backend Services</span>
              <strong>{summary.backendServices}</strong>
            </div>
            <div className="metric-card success">
              <span>Protected by Cloud Armor</span>
              <strong style={{ color: 'var(--success)' }}>{summary.protectedBackends}</strong>
            </div>
            <div className={`metric-card ${summary.unprotectedBackends > 0 ? 'metric-alert' : ''}`}>
              <span>Unprotected Backends</span>
              <strong style={{ color: summary.unprotectedBackends > 0 ? 'var(--danger)' : 'var(--text)' }}>
                {summary.unprotectedBackends}
              </strong>
            </div>
          </div>

          <div className="dashboard-grid two">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Unprotected Backends Attention List</h2>
                  <p className="panel-subtitle">External HTTP(S) services without active Cloud Armor security policies.</p>
                </div>
                {unprotectedList.length > 0 && (
                  <span className="status-pill not-ready">{unprotectedList.length} EXPOSED</span>
                )}
              </div>

              {unprotectedList.length === 0 ? (
                <div className="dashboard-safe-box">
                  <span className="safe-icon">✓</span>
                  <div>
                    <strong>Zero unprotected backends discovered</strong>
                    <p>Every public backend route in this scope has an active Cloud Armor policy applied.</p>
                  </div>
                </div>
              ) : (
                <div className="dashboard-alert-list">
                  {unprotectedList.slice(0, 5).map((item, idx) => (
                    <div key={idx} className="dashboard-alert-item">
                      <div className="alert-item-info">
                        <strong>{item.backendService}</strong>
                        <span className="alert-item-meta">
                          LB: <code>{item.loadBalancer}</code> · Rule: <code>{item.forwardingRule}</code>
                          {item.project && item.project !== state.scopeId && <> · Project: <code>{item.project}</code></>}
                        </span>
                      </div>
                      {item.backendNode?.backend_service && onInspectResource && (
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => onInspectResource({
                            type: 'Backend Service',
                            name: item.backendNode.backend_service.name || item.backendService,
                            status: item.status,
                            details: item.backendNode.backend_service,
                            chain: [
                              ['Project', item.project],
                              ['Load Balancer', item.loadBalancer],
                              ['Forwarding Rule', item.forwardingRule],
                              ['Target Proxy', item.hierarchy.target_proxy?.name],
                              ['URL Map', item.hierarchy.url_map?.name],
                              ['Backend Service', item.backendService],
                              ['Cloud Armor Policy', item.cloudArmorPolicy],
                            ],
                          })}
                        >
                          Inspect
                        </button>
                      )}
                    </div>
                  ))}
                  {unprotectedList.length > 5 && (
                    <div className="dashboard-list-footer">
                      <span>And {unprotectedList.length - 5} more unprotected backends</span>
                      <a href="#/unprotected" className="btn ghost small">View All Unprotected →</a>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Cloud Armor policy summary</h2>
                  <p className="panel-subtitle">Policy names and backend services found in this scan. These counts measure different things.</p>
                </div>
                <span className="quiet-badge">{uniquePolicies.size} unique policies</span>
              </div>

              <div className="policy-stats-list">
                <div className="policy-stat-row">
                  <div>
                    <strong>Backend services with a policy</strong>
                    <p className="panel-note" style={{ margin: 0 }}>Services with a Cloud Armor backend policy attached. This counts services, not unique policies.</p>
                  </div>
                  <span className="stat-pill">{protectedList.length} {protectedList.length === 1 ? 'service' : 'services'}</span>
                </div>

                <div className="policy-stat-row">
                  <div>
                    <strong>Backend services with an edge policy</strong>
                    <p className="panel-note" style={{ margin: 0 }}>Services linked to a Cloud Armor edge policy. Counted separately from backend policies.</p>
                  </div>
                  <span className="stat-pill">
                    {edgePolicyServices} {edgePolicyServices === 1 ? 'service' : 'services'} · {edgePolicies.size} {edgePolicies.size === 1 ? 'policy' : 'policies'}
                  </span>
                </div>

                {previewPolicies.size > 0 && (
                  <div className="policy-stat-row warn">
                    <div>
                      <strong>Backend policies with preview rules</strong>
                      <p className="panel-note warn" style={{ margin: 0 }}>
                        {previewPolicies.size} unique {previewPolicies.size === 1 ? 'policy has' : 'policies have'} at least one preview rule. Preview rules are evaluated but do not enforce their action.
                      </p>
                    </div>
                    <span className="stat-pill">{previewPolicies.size} {previewPolicies.size === 1 ? 'policy' : 'policies'}</span>
                  </div>
                )}
              </div>

              <div className="action-row" style={{ marginTop: 20 }}>
                <a href="#/flow" className="btn secondary">
                  Explore Traffic Flow & Policies →
                </a>
              </div>
            </section>
          </div>

          <div className="dashboard-nav-grid">
            <a href="#/scanner" className="dashboard-nav-card">
              <div className="nav-card-icon">🔍</div>
              <div>
                <strong>Live Security Scanner</strong>
                <p>Run real-time scans on GCP projects to verify IAM access and detect external resources.</p>
              </div>
            </a>
            <a href="#/unprotected" className="dashboard-nav-card">
              <div className="nav-card-icon">⚠️</div>
              <div>
                <strong>Unprotected Backends</strong>
                <p>Filter, search, and audit exposed infrastructure missing Cloud Armor policies.</p>
              </div>
            </a>
            <a href="#/flow" className="dashboard-nav-card">
              <div className="nav-card-icon">⚡</div>
              <div>
                <strong>Traffic Flow Visualizer</strong>
                <p>Interactive tree mapping forwarding rules, proxies, URL maps, backends, and WAF rules.</p>
              </div>
            </a>
            <a href="#/connections" className="dashboard-nav-card">
              <div className="nav-card-icon">☁️</div>
              <div>
                <strong>Cloud Connections</strong>
                <p>Authorize and manage user-delegated Google Cloud access tokens securely.</p>
              </div>
            </a>
          </div>
        </>
      ) : (
        <section className="panel empty-state dashboard-welcome">
          <span className="empty-symbol" aria-hidden="true">🛡️</span>
          <h2>Welcome to CloudScanner</h2>
          <p>
            Your cloud perimeter visibility hub. Scan public Google Cloud infrastructure to instantly detect unprotected backend services and verify Cloud Armor WAF coverage.
          </p>
          <div className="action-row" style={{ justifyContent: 'center' }}>
            <a className="btn primary large" href="#/scanner">Go to Scanner</a>
            <a className="btn secondary large" href="#/connections">Connect Google Cloud</a>
          </div>
        </section>
      )}
    </div>
  );
}
