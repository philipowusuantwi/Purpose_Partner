import { useState } from 'react';
import { api, label } from '../api.js';
import { navigate } from '../router.js';
import { useAction, useApi } from '../hooks.js';
import { Empty, ErrorNote, Loading, ReportBlock, Screen, TrustBadges } from '../components/ui.jsx';

function Facts({ m }) {
  const facts = [
    ['Denomination', m.denomination],
    ['Church', m.church ? `${m.church.name}` : 'Not yet confirmed'],
    ['Attends', label('church_attendance', m.churchAttendance)],
    ['Status', m.relationshipStatus ? label('relationship_status', m.relationshipStatus) : 'Not declared'],
    ['Children', `${label('wants_children', m.wantsChildren)}${m.hasChildren ? ' · has children' : ''}`],
    ['Marriage', label('marriage_timeline', m.marriageTimeline)],
    m.occupation && ['Work', m.occupation],
    m.education && ['Education', m.education],
    ['Alcohol', label('drinks', m.drinks)],
    m.openToRelocate && ['Relocation', 'Open to relocating'],
  ].filter(Boolean);
  return <div className="facts">{facts.map(([k, val]) => <div key={k}><span>{k}</span>{val}</div>)}</div>;
}

function InterestActions({ member, onDone, notify }) {
  const [note, setNote] = useState('');
  const [writing, setWriting] = useState(false);
  const { busy, error, run } = useAction();
  const act = (kind) => run(async () => {
    const r = await api('/interests', { method: 'POST', body: { toId: member.id, kind, note: kind === 'interest' && note ? note : undefined } });
    if (r.matched) {
      notify(`It's a match with ${member.firstName}! 🎉`);
      navigate(`/matches/${r.matchId}`);
    } else {
      if (kind === 'interest') notify(`Interest sent to ${member.firstName}`);
      onDone?.();
    }
  });
  return (
    <>
      {writing && <textarea placeholder={`A gracious note for ${member.firstName} (optional)`} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 12 }} />}
      <ErrorNote error={error} />
      {error?.code === 'premium_required' && <a className="btn gold block" href="#/premium" style={{ marginBottom: 8 }}>See Premium</a>}
      <div className="actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => act('pass')}>Pass</button>
        {writing ? <button type="button" className="btn" disabled={busy} onClick={() => act('interest')}>Send interest</button>
          : <button type="button" className="btn" disabled={busy} onClick={() => setWriting(true)}>♡ I'm interested</button>}
      </div>
    </>
  );
}

function ProfileCard({ m, children }) {
  return (
    <article className="card profile-card">
      <a href={`#/members/${m.id}`} aria-label={`View ${m.firstName}'s full profile`}>
        {m.photos[0] ? <img className="photo" src={m.photos[0].data} alt={`${m.firstName}`} /> : <div className="photo placeholder">{m.firstName[0]}</div>}
      </a>
      <div className="body">
        <div className="spread">
          <h2>{m.firstName}, {m.age}</h2>
          {m.compatibility && <span className="compat"><b>{m.compatibility.score}</b>% match</span>}
        </div>
        <p className="muted small">{[m.city, m.region].filter(Boolean).join(', ')} · {m.denomination}</p>
        <TrustBadges trust={m.trust} />
        {m.compatibility?.reasons.length > 0 && <ul className="reasons">{m.compatibility.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        {m.faithStatement && <p className="small"><i>“{m.faithStatement}”</i></p>}
        {children}
      </div>
    </article>
  );
}

export function Discover({ me, notify }) {
  const [filters, setFilters] = useState({ verifiedOnly: false, shieldOnly: false });
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k]) => [k, '1'])).toString();
  const { data, error, loading, reload, setData } = useApi(`/discover${qs ? `?${qs}` : ''}`);
  const toggle = (k) => setFilters((f) => ({ ...f, [k]: !f[k] }));
  const current = data?.members[0];
  const next = () => setData({ ...data, members: data.members.slice(1) });

  const trust = me.trust;
  return (
    <>
      {trust && trust.score < 40 && (
        <a className="card hero" href="#/trust" style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginBottom: 16 }}>
          <b>Build trust to get better matches</b>
          <p className="small muted">Verified members receive far more interest. Verify your phone and Ghana Card to start.</p>
        </a>
      )}
      <div className="tabs" role="group" aria-label="Filters">
        <button type="button" className={`chip ${filters.verifiedOnly ? 'active' : ''}`} aria-pressed={filters.verifiedOnly} onClick={() => toggle('verifiedOnly')}>✓ ID verified only</button>
        <button type="button" className={`chip ${filters.shieldOnly ? 'active' : ''}`} aria-pressed={filters.shieldOnly} onClick={() => toggle('shieldOnly')}>🛡 Shield holders</button>
        <a className="chip" href="#/interests" style={{ textDecoration: 'none' }}>♡ Interested in you</a>
      </div>
      {data?.interestsLeft !== null && data?.interestsLeft !== undefined && <p className="small muted">{data.interestsLeft} interests left today</p>}
      <ErrorNote error={error} />
      {loading && <Loading label="Finding compatible believers…" />}
      {current ? (
        <ProfileCard m={current}>
          <InterestActions key={current.id} member={current} onDone={next} notify={notify} />
        </ProfileCard>
      ) : data && (
        <div className="card center stack">
          <h2>That's everyone for now</h2>
          <p className="muted small">New members join every day. Complete your profile and verification so you appear to more people.</p>
          <button type="button" className="btn secondary" onClick={reload}>Refresh</button>
        </div>
      )}
    </>
  );
}

export function MemberView({ id, me, notify, matched }) {
  const { data, error } = useApi(`/members/${id}`);
  const isMe = Number(id) === me.user.id;
  const m = data?.member;
  return (
    <Screen title={m ? `${m.firstName}, ${m.age}` : 'Profile'}>
      <ErrorNote error={error} />
      {!m ? !error && <Loading /> : (
        <>
          {m.photos.length > 0 ? <div className="gallery">{m.photos.map((p) => <img key={p.id} src={p.data} alt="" />)}</div>
            : <div className="card center muted">{isMe ? 'Your photos appear here once approved.' : 'No photos yet.'}</div>}
          <section className="card">
            <p className="muted small">{[m.city, m.region, m.country].filter(Boolean).join(', ')}</p>
            <TrustBadges trust={m.trust} />
            {m.faithStatement && <><h3 style={{ marginTop: 12 }}>My walk with God</h3><p>{m.faithStatement}</p></>}
            {m.about && <><h3 style={{ marginTop: 12 }}>About me</h3><p style={{ whiteSpace: 'pre-line' }}>{m.about}</p></>}
            <Facts m={m} />
            {m.attachment && <p className="small muted">Relationship style: {label('attachment', m.attachment)}</p>}
          </section>
          {!isMe && (
            <section className="card">
              {!matched && <InterestActions member={m} notify={notify} onDone={() => navigate('/')} />}
              <div style={{ marginTop: matched ? 0 : 12 }}><ReportBlock userId={m.id} name={m.firstName} notify={notify} onDone={() => navigate('/')} /></div>
            </section>
          )}
        </>
      )}
    </Screen>
  );
}

export function Interests({ notify }) {
  const { data, error, reload } = useApi('/interests/received');
  return (
    <Screen title="Interested in you" backTo="/">
      <ErrorNote error={error} />
      {!data ? !error && <Loading /> : data.premiumRequired ? (
        <div className="card center stack">
          <p className="big"><b style={{ fontFamily: 'var(--display)', fontSize: '2.4rem' }}>{data.count}</b></p>
          <p>{data.count === 1 ? 'person has' : 'people have'} expressed interest in you.</p>
          <p className="small muted">Keep exploring Discover: if they appear and you are interested too, it's a match. Premium shows you who they are.</p>
          <a className="btn gold" href="#/premium">See who with Premium</a>
        </div>
      ) : data.members.length === 0 ? <Empty>No new interest yet. Completing your verification helps others trust your profile.</Empty> : (
        data.members.map((m) => (
          <ProfileCard key={m.id} m={m}>
            {m.note && <p className="notice">“{m.note}”</p>}
            <InterestActions member={m} notify={notify} onDone={reload} />
          </ProfileCard>
        ))
      )}
    </Screen>
  );
}
