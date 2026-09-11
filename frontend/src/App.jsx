import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { getState, subscribe, patchState, resetState } from './store.js';
import { fetchServiceAccount, currentUser, signOut } from './api.js';
import { Status } from './components.jsx';
import Scanner from './Scanner.jsx';
import Flow from './Flow.jsx';
import Backends from './Backends.jsx';
import Drawer from './Drawer.jsx';
import Auth from './Auth.jsx';
import DemoProjects from './DemoProjects.jsx';
import Profile, { initials } from './Profile.jsx';
const routes = { scanner: 'Scanner', unprotected: 'Unprotected Backends', flow: 'Load Balancer Flow' };
const currentRoute = () => (Object.hasOwn(routes, location.hash.slice(2)) || ['login', 'signup', 'profile'].includes(location.hash.slice(2))) ? location.hash.slice(2) : 'scanner';
export default function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const [route, setRoute] = useState(currentRoute);
  const [drawer, setDrawer] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const change = () => { setRoute(currentRoute()); setDrawer(null); };
    window.addEventListener('hashchange', change);
    resetState();
    currentUser().then(result => { if (result.user.sample_workspace) patchState(result.user.sample_workspace); setUser(result.user); }).catch(err => { if (err.status !== 401) setError(err.message); }).finally(() => setLoading(false));
    const expired = () => { resetState(); setUser(null); setDrawer(null); location.hash = '#/login'; };
    window.addEventListener('session-expired', expired);
    return () => { window.removeEventListener('hashchange', change); window.removeEventListener('session-expired', expired); };
  }, []);
  useEffect(() => {
    if (user && !user.is_demo) fetchServiceAccount().then(serviceAccount => patchState({ serviceAccount })).catch(() => patchState({ serviceAccount: { email: 'Unavailable' } }));
  }, [user]);
  function authenticated(account) { resetState(); if (account.sample_workspace) patchState(account.sample_workspace); setError(''); setUser(account); location.hash = '#/scanner'; }
  async function logout() {
    setLoggingOut(true);
    try { await signOut(); resetState(); setUser(null); setDrawer(null); location.hash = '#/login'; }
    catch (err) { setError(err.message); }
    finally { setLoggingOut(false); }
  }
  if (loading) return <main className="page-root" role="status">Loading your workspace...</main>;
  if (!user || route === 'login' || route === 'signup') return <><Auth key={route} mode={route === 'signup' ? 'signup' : 'login'} onAuthenticated={authenticated} serviceError={error} /></>;
  return <><div className="app-shell" inert={drawer ? true : undefined}>
    <header className="global-header"><div className="header-left"><a href="#/scanner" className="brand"><span className="brand-mark" aria-hidden="true" /><span className="brand-text"><strong>Cloud Armor Scanner</strong><small>GCP External LB Security</small></span></a><nav className="main-nav" aria-label="Main navigation">{Object.entries(routes).map(([key, label]) => <a key={key} href={`#/${key}`} className={route === key ? 'active' : ''} aria-current={route === key ? 'page' : undefined}>{label}</a>)}</nav></div><div className="header-right"><div className="header-meta"><span className="meta-label">Scope</span><span className="meta-value">{state.scopeId === 'all-projects' ? 'All projects' : state.scopeId ? `${state.scopeType} / ${state.scopeId}` : 'Not configured'}</span></div><div className="header-meta"><span className="meta-label">Scan</span><Status value={state.scanStatus} /></div><a href="#/profile" className="profile-avatar user-initials" title={`${user.name} (${user.email})`} aria-label="Open profile" aria-current={route === 'profile' ? 'page' : undefined}>{initials(user.name)}</a><button className="btn ghost" disabled={loggingOut} onClick={logout}>{loggingOut ? 'Signing out...' : 'Sign out'}</button></div></header>
    <main className="page-root">{user.is_demo && route !== 'profile' && <p className="auth-message" role="note"><strong>Demo workspace</strong> · Sample resources only. No live Google Cloud scans.</p>}{user.is_demo && route !== 'profile' && <DemoProjects workspace={user.sample_workspace} selected={state.scopeId} onSelect={project => { setDrawer(null); patchState(project); }} />}{error && <p role="alert" className="auth-message">{error}</p>}{route === 'profile' ? <Profile user={user} onUpdated={setUser} /> : route === 'scanner' ? <Scanner state={state} /> : route === 'flow' ? <Flow key={state.scopeId} state={state} onSelect={setDrawer} /> : <Backends key={state.scopeId} state={state} onSelect={setDrawer} />}</main>
  </div>{drawer && <Drawer resource={drawer} onClose={() => setDrawer(null)} />}</>;
}
