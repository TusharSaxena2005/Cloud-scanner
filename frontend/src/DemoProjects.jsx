import React from 'react';
export const ALL_PROJECTS = 'all-projects';
export function combineProjects(projects) {
  const loadBalancers = projects.flatMap(project => (project.scanResult?.load_balancers || []).map(lb => ({ ...lb, project_id: project.scopeId, lastScanTime: project.lastScanTime })));
  return {
    sampleMode: true, scopeType: 'project', scopeId: ALL_PROJECTS,
    serviceAccount: { email: 'demo-scanner@example.com' }, preflight: null,
    scanStatus: 'completed', lastScanTime: null, scanDurationMs: null,
    scanLogs: 'Combined sample data. No Google Cloud requests were made.\n',
    scanResult: { project_id: ALL_PROJECTS, status: 'completed', message: `Sample data across ${projects.length} projects`, load_balancers: loadBalancers },
  };
}
export default function DemoProjects({ workspace, selected, onSelect }) {
  const projects = workspace?.projects || (workspace ? [workspace] : []);
  if (projects.length < 2) return null;
  return <label className="demo-project-picker"><span>Demo project</span><select value={selected} onChange={event => {
    const project = event.target.value === ALL_PROJECTS ? combineProjects(projects) : projects.find(p => p.scopeId === event.target.value);
    if (project) onSelect(project);
  }}><option value={ALL_PROJECTS}>All projects</option>{projects.map(project => <option key={project.scopeId} value={project.scopeId}>{project.scopeId}</option>)}</select></label>;
}
