import React, { useEffect, useRef, useState } from 'react';
const labelText = label => label.replaceAll('_', ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');

function FormattedValue({ value }) {
  if (value === null || value === undefined) return <span>—</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span>No items</span>;
    return <div className="resource-nested-list">{value.map((item, index) => <section className="resource-nested-item" key={index}>
      <div className="resource-item-label">Item {index + 1}</div>
      <FormattedValue value={item} />
    </section>)}</div>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([key]) => key !== 'raw');
    return entries.length ? <dl className="resource-fields resource-nested-fields">{entries.map(([label, child]) => <DetailField key={label} label={label} value={child} />)}</dl> : <span>No fields</span>;
  }
  return <span>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}</span>;
}

function DetailField({ label, value }) {
  const nested = value !== null && typeof value === 'object';
  return <div className="resource-field"><dt>{labelText(label)}</dt><dd className={nested ? 'resource-nested-value' : undefined}><FormattedValue value={value} /></dd></div>;
}

export default function Drawer({ resource, onClose }) {
  const [view, setView] = useState('formatted');
  useEffect(() => setView('formatted'), [resource]);
  const panel = useRef(null), close = useRef(null), returnTo = useRef(document.activeElement);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    close.current.focus();
    const key = e => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const controls = [...panel.current.querySelectorAll('button, [tabindex="0"]')];
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (returnTo.current?.isConnected) returnTo.current.focus(); };
  }, []);
  const field = ([label, value]) => <DetailField key={label} label={label} value={value} />;
  const details = resource.details;
  return <><div className="drawer-backdrop" onClick={onClose} /><aside ref={panel} className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div className="drawer-header"><div><span className="drawer-kicker">RESOURCE DETAILS</span><h2 id="drawer-title">{resource.name}</h2></div><button ref={close} className="icon-btn" aria-label="Close" onClick={onClose}>✕</button></div><div className="drawer-body"><div className="drawer-view-toggle" role="group" aria-label="Details view">{['formatted', 'raw'].map(value => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{value === 'raw' ? 'Raw' : 'Formatted'}</button>)}</div>{view === 'raw' ? <pre className="resource-details" tabIndex={0}>{JSON.stringify(details?.raw || details || { name: resource.name, type: resource.type }, null, 2)}</pre> : <><div className="drawer-type">{resource.type}</div>{resource.status && <div className={`drawer-status ${resource.status.toLowerCase()}`}>{resource.status}</div>}<h3 className="drawer-section-title">Resource overview</h3><dl className="resource-fields">{[['Name', resource.name], ['Resource type', resource.type]].map(field)}</dl>{resource.chain ? <><h3 className="drawer-section-title">Resource hierarchy</h3><div className="drawer-chain">{resource.chain.map(([label, value]) => <div className="drawer-chain-item" key={label}><span className="drawer-chain-label">{label}</span><span className="drawer-chain-value">{value || '—'}</span></div>)}</div></> : <><h3 className="drawer-section-title">Details</h3>{details && typeof details === 'object' && Object.keys(details).length ? <dl className="resource-fields">{Object.entries(details.details ? { self_link: details.self_link, ...details.details } : details).filter(([key]) => key !== 'raw').map(field)}</dl> : typeof details === 'string' && details ? <div className="resource-details">{details}</div> : <p className="drawer-empty">No additional details are available for this resource.</p>}</>}</>}</div></aside></>;
}
