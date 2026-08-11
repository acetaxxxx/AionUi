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

import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import net, { type Socket } from 'node:net';
import serveHandler from 'serve-handler';

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

function getLanIP(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

function forwardToBackend(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
  };
  const proxy = http.request(options, (proxyRes) => {
    const isLogout = req.url?.startsWith('/logout') || req.url?.startsWith('/api/auth/logout');
    const isCfAccess = Boolean(extractCloudflareEmail(req) || req.headers.cookie?.includes('CF_Authorization'));

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

/**
 * Extracts Cloudflare Access authenticated email from HTTP headers or CF_Authorization JWT cookie.
 */
function extractCloudflareEmail(req: IncomingMessage): string | null {
  const headerEmail = req.headers['cf-access-authenticated-user-email'];
  if (typeof headerEmail === 'string' && headerEmail.trim()) {
    return headerEmail.trim();
  }

  let jwt: string | undefined;
  if (typeof req.headers['cf-access-jwt-assertion'] === 'string') {
    jwt = req.headers['cf-access-jwt-assertion'];
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    if (match) jwt = match[1];
  }

  if (jwt) {
    try {
      const parts = jwt.split('.');
      if (parts.length === 3) {
        const payloadStr = Buffer.from(parts[1], 'base64url').toString('utf8');
        const payload = JSON.parse(payloadStr);
        if (typeof payload.email === 'string' && payload.email.trim()) {
          return payload.email.trim();
        }
      }
    } catch {
      // Ignore invalid JWT
    }
  }

  return null;
}

interface AionUserMatch {
  username: string;
  password?: string;
}

/**
 * Matches a Cloudflare Access email against configured AIONUI_USERS entries.
 * Supports:
 * - "email:username:password"
 * - "email:password"
 * - "username:password"
 */
function getAionUserForEmail(cfEmail: string): AionUserMatch {
  const usersEnv = process.env.AIONUI_USERS || '';
  const entries = usersEnv.split(',').map((s) => s.trim()).filter(Boolean);

  for (const entry of entries) {
    const parts = entry.split(':');
    if (parts.length === 3) {
      const [email, username, password] = parts;
      if (email.toLowerCase() === cfEmail.toLowerCase()) {
        return { username, password };
      }
    } else if (parts.length === 2) {
      const [userOrEmail, password] = parts;
      if (userOrEmail.toLowerCase() === cfEmail.toLowerCase()) {
        const username = userOrEmail.includes('@') ? userOrEmail.split('@')[0] : userOrEmail;
        return { username, password };
      }
      if (cfEmail.toLowerCase().startsWith(userOrEmail.toLowerCase() + '@')) {
        return { username: userOrEmail, password };
      }
    }
  }

  // Fallback: If no direct match in AIONUI_USERS, check first user entry or use email prefix
  const firstEntry = entries[0];
  if (firstEntry) {
    const parts = firstEntry.split(':');
    if (parts.length === 3) return { username: parts[1], password: parts[2] };
    if (parts.length === 2) return { username: parts[0], password: parts[1] };
  }

  const username = cfEmail.includes('@') ? cfEmail.split('@')[0] : cfEmail;
  return { username };
}

/**
 * Auto-authenticates a matched user with aioncore /login endpoint to issue a session cookie.
 */
function autoLoginUser(backendPort: number, username: string, password?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ username, password: password || '' });
    const req = http.request(
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
    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });
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

      // Cloudflare Access SSO Auto-Login Interceptor
      const hasSessionCookie = req.headers.cookie && req.headers.cookie.includes('aionui-session=');
      const isAuthCheck = req.url === '/api/auth/user' || req.url.startsWith('/api/auth/user?');
      const isDocumentGet = req.method === 'GET' && (!req.url.includes('.') || req.url === '/' || req.url.startsWith('/?'));

      if (!hasSessionCookie && (isDocumentGet || isAuthCheck)) {
        const cfEmail = extractCloudflareEmail(req);
        if (cfEmail) {
          const userMatch = getAionUserForEmail(cfEmail);
          const cookieHeader = await autoLoginUser(opts.backendPort, userMatch.username, userMatch.password);
          if (cookieHeader) {
            let formattedCookie = cookieHeader;
            if (!formattedCookie.toLowerCase().includes('path=')) formattedCookie += '; Path=/';
            if (!formattedCookie.toLowerCase().includes('samesite=')) formattedCookie += '; SameSite=Lax';
            const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.headers['cf-visitor']?.includes('https');
            if (isHttps && !formattedCookie.toLowerCase().includes('secure')) {
              formattedCookie += '; Secure';
            }
            res.setHeader('Set-Cookie', formattedCookie);

            if (isAuthCheck) {
              req.headers.cookie = req.headers.cookie ? `${req.headers.cookie}; ${formattedCookie}` : formattedCookie;
              forwardToBackend(req, res, opts.backendPort);
              return;
            }

            await serveHandler(req, res, {
              public: opts.staticDir,
              rewrites: [{ source: '**', destination: '/index.html' }],
            });
            return;
          }
        }
      }

      // /api/* — reverse proxy to backend (includes /api/auth/*).
      // /login and /logout are aionui-auth's top-level auth endpoints: proxy them too
      // so WebUI browser clients reach the backend without a path-rewrite.
      if (req.url.startsWith('/api/') || req.url.startsWith('/api?') || req.url.startsWith('/login') || req.url.startsWith('/logout')) {
        forwardToBackend(req, res, opts.backendPort);
        return;
      }

      // static files + SPA fallback
      await serveHandler(req, res, {
        public: opts.staticDir,
        rewrites: [{ source: '**', destination: '/index.html' }],
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
      } else {
        res.destroy();
      }
    }
  });

  // Configure timeouts to prevent Cloudflare Tunnel TCP Keep-Alive race condition 502 errors
  http_server.keepAliveTimeout = 75000; // 75 seconds (> Cloudflare 60s default)
  http_server.headersTimeout = 76000;   // 76 seconds (> keepAliveTimeout)
  http_server.requestTimeout = 300000;  // 5 minutes for long LLM / Agent streaming requests

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
  const tcp_server = net.createServer((client: Socket) => {
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
        tcp_server.close(() => {
          http_server.close(() => resolve());
        });
      }),
  };
}

export async function stopStaticServer(handle: StaticServerHandle): Promise<void> {
  await handle.stop();
}
