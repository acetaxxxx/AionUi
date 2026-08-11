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
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import net, { type Socket } from 'node:net';
import serveHandler from 'serve-handler';
import { ShareStore, ShareStoreError, type ShareAssetInput } from './share-store.js';

export type StaticServerOptions = {
  staticDir: string;
  backendPort: number;
  port?: number;
  allowRemote?: boolean;
  /** Persistent directory for share metadata/assets. Omit to disable share APIs. */
  shareStorageDir?: string;
  /** Exact public host allowed to serve `/s/:token` (default: share.snoozydoggy.com). */
  sharePublicHost?: string;
  /** Resolves the authenticated app user; absence deliberately denies management APIs. */
  authenticateShareUser?: (req: IncomingMessage) => string | null | Promise<string | null>;
};

export type StaticServerHandle = {
  port: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};

/** Validate the existing backend session without trusting client identity headers. */
export const createBackendSessionAuthenticator = (backendPort: number) => (req: IncomingMessage): Promise<string | null> =>
  new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (req.headers.cookie) headers.cookie = req.headers.cookie;
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    const authReq = http.request(
      { hostname: '127.0.0.1', port: backendPort, path: '/api/auth/user', method: 'GET', headers },
      (authRes) => {
        const chunks: Buffer[] = [];
        let size = 0;
        authRes.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 64 * 1024) chunks.push(chunk);
        });
        authRes.on('end', () => {
          if ((authRes.statusCode ?? 500) < 200 || (authRes.statusCode ?? 500) >= 300) {
            resolve(null);
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              success?: boolean;
              user?: { id?: string };
            };
            resolve(body.success === true && body.user?.id ? body.user.id : null);
          } catch {
            resolve(null);
          }
        });
        authRes.on('error', () => resolve(null));
      }
    );
    authReq.setTimeout(2000, () => authReq.destroy());
    authReq.on('error', () => resolve(null));
    authReq.end();
  });

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
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
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

const requestHost = (req: IncomingMessage): string => (req.headers.host || '').split(':')[0].toLowerCase();
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const validatePublicHost = (value: string): string => {
  const host = value.trim().toLowerCase();
  if (!host || host.includes('/') || host.includes(':') || host.includes('..') || !/^[a-z0-9.-]+$/.test(host)) {
    throw new Error('sharePublicHost must be an exact DNS hostname without a port or path');
  }
  return host;
};

const sendJson = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(data);
};

const readJson = async (req: IncomingMessage, maxBytes = 8 * 1024 * 1024): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new ShareStoreError('REQUEST_TOO_LARGE', 413);
    chunks.push(bytes);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value as Record<string, unknown>;
  } catch {
    throw new ShareStoreError('INVALID_JSON', 400);
  }
};

const isExactPublicHost = (req: IncomingMessage, publicHost: string): boolean => requestHost(req) === publicHost.toLowerCase();

const publicShareShell = (token: string): string => {
  const encodedToken = JSON.stringify(token);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shared Markdown</title><meta name="robots" content="noindex">
<style>:root{color-scheme:light dark}body{margin:0;background:#f7f7f8;color:#202124;font:16px/1.7 system-ui,sans-serif}main{box-sizing:border-box;max-width:860px;margin:0 auto;padding:64px 28px 96px;background:#fff;min-height:100vh}h1{font-size:2rem;line-height:1.2;margin:0 0 8px}#meta{color:#6b7280;font-size:.9rem;margin-bottom:40px}.markdown{overflow-wrap:anywhere}.markdown h1,.markdown h2,.markdown h3{line-height:1.3;margin:1.5em 0 .5em}.markdown p{margin:1em 0}.markdown pre{padding:16px;border-radius:8px;overflow:auto;background:#f1f3f5}.markdown code{font-family:ui-monospace,monospace}.markdown img{display:block;max-width:100%;height:auto;margin:1.25em auto;border-radius:8px}.error{padding:24px;border:1px solid #f0a0a0;border-radius:8px}@media(prefers-color-scheme:dark){body{background:#17181a;color:#e8eaed}main{background:#202124}.markdown pre{background:#303134}}</style></head>
<body><main><h1 id="title">Shared Markdown</h1><div id="meta"></div><article id="content" class="markdown">Loading…</article></main>
<script>(async()=>{const token=${encodedToken},root=document.getElementById('content'),title=document.getElementById('title'),meta=document.getElementById('meta');const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));try{const r=await fetch('/api/public/shares/'+token);if(!r.ok)throw Error('not found');const d=await r.json();title.textContent=d.title||'Shared Markdown';meta.textContent='Shared '+new Date(d.createdAt).toLocaleDateString();const assets=new Map((d.assets||[]).map(a=>[a.name,'/api/public/shares/'+token+'/assets/'+a.id]));let md=esc(d.markdown||'');md=md.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g,(_,alt,src)=>{const clean=src.split(/[?#]/)[0].split('/').pop(),url=assets.get(clean)||(/^https?:\\/\\//i.test(src)||/^data:image\\//i.test(src)?src:'');return url?'<img alt="'+alt+'" src="'+url+'">':''});md=md.replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>').replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>').replace(/\\n{2,}/g,'</p><p>').replace(/\\n/g,'<br>');root.innerHTML='<p>'+md+'</p>'}catch(e){root.innerHTML='<div class="error">This shared document is unavailable or has expired.</div>'}})()</script></body></html>`;
};

async function handleShareRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: ShareStore,
  publicHost: string,
  staticDir: string,
  authenticate: StaticServerOptions['authenticateShareUser']
): Promise<boolean> {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const shellMatch = /^\/s\/([A-Za-z0-9_-]+)$/.exec(parsed.pathname);
  const legacyAssetMatch = /^\/s\/([A-Za-z0-9_-]+)\/assets\/([A-Za-z0-9_-]+)$/.exec(parsed.pathname);
  const apiMatch = /^\/api\/public\/shares\/([A-Za-z0-9_-]+)$/.exec(parsed.pathname);
  const apiAssetMatch = /^\/api\/public\/shares\/([A-Za-z0-9_-]+)\/assets\/([A-Za-z0-9_-]+)$/.exec(parsed.pathname);
  if (shellMatch || legacyAssetMatch || apiMatch || apiAssetMatch) {
    if (!isExactPublicHost(req, publicHost) || req.method !== 'GET') {
      sendJson(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    const token = (shellMatch || legacyAssetMatch || apiMatch || apiAssetMatch)![1];
    if (!SHARE_TOKEN_PATTERN.test(token)) {
      sendJson(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    if (legacyAssetMatch || apiAssetMatch) {
      const assetId = (legacyAssetMatch || apiAssetMatch)![2];
      const result = await store.readAsset(token, assetId);
      if (!result) {
        sendJson(res, 404, { error: 'NOT_FOUND' });
        return true;
      }
      res.writeHead(200, {
        'content-type': result.asset.mime,
        'content-length': String(result.data.length),
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      res.end(result.data);
      return true;
    }
    if (shellMatch) {
      const shellPath = path.join(staticDir, 'share.html');
      try {
        const shell = await readFile(shellPath, 'utf8');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=30, must-revalidate',
          'x-content-type-options': 'nosniff',
        });
        res.end(shell);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=30, must-revalidate',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: https:",
        'x-content-type-options': 'nosniff',
      });
      res.end(publicShareShell(token));
      return true;
    }
    const share = store.getPublic(token);
    if (!share) {
      sendJson(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    sendJson(res, 200, share, { 'cache-control': 'public, max-age=30, must-revalidate', etag: `"${share.id}-${share.createdAt}"` });
    return true;
  }

  const createMatch = parsed.pathname === '/api/shares/markdown';
  const revokeMatch = /^\/api\/shares\/([A-Za-z0-9_-]+)\/revoke$/.exec(parsed.pathname);
  if ((!createMatch && !revokeMatch) || isExactPublicHost(req, publicHost)) return false;
  const ownerId = authenticate ? await authenticate(req) : null;
  if (!ownerId) {
    sendJson(res, 401, { error: 'AUTHENTICATION_REQUIRED' });
    return true;
  }
  try {
    if (req.method === 'POST' && createMatch) {
      const body = await readJson(req);
      const result = await store.create(ownerId, {
        markdown: body.markdown as string,
        title: body.title as string | undefined,
        expiresAt: body.expiresAt as string | undefined,
        assets: body.assets as ShareAssetInput[] | undefined,
      });
      sendJson(res, 201, result, { 'cache-control': 'no-store' });
      return true;
    }
    if (req.method === 'DELETE' && revokeMatch) {
      const ok = await store.revoke(ownerId, revokeMatch[1]);
      sendJson(res, ok ? 204 : 404, ok ? undefined : { error: 'NOT_FOUND' }, { 'cache-control': 'no-store' });
      return true;
    }
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' }, { allow: revokeMatch ? 'DELETE' : 'POST' });
    return true;
  } catch (error) {
    if (error instanceof ShareStoreError) sendJson(res, error.status, { error: error.code });
    else sendJson(res, 500, { error: 'INTERNAL_ERROR' });
    return true;
  }
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
  client.setKeepAlive(true);
  client.setTimeout(0);
  const upstream = net.connect({ host: '127.0.0.1', port: targetPort });
  upstream.setNoDelay(true);
  upstream.setKeepAlive(true);
  upstream.once('connect', () => {
    if (initialBytes.length > 0) upstream.write(initialBytes);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const tearDown = (): void => {
    client.destroy();
    upstream.destroy();
  };
  upstream.on('error', tearDown);
  client.on('error', tearDown);
  upstream.on('close', tearDown);
  client.on('close', tearDown);
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

export async function startStaticServer(opts: StaticServerOptions): Promise<StaticServerHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const allowRemote = opts.allowRemote === true;
  const host = allowRemote ? '0.0.0.0' : '127.0.0.1';
  const shareStore = opts.shareStorageDir ? new ShareStore(opts.shareStorageDir) : null;
  if (shareStore) await shareStore.init();
  const sharePublicHost = validatePublicHost(opts.sharePublicHost ?? 'share.snoozydoggy.com');

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

      if (shareStore && (req.url.startsWith('/s/') || req.url.startsWith('/api/shares') || req.url.startsWith('/api/public/shares/'))) {
        const handled = await handleShareRequest(req, res, shareStore, sharePublicHost, opts.staticDir, opts.authenticateShareUser);
        if (handled) return;
      }

      // /api/* — reverse proxy to backend (includes /api/auth/*).
      // /login and /logout are aionui-auth's top-level auth endpoints: proxy them too
      // so WebUI browser clients reach the backend without a path-rewrite.
      if (req.url.startsWith('/api/') || req.url.startsWith('/api?') || req.url === '/login' || req.url === '/logout') {
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
