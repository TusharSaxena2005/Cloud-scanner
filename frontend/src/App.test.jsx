import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App.jsx';
import Flow from './Flow.jsx';
import Backends from './Backends.jsx';
import Drawer from './Drawer.jsx';
import { patchState } from './store.js';
import { fetchServiceAccount, streamPermissions, streamScan, currentUser } from './api.js';
vi.mock('./api.js', () => ({ fetchServiceAccount: vi.fn(), streamPermissions: vi.fn(), streamScan: vi.fn(), currentUser: vi.fn(), signOut: vi.fn(), authenticate: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  currentUser.mockResolvedValue({ user: { id: 'test', name: 'Test User', email: 'test@example.com' } });
  location.hash = '#/scanner';
  fetchServiceAccount.mockResolvedValue({ email: 'scanner@example.test' });
  patchState({ scopeType: 'project', scopeId: '', preflight: null, scanResult: null, scanStatus: 'idle', scanLogs: '', lastScanTime: null });
});
const state = { scanResult: { project_id: 'demo-project', load_balancers: [{ forwarding_rule: { name: 'public-lb', details: { ip_address: '1.2.3.4' } }, backend_services: [{ backend_service: { name: 'protected-api' }, security_policy: { name: 'armor-policy' } }, { backend_service: { name: 'exposed-api' } }] }] } };
test('permission verification enables scanning and editing the scope invalidates it', async () => {
  streamPermissions.mockResolvedValue({ all_permissions_granted: true, permissions: [] });
  streamScan.mockResolvedValue({ ...state.scanResult, status: 'completed' });
  render(<App />);
  await screen.findByLabelText('Project ID');
  fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: 'demo-project' } });
  fireEvent.click(screen.getByText('Check permissions'));
  await waitFor(() => expect(screen.getByText('Start scan').disabled).toBe(false));
  fireEvent.click(screen.getByText('Start scan'));
  await screen.findByText('View backends');
  expect(streamScan).toHaveBeenCalledWith('demo-project', expect.any(Function));
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
  expect(screen.getByText('No backends match the current filters.')).toBeTruthy();
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
  expect(screen.getByText('Personal account')).toBeTruthy();
});
