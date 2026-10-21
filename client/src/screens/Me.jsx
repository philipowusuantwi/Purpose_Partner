import { useEffect, useState } from 'react';
import { api, downloadJson, fmtDate, money } from '../api.js';
import { navigate } from '../router.js';
import { useAction, useApi } from '../hooks.js';
import { Avatar, ErrorNote, Field, Loading, MenuLink, Screen, TrustBadges } from '../components/ui.jsx';

export function Me({ me, onSignOut }) {
  const photos = useApi('/profile/photos');
  const photo = photos.data?.photos.find((p) => p.status === 'approved')?.data;
  const u = me.user;
  const staff = ['moderator', 'trust_analyst', 'admin'].includes(u.role);
  return (
    <>
      <section className="card">
        <div className="person">
          <Avatar photo={photo} name={me.profile.first_name} size="lg" />
          <div className="grow">
            <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontSize: '1.4rem' }}>{me.profile.first_name}</h2>
            <p className="small muted" style={{ margin: 0 }}>{u.email}</p>
            {me.trust && <TrustBadges trust={{ ...me.trust, churchVerified: me.trust.steps.find((s) => s.id === 'church').status === 'done' }} />}
          </div>
        </div>
        {!me.profile.visible && <p className="notice" style={{ marginTop: 12 }}>Your profile is paused and hidden from Discover.</p>}
        {me.profile.hidden_reason && <p className="notice" style={{ marginTop: 12 }}>Your profile is temporarily hidden while our safety team reviews reports.</p>}
      </section>
      <section className="card menu">
        <MenuLink to="/profile" icon="✎" label="Edit profile & photos" />
        <MenuLink to={`/members/${u.id}`} icon="👁" label="Preview my profile" />
        <MenuLink to="/trust" icon="🛡" label="Trust & verification" hint={me.trust ? `${me.trust.tierLabel} · ${me.trust.score}/100` : undefined} />
        <MenuLink to="/readiness" icon="🌱" label="Relationship readiness" />
        <MenuLink to="/premium" icon="★" label="Premium" hint={u.premiumUntil ? `Active until ${fmtDate(u.premiumUntil)}` : 'Unlimited interests, see who likes you'} />
        <MenuLink to="/safety" icon="🧭" label="Safe meet-up" />
      </section>
      <section className="card menu">
        {u.churchAdmin.length > 0 && u.churchAdmin.map((id) => <MenuLink key={id} to={`/church/${id}`} icon="⛪" label="Church portal" />)}
        {staff && <MenuLink to="/staff" icon="🧑‍⚖️" label="Trust & Safety console" />}
        {u.role === 'admin' && <MenuLink to="/admin" icon="⚙" label="Admin" />}
        <MenuLink to="/privacy" icon="🔒" label="Privacy, data & account" />
        <MenuLink to="/legal/terms" icon="📜" label="Terms, privacy & guidelines" />
      </section>
      <button type="button" className="btn ghost block" style={{ marginTop: 16 }} onClick={onSignOut}>Sign out</button>
    </>
  );
}

export function Privacy({ me, onUser, onSignOut, notify }) {
  const consents = useApi('/consents');
  const blocks = useApi('/blocks');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [del, setDel] = useState('');
  const { busy, error, run } = useAction();
  const visible = Boolean(me.profile?.visible);
  return (
    <Screen title="Privacy & data" backTo="/me">
      <ErrorNote error={error} />
      {me.profile && (
        <section className="card">
          <h2>Profile visibility</h2>
          <p className="small muted">Pause to stop appearing in Discover. Your matches and messages stay.</p>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => run(async () => { onUser(await api('/account/visibility', { method: 'PUT', body: { visible: !visible } })); notify(visible ? 'Profile paused' : 'Profile visible again'); })}>{visible ? 'Pause my profile' : 'Show my profile again'}</button>
        </section>
      )}
      <section className="card">
        <h2>Your data</h2>
        <p className="small muted">Download everything we hold about you as a JSON file.</p>
        <button type="button" className="btn secondary" onClick={() => run(() => downloadJson('/account/export', 'purpose-partner-data.json'))}>Download my data</button>
      </section>
      {blocks.data?.blocked.length > 0 && (
        <section className="card">
          <h2>Blocked members</h2>
          <ul className="list">{blocks.data.blocked.map((b) => <li key={b.id} className="spread"><span>{b.firstName ?? 'Member'}</span><button type="button" className="link-btn" onClick={() => api(`/blocks/${b.id}`, { method: 'DELETE' }).then(blocks.reload)}>Unblock</button></li>)}</ul>
        </section>
      )}
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/auth/change-password', { method: 'POST', body: pw }); notify('Password changed. Other devices were signed out.'); setPw({ currentPassword: '', newPassword: '' }); }); }}>
        <h2>Change password</h2>
        <Field label="Current password"><input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
        <Field label="New password"><input type="password" autoComplete="new-password" minLength={8} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
        <button className="btn secondary" disabled={busy}>Change password</button>
      </form>
      <section className="card">
        <h2>Sign out everywhere</h2>
        <button type="button" className="btn secondary" onClick={() => run(async () => { await api('/auth/logout-all', { method: 'POST' }); onSignOut(); })}>Sign out of all devices</button>
      </section>
      <section className="card">
        <h2>Consent history</h2>
        <ul className="list small">{consents.data?.history.map((c, i) => <li key={i}>{c.action === 'accept' ? 'Accepted' : 'Withdrew'} {c.document.replace(/_/g, ' ')} ({c.version}) · {fmtDate(c.created_at)}</li>)}</ul>
        <p className="small muted">To withdraw consent to processing your sensitive data, delete your account below.</p>
      </section>
      <section className="card" style={{ borderColor: 'var(--rose)' }}>
        <h2>Delete account</h2>
        <p className="small">This permanently deletes your profile, photos, verifications, matches and messages.</p>
        <Field label="Confirm with your password"><input type="password" autoComplete="current-password" value={del} onChange={(e) => setDel(e.target.value)} /></Field>
        <button type="button" className="btn danger" disabled={busy || !del} onClick={() => { if (window.confirm('Delete your Purpose Partner account permanently?')) run(async () => { await api('/account', { method: 'DELETE', body: { password: del } }); onSignOut(); }); }}>Delete my account</button>
      </section>
    </Screen>
  );
}

export function Premium() {
  const { data, error } = useApi('/billing/plans');
  const { busy, error: payError, run } = useAction();
  const checkout = (plan) => run(async () => {
    const r = await api('/billing/checkout', { method: 'POST', body: { plan } });
    if (r.checkoutUrl.startsWith('#')) navigate(r.checkoutUrl);
    else window.location.href = r.checkoutUrl;
  });
  return (
    <Screen title="Premium" backTo="/me">
      <ErrorNote error={error || payError} />
      {!data ? !error && <Loading /> : (
        <>
          <section className="card hero">
            {data.premiumUntil ? <p><b>Premium is active until {fmtDate(data.premiumUntil, { day: 'numeric', month: 'long', year: 'numeric' })}.</b></p> : <h2>Find your partner with purpose</h2>}
            <ul>{data.perks.map((p) => <li key={p}>{p}</li>)}</ul>
            <p className="small muted">Safety features (verification, scam warnings, reporting, safe meet-ups) are free for everyone.</p>
          </section>
          <div className="two" style={{ marginTop: 16 }}>
            {data.plans.map((p) => (
              <div key={p.id} className="card center" style={{ marginTop: 0 }}>
                <b>{p.label}</b>
                <p style={{ fontFamily: 'var(--display)', fontSize: '1.6rem', margin: '8px 0' }}>{money(p.amountMinor, data.currency)}</p>
                <button type="button" className="btn block" disabled={busy || !data.provider} onClick={() => checkout(p.id)}>{data.premiumUntil ? 'Extend' : 'Choose'}</button>
              </div>
            ))}
          </div>
          <p className="small muted center" style={{ marginTop: 12 }}>{data.provider === 'sandbox' ? 'Test mode: no money will be taken.' : 'Pay securely with card or mobile money via Paystack. Premium does not renew automatically.'}</p>
        </>
      )}
    </Screen>
  );
}

export function SandboxCheckout({ reference, onPaid }) {
  const { busy, error, run } = useAction();
  return (
    <Screen title="Test checkout" backTo="/premium">
      <div className="card stack">
        <p className="notice">This is a test payment. No money changes hands.</p>
        <ErrorNote error={error} />
        <button type="button" className="btn block" disabled={busy} onClick={() => run(async () => { await api('/billing/sandbox/complete', { method: 'POST', body: { reference } }); await onPaid(); navigate('/premium'); })}>Complete test payment</button>
      </div>
    </Screen>
  );
}

export function BillingReturn({ reference, onPaid }) {
  const [status, setStatus] = useState('checking');
  useEffect(() => {
    api(`/billing/payments/${encodeURIComponent(reference)}`).then(async (r) => { setStatus(r.status); if (r.status === 'paid') await onPaid(); }).catch((e) => setStatus(e.message));
  }, [reference, onPaid]);
  return (
    <Screen title="Payment" backTo="/premium">
      <div className="card center">
        {status === 'checking' ? <Loading label="Confirming your payment…" /> : status === 'paid' ? <><h2>Thank you! Premium is active.</h2><a className="btn" href="#/">Continue</a></>
          : status === 'pending' ? <p>Your payment is still processing. Please check back in a minute.</p> : <p className="error">{status}</p>}
      </div>
    </Screen>
  );
}
