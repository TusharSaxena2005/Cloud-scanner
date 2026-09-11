import React from 'react';
export function Heading({ title, children }) { return <div className="page-header"><h1>{title}</h1><p>{children}</p></div>; }
export function Empty() { return <section className="panel empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>No scan results yet</h2><p>Run a scan to explore your Google Cloud resources and their protection.</p><a className="btn primary" href="#/scanner">Go to scanner</a></section>; }
export function Metric({ label, value }) { return <div className="metric-card"><span>{label}</span><strong>{value ?? '—'}</strong></div>; }
export function Status({ value }) { return <span className={`status-pill ${value === 'PROTECTED' ? 'ready' : value === 'UNPROTECTED' ? 'not-ready' : value.toLowerCase()}`}>{value.toUpperCase()}</span>; }
