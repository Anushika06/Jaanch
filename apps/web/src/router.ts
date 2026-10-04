import { useSyncExternalStore, type MouseEvent } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'report'; id: string }
  | { name: 'paid'; id: string }
  | { name: 'privacy' }
  | { name: 'notfound' };

const ID = '(J[A-Za-z0-9_-]{22})';

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  if (pathname === '/privacy') return { name: 'privacy' };
  let m = new RegExp(`^/r/${ID}/?$`).exec(pathname);
  if (m) return { name: 'report', id: m[1]! };
  m = new RegExp(`^/r/${ID}/paid/?$`).exec(pathname);
  if (m) return { name: 'paid', id: m[1]! };
  return { name: 'notfound' };
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  return () => window.removeEventListener('popstate', cb);
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname);
  return parseRoute(path);
}

export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

/** Client-side navigation for in-app links; modified clicks keep normal browser behaviour. */
export function onLinkClick(e: MouseEvent<HTMLAnchorElement>, path: string): void {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  navigate(path);
}
