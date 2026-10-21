import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAction, useApi } from '../hooks.js';
import { DocText, ErrorNote, Field, Loading, Screen } from '../components/ui.jsx';

const STATEMENTS = [
  ['confirmAdult', 'I am 18 or older.'],
  ['confirmSingle', 'I am single (never married, divorced, widowed or annulled) and not engaged to anyone.'],
  ['acceptTerms', <>I accept the <a href="#/legal/terms" target="_blank" rel="noreferrer">Terms of Service</a>.</>],
  ['acceptPrivacy', <>I have read the <a href="#/legal/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</>],
  ['acceptGuidelines', <>I will follow the <a href="#/legal/guidelines" target="_blank" rel="noreferrer">Community Guidelines</a>, including never asking for money.</>],
  ['sensitiveDataConsent', 'I consent to Purpose Partner processing my religious beliefs and relationship history to provide matching and verification.'],
];

export default function Auth({ onAuthed, pilot }) {
  const [mode, setMode] = useState('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consents, setConsents] = useState({});
  const { busy, error, run, setError } = useAction();

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = mode === 'signup' ? { email, password, ...consents } : { email, password };
      onAuthed(await api(mode === 'signup' ? '/auth/register' : '/auth/login', { method: 'POST', body }));
    });
  };

  if (mode === 'welcome') {
    return (
      <div className="welcome center">
        <img className="logo" src="/favicon.svg" alt="" />
        <h1>Purpose Partner</h1>
        <p className="tagline">Trust-first Christian relationships, courtship and marriage.</p>
        <div className="card stack" style={{ textAlign: 'left', marginTop: 16 }}>
          <p>✓ Verified members: Ghana Card, liveness selfie and church confirmation</p>
          <p>✓ Marriage Transparency Shield: honest relationship status</p>
          <p>✓ Matching on faith, values and readiness</p>
          <p>✓ Scam warnings, safe meet-ups and a real safety team</p>
        </div>
        {pilot && <p className="notice" style={{ marginTop: 12 }}>Pilot version for invited testers.</p>}
        <div className="stack" style={{ marginTop: 20 }}>
          <button type="button" className="btn block" onClick={() => setMode('signup')}>Create an account</button>
          <button type="button" className="btn secondary block" onClick={() => setMode('login')}>Sign in</button>
        </div>
      </div>
    );
  }

  const allAccepted = STATEMENTS.every(([k]) => consents[k]);
  return (
    <div className="welcome">
      <h1 className="center">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
      <form className="card" onSubmit={submit}>
        <Field label="Email"><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
          <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {mode === 'signup' && (
          <fieldset>
            <legend>Before you join</legend>
            {STATEMENTS.map(([k, text]) => (
              <label key={k} className="check"><input type="checkbox" checked={Boolean(consents[k])} onChange={(e) => setConsents({ ...consents, [k]: e.target.checked })} /> <span>{text}</span></label>
            ))}
          </fieldset>
        )}
        <ErrorNote error={error} />
        <button className="btn block" disabled={busy || (mode === 'signup' && !allAccepted)}>{mode === 'signup' ? 'Create account' : 'Sign in'}</button>
        {mode === 'login' && <p className="center small" style={{ marginTop: 12 }}><a href="#/forgot-password">Forgot your password?</a></p>}
      </form>
      <p className="center small" style={{ marginTop: 12 }}>
        <button type="button" className="link-btn" onClick={() => { setError(null); setMode(mode === 'signup' ? 'login' : 'signup'); }}>
          {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </p>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <Screen title="Reset password" backTo="/">
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => setDone((await api('/auth/forgot', { method: 'POST', body: { email } })).message)); }}>
        {done ? <p>{done}</p> : (
          <>
            <Field label="Your email"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <ErrorNote error={error} />
            <button className="btn block" disabled={busy}>Send reset link</button>
          </>
        )}
      </form>
    </Screen>
  );
}

export function ResetPassword({ token, onAuthed }) {
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Screen title="Choose a new password" backTo="/">
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => onAuthed(await api('/auth/reset', { method: 'POST', body: { token, password } }))); }}>
        <Field label="New password" hint="At least 8 characters. You will be signed out on other devices."><input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorNote error={error} />
        <button className="btn block" disabled={busy}>Save password</button>
      </form>
    </Screen>
  );
}

export function VerifyEmail({ token, onVerified }) {
  const [state, setState] = useState('working');
  useEffect(() => {
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => { setState('done'); onVerified?.(); })
      .catch((e) => setState(e.message));
  }, [token, onVerified]);
  return (
    <Screen title="Email verification" backTo="/">
      <div className="card center">
        {state === 'working' ? <Loading label="Verifying…" /> : state === 'done' ? <><h2>Your email is verified ✓</h2><a className="btn" href="#/">Continue</a></> : <p className="error">{state}</p>}
      </div>
    </Screen>
  );
}

export function ConsentUpdate({ documents, onDone, onSignOut }) {
  const [agreed, setAgreed] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <div className="welcome">
      <h1>Updated terms</h1>
      <p className="muted">We have updated the following. Please review them to continue.</p>
      <div className="card">
        <ul>{documents.map((d) => <li key={d.id}><a href={`#/legal/${d.id}`} target="_blank" rel="noreferrer">{d.title}</a> <span className="small muted">({d.version})</span></li>)}</ul>
        <label className="check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I accept the updated documents.</label>
        <ErrorNote error={error} />
        <button type="button" className="btn block" disabled={!agreed || busy} onClick={() => run(async () => onDone(await api('/consents/accept', { method: 'POST', body: { documents: documents.map((d) => d.id) } })))}>Continue</button>
        <button type="button" className="btn ghost block" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

export function Suspended({ me, onSignOut }) {
  const appeals = useApi('/appeals');
  const [body, setBody] = useState('');
  const { busy, error, run } = useAction();
  const open = appeals.data?.appeals.find((a) => a.status === 'open');
  return (
    <div className="welcome">
      <h1>Your account is suspended</h1>
      <div className="card stack">
        <p><b>Reason:</b> {me.user.suspendedReason ?? 'A breach of our Community Guidelines.'}</p>
        {appeals.data?.appeals.filter((a) => a.status !== 'open').map((a) => <p key={a.id} className="notice">Previous appeal {a.status}: {a.decision}</p>)}
        {open ? <p className="notice teal">Your appeal is being reviewed. We will notify you of the outcome.</p> : (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/appeals', { method: 'POST', body: { body } }); appeals.reload(); }); }}>
            <Field label="Appeal this decision" hint="Explain honestly what happened. A different member of our team will review it.">
              <textarea required minLength={20} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <ErrorNote error={error} />
            <button className="btn block" disabled={busy}>Submit appeal</button>
          </form>
        )}
        <a className="btn ghost block" href="#/privacy">Download or delete my data</a>
        <button type="button" className="btn ghost block" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

export function Legal({ doc }) {
  const { data, error } = useApi(`/legal/${doc}`);
  return (
    <Screen title={data?.title ?? 'Legal'}>
      <ErrorNote error={error} />
      {data ? <div className="card"><p className="notice small">{data.status}</p><DocText text={data.body} /></div> : !error && <Loading />}
    </Screen>
  );
}
