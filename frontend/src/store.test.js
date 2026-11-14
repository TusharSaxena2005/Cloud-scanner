import { afterEach, beforeEach, expect, test } from 'vitest';
import { activateUser, deactivateUser, getState, patchState, resetState } from './store.js';

beforeEach(() => {
  localStorage.clear();
  resetState();
});

afterEach(() => {
  resetState();
  localStorage.clear();
});

test('scan results survive sign-out and are restored only to the same user', () => {
  const scanResult = { project_id: 'project-a', load_balancers: [{ name: 'lb-a' }] };
  activateUser('user-a');
  patchState({ connectionId: 'connection-a', scanResult, scanStatus: 'completed' });

  deactivateUser();
  expect(getState().scanResult).toBeNull();

  activateUser('user-b');
  expect(getState().scanResult).toBeNull();

  activateUser('user-a');
  expect(getState().scanResult).toEqual(scanResult);
  expect(getState().connectionId).toBe('connection-a');
});
