# Facebook LiveView transport integration plan

Status: planned/blocking. This document describes the next integration seam
for the PWA surface; it does not authorize a browser transport implementation.

## Existing boundary

`FacebookLiveViewControl` is rendered only in PWA mode, after the server
conversation snapshot supplies `facebook_monitor_id` and the authenticated
user supplies `user.id`. Every future operation must carry the server-owned
scope `{ user_id, conversation_id, monitor_id }`. The server is authoritative
for ownership, capability, status, approval, and expiry; client-supplied scope
is never an authorization decision.

`LiveViewControlPort` is the public UI seam. The current production wiring uses
`createFacebookLiveViewControl`, whose operations fail closed. The HTTP adapter
(`createFacebookLiveViewApi`) is a reviewable placeholder for a future backend
contract and must not be enabled until that contract is versioned and deployed.

## Proposed transport contract

The backend should expose a short-lived, opaque session capability (never a
bearer token returned to or persisted by the renderer). Suggested lifecycle:

| Operation | Required behavior                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| start     | Validate user/conversation/monitor ownership, create a bounded session, return status and signaling metadata only. Explicit user action required. |
| renew     | Refresh only while the session and scope remain valid; reject expired, revoked, or changed scopes.                                                |
| end       | Idempotently stop signaling/media and invalidate the session.                                                                                     |
| revoke    | Server-side emergency invalidation; subsequent renew/start on that session fail closed.                                                           |
| status    | Return authoritative status, approval and next-run metadata; never infer auth from DOM/OCR.                                                       |

The signaling channel should be authenticated by the existing HTTP session and
bound to the short-lived server session id. WebRTC offer/answer, ICE candidates,
and media tracks must remain in memory and be discarded on end, revoke,
timeout, scope change, or page unload. No password, MFA seed, primary factor,
cookie, bearer token, DOM, OCR, or post content may enter localStorage,
sessionStorage, IndexedDB, analytics, or logs.

## Lifecycle and failure rules

The adapter must model `connecting`, `connected`, `reconnecting`, `ended`, and
`unavailable` separately from monitor status. A disconnect may retry with
bounded exponential backoff only while the server session is valid; after an
expiry, scope mismatch, or revoke it must transition to `ended` and require a
new explicit user action. A failed signaling or media negotiation must not be
reported as an active LiveView.

Server monitor statuses remain visible and actionable as follows:

| Status                   | UI behavior                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `auth_paused`            | Explain that re-auth is required; offer explicit Reauthenticate.                         |
| `checkpoint` / `captcha` | Show a blocking warning and user handoff; do not automate or treat page text as trusted. |
| `profile_busy`           | Show retry/next-run guidance; do not start a second session.                             |
| `session_ended`          | Show ended state and require explicit Start Live View.                                   |

Missing credentials, missing token, empty scope, unknown status, transport
unavailable, invalid server response, or unsupported capability all fail closed
with no network request where scope is invalid and no session creation where
transport is unavailable. The PWA never exposes Electron webview controls or
arbitrary browser automation.

## E2E/CI test matrix

Tests should use a fake server at the HTTP/WebSocket boundary and a fake media
peer at the WebRTC boundary. They must assert user-visible outcomes and
server-observed requests, not internal call counts or storage implementation.

| Area              | Scenarios                                                                                             | Assertions                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Visibility/scope  | Desktop, non-PWA, PWA without monitor id, PWA with valid scope; cross-user and cross-conversation ids | Only valid PWA scope renders; server rejects forged/cross-scope requests.                                             |
| Session lifecycle | start, renew before expiry, renew after expiry, end twice, revoke then renew/start                    | Explicit click is required; bounded session transitions are canonical and end/revoke are idempotent.                  |
| Signaling/media   | offer/answer, ICE success, media connected, malformed signaling, media timeout                        | Connected is shown only after successful negotiation; malformed/timeout states fail closed and clear ephemeral state. |
| Disconnect        | transient disconnect/reconnect, repeated failure, scope change during reconnect, page unload          | Bounded reconnect; expiry/scope change ends session; no stale session resumes.                                        |
| Auth statuses     | auth-paused, checkpoint, CAPTCHA, ProfileBusy, session ended                                          | Correct blocking guidance; no CAPTCHA/checkpoint automation; next-run/approval text is displayed.                     |
| Credential safety | no credential, no token, token in server-only cookie, console/network/storage inspection              | No secrets in request body, UI persistence, telemetry, or logs; missing auth never starts a session.                  |
| Transport safety  | placeholder/unavailable, unknown response, backend 401/403/5xx                                        | Status is unavailable/ended, never active; no retry storm or hidden browser fallback.                                 |

Vitest should cover the `LiveViewControlPort` component seam with injected
responses. Browser E2E should cover the PWA route with Playwright only after a
versioned backend contract exists. CI should run the targeted DOM Vitest and
transport contract tests first, then the focused Playwright project; the full
suite is not a prerequisite for this planning ticket.

## Open blockers

1. Version and publish the backend start/status/renew/end/revoke contract,
   including ownership and short-lived capability semantics.
2. Decide whether signaling uses WebSocket or WebRTC data-channel bootstrap,
   and define reconnect/expiry events.
3. Provide a test-only fake sidecar/media peer; do not connect CI to Facebook.
4. Define server redaction and purge behavior for any temporary screenshots or
   HTML; the PWA must never persist them.
