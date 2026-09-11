import React, { useEffect, useRef } from 'react';
export default function Drawer({ resource, onClose }) {
  const panel = useRef(null), close = useRef(null), returnTo = useRef(document.activeElement);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    close.current.focus();
    const key = e => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') { e.preventDefault(); close.current.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (returnTo.current?.isConnected) returnTo.current.focus(); };
  }, []);
  const field = ([label, value]) => <div className="resource-field" key={label}><dt>{label.replaceAll('_', ' ')}</dt><dd>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '—')}</dd></div>;
  const details = resource.details;
  return <><div className="drawer-backdrop" onClick={onClose} /><aside ref={panel} className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div className="drawer-header"><div><span className="drawer-kicker">RESOURCE DETAILS</span><h2 id="drawer-title">{resource.name}</h2></div><button ref={close} className="icon-btn" aria-label="Close" onClick={onClose}>✕</button></div><div className="drawer-body"><div className="drawer-type">{resource.type}</div>{resource.status && <div className={`drawer-status ${resource.status.toLowerCase()}`}>{resource.status}</div>}<h3 className="drawer-section-title">Resource overview</h3><dl className="resource-fields">{[['Name', resource.name], ['Resource type', resource.type]].map(field)}</dl>{resource.chain ? <><h3 className="drawer-section-title">Resource hierarchy</h3><div className="drawer-chain">{resource.chain.map(([label, value]) => <div className="drawer-chain-item" key={label}><span className="drawer-chain-label">{label}</span><span className="drawer-chain-value">{value || '—'}</span></div>)}</div></> : <><h3 className="drawer-section-title">Details</h3>{details && typeof details === 'object' && Object.keys(details).length ? <dl className="resource-fields">{Object.entries(details).map(field)}</dl> : typeof details === 'string' && details ? <div className="resource-details">{details}</div> : <p className="drawer-empty">No additional details are available for this resource.</p>}</>}</div></aside></>;
}
