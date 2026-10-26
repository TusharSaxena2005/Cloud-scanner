import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import Auth from './Auth.jsx';
import { beginGoogleSignIn, loginDemo } from './api.js';
vi.mock('./api.js', () => ({ beginGoogleSignIn: vi.fn(), loginDemo: vi.fn() }));
afterEach(() => { cleanup(); location.hash = ''; vi.resetAllMocks(); });
test('Google replaces password signup and login forms and provides demo account option', () => {
  render(<Auth />);
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Continue with Demo Account' })).toBeTruthy();
  expect(screen.getByText('Explore Demo Account')).toBeTruthy();
  expect(screen.getByText('Sample Data')).toBeTruthy();
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.queryByLabelText('Email address')).toBeNull();
});
test('failed sign-in startup remains actionable', async () => {
  beginGoogleSignIn.mockRejectedValue(new Error('Google Sign-In is not configured.'));
  render(<Auth />);
  fireEvent.click(screen.getByText('Continue with Google'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Google Sign-In is not configured.');
  expect(screen.getByText('Continue with Google').disabled).toBe(false);
});
test('OAuth cancellation explains how to retry', () => {
  location.hash = '#/login?oauth_error=Authorization%20cancelled';
  render(<Auth />);
  expect(screen.getByRole('alert').textContent).toBe('Authorization cancelled');
});
test('demo account login successfully invokes onAuthenticated with demo data', async () => {
  const onAuthenticated = vi.fn();
  const demoUser = { id: 'demo-1', name: 'Demo User', is_demo: true, sample_workspace: { sampleMode: true, scopeId: 'all-projects' } };
  loginDemo.mockResolvedValue({ user: demoUser });
  render(<Auth onAuthenticated={onAuthenticated} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Demo Account' }));
  expect(await screen.findByText('Launching demo account...')).toBeTruthy();
  expect(loginDemo).toHaveBeenCalledTimes(1);
  expect(onAuthenticated).toHaveBeenCalledWith(demoUser);
});
test('demo account login failure displays an error message', async () => {
  loginDemo.mockRejectedValue(new Error('Demo service is currently unavailable.'));
  render(<Auth />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Demo Account' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Demo service is currently unavailable.');
  expect(screen.getByRole('button', { name: 'Continue with Demo Account' }).disabled).toBe(false);
});
