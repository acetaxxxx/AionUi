/**
 * WebUI static server.
 *
 * Serves out/renderer/ as the SPA and reverse-proxies /api/*, /ws, /api/stt/stream,
 * /login and /logout to aioncore. All auth goes to backend's aionui-auth crate;
 * /login and /logout are aionui-auth's top-level paths, the rest live under
 * /api/auth/*. /ws and /api/stt/stream are WebSocket/stream upgrades spliced at
 * TCP level; /api/stt/stream is the STT streaming endpoint.
 *
 * Design: Node native http + serve-handler. No Express. No business routes.
 */

import http, { type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import net, { type Socket } from 'node:net';
import serveHandler from 'serve-handler';
import {
  extractCloudflareAccessToken,
  getCloudflareAccessIdentity,
  resolveCloudflareAccessConfig,
} from './cloudflareAccess.js';

export type StaticServerOptions = {
  staticDir: string;
  backendPort: number;
  port?: number;
  allowRemote?: boolean;
};

export type StaticServerHandle = {
  port: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};

const DEFAULT_PORT = 25808;
const BACKEND_SESSION_LOOKUP_TIMEOUT_MS = 2000;
const BACKEND_LOGIN_TIMEOUT_MS = 5000;

// Ranges that are non-internal IPv4 yet never a reachable LAN address, so we
// must never advertise them as the WebUI access URL even when they are the only
// non-loopback interface present:
//   169.254.0.0/16  link-local / APIPA (host got no DHCP lease)
//   198.18.0.0/15   RFC 2544 benchmarking range — handed out by utility tunnels
//                   such as Cloudflare WARP; this is the address that showed up
//                   on a multi-NIC machine instead of the real LAN IP.
const isUnreachableLanRange = (addr: string): boolean => addr.startsWith('169.254.') || /^198\.(18|19)\./.test(addr);

// Rank candidate LAN addresses by how likely they are the network the user
// actually reaches the desktop on. Lower is better. Private (RFC 1918) home /
// office ranges win over anything else; 192.168/16 is the most common LAN, then
// the 172.16/12 block, then 10/8 (frequently carved up by VPNs / corp routing).
const rankLanCandidate = (addr: string): number => {
  if (addr.startsWith('192.168.')) return 0;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 1;
  if (addr.startsWith('10.')) return 2;
  return 3;
};

// Pick the best LAN IPv4 to advertise. Pure over the interface map so it can be
// unit-tested against real multi-NIC layouts. Iterating and returning the first
// non-internal hit (the old behavior) picks whatever the OS lists first, which
// on a multi-NIC box can be a VPN / benchmark adapter rather than the LAN.
export function pickLanIP(nets: ReturnType<typeof networkInterfaces>): string | null {
  const candidates: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (isUnreachableLanRange(iface.address)) continue;
      candidates.push(iface.address);
    }
  }
  // Stable sort keeps OS interface order among equally-ranked addresses (e.g. a
  // physical NIC listed before a VPN when both are 10/8).
  candidates.sort((a, b) => rankLanCandidate(a) - rankLanCandidate(b));
  return candidates[0] ?? null;
}

function getLanIP(): string | null {
  return pickLanIP(networkInterfaces());
}

function forwardToBackend(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
  const headers: OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${backendPort}` };
  const cfToken = extractCloudflareAccessToken(req.headers);
  if (cfToken && !headers['cf-access-jwt-assertion']) {
    headers['cf-access-jwt-assertion'] = cfToken;
  }
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers,
  };
  const proxy = http.request(options, (proxyRes) => {
    const isLogout = req.url?.startsWith('/logout') || req.url?.startsWith('/api/auth/logout');
    const isCfAccess = Boolean(cfToken);

    const resHeaders = { ...proxyRes.headers };
    if (isLogout && isCfAccess) {
      resHeaders['x-cloudflare-logout'] = 'true';
    }

    res.writeHead(proxyRes.statusCode ?? 502, resHeaders);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

// Max bytes we peek before forcing a routing decision. An HTTP request-line
// on its own is typically < 100 bytes; a full header block is < 2 KB. If we
// haven't seen a newline after 4 KB the client is sending something weird —
// hand it to the internal HTTP server and let it return 400.
const PEEK_LIMIT_BYTES = 4096;

/**
 * Splice `client` to a TCP endpoint on `targetPort`. Any bytes already read
 * from `client` during peek are replayed to the upstream as the first write,
 * so the endpoint sees the full HTTP request as-sent.
 */
function spliceToTcpEndpoint(client: Socket, targetPort: number, initialBytes: Buffer): void {
  client.setNoDelay(true);
  client.setKeepAlive(true, 15000);
  client.setTimeout(0);
  let connected = false;
  // The peek phase left `client` in flowing mode (it had a 'data' listener),
  // but that listener is now removed and the real consumer — `client.pipe(upstream)`
  // — is only wired inside the async 'connect' handler below. Pause here so any
  // body bytes arriving in the gap are buffered by the socket instead of being
  // dropped for lack of a consumer; `pipe()` resumes the socket once connected.
  // Without this, large/buffered uploads (e.g. reverse-proxied POST bodies that
  // span multiple TCP segments) lose their tail bytes and the backend hangs
  // forever waiting for the missing Content-Length (issue #4058).
  client.pause();
  const upstream = net.connect({ host: '127.0.0.1', port: targetPort });
  upstream.setNoDelay(true);
  upstream.setKeepAlive(true, 15000);
  upstream.once('connect', () => {
    connected = true;
    if (initialBytes.length > 0) upstream.write(initialBytes);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const tearDown = (err?: Error): void => {
    if (!connected && err && client.writable) {
      client.write(
        'HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"error":"BACKEND_UNREACHABLE"}'
      );
      client.end();
    } else {
      client.destroy();
    }
    upstream.destroy();
  };
  upstream.on('error', tearDown);
  client.on('error', () => tearDown());
  upstream.on('close', () => {
    if (!connected) tearDown();
  });
  client.on('close', () => tearDown());
}

/**
 * Decide routing from the first chunk of an incoming HTTP connection:
 *  - `true`  → `GET /ws[...] HTTP/1.x` or `GET /api/stt/stream[...] HTTP/1.x` (WebSocket/stream upgrades), splice to backend
 *  - `false` → any other HTTP method / path, hand to internal HTTP server
 *  - `null`  → need more bytes (no CRLF yet)
 *
 * We only check the request-line; `Upgrade: websocket` is not strictly
 * required — the backend will reject a non-upgrade GET on these paths on its own.
 * Keeping the rule simple means we can decide after the first ~50 bytes
 * instead of waiting for the full header block.
 */
function peekWsRoute(buf: Buffer): boolean | null {
  const newlineIdx = buf.indexOf(0x0a); // \n
  if (newlineIdx < 0) return null;
  const firstLine = buf.slice(0, newlineIdx).toString('ascii');
  return /^GET\s+\/(?:ws|api\/stt\/stream)(?:\?[^\s]*)?\s+HTTP\/1\.[01]\r?$/.test(firstLine);
}

interface AionUserMatch {
  username: string;
  password?: string;
}

type BackendAuthUserResponse = {
  success?: unknown;
  user?: {
    username?: unknown;
  };
};

/**
 * Matches a Cloudflare Access email against configured AIONUI_USERS entries.
 * Supports:
 * - "email:username:password"
 * - "email:password"
 * - "username:password"
 */
function getAionUserForEmail(cfEmail: string): AionUserMatch | null {
  const usersEnv = process.env.AIONUI_USERS || '';
  const entries = usersEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const normalizedEmail = cfEmail.toLowerCase();

  for (const entry of entries) {
    const firstColonIdx = entry.indexOf(':');
    const secondColonIdx = entry.indexOf(':', firstColonIdx + 1);
    const isEmailMapping =
      firstColonIdx > 0 && secondColonIdx > firstColonIdx && entry.slice(0, firstColonIdx).includes('@');
    if (isEmailMapping) {
      const email = entry.slice(0, firstColonIdx);
      const username = entry.slice(firstColonIdx + 1, secondColonIdx);
      const password = entry.slice(secondColonIdx + 1);
      if (email.toLowerCase() === normalizedEmail) {
        return { username, password };
      }
    } else if (firstColonIdx > 0) {
      const userOrEmail = entry.slice(0, firstColonIdx);
      const password = entry.slice(firstColonIdx + 1);
      if (userOrEmail.toLowerCase() === normalizedEmail) {
        // ensureUsers creates the username exactly as it appears before the
        // first colon, so an email-style key must keep its full address.
        return { username: userOrEmail, password };
      }
      if (normalizedEmail.startsWith(userOrEmail.toLowerCase() + '@')) {
        return { username: userOrEmail, password };
      }
    }
  }

  // Never fall back to the first configured account. An unmatched SSO
  // identity must remain unauthenticated instead of inheriting another
  // user's conversations, teams, credentials, or workspace.
  return null;
}

function getCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  const prefix = `${cookieName}=`;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      return trimmed.slice(prefix.length);
    }
  }
  return null;
}

function replaceAionSessionCookie(cookieHeader: string | undefined, setCookieHeader: string): string {
  const sessionPair = setCookieHeader.split(';', 1)[0]?.trim();
  if (!sessionPair) return cookieHeader ?? '';

  const remainingCookies = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.toLowerCase().startsWith('aionui-session='));

  return [...remainingCookies, sessionPair].join('; ');
}

function isHttpsRequest(req: IncomingMessage): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return proto === 'https' || req.headers['cf-visitor']?.includes('"scheme":"https"') === true;
}

function getExpiredAionSessionCookie(req: IncomingMessage): string {
  return `aionui-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isHttpsRequest(req) ? '; Secure' : ''}`;
}

function getBackendSessionUsername(backendPort: number, cookieHeader: string): Promise<string | null> {
  return new Promise((resolve) => {
    const authReq = http.request(
      {
        hostname: '127.0.0.1',
        port: backendPort,
        path: '/api/auth/user',
        method: 'GET',
        headers: {
          accept: 'application/json',
          cookie: cookieHeader,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('error', () => resolve(null));
        res.on('end', () => {
          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
            resolve(null);
            return;
          }

          try {
            const payload = JSON.parse(body) as BackendAuthUserResponse;
            resolve(
              payload.success === true && typeof payload.user?.username === 'string' ? payload.user.username : null
            );
          } catch {
            resolve(null);
          }
        });
      }
    );
    authReq.setTimeout(BACKEND_SESSION_LOOKUP_TIMEOUT_MS, () => authReq.destroy());
    authReq.on('error', () => resolve(null));
    authReq.end();
  });
}

/**
 * Auto-authenticates a matched user with aioncore /login endpoint to issue a session cookie.
 */
function autoLoginUser(backendPort: number, username: string, password?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ username, password: password || '', remember: true });
    const loginReq = http.request(
      {
        hostname: '127.0.0.1',
        port: backendPort,
        path: '/login',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie && setCookie.length > 0) {
          const sessionCookie = setCookie.find((c) => c.includes('aionui-session='));
          if (sessionCookie) {
            resolve(sessionCookie);
            return;
          }
          resolve(setCookie[0]);
          return;
        }
        resolve(null);
      }
    );
    loginReq.setTimeout(BACKEND_LOGIN_TIMEOUT_MS, () => loginReq.destroy());
    loginReq.on('error', () => resolve(null));
    loginReq.write(postData);
    loginReq.end();
  });
}
function writeCloudflareAuthFailure(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  error: 'CF_ACCESS_UNVERIFIED' | 'CF_IDENTITY_NOT_MAPPED' | 'AION_SESSION_REFRESH_FAILED'
): void {
  // A transient Cloudflare/JWKS verification failure can finish after a newer
  // login request. Never let that stale response delete the newer AION session.
  // A verified identity mismatch still clears the cookie to prevent account
  // crossover.
  if (error !== 'CF_ACCESS_UNVERIFIED') {
    res.setHeader('Set-Cookie', getExpiredAionSessionCookie(req));
  }
  res.writeHead(statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ success: false, error }));
}

export async function startStaticServer(opts: StaticServerOptions): Promise<StaticServerHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const allowRemote = opts.allowRemote === true;
  const host = allowRemote ? '0.0.0.0' : '127.0.0.1';

  // The HTTP server listens only on loopback — user traffic hits the outer
  // net.Server first. We route to this server for everything except WS
  // upgrades and STT stream upgrades, which go straight to the backend via a raw TCP splice.
  //
  // Why two listeners instead of using `http.Server`'s native `upgrade` event:
  // bun 1.3's http-compat layer does not faithfully forward writes on the
  // socket delivered to the `upgrade` handler, so the backend's 101 response
  // never reaches the browser (see #2824). Making the outer listener pure
  // TCP avoids touching that code path on both bun and node.
  const http_server: Server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        res.writeHead(400).end();
        return;
      }

      // Cloudflare Access is the source of truth for remote WebUI identity.
      // Local requests without a Cloudflare token keep the normal AION login flow.
      const isApiOrAuth =
        req.url.startsWith('/api/') ||
        req.url.startsWith('/api?') ||
        req.url.startsWith('/login') ||
        req.url.startsWith('/logout');
      const isDocumentGet =
        req.method === 'GET' && !isApiOrAuth && (!req.url.includes('.') || req.url === '/' || req.url.startsWith('/?'));

      const cloudflareAccessToken = extractCloudflareAccessToken(req.headers);
      if (cloudflareAccessToken) {
        const cfConfig = resolveCloudflareAccessConfig();
        if (cfConfig) {
          const cfIdentity = await getCloudflareAccessIdentity(req.headers);
          if (!cfIdentity) {
            // Edge verification failed: reject immediately, never fallback to random or local user
            writeCloudflareAuthFailure(req, res, 401, 'CF_ACCESS_UNVERIFIED');
            return;
          }
        }

        // For all API and auth endpoints, forward to backend so backend verifies and provisions user
        if (isApiOrAuth) {
          forwardToBackend(req, res, opts.backendPort);
          return;
        }

        // For initial document request with Cloudflare token, serve SPA index
        if (isDocumentGet) {
          await serveHandler(req, res, {
            public: opts.staticDir,
            rewrites: [{ source: '**', destination: '/index.html' }],
          });
          return;
        }
      }

      // /api/* — reverse proxy to backend (includes /api/auth/*).
      // /login and /logout are aionui-auth's top-level auth endpoints: proxy them too
      // so WebUI browser clients reach the backend without a path-rewrite.
      if (isApiOrAuth) {
        forwardToBackend(req, res, opts.backendPort);
        return;
      }

      // static files + SPA fallback
      await serveHandler(req, res, {
        public: opts.staticDir,
        rewrites: [{ source: '**', destination: '/index.html' }],
      });
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
      } else {
        res.destroy();
      }
    }
  });

  // Configure timeouts to prevent Cloudflare Tunnel TCP Keep-Alive race condition 502 errors
  http_server.keepAliveTimeout = 75000;
  http_server.headersTimeout = 76000;
  http_server.requestTimeout = 300000;

  // Internal HTTP server — 127.0.0.1 ephemeral port, never visible to the user.
  await new Promise<void>((resolve, reject) => {
    http_server.once('error', reject);
    http_server.listen(0, '127.0.0.1', () => {
      http_server.off('error', reject);
      resolve();
    });
  });
  const internalPort = (http_server.address() as { port: number } | null)?.port;
  if (!internalPort) {
    throw new Error('internal HTTP server failed to bind to a port');
  }

  // User-facing listener: inspect the first line of every TCP connection and
  // route to either the backend (for /ws and /api/stt/stream upgrades) or the internal HTTP
  // server (everything else). Both routes use raw TCP splice — no reliance
  // on http.Server's upgrade event.
  const activeClients = new Set<Socket>();
  const tcp_server = net.createServer((client: Socket) => {
    activeClients.add(client);
    client.once('close', () => activeClients.delete(client));

    let peeked = Buffer.alloc(0);
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      client.removeListener('data', onData);
      client.removeListener('error', onEarlyError);
      client.removeListener('end', onEarlyEnd);
    };
    const onData = (chunk: Buffer): void => {
      peeked = Buffer.concat([peeked, chunk]);
      const decision = peekWsRoute(peeked);
      if (decision === null && peeked.length < PEEK_LIMIT_BYTES) return;
      cleanup();
      const target = decision === true ? opts.backendPort : internalPort;
      spliceToTcpEndpoint(client, target, peeked);
    };
    const onEarlyError = (): void => {
      cleanup();
      client.destroy();
    };
    const onEarlyEnd = (): void => {
      // Client closed before we saw a request line — nothing to route.
      cleanup();
      client.destroy();
    };
    client.on('data', onData);
    client.on('error', onEarlyError);
    client.on('end', onEarlyEnd);
  });

  await new Promise<void>((resolve, reject) => {
    tcp_server.once('error', reject);
    tcp_server.listen(port, host, () => {
      tcp_server.off('error', reject);
      resolve();
    });
  });

  const actualPort = (tcp_server.address() as { port: number } | null)?.port ?? port;
  const lanIP = allowRemote ? (getLanIP() ?? undefined) : undefined;
  const localUrl = `http://127.0.0.1:${actualPort}`;
  const networkUrl = lanIP ? `http://${lanIP}:${actualPort}` : undefined;

  return {
    port: actualPort,
    url: networkUrl ?? localUrl,
    localUrl,
    networkUrl,
    lanIP,
    stop: () =>
      new Promise<void>((resolve) => {
        if (
          typeof (http_server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections === 'function'
        ) {
          (http_server as unknown as { closeIdleConnections: () => void }).closeIdleConnections();
        }

        // net.Server does not drain keep-alive sockets on close. Destroy the
        // public clients first, otherwise an idle browser connection can keep
        // shutdown pending while tcp_server.close() waits for it to end.
        for (const client of activeClients) client.destroy();
        activeClients.clear();

        tcp_server.close(() => {
          if (
            typeof (http_server as unknown as { closeAllConnections?: () => void }).closeAllConnections === 'function'
          ) {
            (http_server as unknown as { closeAllConnections: () => void }).closeAllConnections();
          }
          http_server.close(() => resolve());
        });
      }),
  };
}

export async function stopStaticServer(handle: StaticServerHandle): Promise<void> {
  await handle.stop();
}
