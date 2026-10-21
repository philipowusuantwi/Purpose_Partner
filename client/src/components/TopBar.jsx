export default function TopBar({ unread }) {
  return (
    <div className="topbar">
      <a className="brand" href="#/"><img src="/favicon.svg" alt="" /> Purpose Partner</a>
      <a className="icon-btn" href="#/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        🔔{unread > 0 && <span className="badge-dot">{unread}</span>}
      </a>
    </div>
  );
}
