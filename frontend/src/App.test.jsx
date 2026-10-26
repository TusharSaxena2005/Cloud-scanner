import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App.jsx';
import Flow from './Flow.jsx';
import Backends from './Backends.jsx';
import Drawer from './Drawer.jsx';
import { patchState } from './store.js';
import { fetchConnections, fetchWorkspaces, streamPermissions, streamScan, currentUser, loginDemo } from './api.js';
vi.mock('./api.js', () => ({ fetchConnections: vi.fn(), fetchWorkspaces: vi.fn(), streamPermissions: vi.fn(), streamScan: vi.fn(), currentUser: vi.fn(), signOut: vi.fn(), beginGoogleSignIn: vi.fn(), loginDemo: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  currentUser.mockResolvedValue({ user: { id: 'test', name: 'Test User', email: 'test@example.com' } });
  location.hash = '#/scanner';
  fetchConnections.mockResolvedValue({ connections: [{ id: 'gcp-1', provider: 'gcp', label: 'test@example.com' }] });
  fetchWorkspaces.mockResolvedValue({ workspaces: [{ id: 'workspace-1', name: 'Test workspace' }] });
  patchState({ scopeType: 'project', scopeId: '', preflight: null, scanResult: null, scanStatus: 'idle', scanLogs: '', lastScanTime: null });
});
const state = { scanResult: { project_id: 'demo-project', load_balancers: [{ forwarding_rule: { name: 'public-lb', details: { ip_address: '1.2.3.4' } }, backend_services: [{ backend_service: { name: 'protected-api' }, security_policy: { name: 'armor-policy' } }, { backend_service: { name: 'exposed-api' } }] }] } };
test('permission verification enables scanning and editing the scope invalidates it', async () => {
  streamPermissions.mockResolvedValue({ all_permissions_granted: true, permissions: [] });
  streamScan.mockResolvedValue({ ...state.scanResult, status: 'completed' });
  render(<App />);
  await screen.findByLabelText('Project ID');
  await waitFor(() => expect(screen.getByLabelText('Cloud connection').value).toBe('gcp-1'));
  fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: 'demo-project' } });
  fireEvent.click(screen.getByText('Check permissions'));
  await waitFor(() => expect(screen.getByText('Start scan').disabled).toBe(false));
  fireEvent.click(screen.getByText('Start scan'));
  await screen.findByText('View backends');
  expect(streamScan).toHaveBeenCalledWith('demo-project', 'gcp-1', expect.any(Function));
  fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: 'other-project' } });
  expect(screen.getByText('Start scan').disabled).toBe(true);
});
test('waterfall keeps names compact, expands and collapses, filters policies and opens details', () => {
  const onSelect = vi.fn();
  const { container } = render(<Flow state={state} onSelect={onSelect} />);
  expect(screen.queryByText('1.2.3.4')).toBeNull();
  fireEvent.click(screen.getByText('Collapse All'));
  expect([...container.querySelectorAll('details')].every(el => !el.open)).toBe(true);
  fireEvent.click(screen.getByText('Expand All'));
  expect([...container.querySelectorAll('details')].every(el => el.open)).toBe(true);
  fireEvent.click(screen.getByText('protected-api'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'protected-api' }));
  fireEvent.change(screen.getByLabelText('Protection state'), { target: { value: 'UNPROTECTED' } });
  expect(screen.queryByText('protected-api')).toBeNull();
  expect(screen.getByText('exposed-api')).toBeTruthy();
});
test('backend search has a no-matches state', () => {
  render(<Backends state={state} onSelect={() => {}} />);
  fireEvent.change(screen.getByLabelText('Search backends'), { target: { value: 'does-not-exist' } });
  expect(screen.getByText('No unprotected backends match the current filters.')).toBeTruthy();
});
test('drawer displays structured details and supports Escape', () => {
  const onClose = vi.fn();
  render(<Drawer resource={{ type: 'Forwarding Rule', name: 'public-lb', details: { ip_address: '1.2.3.4' } }} onClose={onClose} />);
  expect(screen.getByText('ip address')).toBeTruthy();
  expect(screen.getByText('1.2.3.4')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText('Close'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
});

test('avatar opens the authenticated profile page', async () => {
  render(<App />);
  const avatar = await screen.findByRole('link', { name: 'Open profile' });
  expect(avatar.textContent).toBe('TU');
  fireEvent.click(avatar);
  await screen.findByRole('heading', { name: 'Your profile' });
  expect(screen.getByText('Full name')).toBeTruthy();
  expect(screen.getByText('Google account')).toBeTruthy();
});

test('flow sends resource JSON to the drawer instead of only its link', () => {
  const backend = { name: 'json-backend', self_link: 'https://example.test/backend', details: { protocol: 'HTTP' }, raw: { name: 'json-backend', protocol: 'HTTP' } };
  const proxy = { name: 'json-proxy', details: { url_map: 'map-link' } };
  const map = { name: 'json-map', details: { default_service: 'backend-link' } };
  const policy = { name: 'json-policy', details: { rules: [{ action: 'deny(403)' }] } };
  const onSelect = vi.fn();
  const data = { scanResult: { project_id: 'demo', load_balancers: [{ forwarding_rule: { name: 'rule' }, target_proxy: proxy, url_map: map, backend_services: [{ backend_service: backend, security_policy: policy }] }] } };
  const { unmount } = render(<Flow state={data} onSelect={onSelect} />);
  for (const node of [proxy, map, backend, policy]) {
    fireEvent.click(screen.getByText(node.name));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ details: node }));
  }
  unmount();
  const { container } = render(<Drawer resource={{ type: 'Backend Service', name: backend.name, details: backend }} onClose={() => {}} />);
  expect(container.querySelector('pre')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
  expect(JSON.parse(container.querySelector('pre').textContent)).toEqual(backend.raw);
  fireEvent.click(screen.getByRole('button', { name: 'Formatted' }));
  expect(container.querySelector('pre')).toBeNull();
});

test('formatted details render nested policy rules as boxes without JSON', () => {
  const rules = [{ priority: 100, preview: false, match: { expr: { expression: 'evaluatePreconfiguredWaf' } }, action: 'deny(403)' }];
  const { container } = render(<Drawer resource={{ type: 'Cloud Armor', name: 'waf', details: { rules } }} onClose={() => {}} />);
  expect(screen.getByText('Item 1')).toBeTruthy();
  expect(screen.getByText('priority')).toBeTruthy();
  expect(screen.getByText('100')).toBeTruthy();
  expect(screen.getByText('No')).toBeTruthy();
  expect(screen.getByText('evaluatePreconfiguredWaf')).toBeTruthy();
  expect(container.querySelector('pre')).toBeNull();
  expect(container.querySelectorAll('.resource-nested-fields').length).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
  expect(JSON.parse(container.querySelector('pre').textContent)).toEqual({ rules });
});

test('unprotected backends excludes protected resources and status filter', () => {
  render(<Backends state={state} onSelect={() => {}} />);
  expect(screen.getByText('exposed-api')).toBeTruthy();
  expect(screen.queryByText('protected-api')).toBeNull();
  expect(screen.queryByLabelText('Status')).toBeNull();
});

test('all protected resources show an explicit empty result', () => {
  const protectedState = { scanResult: { project_id: 'demo', load_balancers: [{ forwarding_rule: { name: 'lb' }, backend_services: [{ backend_service: { name: 'safe' }, security_policy: { name: 'waf' } }] }] } };
  render(<Backends state={protectedState} onSelect={() => {}} />);
  expect(screen.getByText('No unprotected backends found.')).toBeTruthy();
  expect(screen.queryByText('safe')).toBeNull();
});

test('logging in with demo account shows demo workspace notice and sample resources', async () => {
  const unauthError = new Error('Please sign in to continue.');
  unauthError.status = 401;
  currentUser.mockRejectedValue(unauthError);
  location.hash = '#/login';
  const demoWorkspace = {
    sampleMode: true,
    scopeType: 'project',
    scopeId: 'all-projects',
    projects: [
      { scopeId: 'demo-proj-1', scanResult: { load_balancers: [] } },
      { scopeId: 'demo-proj-2', scanResult: { load_balancers: [] } },
    ],
    scanResult: { project_id: 'all-projects', load_balancers: [] },
  };
  loginDemo.mockResolvedValue({
    user: { id: 'demo-user-id', name: 'Demo User', email: 'demo@cloudscanner.local', is_demo: true, sample_workspace: demoWorkspace },
  });
  render(<App />);
  const demoBtn = await screen.findByRole('button', { name: 'Continue with Demo Account' });
  fireEvent.click(demoBtn);
  await screen.findByText('Demo workspace');
  expect(screen.getByText('Demo project')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Continue with Demo Account' })).toBeNull();
});

test('first page defaults to Dashboard and displays Cloud Security Posture overview', async () => {
  location.hash = '';
  render(<App />);
  await screen.findByRole('heading', { name: 'Cloud Security Posture' });
  const dashboardNav = screen.getByRole('link', { name: 'Dashboard' });
  expect(dashboardNav.classList.contains('active')).toBe(true);
});
