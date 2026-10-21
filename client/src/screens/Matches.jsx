import { useEffect, useRef, useState } from 'react';
import { api, timeAgo } from '../api.js';
import { navigate } from '../router.js';
import { useAction, useApi } from '../hooks.js';
import { Avatar, Empty, ErrorNote, Loading, ReportBlock, Screen, TrustBadges } from '../components/ui.jsx';

export function Matches() {
  const { data, error } = useApi('/matches');
  return (
    <>
      <h1>Matches</h1>
      <ErrorNote error={error} />
      {!data ? !error && <Loading /> : data.matches.length === 0 ? (
        <div className="card center stack">
          <p>When you and someone else both express interest, you'll be able to talk here.</p>
          <a className="btn" href="#/">Go to Discover</a>
        </div>
      ) : (
        <ul className="card list">
          {data.matches.map((m) => (
            <li key={m.id}>
              <a className="person" href={`#/matches/${m.id}`}>
                <Avatar photo={m.member.photo} name={m.member.firstName} />
                <span className="grow">
                  <b>{m.member.firstName}, {m.member.age}</b>
                  <span className="block small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.lastMessage ?? 'Say hello 👋'}</span>
                </span>
                <span className="right">
                  {m.lastAt && <span className="small muted block">{timeAgo(m.lastAt)}</span>}
                  {m.unread > 0 && <span className="unread-dot" style={{ marginLeft: 'auto' }}>{m.unread}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted center" style={{ marginTop: 16 }}>Never send money to someone you met online. <a href="#/safety">Safety tools</a></p>
    </>
  );
}

const OPENERS = ['How did you come to faith?', 'What does a Christ-centred marriage look like to you?', 'What is your favourite verse right now?'];

function Journey({ match, stages, onChange, firstName }) {
  const { busy, error, run } = useAction();
  const idx = stages.findIndex((s) => s.id === match.stage);
  const next = stages[idx + 1];
  const act = (body) => run(async () => onChange(await api(`/matches/${match.id}/stage`, { method: 'POST', body })));
  return (
    <section className="card">
      <div className="spread"><b>Your journey</b><span className="small muted">{stages[idx].label}</span></div>
      <div className="journey" aria-hidden="true">{stages.map((s, i) => <span key={s.id} className={i <= idx ? 'on' : ''} />)}</div>
      {match.status !== 'active' ? null : match.proposedStage && !match.proposedByMe ? (
        <div className="stack">
          <p className="small">{firstName} would like to move to <b>{stages.find((s) => s.id === match.proposedStage).label}</b>.</p>
          <div className="row"><button type="button" className="btn sm" disabled={busy} onClick={() => act({ stage: match.proposedStage })}>Agree</button><button type="button" className="btn sm ghost" disabled={busy} onClick={() => act({ decline: true })}>Not yet</button></div>
        </div>
      ) : match.proposedStage ? (
        <p className="small muted">Waiting for {firstName} to agree to: {stages.find((s) => s.id === match.proposedStage).label}.</p>
      ) : next && (
        <button type="button" className="btn sm secondary" disabled={busy} onClick={() => act({ stage: next.id })}>Propose: {next.label}</button>
      )}
      <ErrorNote error={error} />
    </section>
  );
}

export function Chat({ id, notify }) {
  const detail = useApi(`/matches/${id}`);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [reporting, setReporting] = useState(null);
  const lastId = useRef(0);
  const { busy, error, run } = useAction();

  useEffect(() => {
    let alive = true;
    lastId.current = 0;
    setMessages([]);
    const poll = async () => {
      try {
        const r = await api(`/matches/${id}/messages?after=${lastId.current}`);
        if (alive && r.messages.length) {
          lastId.current = r.messages.at(-1).id;
          setMessages((m) => [...m, ...r.messages]);
          window.scrollTo(0, document.body.scrollHeight);
        }
      } catch { /* shown by detail */ }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [id]);

  const send = (text) => run(async () => {
    const r = await api(`/matches/${id}/messages`, { method: 'POST', body: { body: text } });
    setBody('');
    if (r.risk !== 'none') notify(r.risk === 'high' ? 'Reminder: never ask for or send money on Purpose Partner.' : 'Tip: take time to know someone before sharing contact details.');
    const more = await api(`/matches/${id}/messages?after=${lastId.current}`);
    if (more.messages.length) { lastId.current = more.messages.at(-1).id; setMessages((m) => [...m, ...more.messages]); }
  });

  const d = detail.data;
  if (detail.error) return <Screen title="Conversation" backTo="/matches"><ErrorNote error={detail.error} /></Screen>;
  if (!d) return <Screen title="Conversation" backTo="/matches"><Loading /></Screen>;
  const m = d.member;
  const closed = d.match.status !== 'active';

  return (
    <Screen title={m.firstName} backTo="/matches" right={<button type="button" className="icon-btn" aria-label="More" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>⋯</button>}>
      {showMore && (
        <section className="card stack">
          <a className="person" href={`#/members/${m.id}?from=match`}><span className="grow"><b>View {m.firstName}'s profile</b></span>›</a>
          <TrustBadges trust={m.trust} />
          <p className="small">Compatibility <b>{d.compatibility.score}%</b>{d.compatibility.reasons.length > 0 && ` · ${d.compatibility.reasons.join(' · ')}`}</p>
          <a className="btn sm secondary" href={`#/safety?match=${d.match.id}`}>Plan a safe meet-up</a>
          {!closed && <button type="button" className="link-btn" onClick={() => { if (window.confirm(`End your conversation with ${m.firstName}?`)) api(`/matches/${id}/close`, { method: 'POST' }).then(() => navigate('/matches')); }}>End conversation</button>}
          <ReportBlock userId={m.id} name={m.firstName} notify={notify} onDone={() => navigate('/matches')} />
        </section>
      )}
      <Journey match={d.match} stages={d.stages} firstName={m.firstName} onChange={() => detail.reload()} />
      {!m.trust?.identityVerified && <p className="notice small" style={{ marginTop: 12 }}>{m.firstName} has not completed ID verification yet. Take extra care, and never send money.</p>}
      <div className="chat" style={{ marginTop: 16 }}>
        {messages.length === 0 && (
          <div className="card flat center stack">
            <p className="small muted">Start with something gracious:</p>
            <div className="chips" style={{ justifyContent: 'center' }}>{OPENERS.map((o) => <button key={o} type="button" className="chip" onClick={() => setBody(o)}>{o}</button>)}</div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`bubble ${msg.mine ? 'mine' : 'theirs'}`}>
            {msg.body}
            <span className="meta">{timeAgo(msg.createdAt)}{msg.mine && msg.read ? ' · read' : ''}</span>
            {!msg.mine && msg.risk !== 'none' && (
              <div className="warning-banner">
                ⚠ {msg.risk === 'high' ? 'This message may be a scam.' : 'Be careful.'} {msg.warnings.join('. ')}. Never send money, airtime or gift cards.
                {' '}<button type="button" className="link-btn danger" onClick={() => setReporting(msg.id)}>Report</button>
              </div>
            )}
          </div>
        ))}
        {reporting && <ReportBlock startOpen userId={m.id} messageId={reporting} name={m.firstName} notify={notify} onDone={(r) => { setReporting(null); if (r.blocked) navigate('/matches'); }} />}
      </div>
      {closed ? <Empty>This conversation has ended.</Empty> : (
        <div className="composer">
          <ErrorNote error={error} />
          <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) send(body.trim()); }}>
            <input type="text" aria-label="Message" placeholder={`Message ${m.firstName}`} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
            <button className="btn" disabled={busy || !body.trim()}>Send</button>
          </form>
        </div>
      )}
    </Screen>
  );
}
