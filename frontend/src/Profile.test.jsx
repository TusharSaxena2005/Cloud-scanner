import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import Profile, { initials } from './Profile.jsx';
import { updateProfile } from './api.js';
vi.mock('./api.js', () => ({ updateProfile: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const user = { name: 'Test User', email: 'test@example.com' };
test('Google email stays read-only and profile name remains editable', async () => {
  const onUpdated = vi.fn();
  updateProfile.mockResolvedValue({ user: { ...user, name: 'New Name' } });
  render(<Profile user={user} onUpdated={onUpdated} />);
  expect(screen.getByLabelText('Email address').readOnly).toBe(true);
  expect(screen.queryByLabelText('Current password')).toBeNull();
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Name' } });
  fireEvent.click(screen.getByText('Save changes'));
  await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ name: 'New Name' }));
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(onUpdated).toHaveBeenCalledWith({ ...user, name: 'New Name' });
});
test('initials handle one or several names', () => {
  expect(initials('Test User')).toBe('TU');
  expect(initials('Alice')).toBe('A');
});
