import { useEffect, useState } from 'react';

// Minimal hash router: #/path/segments?query=1. Hash routes keep deep links (password reset,
// email verification, invites, payment returns) working on any static host.
function parse() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path.replace(/\/+$/, '') || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => { setRoute(parse()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const navigate = (to) => { window.location.hash = to.startsWith('#') ? to : `#${to}`; };
export const back = (fallback = '/') => (window.history.length > 1 ? window.history.back() : navigate(fallback));

/** Match "/tribe/post/:id" against a path; returns params or null. */
export function match(pattern, path) {
  const p = pattern.split('/');
  const a = path.split('/');
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
