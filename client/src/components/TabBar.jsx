const TABS = [
  ['/', '♡', 'Discover'],
  ['/matches', '💬', 'Matches'],
  ['/trust', '🛡', 'Trust'],
  ['/community', '✝', 'Community'],
  ['/me', '☺', 'Me'],
];

export default function TabBar({ path, unreadMessages }) {
  const active = (to) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));
  return (
    <footer className="tabbar">
      <nav aria-label="Main">
        {TABS.map(([to, ico, text]) => (
          <a key={to} href={`#${to}`} className={active(to) ? 'active' : ''} aria-current={active(to) ? 'page' : undefined}>
            <span className="ico" aria-hidden="true">{ico}</span>
            {text}
            {to === '/matches' && unreadMessages > 0 && <span className="badge-dot" style={{ right: '22%', top: 4 }}>{unreadMessages}</span>}
          </a>
        ))}
      </nav>
    </footer>
  );
}
