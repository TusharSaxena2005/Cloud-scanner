import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import Profile from './Profile.jsx';
import { updateProfile } from './api.js';
vi.mock('./api.js', () => ({ updateProfile: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const user = { name: 'Test User', email: 'test@example.com' };
test('profile saves the edited name and notifies the app', async () => {
  const onUpdated = vi.fn();
  updateProfile.mockResolvedValue({ user: { ...user, name: 'New Name' } });
  render(<Profile user={user} onUpdated={onUpdated} />);
  fireEvent.click(screen.getByText('Edit profile'));
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Name' } });
  fireEvent.click(screen.getByText('Save changes'));
  await screen.findByText('Profile updated successfully.');
  expect(updateProfile).toHaveBeenCalledWith({ name: 'New Name', email: user.email });
  expect(onUpdated).toHaveBeenCalledWith({ ...user, name: 'New Name' });
});
test('email changes request a password and cancel discards edits', () => {
  render(<Profile user={user} onUpdated={() => {}} />);
  fireEvent.click(screen.getByText('Edit profile'));
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.com' } });
  expect(screen.getByLabelText('Current password').required).toBe(true);
  fireEvent.click(screen.getByText('Cancel'));
  expect(updateProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Edit profile'));
  expect(screen.getByLabelText('Email address').value).toBe(user.email);
});
test('save errors leave edits available for retry', async () => {
  updateProfile.mockRejectedValue(new Error('That email address is already in use.'));
  render(<Profile user={user} onUpdated={() => {}} />);
  fireEvent.click(screen.getByText('Edit profile'));
  fireEvent.click(screen.getByText('Save changes'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('already in use'));
  expect(screen.getByText('Save changes').disabled).toBe(false);
});
