import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import Auth from './Auth.jsx';
import { beginGoogleSignIn } from './api.js';
vi.mock('./api.js', () => ({ beginGoogleSignIn: vi.fn() }));
afterEach(() => { cleanup(); location.hash = ''; vi.resetAllMocks(); });
test('Google replaces password signup and login forms', () => {
  render(<Auth />);
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
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
