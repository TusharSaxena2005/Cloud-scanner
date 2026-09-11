import { afterEach, expect, test, vi } from 'vitest';
import { authRequest } from './api.js';
afterEach(() => vi.unstubAllGlobals());
test('proxy failures explain service availability rather than invalid credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('Not JSON'); } }));
  await expect(authRequest('me')).rejects.toThrow('The sign-in service is unavailable.');
});
test('signed-out session checks retain the 401 status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: 'Please sign in to continue.' }) }));
  await expect(authRequest('me')).rejects.toMatchObject({ status: 401 });
});
test('database failures are distinguished from an unavailable backend', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: 'Account database is unavailable. Please try again later.' }) }));
  await expect(authRequest('me')).rejects.toThrow('Cannot connect to the account database.');
});
