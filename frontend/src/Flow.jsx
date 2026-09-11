import React, { useState } from 'react';
import { Heading, Empty } from './components.jsx';
const icons = { Project: '◆', 'Load Balancer': '⬡', 'Forwarding Rule': '⇄', 'Target Proxy': '🔒', 'URL Map': '☷', 'Backend Service': '▣', 'Cloud Armor': '🛡' };
function Resource({ resource, onSelect, children, command }) {
  const [local, setLocal] = useState(null);
  const expanded = local?.version === command.version ? local.open : command.open;
  return <div className="waterfall-level"><button className={`tree-node ${resource.status?.toLowerCase() || ''}`} onClick={() => onSelect(resource)}><span className="node-icon">{icons[resource.type] || '◆'}</span><span className="node-body"><span className="node-type">{resource.type}</span><strong className="node-name">{resource.name}</strong></span></button>{children && <details className="waterfall-branch" open={expanded}><summary aria-label={`Expand or collapse ${resource.name}`} onClick={e => { e.preventDefault(); setLocal({ version: command.version, open: !expanded }); }}><span aria-hidden="true">›</span></summary><div className="waterfall-children">{children}</div></details>}</div>;
}
export default function Flow({ state, onSelect }) {
  const [search, setSearch] = useState(''), [lbFilter, setLbFilter] = useState(''), [protection, setProtection] = useState('');
  const [command, setCommand] = useState({ version: 0, open: true });
  const scan = state.scanResult;
  const resource = (type, name, details, status) => ({ type, name: name || '—', details, status });
  const branch = (data, children, key) => <Resource key={key} resource={data} onSelect={onSelect} command={command}>{children}</Resource>;
  const lbKey = lb => JSON.stringify([lb.project_id || scan.project_id, lb.forwarding_rule.name]);
  const buildTrees = loadBalancers => loadBalancers.filter(lb => !lbFilter || lbKey(lb) === lbFilter).filter(lb => [lb.project_id || scan.project_id, lb.forwarding_rule.name, lb.target_proxy?.name, lb.url_map?.name, ...(lb.backend_services || []).flatMap(b => [b.backend_service?.name, b.security_policy?.name])].join(' ').toLowerCase().includes(search.toLowerCase())).map((lb, index) => {
    const backends = (lb.backend_services || []).filter(b => !protection || (b.security_policy?.name && !b.security_policy.error ? 'PROTECTED' : 'UNPROTECTED') === protection);
    if (protection && !backends.length) return null;
    const backendNodes = backends.length ? backends.map((b, i) => {
      const protectedState = b.security_policy?.name && !b.security_policy.error;
      return branch(resource('Backend Service', b.backend_service?.name, b.backend_service?.self_link), branch(resource('Cloud Armor', protectedState ? b.security_policy.name : 'Not attached', b.security_policy?.self_link, protectedState ? 'PROTECTED' : 'UNPROTECTED')), i);
    }) : branch(resource('Backend Service', 'Not resolved', 'No backend services resolved'));
    return branch(resource('Load Balancer', lb.forwarding_rule.name, lb.forwarding_rule.details?.load_balancing_scheme), branch(resource('Forwarding Rule', lb.forwarding_rule.name, lb.forwarding_rule.details), branch(resource('Target Proxy', lb.target_proxy?.name, lb.target_proxy?.self_link), branch(resource('URL Map', lb.url_map?.name, lb.url_map?.self_link), backendNodes))), index);
  }).filter(Boolean);
  const groups = new Map();
  for (const lb of scan?.load_balancers || []) {
    const project = lb.project_id || scan.project_id;
    if (!groups.has(project)) groups.set(project, []);
    groups.get(project).push(lb);
  }
  const projectTrees = [...groups].map(([project, lbs]) => {
    const trees = buildTrees(lbs);
    return trees.length ? branch(resource('Project', project), trees, project) : null;
  }).filter(Boolean);
  return <><Heading title="Load Balancer Flow">Follow the waterfall from project to Cloud Armor policy. Expand a resource to reveal the next step below and to the right.</Heading>{!scan?.load_balancers?.length ? <Empty /> : <><section className="panel flow-controls"><div className="filter-row"><input aria-label="Search resources" type="search" placeholder="Search resource names..." value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Load balancer" value={lbFilter} onChange={e => setLbFilter(e.target.value)}><option value="">All Load Balancers</option>{scan.load_balancers.map((lb, i) => <option key={i} value={lbKey(lb)}>{lb.project_id ? `${lb.project_id} / ` : ''}{lb.forwarding_rule.name}</option>)}</select><select aria-label="Protection state" value={protection} onChange={e => setProtection(e.target.value)}><option value="">All Protection States</option><option value="PROTECTED">Protected</option><option value="UNPROTECTED">Unprotected</option></select></div><div className="flow-toolbar"><button className="btn ghost" onClick={() => setCommand(c => ({ version: c.version + 1, open: true }))}>Expand All</button><button className="btn ghost" onClick={() => setCommand(c => ({ version: c.version + 1, open: false }))}>Collapse All</button></div></section><section className="panel flow-panel"><div className="flow-viewport" role="region" aria-label="Resource hierarchy"><div className="flow-canvas"><div className="waterfall-root">{projectTrees.length ? projectTrees : <p className="empty-inline">No load balancers match the current filters.</p>}</div></div></div></section></>}</>;
}
