import { useState } from 'react';
import { api, label, imageToDataUrl } from '../api.js';
import { back, navigate } from '../router.js';
import { useAction } from '../hooks.js';

export function Screen({ title, backTo, right, children }) {
  return (
    <>
      <header className="screen-head">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => (backTo ? navigate(backTo) : back())}>‹</button>
        <h1>{title}</h1>
        <div className="screen-head-right">{right}</div>
      </header>
      {children}
    </>
  );
}

export function Loading({ label: text = 'Loading…' }) {
  return <p className="muted center" style={{ padding: '32px 0' }}>{text}</p>;
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="error" role="alert">{error.message ?? String(error)}</div>;
}

export function Empty({ children }) {
  return <p className="muted small center" style={{ padding: '16px 0' }}>{children}</p>;
}

export function MenuLink({ to, icon, label: text, hint, right }) {
  return (
    <a className="menu-link" href={`#${to}`}>
      <span className="ico" aria-hidden="true">{icon}</span>
      <span className="grow"><b>{text}</b>{hint && <span className="small muted block">{hint}</span>}</span>
      {right}
      <span aria-hidden="true" className="muted">›</span>
    </a>
  );
}

export function Avatar({ photo, name, size = '' }) {
  return photo ? <img className={`avatar ${size}`} src={photo} alt="" /> : <span className={`avatar ${size}`} aria-hidden="true">{name?.[0] ?? '?'}</span>;
}

/** Tier, shield and verification badges for a member. */
export function TrustBadges({ trust }) {
  if (!trust) return null;
  return (
    <span className="tags">
      {trust.shield && <span className="tag gold" title="Marriage Transparency Shield">🛡 Shield</span>}
      <span className={`tag tier-${trust.tier}`}>{trust.tierLabel}</span>
      {trust.identityVerified && <span className="tag">✓ ID verified</span>}
      {trust.churchVerified && <span className="tag plum">⛪ Church verified</span>}
    </span>
  );
}

export function ScoreRing({ score, size = 96, caption }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="score-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${caption ?? 'Score'} ${score} out of 100`}>
      <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="10" />
      <circle className="bar" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fontSize={size / 3.6} fontWeight="700">{score}</text>
    </svg>
  );
}

/** Labelled form field. Use `group` for sets of buttons (a <label> would rename every button). */
export function Field({ label: text, hint, group, children }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className="field" {...(group && { role: 'group', 'aria-label': text })}>
      <span>{text}</span>
      {children}
      {hint && <small>{hint}</small>}
    </Tag>
  );
}

/** Select built from a list of values with human labels. */
export function Choice({ field, value, options, onChange, placeholder }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{label(field, o)}</option>)}
    </select>
  );
}

/** Very small renderer for the legal documents ("# " headings, "• " bullets, paragraphs). */
export function DocText({ text }) {
  return (
    <div className="doc">
      {text.split('\n\n').map((block, i) => {
        if (block.startsWith('# ')) {
          const [h, ...rest] = block.split('\n');
          return <div key={i}><h3>{h.slice(2)}</h3>{rest.map((l, j) => <p key={j}>{l}</p>)}</div>;
        }
        const lines = block.split('\n');
        if (lines.every((l) => l.startsWith('• '))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>;
        return <p key={i} style={{ whiteSpace: 'pre-line' }}>{block}</p>;
      })}
    </div>
  );
}

const REASONS = {
  scam: 'Asking for money or a scam', fake: 'Fake profile or photos', married: 'Married or in a relationship',
  harassment: 'Harassment or pressure', inappropriate: 'Sexual or inappropriate content', underage: 'May be under 18', other: 'Something else',
};

/** Report and/or block a member. */
export function ReportBlock({ userId, messageId, name, onDone, notify, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(true);
  const { busy, error, run } = useAction();
  const send = () => run(async () => {
    const r = await api('/reports', { method: 'POST', body: { userId, messageId, reason, details: details || undefined, block } });
    setOpen(false);
    notify?.(r.message);
    onDone?.({ blocked: block });
  });
  const blockOnly = () => run(async () => {
    await api('/blocks', { method: 'POST', body: { userId } });
    notify?.(`${name ?? 'Member'} has been blocked.`);
    onDone?.({ blocked: true });
  });
  if (!open) {
    return (
      <div className="row wrap">
        <button type="button" className="link-btn danger" onClick={() => setOpen(true)}>Report{messageId ? ' message' : ''}</button>
        {!messageId && <button type="button" className="link-btn" disabled={busy} onClick={blockOnly}>Block</button>}
      </div>
    );
  }
  return (
    <div className="card flat stack">
      <b>Why are you reporting {name ?? 'this member'}?</b>
      <div className="chips">
        {Object.entries(REASONS).map(([id, l]) => <button key={id} type="button" className={`chip ${reason === id ? 'active' : ''}`} aria-pressed={reason === id} onClick={() => setReason(id)}>{l}</button>)}
      </div>
      <textarea placeholder="Anything our safety team should know? (optional, confidential)" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
      <label className="check"><input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> Also block them</label>
      <ErrorNote error={error} />
      <div className="row">
        <button type="button" className="btn danger" disabled={!reason || busy} onClick={send}>Send report</button>
        <button type="button" className="btn ghost" onClick={() => { setOpen(false); if (startOpen) onDone?.({ cancelled: true }); }}>Cancel</button>
      </div>
    </div>
  );
}

/** File input that downscales the chosen image and passes a data URL to onImage. */
export function ImagePicker({ label: text, onImage, capture, value }) {
  const [err, setErr] = useState(null);
  return (
    <div className="field">
      <span style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: '0.92rem' }}>{text}</span>
      {value && <img src={value} alt="" className="review-img" style={{ maxHeight: 220, objectFit: 'contain', marginBottom: 8 }} />}
      <input type="file" accept="image/jpeg,image/png,image/webp" {...(capture && { capture })}
        onChange={async (e) => {
          setErr(null);
          try { onImage(await imageToDataUrl(e.target.files[0])); } catch (x) { setErr(x); }
        }} />
      <ErrorNote error={err} />
    </div>
  );
}
