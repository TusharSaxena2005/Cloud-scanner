import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import Connections from './Connections.jsx';
import Scanner from './Scanner.jsx';
import { connectGcp, disconnectCloud, fetchConnections } from './api.js';
import { getState, getSessionEpoch, patchState, resetState, selectCloudConnection } from './store.js';
vi.mock('./api.js', () => ({ connectGcp: vi.fn(), disconnectCloud: vi.fn(), fetchConnections: vi.fn(), streamPermissions: vi.fn(), streamScan: vi.fn() }));
afterEach(() => { cleanup(); resetState(); vi.resetAllMocks(); });
const state = { workspaces: [{ id: 'workspace', name: 'My workspace' }], connections: [{ id: 'connection', label: 'user@example.com', provider: 'gcp', workspace_id: 'workspace' }], connectionId: 'connection' };
test('GCP connection errors are recoverable and future providers are explicit', async () => {
  connectGcp.mockRejectedValue(new Error('Cloud connection encryption is not configured.'));
  render(<Connections state={state} />);
  fireEvent.click(screen.getByText('Connect GCP'));
  expect(connectGcp).toHaveBeenCalledWith('workspace');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Cloud connection encryption is not configured.');
  expect(screen.getByText('AWS')).toBeTruthy();
  expect(screen.getByText('Azure')).toBeTruthy();
});
test('disconnect removes the selected connection and clears its scan results', async () => {
  patchState({ ...state, scanResult: { project_id: 'private-project' }, preflight: { all_permissions_granted: true } });
  disconnectCloud.mockResolvedValue({ ok: true });
  fetchConnections.mockResolvedValue({ connections: [] });
  render(<Connections state={state} />);
  fireEvent.click(screen.getByText('Disconnect'));
  await waitFor(() => expect(getState().connectionId).toBe(''));
  expect(getState().scanResult).toBeNull();
  expect(getState().preflight).toBeNull();
});
test('changing connections invalidates preflight and pending scan results', () => {
  patchState({ preflight: { all_permissions_granted: true }, scanResult: { private: true } });
  const epoch = getSessionEpoch();
  selectCloudConnection('other-connection');
  expect(getSessionEpoch()).toBeGreaterThan(epoch);
  expect(getState().preflight).toBeNull();
  expect(getState().scanResult).toBeNull();
});
test('scanning cannot start without a cloud connection', () => {
  render(<Scanner state={{ scanStatus: 'idle', scopeType: 'project', scopeId: 'my-project', preflight: { all_permissions_granted: true }, connections: [] }} />);
  expect(screen.getByText('Check permissions').disabled).toBe(true);
  expect(screen.getByText('Start scan').disabled).toBe(true);
});
