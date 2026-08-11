# Markdown sharing API

The static host can optionally expose persistent snapshot shares. Set
`shareStorageDir` when starting `startStaticServer`; the directory contains a
0600 `shares.json` metadata file and an `assets/` directory. The host does not
modify aioncore.

When using `startWebHost`, enable the same module with:

```ts
sharing: {
  enabled: true,
  // Defaults to `${dataDir}/shares`.
  publicHost: 'share.snoozydoggy.com',
  authenticateUser: validateSession,
}
```

`enabled: true` requires either `WebHostOptions.dataDir` or an explicit
`sharing.storageDir`; sharing is disabled by default. `authenticateUser` is an
injected server-side verifier, not a client header parser.

Management endpoints are only enabled when `authenticateShareUser` is injected.
The callback must validate the app's session using the same auth authority as
the backend and return a stable owner id. If it is absent, management requests
return `401` rather than trusting a client-supplied header or cookie.

`POST /api/shares/markdown` (app host, authenticated)

```json
{
  "title": "Release notes",
  "markdown": "# Hello\n\n![logo](/s/.../assets/...)\n",
  "expiresAt": "2026-08-18T00:00:00.000Z",
  "assets": [{ "name": "logo.png", "mime": "image/png", "data": "<base64>" }]
}
```

The response is `201` with `{ id, token, title, createdAt, expiresAt }`. Tokens
are returned only once and are stored as SHA-256 hashes. Markdown is limited to
2 MiB, each raster image asset to 5 MiB, and each inline `data:image` payload to
100 KiB (decoded bytes). Each request is limited to 8 MiB (64 assets per share).
Asset names are basename-normalized and only PNG, JPEG, GIF, WebP, AVIF, BMP,
ICO, and TIFF image MIME types are accepted. SVG is rejected because it can
carry active content. Remote HTTPS images remain links and are not uploaded.

`DELETE /api/shares/:id/revoke` (app host, authenticated)

Revokes a share and returns `204`. Revoked and expired shares return `404` from
all public endpoints.

`GET /s/:token` (public HTML shell), `GET /api/public/shares/:token` (JSON),
and `GET /api/public/shares/:token/assets/:assetId` (public bytes)

These routes are served only when the request host exactly matches
`sharePublicHost` (default `share.snoozydoggy.com`). `/s/:token` serves
`<staticDir>/share.html` when the compiled public MPA is present; if it is absent
the endpoint returns `503 PUBLIC_SHARE_ENTRY_UNAVAILABLE` rather than rendering
an unsafe server-side fallback. The shell fetches the JSON endpoint and renders
a reading view. The JSON endpoint returns the Markdown snapshot and asset
manifest; the asset endpoint returns image bytes with `nosniff` and immutable
cache headers. The legacy `/s/:token/assets/:assetId` bytes alias remains for
compatibility. A public page can use this contract without exposing local paths
or requiring an authenticated WebSocket session.

This module intentionally implements snapshot shares only. Live publication
should add append-only revisions and a `current_revision_id` pointer before
adding a watcher; the current API can remain backward-compatible by treating
each POST as a new immutable snapshot.
