import { academicTermOptions } from '../state';

export function ApiModal({ cfg, busy, onCfg, onLoad, onClose }){
  const termOptions = React.useMemo(() => academicTermOptions(), []);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const set = (k) => (e) => onCfg(Object.assign({}, cfg, { [k]: e.target.value }));
  return (
    <div className="api-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="api-modal">
        <div className="api-head">
          <h3>Course data API</h3>
          <button className="cart-close" onClick={onClose} title="Close">✕</button>
        </div>
        <p className="api-note">Loads HKUST(GZ) course data through the Cloudflare Workers API (TYPE=data / sisn / klms). The TOKEN is sent as a URL query parameter.</p>
        <label className="api-field">
          <span>API URL</span>
          <input value={cfg.url} onChange={set('url')} placeholder="https://…workers.dev/" spellCheck={false} />
        </label>
        <label className="api-field">
          <span>Cart API URL (add to cart)</span>
          <input value={cfg.cartUrl} onChange={set('cartUrl')} placeholder="https://…workers.dev/" spellCheck={false} />
        </label>
        <label className="api-field">
          <span>Enroll API URL (enroll)</span>
          <input value={cfg.enrollUrl} onChange={set('enrollUrl')} placeholder="https://…workers.dev/" spellCheck={false} />
        </label>
        <label className="api-field">
          <span>TOKEN</span>
          <input value={cfg.token} onChange={set('token')} type="password" autoComplete="off" placeholder="authorization token" />
        </label>
        <label className="api-field">
          <span>Student ID</span>
          <input value={cfg.studentId} onChange={set('studentId')} autoComplete="off" placeholder="student id (sent with enroll requests)" spellCheck={false} />
        </label>
        <label className="api-field">
          <span>TERM (academic term)</span>
          <select value={cfg.termId} onChange={set('termId')}>
            {termOptions.map(o => <option key={o.id} value={o.id}>{o.label} ({o.id})</option>)}
            {termOptions.some(o => o.id === cfg.termId) || !cfg.termId ? null : <option value={cfg.termId}>{cfg.termId}</option>}
          </select>
        </label>
        <div className="api-actions">
          <button className="hbtn" type="button" disabled={!!busy} onClick={() => onLoad('data')}>{busy === 'data' ? 'Loading…' : 'Load catalog (data)'}</button>
          <button className="hbtn" type="button" disabled={!!busy} onClick={() => onLoad('sisn')}>{busy === 'sisn' ? 'Loading…' : 'Load courses (sisn)'}</button>
          <button className="hbtn" type="button" disabled={!!busy} onClick={() => onLoad('klms')}>{busy === 'klms' ? 'Loading…' : 'Load KLMS courses'}</button>
        </div>
        <div className="api-foot">
          <span className="api-hint">Settings are stored in this browser after a successful load.</span>
          <button className="hbtn" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
