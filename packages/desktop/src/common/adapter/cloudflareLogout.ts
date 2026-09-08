/**
 * Revoke the Cloudflare Access session without leaving the app on the edge
 * logout page. Cloudflare processes cookie clearing before the fetch resolves.
 */
export async function revokeCloudflareAccessAndReturnToLogin(): Promise<void> {
  try {
    await fetch('/cdn-cgi/access/logout', {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    // A failed revoke still must return the user to the app's login flow.
  } finally {
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
  }
}
