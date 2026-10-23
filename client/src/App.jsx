import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken, onUnauthorized } from './api.js';
import { useRoute, match, navigate } from './router.js';
import TabBar from './components/TabBar.jsx';
import TopBar from './components/TopBar.jsx';
import { Loading } from './components/ui.jsx';
import Auth, { ForgotPassword, ResetPassword, VerifyEmail, ConsentUpdate, Suspended, Legal } from './screens/Auth.jsx';
import { Onboarding, EditProfile } from './screens/Profile.jsx';
import { Discover, MemberView, Interests } from './screens/Discover.jsx';
import { Matches, Chat } from './screens/Matches.jsx';
import { TrustHub, PhoneVerify, GhanaCard, Liveness, StatusDeclaration, ChurchVerify, References, ReferenceForm, Readiness } from './screens/Trust.jsx';
import { Community, Notifications, Safety } from './screens/Community.jsx';
import { Me, Privacy, Premium, SandboxCheckout, BillingReturn } from './screens/Me.jsx';
import { ChurchRegister, ChurchPortal } from './screens/Church.jsx';
import { Staff, Admin } from './screens/Staff.jsx';

// Routes available without signing in.
const PUBLIC = [
  ['/forgot-password', () => <ForgotPassword />],
  ['/reset-password', (_p, q, c) => <ResetPassword token={q.token} onAuthed={c.signIn} />],
  ['/verify-email', (_p, q, c) => <VerifyEmail token={q.token} onVerified={c.refresh} />],
  ['/reference', (_p, q) => <ReferenceForm token={q.token} />],
  ['/legal/:doc', (p) => <Legal doc={p.doc} />],
];

// Routes that work before a profile exists.
const ACCOUNT = [
  ['/privacy', (_p, _q, c) => <Privacy me={c.me} onUser={c.setMe} onSignOut={c.signOut} notify={c.notify} />],
  ['/church/register', (_p, _q, c) => <ChurchRegister meta={c.meta} me={c.me} notify={c.notify} />],
  ['/staff', (_p, _q, c) => <Staff notify={c.notify} />],
  ['/admin', (_p, _q, c) => <Admin notify={c.notify} />],
  ['/notifications', (_p, _q, c) => <Notifications onRead={c.refreshUnread} />],
];

const PRIVATE = [
  ['/', (_p, _q, c) => <Discover me={c.me} notify={c.notify} />],
  ['/members/:id', (p, q, c) => <MemberView id={p.id} me={c.me} notify={c.notify} matched={q.from === 'match'} />],
  ['/interests', (_p, _q, c) => <Interests notify={c.notify} />],
  ['/matches', () => <Matches />],
  ['/matches/:id', (p, _q, c) => <Chat id={p.id} notify={c.notify} />],
  ['/trust', (_p, _q, c) => <TrustHub me={c.me} notify={c.notify} />],
  ['/trust/phone', (_p, _q, c) => <PhoneVerify me={c.me} onUser={c.setMe} notify={c.notify} />],
  ['/trust/ghana-card', (_p, _q, c) => <GhanaCard notify={c.notify} />],
  ['/trust/liveness', (_p, _q, c) => <Liveness notify={c.notify} />],
  ['/trust/status', (_p, _q, c) => <StatusDeclaration meta={c.meta} notify={c.notify} />],
  ['/trust/church', (_p, _q, c) => <ChurchVerify notify={c.notify} />],
  ['/trust/references', (_p, _q, c) => <References notify={c.notify} />],
  ['/readiness', (_p, _q, c) => <Readiness notify={c.notify} />],
  ['/community', (_p, _q, c) => <Community notify={c.notify} />],
  ['/safety', (_p, q, c) => <Safety matchId={q.match} notify={c.notify} />],
  ['/me', (_p, _q, c) => <Me me={c.me} onSignOut={c.signOut} />],
  ['/profile', (_p, _q, c) => <EditProfile me={c.me} meta={c.meta} onSaved={c.setMe} notify={c.notify} />],
  ['/premium', () => <Premium />],
  ['/billing/sandbox', (_p, q, c) => <SandboxCheckout reference={q.ref} onPaid={c.refresh} />],
  ['/billing/return', (_p, q, c) => <BillingReturn reference={q.ref} onPaid={c.refresh} />],
  ['/church/:id', (p, _q, c) => <ChurchPortal id={p.id} notify={c.notify} />],
];

function resolve(table, path, query, ctx) {
  for (const [pattern, render] of table) {
    const params = match(pattern, path);
    if (params) return render(params, query, ctx);
  }
  return null;
}

const TOP_BAR = ['/', '/matches', '/trust', '/community', '/me'];

export default function App() {
  const { path, query } = useRoute();
  const [me, setMe] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [toast, setToast] = useState(null);
  const [unread, setUnread] = useState({ notifications: 0, messages: 0 });

  const notify = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setMe(null);
    navigate('/');
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      setMe(await api('/me'));
    } catch {
      setToken(null);
      setMe(null);
    }
  }, []);

  const refreshUnread = useCallback(() => {
    if (!getToken()) return;
    api('/notifications').then((d) => setUnread((u) => ({ ...u, notifications: d.unread }))).catch(() => {});
    api('/matches').then((d) => setUnread((u) => ({ ...u, messages: d.matches.reduce((s, m) => s + m.unread, 0) }))).catch(() => {});
  }, []);

  useEffect(() => { api('/meta').then(setMeta).catch(() => {}); }, []);
  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => onUnauthorized(() => { setToken(null); setMe(null); }), []);
  const ready = Boolean(me?.user.onboarded && me.user.status === 'active');
  useEffect(() => {
    if (!ready) return undefined;
    refreshUnread();
    const t = setInterval(refreshUnread, 30_000);
    return () => clearInterval(t);
  }, [ready, path, refreshUnread]);

  const signIn = (session) => {
    setToken(session.token);
    setMe(session);
    navigate('/');
  };
  const ctx = { me, meta, notify, signIn, signOut, refresh, refreshUnread, setMe };

  const toastEl = toast && <div className="toast" role="status">{toast}</div>;
  const wide = ['/staff', '/admin'].includes(path) || path.startsWith('/church/');
  const shell = (content, { tabs = false } = {}) => (
    <>
      {toastEl}
      <main className={`app ${wide ? 'wide' : ''}`}>{content}</main>
      {tabs && <TabBar path={path} unreadMessages={unread.messages} />}
    </>
  );

  if (loading || !meta) return <div className="app"><Loading /></div>;

  const publicScreen = resolve(PUBLIC, path, query, ctx);
  if (publicScreen) return shell(publicScreen);
  if (!me) return shell(<Auth onAuthed={signIn} pilot={meta.pilot} />);
  if (me.user.status === 'suspended') return shell(path === '/privacy' ? resolve(ACCOUNT, path, query, ctx) : <Suspended me={me} onSignOut={signOut} />);
  if (me.consentRequired.length) return shell(<ConsentUpdate documents={me.consentRequired} onDone={setMe} onSignOut={signOut} />);

  const accountScreen = resolve(ACCOUNT, path, query, ctx);
  if (accountScreen) return shell(accountScreen, { tabs: me.user.onboarded });
  if (!me.user.onboarded) {
    const staff = ['moderator', 'trust_analyst', 'admin'].includes(me.user.role);
    return shell(
      <>
        {staff && (
          <p className="notice">
            Staff account: open the <a href="#/staff">Trust &amp; Safety console</a>{me.user.role === 'admin' && <> or <a href="#/admin">Admin</a></>}, or create a profile below to use the app as a member.
          </p>
        )}
        <Onboarding meta={meta} onDone={(m) => { setMe(m); notify('Welcome to Purpose Partner'); navigate('/trust'); }} />
      </>,
    );
  }

  const screen = resolve(PRIVATE, path, query, ctx) ?? resolve(PRIVATE, '/', query, ctx);
  return shell(
    <>
      {meta.pilot && path === '/' && <p className="notice small">Pilot version: thank you for testing Purpose Partner.</p>}
      {!me.user.emailVerified && path === '/' && <p className="notice small">Please verify your email: check your inbox for the link.</p>}
      {TOP_BAR.includes(path) && <TopBar unread={unread.notifications} />}
      {screen}
    </>,
    { tabs: true },
  );
}
