import { useState } from 'react';
import { api, label } from '../api.js';
import { navigate } from '../router.js';
import { useAction, useApi } from '../hooks.js';
import { Empty, ErrorNote, Field, ImagePicker, Loading, Screen, ScoreRing } from '../components/ui.jsx';

const STEP_LINKS = {
  phone: '/trust/phone', ghana_card: '/trust/ghana-card', liveness: '/trust/liveness', status: '/trust/status',
  church: '/trust/church', references: '/trust/references', readiness: '/readiness',
};
const ICONS = { done: '✓', pending: '…', partial: '½', rejected: '!', todo: '' };
const STATUS_TEXT = { done: 'Complete', pending: 'Under review', partial: 'In progress', rejected: 'Try again', todo: 'Not started' };

export function TrustHub({ me, notify }) {
  const { data, error } = useApi('/trust');
  const { run, busy } = useAction();
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const r = data.report;
  return (
    <>
      <h1>Trust Stack</h1>
      <section className="card hero">
        <div className="score-wrap">
          <ScoreRing score={r.score} caption="Covenant Integrity Score" />
          <div>
            <p className="small muted" style={{ margin: 0 }}>Covenant Integrity Score</p>
            <h2 style={{ margin: '2px 0' }}><span className={`tag tier-${r.tier}`} style={{ fontSize: '0.9rem' }}>{r.tierLabel}</span></h2>
            <p className="small muted" style={{ margin: 0 }}>Platinum 90+ · Gold 75+ · Silver 60+ · Bronze 40+</p>
          </div>
        </div>
        <div className="meters">
          {r.components.map((c) => (
            <div key={c.id} className="meter"><span>{c.label}</span><div className="track"><div className="fill" style={{ width: `${(c.score / c.max) * 100}%` }} /></div><b>{c.score}/{c.max}</b></div>
          ))}
        </div>
      </section>
      <section className="card">
        {r.shield ? (
          <div className="shield"><span className="ico">🛡</span><div><b>Marriage Transparency Shield</b><p className="small" style={{ margin: 0 }}>You have verified your identity, declared your status, been confirmed by your church and kept good standing.</p></div></div>
        ) : (
          <div className="shield" style={{ opacity: 0.85 }}><span className="ico">🛡</span><div><b>Earn the Marriage Transparency Shield</b><p className="small" style={{ margin: 0 }}>Verify your Ghana Card and selfie, declare your status, get church confirmation and one character reference.</p></div></div>
        )}
      </section>
      <section className="card steps-list">
        {r.steps.map((s) => {
          const inner = (
            <>
              <span className={`step-ico ${s.status}`} aria-hidden="true">{ICONS[s.status]}</span>
              <span className="grow"><b>{s.label}</b><span className="block small muted">{STATUS_TEXT[s.status]}{s.id === 'references' ? ` · ${s.count} positive` : ''}</span></span>
            </>
          );
          if (s.id === 'email') {
            return s.status === 'done' ? <div key={s.id} className="step">{inner}</div> : (
              <button key={s.id} type="button" className="step" style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }} disabled={busy}
                onClick={() => run(async () => { await api('/auth/resend-verification', { method: 'POST' }); notify(`Verification email sent to ${me.user.email}`); })}>
                {inner}<span className="small">Resend ›</span>
              </button>
            );
          }
          return <a key={s.id} href={`#${STEP_LINKS[s.id]}`}>{inner}<span className="muted">›</span></a>;
        })}
      </section>
      <p className="small muted" style={{ marginTop: 12 }}>Verification lowers risk but cannot guarantee anyone's intentions. Always use the safety tools and never send money.</p>
    </>
  );
}

export function PhoneVerify({ me, onUser, notify }) {
  const [phone, setPhone] = useState(me.user.phone ?? '');
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Screen title="Verify your phone" backTo="/trust">
      <form className="card" onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!sent) { setSent(await api('/verify/phone/send', { method: 'POST', body: { phone } })); return; }
          onUser(await api('/verify/phone/confirm', { method: 'POST', body: { code } }));
          notify('Phone verified ✓');
          navigate('/trust');
        });
      }}>
        {me.user.phoneVerified && <p className="notice teal">{me.user.phone} is verified. You can change it below.</p>}
        <Field label="Mobile number" hint="We'll text you a 6-digit code. Your number is encrypted and never shown to other members.">
          <input type="tel" autoComplete="tel" placeholder="024 123 4567" required value={phone} disabled={Boolean(sent)} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {sent && (
          <>
            {sent.pilotCode && <p className="notice">Pilot mode: your code is <b>{sent.pilotCode}</b></p>}
            <Field label="Code"><input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          </>
        )}
        <ErrorNote error={error} />
        <button className="btn block" disabled={busy}>{sent ? 'Verify' : 'Send code'}</button>
        {sent && <button type="button" className="btn ghost block" onClick={() => { setSent(null); setCode(''); }}>Use a different number</button>}
      </form>
    </Screen>
  );
}

function CheckStatus({ kind, data }) {
  const v = data.verifications.find((x) => x.kind === kind);
  if (!v) return null;
  if (v.status === 'approved') return <p className="notice teal">✓ Verified{v.meta?.masked ? ` (${v.meta.masked})` : ''}.</p>;
  if (v.status === 'pending') return <p className="notice">Submitted and waiting for review. We usually review within 24 hours.</p>;
  return <p className="error">Last submission was not accepted: {v.reason}. Please try again.</p>;
}

const done = (data, kind) => data.verifications.some((v) => v.kind === kind && ['approved', 'pending'].includes(v.status));

export function GhanaCard({ notify }) {
  const { data, reload } = useApi('/trust');
  const [form, setForm] = useState({ cardNumber: '', front: null, back: null, consent: false });
  const { busy, error, run } = useAction();
  return (
    <Screen title="Ghana Card" backTo="/trust">
      {!data ? <Loading /> : (
        <div className="card">
          <CheckStatus kind="ghana_card" data={data} />
          {!done(data, 'ghana_card') && (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/uploads/ghana-card', { method: 'POST', body: form }); notify('Submitted for review'); reload(); }); }}>
              <p className="small muted">A trained trust analyst compares your card with your profile and selfie. Images are encrypted and deleted once reviewed; we keep only the result and a masked card number.</p>
              <Field label="Ghana Card number"><input type="text" placeholder="GHA-123456789-0" required value={form.cardNumber} onChange={(e) => setForm({ ...form, cardNumber: e.target.value })} /></Field>
              <ImagePicker label="Front of card" value={form.front} onImage={(front) => setForm((f) => ({ ...f, front }))} capture="environment" />
              <ImagePicker label="Back of card" value={form.back} onImage={(back) => setForm((f) => ({ ...f, back }))} capture="environment" />
              <label className="check"><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} /> I consent to Purpose Partner verifying my identity using my Ghana Card, as described in the Privacy Policy.</label>
              <ErrorNote error={error} />
              <button className="btn block" disabled={busy || !form.front || !form.back || !form.consent}>Submit for verification</button>
            </form>
          )}
        </div>
      )}
    </Screen>
  );
}

export function Liveness({ notify }) {
  const { data, reload } = useApi('/trust');
  const [selfie, setSelfie] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <Screen title="Liveness selfie" backTo="/trust">
      {!data ? <Loading /> : (
        <div className="card">
          <CheckStatus kind="liveness" data={data} />
          {!done(data, 'liveness') && (
            <>
              <p>This proves you are a real person and the one in your photos.</p>
              <div className="notice" style={{ margin: '12px 0' }}>
                Take a selfie today showing <b>{data.liveness.gesture}</b> and holding a paper with <b style={{ fontSize: '1.2rem' }}>{data.liveness.code}</b> written on it.
              </div>
              <ImagePicker label="Your selfie" value={selfie} onImage={setSelfie} capture="user" />
              <ErrorNote error={error} />
              <button type="button" className="btn block" disabled={busy || !selfie} onClick={() => run(async () => { await api('/uploads/liveness', { method: 'POST', body: { selfie } }); notify('Submitted for review'); reload(); })}>Submit selfie</button>
            </>
          )}
        </div>
      )}
    </Screen>
  );
}

export function StatusDeclaration({ meta, notify }) {
  const { data, reload } = useApi('/trust');
  const [status, setStatus] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [doc, setDoc] = useState(null);
  const { busy, error, run } = useAction();
  if (!data) return <Screen title="Relationship status" backTo="/trust"><Loading /></Screen>;
  const declared = data.declaration?.status;
  const needsEvidence = declared && declared !== 'never_married';
  return (
    <Screen title="Relationship status" backTo="/trust">
      <section className="card">
        <p>The <b>Marriage Transparency Shield</b> starts with an honest declaration. Your status is shown on your profile and confirmed by your church.</p>
        {declared && <p className="notice teal">You declared: <b>{label('relationship_status', declared)}</b> ({data.declaration.declared_at.slice(0, 10)})</p>}
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/verify/status', { method: 'POST', body: { status, confirmNotMarried: confirm } }); notify('Status declared'); reload(); }); }}>
          <Field group label={declared ? 'Update my status' : 'My status'}>
            <div className="chips">{meta.options.relationship_status.map((s) => <button key={s} type="button" className={`chip ${status === s ? 'active' : ''}`} aria-pressed={status === s} onClick={() => setStatus(s)}>{label('relationship_status', s)}</button>)}</div>
          </Field>
          <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I solemnly declare that I am not currently married, engaged or in a relationship, and I understand that false declarations lead to permanent removal.</label>
          <ErrorNote error={error} />
          <button className="btn block" disabled={busy || !status || !confirm}>Declare</button>
        </form>
      </section>
      {needsEvidence && (
        <section className="card">
          <h2>Supporting document (optional)</h2>
          <CheckStatus kind="status_evidence" data={data} />
          {!done(data, 'status_evidence') && (
            <>
              <p className="small muted">A divorce decree, death certificate or annulment record raises your relationship-integrity score. It is encrypted and deleted after review.</p>
              <ImagePicker label="Document" value={doc} onImage={setDoc} />
              <button type="button" className="btn secondary block" disabled={busy || !doc} onClick={() => run(async () => { await api('/uploads/status-evidence', { method: 'POST', body: { document: doc } }); notify('Submitted for review'); reload(); })}>Submit document</button>
            </>
          )}
        </section>
      )}
    </Screen>
  );
}

export function ChurchVerify({ notify }) {
  const trust = useApi('/trust');
  const [q, setQ] = useState('');
  const churches = useApi(`/churches?q=${encodeURIComponent(q)}`);
  const [form, setForm] = useState({ churchId: null, memberSince: '', ministry: '' });
  const { busy, error, run } = useAction();
  const mine = trust.data?.church;
  return (
    <Screen title="Church confirmation" backTo="/trust">
      {mine && (
        <section className="card">
          <b>{mine.name}</b>, {mine.city}
          <p className={`notice ${mine.status === 'confirmed' ? 'teal' : ''}`} style={{ marginTop: 8 }}>
            {mine.status === 'confirmed' ? `✓ Your membership is confirmed${mine.status_attested === 'confirms_single' ? ' and your church confirmed your relationship status' : ''}.`
              : mine.status === 'pending' ? 'Waiting for your pastor or church admin to confirm.' : `Your church could not confirm your membership${mine.note ? `: ${mine.note}` : ''}.`}
          </p>
        </section>
      )}
      <section className="card">
        <h2>{mine ? 'Change church' : 'Find your church'}</h2>
        <p className="small muted">Your pastor or church admin confirms you are a member in good standing. They see your first name, age, city and declared status.</p>
        <input type="search" placeholder="Search by church name or city" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="list" style={{ marginTop: 12 }}>
          {churches.data?.churches.map((c) => (
            <li key={c.id}><label className="check" style={{ margin: 0 }}><input type="radio" name="church" checked={form.churchId === c.id} onChange={() => setForm({ ...form, churchId: c.id })} /> <span><b>{c.name}</b><span className="block small muted">{c.denomination} · {c.city}</span></span></label></li>
          ))}
        </ul>
        {churches.data?.churches.length === 0 && <Empty>No partner church found. <a href="#/church/register">Invite your church to partner with us</a>.</Empty>}
        {form.churchId && (
          <div style={{ marginTop: 12 }}>
            <div className="two">
              <Field label="Member since (year)"><input type="number" min={1940} max={new Date().getFullYear()} value={form.memberSince} onChange={(e) => setForm({ ...form, memberSince: e.target.value })} /></Field>
              <Field label="Ministry (optional)"><input type="text" maxLength={80} value={form.ministry} onChange={(e) => setForm({ ...form, ministry: e.target.value })} /></Field>
            </div>
            <ErrorNote error={error} />
            <button type="button" className="btn block" disabled={busy} onClick={() => run(async () => {
              await api('/church-membership', { method: 'POST', body: { churchId: form.churchId, memberSince: form.memberSince || undefined, ministry: form.ministry || undefined } });
              notify('Request sent to your church'); trust.reload();
            })}>Ask my church to confirm</button>
          </div>
        )}
      </section>
      <p className="small center"><a href="#/church/register">Are you a pastor or church admin? Register your church</a></p>
    </Screen>
  );
}

export function References({ notify }) {
  const { data, reload } = useApi('/verify/references');
  const [form, setForm] = useState({ name: '', email: '', relationship: '' });
  const { busy, error, run } = useAction();
  return (
    <Screen title="Character references" backTo="/trust">
      <section className="card">
        <p>Invite up to three people who know you well, such as a pastor, mentor, family friend or colleague. Not a family member you live with.</p>
        <p className="small muted">They answer a short confidential form. You'll see whether it was completed, not what they wrote.</p>
        <ul className="list">
          {data?.references.map((r) => (
            <li key={r.id} className="spread"><span><b>{r.name}</b><span className="block small muted">{r.relationship}</span></span>
              <span className={`tag ${r.status === 'completed' ? '' : r.status === 'declined' ? 'rose' : 'gold'}`}>{r.status === 'sent' ? 'Invited' : r.status}</span></li>
          ))}
        </ul>
      </section>
      {(data?.references.filter((r) => r.status !== 'declined').length ?? 0) < 3 && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/verify/references', { method: 'POST', body: form }); setForm({ name: '', email: '', relationship: '' }); notify('Invitation sent'); reload(); }); }}>
          <h2>Invite a reference</h2>
          <Field label="Their name"><input type="text" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Their email"><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="How they know you"><input type="text" required maxLength={80} placeholder="e.g. My pastor for 5 years" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} /></Field>
          <ErrorNote error={error} />
          <button className="btn block" disabled={busy}>Send invitation</button>
        </form>
      )}
    </Screen>
  );
}

function Rating({ value, onChange, name }) {
  return <div className="likert" role="group" aria-label={name}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={value === n ? 'active' : ''} aria-pressed={value === n} onClick={() => onChange(n)}>{n}</button>)}</div>;
}

/** Public form completed by an invited reference (no account needed). */
export function ReferenceForm({ token }) {
  const { data, error } = useApi(`/references/${token}`);
  const [a, setA] = useState({ knownYears: '', honesty: 0, kindness: 0, faithfulness: 0, confirmsSingle: '', recommend: null, comment: '' });
  const [finished, setFinished] = useState(false);
  const { busy, error: sendError, run } = useAction();
  const submit = (body) => run(async () => { await api(`/references/${token}`, { method: 'POST', body }); setFinished(true); });
  if (finished) return <div className="welcome center"><h1>Thank you 🙏</h1><p>Your reference helps build a safer Christian community.</p></div>;
  return (
    <div style={{ paddingTop: 16 }}>
      <a className="brand" href="#/"><img src="/favicon.svg" alt="" /> Purpose Partner</a>
      <h1 style={{ marginTop: 16 }}>Character reference</h1>
      <ErrorNote error={error} />
      {data && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); submit({ ...a, knownYears: Number(a.knownYears) }); }}>
          <p>Hello {data.referenceName}. <b>{data.memberFirstName}</b> named you as a reference ({data.relationship}). Your answers are confidential.</p>
          <Field label={`How many years have you known ${data.memberFirstName}?`}><input type="number" min={0} max={80} required value={a.knownYears} onChange={(e) => setA({ ...a, knownYears: e.target.value })} /></Field>
          {['honesty', 'kindness', 'faithfulness'].map((k) => (
            <div key={k} className="field"><b>{k[0].toUpperCase() + k.slice(1)}</b><Rating name={k} value={a[k]} onChange={(n) => setA({ ...a, [k]: n })} /><div className="likert-ends"><span>Poor</span><span>Excellent</span></div></div>
          ))}
          <Field group label={`To your knowledge, is ${data.memberFirstName} single (not married, engaged or in a relationship)?`}>
            <div className="chips">{[['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']].map(([v, t]) => <button key={v} type="button" className={`chip ${a.confirmsSingle === v ? 'active' : ''}`} onClick={() => setA({ ...a, confirmsSingle: v })}>{t}</button>)}</div>
          </Field>
          <Field group label="Would you recommend them as a future spouse?">
            <div className="chips">{[[true, 'Yes'], [false, 'No']].map(([v, t]) => <button key={t} type="button" className={`chip ${a.recommend === v ? 'active' : ''}`} onClick={() => setA({ ...a, recommend: v })}>{t}</button>)}</div>
          </Field>
          <Field label="Anything else? (optional)"><textarea maxLength={1000} value={a.comment} onChange={(e) => setA({ ...a, comment: e.target.value })} /></Field>
          <ErrorNote error={sendError} />
          <button className="btn block" disabled={busy || !a.honesty || !a.kindness || !a.faithfulness || !a.confirmsSingle || a.recommend === null}>Submit reference</button>
          <button type="button" className="btn ghost block" disabled={busy} onClick={() => submit({ decline: true })}>I'd rather not give a reference</button>
        </form>
      )}
    </div>
  );
}

export function Readiness({ notify }) {
  const { data, reload } = useApi('/readiness');
  const [answers, setAnswers] = useState({});
  const [retake, setRetake] = useState(false);
  const { busy, error, run } = useAction();
  if (!data) return <Screen title="Readiness" backTo="/trust"><Loading /></Screen>;
  const r = data.latest;
  if (r && !retake) {
    return (
      <Screen title="Relationship readiness" backTo="/trust">
        <section className="card hero">
          <div className="score-wrap"><ScoreRing score={r.overall} caption="Readiness" /><div><b>Overall readiness</b><p className="small muted">Communication, conflict, finances, faith and emotional steadiness.</p></div></div>
          <div className="meters">{Object.entries(data.labels).map(([k, l]) => <div key={k} className="meter"><span>{l}</span><div className="track"><div className="fill" style={{ width: `${r.dimensions[k]}%` }} /></div><b>{r.dimensions[k]}</b></div>)}</div>
        </section>
        <section className="card">
          <h2>Relationship style: {label('attachment', r.attachment)}</h2>
          <p>{r.attachmentNote}</p>
          <h3>Strengths</h3>
          <p>{r.strengths.join(' · ')}</p>
          {r.growth.length > 0 && <><h3>Growth areas</h3><ul>{r.growth.map((g) => <li key={g.area}><b>{g.area}:</b> {g.tip}</li>)}</ul></>}
          <p className="small muted">{data.disclaimer}</p>
          <button type="button" className="btn secondary block" onClick={() => setRetake(true)}>Retake</button>
        </section>
      </Screen>
    );
  }
  const answered = Object.keys(answers).length;
  return (
    <Screen title="Readiness assessment" backTo="/trust">
      <p className="small muted">{data.questions.length} statements, about 5 minutes. Answer honestly; this is for your growth. {data.disclaimer}</p>
      {data.questions.map((q, i) => (
        <div key={q.id} className="card flat" style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}><span className="muted small">{i + 1}.</span> {q.text}</p>
          <div className="likert" role="group" aria-label={q.text}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={answers[q.id] === n ? 'active' : ''} aria-pressed={answers[q.id] === n} onClick={() => setAnswers({ ...answers, [q.id]: n })}>{n}</button>)}</div>
          <div className="likert-ends"><span>Strongly disagree</span><span>Strongly agree</span></div>
        </div>
      ))}
      <div className="card">
        <ErrorNote error={error} />
        <button type="button" className="btn block" disabled={busy || answered < data.questions.length}
          onClick={() => run(async () => { await api('/readiness', { method: 'POST', body: { answers } }); notify('Your readiness reflection is ready'); setRetake(false); setAnswers({}); reload(); })}>
          See my results ({answered}/{data.questions.length})
        </button>
      </div>
    </Screen>
  );
}
