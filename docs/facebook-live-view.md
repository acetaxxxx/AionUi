# Facebook LiveView PWA surface

The renderer exposes a small, backend-authoritative control surface for a
Facebook monitor's LiveView re-authentication flow. It is only rendered in PWA
mode when the server includes `facebook_monitor_id` in the conversation
snapshot. The scope sent by every operation is `{ user_id, conversation_id,
monitor_id }`; the server remains the authority for ownership and status.

## Safety boundary

`createFacebookLiveViewApi` is an explicit adapter seam for the planned backend
contract (`/api/facebook/live-view/{status,start,stop,reauthenticate}`). The
actual WebRTC/VNC/sidecar transport is not implemented in AionUI. Until the
backend contract is deployed, callers must use the fail-closed adapter and no
browser session is started.

The UI displays `auth_paused`, `checkpoint`, `captcha`, `ProfileBusy`, and
`session ended`, plus approval and next-scheduled-run guidance. Start, end, and
reauthenticate require an explicit user click. Passwords, MFA seeds, primary
authentication factors, bearer tokens, DOM, OCR, and post content are not
accepted as props or persisted by this surface.

This is a planned/blocking seam, not an end-to-end transport implementation.
