import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('Cloudflare expiry recovery source policy', () => {
  it('returns the PWA expiry action to the same-origin login route', () => {
    const modal = read('packages/desktop/src/renderer/components/layout/PwaAuthExpiredModal.tsx');

    expect(modal).toContain("window.location.href = '/login'");
    expect(modal).not.toContain('/cdn-cgi/access/logout');
  });

  it('returns HTML-intercepted expiry to login while preserving explicit logout', () => {
    const authContext = read('packages/desktop/src/renderer/hooks/context/AuthContext.tsx');
    const expirySection = authContext.slice(
      authContext.indexOf('result.ssoIntercepted'),
      authContext.indexOf('  useEffect(() => {')
    );
    const logoutSection = authContext.slice(authContext.indexOf('const logout ='), authContext.indexOf('const value ='));

    expect(expirySection).toContain("window.location.href = '/login'");
    expect(expirySection).not.toContain('/cdn-cgi/access/logout');
    expect(logoutSection).toContain('/cdn-cgi/access/logout');
  });

  it('bypasses edge authentication and auth navigation from the service-worker cache', () => {
    const serviceWorker = read('public/sw.js');

    expect(serviceWorker).toContain("url.pathname.startsWith('/cdn-cgi/')");
    expect(serviceWorker).toContain("new Set(['/login', '/logout'])");
    expect(serviceWorker).toContain("if (AUTH_NAVIGATION_PATHS.has(url.pathname)");
  });
});
