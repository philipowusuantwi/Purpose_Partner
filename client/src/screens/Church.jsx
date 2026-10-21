import { useState } from 'react';
import { api, fmtDateTime, label } from '../api.js';
import { useAction, useApi } from '../hooks.js';
import { Choice, Empty, ErrorNote, Field, Loading, Screen } from '../components/ui.jsx';

export function ChurchRegister({ meta, me, notify }) {
  const mine = useApi('/church-portal');
  const [f, setF] = useState({ name: '', denomination: '', region: '', city: '', address: '', phone: '', title: 'Pastor' });
  const { busy, error, run } = useAction();
  const set = (k) => (x) => setF({ ...f, [k]: typeof x === 'string' ? x : x.target.value });
  return (
    <Screen title="Partner your church">
      <section className="card hero">
        <h2>Strengthen marriages in your congregation</h2>
        <ul className="small">
          <li>Confirm your members and their relationship status, so they earn the Marriage Transparency Shield</li>
          <li>Host singles' fellowships, seminars and retreats</li>
          <li>Walk with couples through courtship with mentorship</li>
        </ul>
      </section>
      {mine.data?.churches.length > 0 && (
        <section className="card">
          <h2>Your churches</h2>
          <ul className="list">{mine.data.churches.map((c) => (
            <li key={c.id} className="spread"><span><b>{c.name}</b><span className="block small muted">{c.city} · {c.title}</span></span>
              {c.status === 'approved' ? <a className="btn sm" href={`#/church/${c.id}`}>Open portal{c.pending ? ` (${c.pending})` : ''}</a> : <span className="tag gold">{c.status}</span>}</li>
          ))}</ul>
        </section>
      )}
      {me.profile ? (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/churches', { method: 'POST', body: f }); notify('Thank you! Our team will contact you to complete partnership.'); mine.reload(); }); }}>
          <h2>Register a church</h2>
          <p className="small muted">For pastors and authorised church administrators. We confirm every church with its leadership before approval.</p>
          <Field label="Church name"><input type="text" required maxLength={120} value={f.name} onChange={set('name')} /></Field>
          <Field label="Denomination"><Choice field="denomination" value={f.denomination} options={meta.denominations} onChange={set('denomination')} placeholder="Choose…" /></Field>
          <div className="two">
            <Field label="Region"><Choice field="region" value={f.region} options={meta.regions} onChange={set('region')} placeholder="Choose…" /></Field>
            <Field label="City"><input type="text" required value={f.city} onChange={set('city')} /></Field>
          </div>
          <Field label="Address"><input type="text" maxLength={200} value={f.address} onChange={set('address')} /></Field>
          <div className="two">
            <Field label="Church phone"><input type="tel" value={f.phone} onChange={set('phone')} /></Field>
            <Field label="Your role"><input type="text" maxLength={40} value={f.title} onChange={set('title')} /></Field>
          </div>
          <ErrorNote error={error} />
          <button className="btn block" disabled={busy}>Submit for approval</button>
        </form>
      ) : <p className="notice">Complete your profile first to register a church.</p>}
    </Screen>
  );
}

function Claim({ churchId, m, onDone, notify }) {
  const [attest, setAttest] = useState('');
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const decide = (decision) => run(async () => {
    await api(`/church-portal/${churchId}/memberships/${m.userId}`, { method: 'POST', body: { decision, statusAttested: decision === 'confirm' ? attest : undefined, note: note || undefined } });
    notify(decision === 'confirm' ? `${m.firstName} confirmed` : 'Request declined');
    onDone();
  });
  return (
    <li className="stack">
      <div><b>{m.firstName}, {m.age}</b> · {m.city}<span className="block small muted">Declared: {m.declaredStatus ? label('relationship_status', m.declaredStatus) : 'not yet'} · Member since {m.memberSince ?? '?'}{m.ministry ? ` · ${m.ministry}` : ''}</span></div>
      <Field label="What do you know about their relationship status?">
        <select value={attest} onChange={(e) => setAttest(e.target.value)}>
          <option value="">Choose…</option>
          <option value="confirms_single">I confirm they are single</option>
          <option value="cannot_confirm">I cannot confirm their status</option>
          <option value="not_single">I believe they are married or in a relationship</option>
        </select>
      </Field>
      <input type="text" placeholder="Note (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorNote error={error} />
      <div className="row">
        <button type="button" className="btn sm" disabled={busy || !attest} onClick={() => decide('confirm')}>Confirm member</button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => decide('decline')}>Not a member</button>
      </div>
    </li>
  );
}

export function ChurchPortal({ id, notify }) {
  const { data, error, reload } = useApi(`/church-portal/${id}`);
  const [ev, setEv] = useState({ title: '', startsAt: '', venue: '', capacity: '', description: '' });
  const [admin, setAdmin] = useState({ email: '', title: 'Church admin' });
  const { busy, error: actError, run } = useAction();
  if (error) return <Screen title="Church portal" backTo="/me"><ErrorNote error={error} /></Screen>;
  if (!data) return <Screen title="Church portal" backTo="/me"><Loading /></Screen>;
  return (
    <Screen title={data.church.name} backTo="/me">
      <div className="stats">
        <div className="stat"><b>{data.report.confirmedMembers}</b><span>confirmed members</span></div>
        <div className="stat"><b>{data.report.shieldHolders}</b><span>Shield holders</span></div>
        <div className="stat"><b>{data.report.matchesAmongMembers}</b><span>member matches</span></div>
        <div className="stat"><b>{data.report.upcomingEvents}</b><span>upcoming events</span></div>
      </div>
      <section className="card">
        <h2>Membership requests ({data.pending.length})</h2>
        <p className="small muted">Only confirm people you know to be members in good standing. Your confirmation is recorded.</p>
        {data.pending.length === 0 ? <Empty>No pending requests.</Empty> : <ul className="list">{data.pending.map((m) => <Claim key={m.userId} churchId={id} m={m} onDone={reload} notify={notify} />)}</ul>}
      </section>
      <section className="card">
        <h2>Confirmed members</h2>
        {data.members.length === 0 ? <Empty>None yet.</Empty> : <ul className="list small">{data.members.map((m) => <li key={m.userId}>{m.firstName}, {m.age} · {m.city}{m.statusAttested === 'confirms_single' ? ' · status confirmed' : ''}</li>)}</ul>}
      </section>
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/church-portal/${id}/events`, { method: 'POST', body: { ...ev, startsAt: ev.startsAt ? new Date(ev.startsAt).toISOString() : '' } }); notify('Event published'); setEv({ title: '', startsAt: '', venue: '', capacity: '', description: '' }); reload(); }); }}>
        <h2>Host an event</h2>
        <Field label="Title"><input type="text" required maxLength={120} value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} /></Field>
        <div className="two">
          <Field label="When"><input type="datetime-local" required value={ev.startsAt} onChange={(e) => setEv({ ...ev, startsAt: e.target.value })} /></Field>
          <Field label="Capacity"><input type="number" min={1} value={ev.capacity} onChange={(e) => setEv({ ...ev, capacity: e.target.value })} /></Field>
        </div>
        <Field label="Venue"><input type="text" required maxLength={200} value={ev.venue} onChange={(e) => setEv({ ...ev, venue: e.target.value })} /></Field>
        <Field label="Description"><textarea maxLength={2000} value={ev.description} onChange={(e) => setEv({ ...ev, description: e.target.value })} /></Field>
        <ErrorNote error={actError} />
        <button className="btn" disabled={busy}>Publish event</button>
        {data.events.length > 0 && (
          <ul className="list small" style={{ marginTop: 16 }}>
            {data.events.map((e) => (
              <li key={e.id} className="spread"><span><b>{e.title}</b> · {fmtDateTime(e.starts_at)} · {e.rsvps} going {e.status === 'cancelled' && <span className="tag rose">cancelled</span>}</span>
                {e.status === 'published' && <button type="button" className="link-btn" onClick={() => run(async () => { await api(`/church-portal/${id}/events/${e.id}/cancel`, { method: 'POST' }); reload(); })}>Cancel</button>}</li>
            ))}
          </ul>
        )}
      </form>
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/church-portal/${id}/admins`, { method: 'POST', body: admin }); notify('Admin added'); setAdmin({ email: '', title: 'Church admin' }); reload(); }); }}>
        <h2>Leaders with access</h2>
        <ul className="list small">{data.admins.map((a) => <li key={a.user_id}>{a.first_name ?? 'Leader'} · {a.title}</li>)}</ul>
        <div className="two" style={{ marginTop: 12 }}>
          <Field label="Their account email"><input type="email" required value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></Field>
          <Field label="Role"><input type="text" value={admin.title} onChange={(e) => setAdmin({ ...admin, title: e.target.value })} /></Field>
        </div>
        <button className="btn secondary" disabled={busy}>Add leader</button>
      </form>
    </Screen>
  );
}
