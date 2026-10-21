import { useEffect, useState } from 'react';
import { api, fmtDateTime, timeAgo } from '../api.js';
import { useAction, useApi } from '../hooks.js';
import { Empty, ErrorNote, Field, Loading, Screen } from '../components/ui.jsx';

export function Community({ notify }) {
  const dev = useApi('/devotional');
  const events = useApi('/events');
  const { run } = useAction();
  const d = dev.data?.devotional;
  const rsvp = (e) => run(async () => {
    await api(`/events/${e.id}/rsvp`, { method: e.going ? 'DELETE' : 'POST' });
    notify(e.going ? 'RSVP cancelled' : `You're going to ${e.title}`);
    events.reload();
  });
  return (
    <>
      <h1>Community</h1>
      {d && (
        <section className="card hero">
          <p className="small muted" style={{ margin: 0 }}>Today's devotional</p>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.3rem' }}>{d.title}</h2>
          <p className="verse">“{d.verse}” <span className="small">({d.ref}, KJV)</span></p>
          <p>{d.reflection}</p>
          <p className="small"><b>Prayer:</b> {d.prayer}</p>
        </section>
      )}
      <section className="card">
        <h2>Upcoming events</h2>
        <ErrorNote error={events.error} />
        {!events.data ? <Loading /> : events.data.events.length === 0 ? <Empty>No events yet. Partner churches post fellowships, seminars and singles' retreats here.</Empty> : (
          <ul className="list">
            {events.data.events.map((e) => (
              <li key={e.id}>
                <b>{e.title}</b>
                <span className="block small muted">{fmtDateTime(e.starts_at)} · {e.venue}{e.city ? `, ${e.city}` : ''}</span>
                {e.church_name && <span className="block small">Hosted by {e.church_name}</span>}
                {e.description && <p className="small" style={{ marginTop: 4 }}>{e.description}</p>}
                <div className="spread">
                  <span className="small muted">{e.rsvps} going{e.capacity ? ` · ${e.capacity} places` : ''}</span>
                  <button type="button" className={`btn sm ${e.going ? 'secondary' : ''}`} disabled={!e.going && e.full} onClick={() => rsvp(e)}>{e.going ? 'Going ✓' : e.full ? 'Full' : 'RSVP'}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card menu">
        <a className="menu-link" href="#/safety"><span className="ico">🧭</span><span className="grow"><b>Safe meet-up</b><span className="block small muted">Share your plans with someone you trust</span></span>›</a>
        <a className="menu-link" href="#/legal/guidelines"><span className="ico">📜</span><span className="grow"><b>Community Guidelines</b></span>›</a>
        <a className="menu-link" href="#/church/register"><span className="ico">⛪</span><span className="grow"><b>Partner your church</b><span className="block small muted">Verify members, host events and mentor couples</span></span>›</a>
      </section>
    </>
  );
}

export function Notifications({ onRead }) {
  const { data, error } = useApi('/notifications');
  useEffect(() => {
    if (data?.unread) api('/notifications/read', { method: 'POST' }).then(onRead).catch(() => {});
  }, [data, onRead]);
  return (
    <Screen title="Notifications">
      <ErrorNote error={error} />
      {!data ? !error && <Loading /> : data.items.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <ul className="card list">
          {data.items.map((n) => (
            <li key={n.id}>
              <a className={`notif ${n.read_at ? '' : 'unread'}`} href={n.link ?? '#/'}>
                <b>{n.title}</b>
                {n.body && <span className="small">{n.body}</span>}
                <span className="small muted">{timeAgo(n.created_at)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

const TIPS = [
  'Meet in a busy public place for the first few dates: a café, restaurant or church event.',
  'Arrange your own transport there and back.',
  'Tell someone you trust where you are going (use the form below).',
  'Never send money, mobile money, airtime or gift cards to someone you met online.',
  'Video call before meeting so you know the person matches their photos.',
  'Trust your instincts. You can leave at any time, and report anything that feels wrong.',
];

export function Safety({ matchId, notify }) {
  const plans = useApi('/safety-plans');
  const matches = useApi('/matches');
  const [form, setForm] = useState({ matchId: matchId ?? '', place: '', startsAt: '', contactName: '', contactEmail: '', contactPhone: '' });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const act = (p, what) => run(async () => {
    await api(`/safety-plans/${p.id}/${what}`, { method: 'POST' });
    notify(what === 'safe' ? `${p.contact_name} has been told you're safe` : `${p.contact_name} has been alerted`);
    plans.reload();
  });
  return (
    <Screen title="Safe meet-up">
      <section className="card">
        <h2>Before you meet</h2>
        <ul className="small">{TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="small"><b>Emergency in Ghana:</b> Police 191 or 18555 · Ambulance 193</p>
      </section>
      <form className="card" onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api('/safety-plans', { method: 'POST', body: { ...form, matchId: form.matchId || undefined, startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : '' } });
          notify(`Plan shared with ${form.contactName}`);
          setForm({ ...form, place: '', startsAt: '' });
          plans.reload();
        });
      }}>
        <h2>Share a plan</h2>
        <Field label="Who are you meeting?">
          <select value={form.matchId} onChange={set('matchId')}>
            <option value="">Someone else</option>
            {matches.data?.matches.map((m) => <option key={m.id} value={m.id}>{m.member.firstName}</option>)}
          </select>
        </Field>
        <Field label="Where"><input type="text" required maxLength={200} placeholder="e.g. Accra Mall food court" value={form.place} onChange={set('place')} /></Field>
        <Field label="When"><input type="datetime-local" required value={form.startsAt} onChange={set('startsAt')} /></Field>
        <Field label="Trusted contact's name"><input type="text" required maxLength={80} value={form.contactName} onChange={set('contactName')} /></Field>
        <div className="two">
          <Field label="Their phone"><input type="tel" value={form.contactPhone} onChange={set('contactPhone')} /></Field>
          <Field label="Their email"><input type="email" value={form.contactEmail} onChange={set('contactEmail')} /></Field>
        </div>
        <ErrorNote error={error} />
        <button className="btn block" disabled={busy}>Share plan</button>
      </form>
      {plans.data?.plans.length > 0 && (
        <section className="card">
          <h2>My plans</h2>
          <ul className="list">
            {plans.data.plans.map((p) => (
              <li key={p.id}>
                <b>{p.place}</b><span className="block small muted">{fmtDateTime(p.starts_at)} · shared with {p.contact_name}</span>
                {p.status === 'planned' ? (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button type="button" className="btn sm teal" disabled={busy} onClick={() => act(p, 'safe')}>I'm home safe</button>
                    <button type="button" className="btn sm danger" disabled={busy} onClick={() => { if (window.confirm(`Send an emergency alert to ${p.contact_name}?`)) act(p, 'alert'); }}>Emergency alert</button>
                  </div>
                ) : <span className={`tag ${p.status === 'safe' ? '' : 'rose'}`}>{p.status === 'safe' ? 'Checked in safe' : 'Alert sent'}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  );
}
