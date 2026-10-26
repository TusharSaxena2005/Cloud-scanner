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
        }
      }
    }
  }

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
                          onClick={() => onInspectResource(item.backendNode.backend_service)}
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
                  <h2>WAF & Edge Policy Coverage</h2>
                  <p className="panel-subtitle">Distribution of security controls safeguarding ingress traffic.</p>
                </div>
                <span className="quiet-badge">{uniquePolicies.size} Policies</span>
              </div>

              <div className="policy-stats-list">
                <div className="policy-stat-row">
                  <div>
                    <strong>Standard Cloud Armor Backend Policies</strong>
                    <p className="panel-note" style={{ margin: 0 }}>Layer 7 WAF inspection applied to backend services.</p>
                  </div>
                  <span className="stat-pill">{protectedList.filter(p => p.cloudArmorPolicy !== 'No Policy').length} applied</span>
                </div>

                <div className="policy-stat-row">
                  <div>
                    <strong>Cloud Armor Edge Policies (CDN)</strong>
                    <p className="panel-note" style={{ margin: 0 }}>Protection evaluated at Google Cloud edge cache locations.</p>
                  </div>
                  <span className="stat-pill">
                    {protectedList.filter(p => p.edgePolicy).length} edge policies
                  </span>
                </div>

                {previewPolicies.size > 0 && (
                  <div className="policy-stat-row warn">
                    <div>
                      <strong>Policies in Preview Mode</strong>
                      <p className="panel-note warn" style={{ margin: 0 }}>
                        {previewPolicies.size} policy is running rules in preview/dry-run mode without blocking traffic.
                      </p>
                    </div>
                    <span className="status-pill checking">PREVIEW</span>
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
