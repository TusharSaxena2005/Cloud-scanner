import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import ChangePassword from './ChangePassword.jsx';
import { changePassword } from './api.js';
vi.mock('./api.js', () => ({ changePassword: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function openForm() {
  render(<ChangePassword />);
  fireEvent.click(screen.getByText('Change password'));
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password-123' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-123' } });
}
test('validates confirmation and saves only the password fields', async () => {
  changePassword.mockResolvedValue({ ok: true });
  openForm();
  const confirm = screen.getByLabelText('Confirm new password');
  fireEvent.change(confirm, { target: { value: 'different-password' } });
  fireEvent.click(screen.getByText('Update password'));
  expect(confirm.validationMessage).toBe('Passwords must match.');
  expect(changePassword).not.toHaveBeenCalled();
  fireEvent.change(confirm, { target: { value: 'new-password-123' } });
  fireEvent.click(screen.getByText('Update password'));
  await screen.findByText('Password changed. Other sessions have been signed out.');
  expect(changePassword).toHaveBeenCalledWith({ current_password: 'old-password-123', new_password: 'new-password-123' });
  expect(screen.queryByLabelText('Current password')).toBeNull();
});
test('cancel clears the form without calling the backend', () => {
  openForm();
  fireEvent.click(screen.getByText('Cancel'));
  fireEvent.click(screen.getByText('Change password'));
  expect(screen.getByLabelText('Current password').value).toBe('');
  expect(changePassword).not.toHaveBeenCalled();
});
