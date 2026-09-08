import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const sectionBetween = (source: string, start: string, end: string): string => {
  return source.slice(source.indexOf(start), source.indexOf(end));
};

describe('Cloudflare expiry recovery source policy', () => {
  it('returns the PWA expiry action to the same-origin login route', () => {
    const modal = read('packages/desktop/src/renderer/components/layout/PwaAuthExpiredModal.tsx');

    expect(modal).toContain("window.location.href = '/login'");
    expect(modal).not.toContain('/cdn-cgi/access/logout');
  });

  it('returns HTML-intercepted expiry to login while preserving explicit logout', () => {
    const authContext = read('packages/desktop/src/renderer/hooks/context/AuthContext.tsx');
    const logoutHelper = read('packages/desktop/src/common/adapter/cloudflareLogout.ts');
    const expirySection = sectionBetween(authContext, 'result.ssoIntercepted', '  useEffect(() => {');
    const logoutSection = sectionBetween(authContext, 'const logout =', 'const value =');

    expect(expirySection).toContain("window.location.href = '/login'");
    expect(expirySection).not.toContain('/cdn-cgi/access/logout');
    expect(logoutSection).toContain('revokeCloudflareAccessAndReturnToLogin');
    expect(logoutHelper).toContain("fetch('/cdn-cgi/access/logout'");
    expect(logoutHelper).toContain("window.location.assign('/login')");
  });

  it('uses the safe logout helper from the login page instead of top-level navigation', () => {
    const loginPage = read('packages/desktop/src/renderer/pages/login/index.tsx');

    expect(loginPage).toContain('revokeCloudflareAccessAndReturnToLogin');
    expect(loginPage).not.toContain("window.location.href = '/cdn-cgi/access/logout'");
  });

  it('bypasses edge authentication and auth navigation from the service-worker cache', () => {
    const serviceWorker = read('public/sw.js');

    expect(serviceWorker).toContain("url.pathname.startsWith('/cdn-cgi/')");
    expect(serviceWorker).toContain("new Set(['/login', '/logout'])");
    expect(serviceWorker).toContain("if (AUTH_NAVIGATION_PATHS.has(url.pathname)");
  });
});
