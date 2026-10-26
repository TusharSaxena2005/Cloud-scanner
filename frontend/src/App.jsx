import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { getState, subscribe, patchState, resetState, selectCloudConnection } from './store.js';
import { fetchConnections, fetchWorkspaces, currentUser, signOut } from './api.js';
import { Status } from './components.jsx';
import Dashboard from './Dashboard.jsx';
import Scanner from './Scanner.jsx';
import Connections from './Connections.jsx';
import Flow from './Flow.jsx';
import Backends from './Backends.jsx';
import Drawer from './Drawer.jsx';
import Auth from './Auth.jsx';
import DemoProjects from './DemoProjects.jsx';
import Profile, { initials } from './Profile.jsx';
const routes = { dashboard: 'Dashboard', scanner: 'Scanner', unprotected: 'Unprotected Backends', flow: 'Load Balancer Flow', connections: 'Cloud connections' };
const currentRoute = () => (Object.hasOwn(routes, location.hash.slice(2).split('?')[0]) || ['login', 'signup', 'profile'].includes(location.hash.slice(2).split('?')[0])) ? location.hash.slice(2).split('?')[0] : 'dashboard';
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
    if (!user || user.is_demo) return;
    let active = true;
    Promise.all([fetchConnections(), fetchWorkspaces()]).then(([cloud, work]) => {
      if (!active) return;
      patchState({ connections: cloud.connections, workspaces: work.workspaces });
      selectCloudConnection(cloud.connections[0]?.id || '');
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [user?.id]);
  async function logout() {
    setLoggingOut(true);
    try { await signOut(); resetState(); setUser(null); setDrawer(null); location.hash = '#/login'; }
    catch (err) { setError(err.message); }
    finally { setLoggingOut(false); }
  }
  function handleAuthenticated(authenticatedUser) {
    if (authenticatedUser.sample_workspace) patchState(authenticatedUser.sample_workspace);
    setUser(authenticatedUser);
    setRoute('dashboard');
    location.hash = '#/dashboard';
  }
  if (loading) return <main className="page-root" role="status">Loading your workspace...</main>;
  if (!user || route === 'login' || route === 'signup') return <><Auth key={route} serviceError={error} onAuthenticated={handleAuthenticated} /></>;
  return <><div className="app-shell" inert={drawer ? true : undefined}>
    <header className="global-header"><div className="header-left"><a href="#/dashboard" className="brand"><span className="brand-mark" aria-hidden="true" /><span className="brand-text"><strong>CloudScanner</strong><small>Cloud security visibility</small></span></a><nav className="main-nav" aria-label="Main navigation">{Object.entries(routes).map(([key, label]) => <a key={key} href={`#/${key}`} className={route === key ? 'active' : ''} aria-current={route === key ? 'page' : undefined}>{label}</a>)}</nav></div><div className="header-right"><div className="header-meta"><span className="meta-label">Scope</span><span className="meta-value">{state.scopeId === 'all-projects' ? 'All projects' : state.scopeId ? `${state.scopeType} / ${state.scopeId}` : 'Not configured'}</span></div><div className="header-meta"><span className="meta-label">Scan</span><Status value={state.scanStatus} /></div><a href="#/profile" className="profile-avatar user-initials" title={`${user.name} (${user.email})`} aria-label="Open profile" aria-current={route === 'profile' ? 'page' : undefined}>{initials(user.name)}</a><button className="btn ghost" disabled={loggingOut} onClick={logout}>{loggingOut ? 'Signing out...' : 'Sign out'}</button></div></header>
    <main className="page-root">{user.is_demo && route !== 'profile' && route !== 'connections' && <p className="auth-message" role="note"><strong>Demo workspace</strong> · Sample resources only. No live Google Cloud scans.</p>}{user.is_demo && route !== 'profile' && route !== 'connections' && route !== 'flow' && <DemoProjects workspace={user.sample_workspace} selected={state.scopeId} onSelect={project => { setDrawer(null); patchState(project); }} />}{error && <p role="alert" className="auth-message">{error}</p>}{route === 'dashboard' ? <Dashboard state={state} user={user} onInspectResource={setDrawer} /> : route === 'connections' ? <Connections state={state} demo={user.is_demo} /> : route === 'profile' ? <Profile user={user} onUpdated={setUser} /> : route === 'scanner' ? <Scanner state={state} /> : route === 'flow' ? <Flow key={state.scopeId} state={state} onSelect={setDrawer} projectPicker={user.is_demo ? <DemoProjects workspace={user.sample_workspace} selected={state.scopeId} onSelect={project => { setDrawer(null); patchState(project); }} /> : null} /> : <Backends key={state.scopeId} state={state} onSelect={setDrawer} />}</main>
  </div>{drawer && <Drawer resource={drawer} onClose={() => setDrawer(null)} />}</>;
}
