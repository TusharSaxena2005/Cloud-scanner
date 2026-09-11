import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import DemoProjects from './DemoProjects.jsx';
afterEach(cleanup);
test('switching demo projects loads the selected project snapshot', () => {
  const first = { scopeId: 'first', scanResult: { load_balancers: [] } };
  const second = { scopeId: 'second', scanResult: { load_balancers: [{ name: 'second-lb' }] } };
  const onSelect = vi.fn();
  render(<DemoProjects workspace={{ projects: [first, second] }} selected="first" onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText('Demo project'), { target: { value: 'second' } });
  expect(onSelect).toHaveBeenCalledWith(second);
});
import { combineProjects } from './DemoProjects.jsx';
import { flattenBackends, scanSummary } from './store.js';
import Flow from './Flow.jsx';
test('all projects combines totals and preserves project identity in rows and tree', () => {
  const projects = ['first-project', 'second-project'].map((scopeId, index) => ({ scopeId, lastScanTime: '2026-09-11T12:00:00Z', scanResult: { load_balancers: [{ forwarding_rule: { name: 'shared-lb' }, backend_services: [{ backend_service: { name: `backend-${index}` }, security_policy: index ? null : { name: 'waf' } }] }] } }));
  const combined = combineProjects(projects);
  const rows = flattenBackends(combined.scanResult);
  expect(rows.map(row => row.project)).toEqual(['first-project', 'second-project']);
  expect(scanSummary(combined.scanResult)).toMatchObject({ loadBalancers: 2, backendServices: 2, protectedBackends: 1, unprotectedBackends: 1 });
  render(<Flow state={combined} onSelect={() => {}} />);
  expect(screen.getByText('first-project')).toBeTruthy();
  expect(screen.getByText('second-project')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Load balancer'), { target: { value: JSON.stringify(['second-project', 'shared-lb']) } });
  expect(screen.queryByText('backend-0')).toBeNull();
  expect(screen.getByText('backend-1')).toBeTruthy();
});
test('all projects option selects an aggregated workspace', () => {
  const onSelect = vi.fn();
  render(<DemoProjects workspace={{ projects: [{ scopeId: 'first' }, { scopeId: 'second' }] }} selected="first" onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText('Demo project'), { target: { value: 'all-projects' } });
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ scopeId: 'all-projects', sampleMode: true }));
});
