import { useState } from 'react';
import { api, fmtDate, timeAgo } from '../api.js';
import { useAction, useApi } from '../hooks.js';
import { Empty, ErrorNote, Field, Loading, Screen, TrustBadges } from '../components/ui.jsx';

function Who({ m }) {
  return (
    <div className="person">
      {m.photos[0] ? <img className="avatar" src={m.photos[0].data} alt="" /> : <span className="avatar">{m.firstName[0]}</span>}
      <span className="grow"><b>{m.firstName}{m.age ? `, ${m.age}` : ''}</b> <span className="small muted">#{m.id} · joined {fmtDate(m.joined)}</span>
        <span className="block"><TrustBadges trust={m.trust} />{m.status === 'suspended' && <span className="tag rose">suspended</span>}</span></span>
    </div>
  );
}

/** Two-button decision with an optional/required reason. */
function Decide({ path, options, reasonLabel, requireReasonFor, extra, onDone, notify }) {
  const [reason, setReason] = useState('');
  const [suspend, setSuspend] = useState(false);
  const { busy, error, run } = useAction();
  const go = (decision) => run(async () => {
    await api(path, { method: 'POST', body: { decision, reason: reason || undefined, resolution: reason || undefined, note: reason || undefined, suspend } });
    notify('Decision recorded');
    onDone();
  });
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      {reasonLabel && <input type="text" placeholder={reasonLabel} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
      {extra && <label className="check"><input type="checkbox" checked={suspend} onChange={(e) => setSuspend(e.target.checked)} /> {extra}</label>}
      <ErrorNote error={error} />
      <div className="row wrap">
        {options.map(([d, text, cls]) => <button key={d} type="button" className={`btn sm ${cls ?? ''}`} disabled={busy || (requireReasonFor === d && !reason)} onClick={() => go(d)}>{text}</button>)}
      </div>
    </div>
  );
}

function VerificationQueue({ notify, onChange }) {
  const { data, error, reload } = useApi('/staff/verifications');
  const [open, setOpen] = useState(null);
  const detail = useApi(open ? `/staff/verifications/${open}` : null);
  const done = () => { setOpen(null); reload(); onChange(); };
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <Empty>No verifications waiting.</Empty>;
  return (
    <ul className="list">
      {data.items.map((v) => (
        <li key={v.id}>
          <div className="spread"><Who m={v.member} /><span className="tag gold">{v.kindLabel}</span></div>
          {open !== v.id ? <button type="button" className="btn sm secondary" style={{ marginTop: 8 }} onClick={() => setOpen(v.id)}>Review</button> : !detail.data ? <Loading /> : (
            <div className="stack" style={{ marginTop: 8 }}>
              <p className="small">Profile: {detail.data.member.firstName}, born {detail.data.member.birthDate}, {detail.data.member.gender}</p>
              {detail.data.flags.map((f, i) => <p key={i} className="warning-banner">⚠ {f.detail}</p>)}
              {v.kind === 'ghana_card' && <p>Card number: <b>{detail.data.submission?.cardNumber}</b></p>}
              {v.kind === 'liveness' && <p className="notice">Expected: <b>{detail.data.meta.challenge?.gesture}</b> and paper reading <b>{detail.data.meta.challenge?.code}</b></p>}
              {v.kind === 'status_evidence' && <p>Declared status: <b>{detail.data.meta.declared}</b></p>}
              <div className="review-grid">
                {Object.entries(detail.data.submission ?? {}).filter(([k]) => k !== 'cardNumber').map(([k, src]) => <figure key={k} style={{ margin: 0 }}><img className="review-img" src={src} alt={k} /><figcaption className="small muted">{k}</figcaption></figure>)}
                {detail.data.member.photos.map((p) => <figure key={p.id} style={{ margin: 0 }}><img className="review-img" src={p.data} alt="Profile" /><figcaption className="small muted">profile photo</figcaption></figure>)}
              </div>
              <p className="small muted">Check: name and date of birth match the profile, the face matches the selfie and photos, and the document looks genuine. Images are deleted after your decision.</p>
              <Decide path={`/staff/verifications/${v.id}`} options={[['approve', 'Approve', 'teal'], ['reject', 'Reject', 'danger']]} reasonLabel="Reason shown to the member (required to reject)" requireReasonFor="reject" onDone={done} notify={notify} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function PhotoQueue({ notify, onChange }) {
  const { data, error, reload } = useApi('/staff/photos');
  const done = () => { reload(); onChange(); };
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <Empty>No photos waiting.</Empty>;
  return (
    <div className="review-grid">
      {data.items.map((p) => (
        <div key={p.id} className="card flat" style={{ marginTop: 0, padding: 10 }}>
          <img className="review-img" src={p.data} alt="" />
          <p className="small"><b>{p.member.firstName}</b> #{p.member.id}</p>
          <Decide path={`/staff/photos/${p.id}`} options={[['approve', 'Approve', 'teal'], ['reject', 'Reject', 'danger']]} reasonLabel="Reason (optional)" onDone={done} notify={notify} />
        </div>
      ))}
    </div>
  );
}

function ReportQueue({ notify, onChange, investigate }) {
  const { data, error, reload } = useApi('/staff/reports');
  const done = () => { reload(); onChange(); };
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <Empty>No open reports.</Empty>;
  return (
    <ul className="list">
      {data.items.map((r) => (
        <li key={r.id}>
          <Who m={r.member} />
          <p style={{ marginTop: 8 }}><span className="tag rose">{r.reasonLabel}</span> <span className="small muted">{timeAgo(r.createdAt)} · {r.totalReports} report(s) in total</span></p>
          {r.details && <p className="small">{r.details}</p>}
          {r.message && <p className="notice small">Message: “{r.message}”</p>}
          <button type="button" className="link-btn" onClick={() => investigate(r.member.id)}>Investigate member</button>
          <Decide path={`/staff/reports/${r.id}`} options={[['uphold', 'Uphold', 'danger'], ['dismiss', 'Dismiss', 'secondary']]} reasonLabel="Resolution note (shown to the member if suspended)" extra="Suspend the member" onDone={done} notify={notify} />
        </li>
      ))}
    </ul>
  );
}

function FlagQueue({ notify, onChange, investigate }) {
  const { data, error, reload } = useApi('/staff/flags');
  const done = () => { reload(); onChange(); };
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <Empty>No open risk flags.</Empty>;
  return (
    <ul className="list">
      {data.items.map((f) => (
        <li key={f.id}>
          <Who m={f.member} />
          <p style={{ marginTop: 8 }}><span className={`tag ${f.level === 'high' ? 'rose' : 'gold'}`}>{f.level}</span> <span className="small muted">{f.source} · {timeAgo(f.createdAt)}</span></p>
          <p className="small">{f.detail}</p>
          {f.message && <p className="notice small">“{f.message}”</p>}
          <button type="button" className="link-btn" onClick={() => investigate(f.member.id)}>Investigate member</button>
          <Decide path={`/staff/flags/${f.id}`} options={[['confirm', 'Confirm risk', 'danger'], ['dismiss', 'False alarm', 'secondary']]} reasonLabel="Reason (shown if suspended)" extra="Suspend the member" onDone={done} notify={notify} />
        </li>
      ))}
    </ul>
  );
}

function AppealQueue({ notify, onChange }) {
  const { data, error, reload } = useApi('/staff/appeals');
  const done = () => { reload(); onChange(); };
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <Empty>No open appeals.</Empty>;
  return (
    <ul className="list">
      {data.items.map((a) => (
        <li key={a.id}>
          <Who m={a.member} />
          <p className="small" style={{ marginTop: 8 }}><b>Suspended for:</b> {a.suspendedReason}</p>
          <p className="notice small">{a.body}</p>
          <Decide path={`/staff/appeals/${a.id}`} options={[['reinstate', 'Reinstate', 'teal'], ['deny', 'Deny', 'secondary']]} reasonLabel="Decision note to the member" onDone={done} notify={notify} />
        </li>
      ))}
    </ul>
  );
}

function Investigation({ id, onClose, notify }) {
  const { data, error, reload } = useApi(`/staff/users/${id}`);
  const [reason, setReason] = useState('');
  const { busy, error: actError, run } = useAction();
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const act = (what) => run(async () => { await api(`/staff/users/${id}/${what}`, { method: 'POST', body: { reason } }); notify(what === 'suspend' ? 'Member suspended' : 'Member reinstated'); reload(); });
  return (
    <section className="card">
      <div className="spread"><h2>Investigation #{id}</h2><button type="button" className="btn sm ghost" onClick={onClose}>Close</button></div>
      <Who m={data.member} />
      {data.trust && <p className="small" style={{ marginTop: 8 }}>Score {data.trust.score} · {data.trust.steps.map((s) => `${s.label}: ${s.status}`).join(' · ')}</p>}
      <h3>Reports ({data.reports.length})</h3>
      <ul className="small">{data.reports.map((r) => <li key={r.id}>{r.reason} · {r.status}{r.details ? ` · ${r.details}` : ''}</li>)}</ul>
      <h3>Risk flags ({data.flags.length})</h3>
      <ul className="small">{data.flags.map((f) => <li key={f.id}>{f.level} · {f.source} · {f.status} · {f.detail}</li>)}</ul>
      <ErrorNote error={actError} />
      {data.member.status === 'suspended' ? (
        <><p className="small">Suspended: {data.suspendedReason}</p><button type="button" className="btn sm teal" disabled={busy} onClick={() => act('reinstate')}>Reinstate</button></>
      ) : (
        <div className="row"><input type="text" placeholder="Suspension reason (shown to member)" value={reason} onChange={(e) => setReason(e.target.value)} /><button type="button" className="btn sm danger" disabled={busy || !reason} onClick={() => act('suspend')}>Suspend</button></div>
      )}
    </section>
  );
}

const QUEUES = [
  ['verifications', 'Verifications', VerificationQueue, ['trust_analyst', 'admin']],
  ['photos', 'Photos', PhotoQueue],
  ['reports', 'Reports', ReportQueue],
  ['flags', 'Risk flags', FlagQueue, ['trust_analyst', 'admin']],
  ['appeals', 'Appeals', AppealQueue],
];

export function Staff({ notify }) {
  const overview = useApi('/staff/overview');
  const role = overview.data?.role;
  const queues = QUEUES.filter(([, , , roles]) => !roles || roles.includes(role));
  const [tab, setTab] = useState(null);
  const [investigating, setInvestigating] = useState(null);
  const active = tab ?? queues[0]?.[0];
  const Queue = queues.find(([k]) => k === active)?.[2];
  return (
    <Screen title="Trust & Safety" backTo="/me">
      <ErrorNote error={overview.error} />
      {overview.data && (
        <>
          <p className="small muted">Detection → risk scoring → human review → suspension → appeals → resolution. Every decision is recorded in the audit log.</p>
          <div className="tabs">{queues.map(([k, l]) => <button key={k} type="button" className={`chip ${active === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l} ({overview.data.queues[k]})</button>)}</div>
          {investigating && <Investigation id={investigating} onClose={() => setInvestigating(null)} notify={notify} />}
          <section className="card">{Queue && <Queue key={active} notify={notify} onChange={overview.reload} investigate={setInvestigating} />}</section>
        </>
      )}
    </Screen>
  );
}

export function Admin({ notify }) {
  const stats = useApi('/admin/stats');
  const churches = useApi('/admin/churches');
  const [q, setQ] = useState('');
  const users = useApi(`/admin/users?q=${encodeURIComponent(q)}`);
  const audit = useApi('/admin/audit');
  const [ev, setEv] = useState({ title: '', startsAt: '', venue: '', city: '', capacity: '', description: '' });
  const [resetLink, setResetLink] = useState(null);
  const { busy, error, run } = useAction();
  const s = stats.data;
  return (
    <Screen title="Admin" backTo="/me">
      <ErrorNote error={stats.error || error} />
      {s && (
        <div className="stats">
          {[['members', 'members'], ['newThisWeek', 'new this week'], ['activeThisWeek', 'active this week'], ['identityVerified', 'ID verified'], ['shieldHolders', 'Shield holders'], ['matches', 'matches'], ['inCourtship', 'in courtship'], ['engaged', 'engaged'], ['messagesThisWeek', 'messages this week'], ['flaggedMessages', 'scam-flagged messages'], ['openReports', 'open reports'], ['suspended', 'suspended'], ['churches', 'partner churches'], ['premium', 'Premium']].map(([k, l]) => <div key={k} className="stat"><b>{s[k]}</b><span>{l}</span></div>)}
        </div>
      )}
      {s && <p className="small muted" style={{ marginTop: 8 }}>Tiers: {Object.entries(s.tiers).map(([t, n]) => `${t} ${n}`).join(' · ') || 'none yet'}</p>}
      <section className="card">
        <h2>Churches</h2>
        <ul className="list">{churches.data?.churches.map((c) => (
          <li key={c.id} className="spread">
            <span><b>{c.name}</b><span className="block small muted">{c.denomination} · {c.city} · {c.applicant_email ?? ''} · {c.members} members</span></span>
            {c.status === 'pending' ? (
              <span className="row"><button type="button" className="btn sm teal" disabled={busy} onClick={() => run(async () => { await api(`/admin/churches/${c.id}`, { method: 'POST', body: { decision: 'approve' } }); notify('Church approved'); churches.reload(); })}>Approve</button>
                <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api(`/admin/churches/${c.id}`, { method: 'POST', body: { decision: 'reject' } }); churches.reload(); })}>Reject</button></span>
            ) : <span className={`tag ${c.status === 'approved' ? '' : 'rose'}`}>{c.status}</span>}
          </li>
        ))}</ul>
      </section>
      <section className="card">
        <h2>Members & roles</h2>
        <input type="search" placeholder="Search email or first name" value={q} onChange={(e) => setQ(e.target.value)} />
        {resetLink && <p className="notice small" style={{ wordBreak: 'break-all', marginTop: 8 }}>Reset link (valid 24h): {resetLink}</p>}
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data">
            <thead><tr><th>Member</th><th>Role</th><th /></tr></thead>
            <tbody>{users.data?.users.map((u) => (
              <tr key={u.id}>
                <td>{u.first_name ?? '-'} <span className="small muted block">{u.email}{u.status === 'suspended' ? ' · suspended' : ''}</span></td>
                <td><select value={u.role} onChange={(e) => run(async () => { await api(`/admin/users/${u.id}/role`, { method: 'PUT', body: { role: e.target.value } }); notify('Role updated'); users.reload(); })}>
                  {['member', 'moderator', 'trust_analyst', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
                </select></td>
                <td><button type="button" className="link-btn small" onClick={() => run(async () => setResetLink((await api(`/admin/users/${u.id}/reset-link`, { method: 'POST' })).link))}>Reset link</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/admin/events', { method: 'POST', body: { ...ev, startsAt: ev.startsAt ? new Date(ev.startsAt).toISOString() : '' } }); notify('Event published'); setEv({ title: '', startsAt: '', venue: '', city: '', capacity: '', description: '' }); }); }}>
        <h2>Publish a platform event</h2>
        <Field label="Title"><input type="text" required value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} /></Field>
        <div className="two">
          <Field label="When"><input type="datetime-local" required value={ev.startsAt} onChange={(e) => setEv({ ...ev, startsAt: e.target.value })} /></Field>
          <Field label="Capacity"><input type="number" min={1} value={ev.capacity} onChange={(e) => setEv({ ...ev, capacity: e.target.value })} /></Field>
        </div>
        <div className="two">
          <Field label="Venue"><input type="text" required value={ev.venue} onChange={(e) => setEv({ ...ev, venue: e.target.value })} /></Field>
          <Field label="City"><input type="text" value={ev.city} onChange={(e) => setEv({ ...ev, city: e.target.value })} /></Field>
        </div>
        <Field label="Description"><textarea value={ev.description} onChange={(e) => setEv({ ...ev, description: e.target.value })} /></Field>
        <button className="btn" disabled={busy}>Publish</button>
      </form>
      <section className="card">
        <h2>Audit log</h2>
        <ul className="list small">{audit.data?.entries.slice(0, 50).map((a) => <li key={a.id}>{timeAgo(a.created_at)} · {a.actor_email ?? 'system'} · <b>{a.action}</b> {a.target_type} #{a.target_id}</li>)}</ul>
      </section>
    </Screen>
  );
}
