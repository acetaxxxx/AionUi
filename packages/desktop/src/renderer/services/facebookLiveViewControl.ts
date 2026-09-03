import { httpRequest } from '@/common/adapter/httpBridge';

export type LiveViewStatus = 'ready' | 'auth_paused' | 'checkpoint' | 'captcha' | 'profile_busy' | 'session_ended';

export interface LiveViewScope {
  user_id: string;
  conversation_id: string;
  monitor_id: string;
}

export interface LiveViewSnapshot extends LiveViewScope {
  status: LiveViewStatus;
  detail?: string;
  approval_required: boolean;
  next_scheduled_run_at?: number;
  /** No browser transport is implemented in AionUI yet. */
  transport: 'planned';
}

export interface LiveViewControlPort {
  getStatus(scope: LiveViewScope): Promise<LiveViewSnapshot>;
  start(scope: LiveViewScope): Promise<LiveViewSnapshot>;
  stop(scope: LiveViewScope): Promise<LiveViewSnapshot>;
  reauthenticate(scope: LiveViewScope): Promise<LiveViewSnapshot>;
  renew(scope: LiveViewScope): Promise<LiveViewSnapshot>;
  revoke(scope: LiveViewScope): Promise<LiveViewSnapshot>;
}

const unavailable = (): Promise<LiveViewSnapshot> =>
  Promise.reject(new Error('FACEBOOK_LIVE_VIEW_TRANSPORT_UNAVAILABLE'));

/**
 * Backend-authoritative adapter. The endpoint is intentionally explicit: until
 * the backend contract exists, every operation fails closed instead of opening
 * a browser, accepting credentials, or persisting a token in the renderer.
 */
export const createFacebookLiveViewControl = (): LiveViewControlPort => {
  return {
    getStatus: unavailable,
    start: unavailable,
    stop: unavailable,
    reauthenticate: unavailable,
    renew: unavailable,
    revoke: unavailable,
  };
};

/** Future backend seam, kept separate so its request shape is reviewable. */
export const createFacebookLiveViewApi = (): LiveViewControlPort => {
  const request = (action: string, scope: LiveViewScope) => {
    if (![scope.user_id, scope.conversation_id, scope.monitor_id].every((value) => value.trim().length > 0)) {
      return Promise.reject(new Error('FACEBOOK_LIVE_VIEW_SCOPE_REQUIRED'));
    }
    return httpRequest<LiveViewSnapshot>('POST', `/api/facebook/live-view/${action}`, scope);
  };
  return {
    getStatus: (scope) => request('status', scope),
    start: (scope) => request('start', scope),
    stop: (scope) => request('stop', scope),
    reauthenticate: (scope) => request('reauthenticate', scope),
    renew: (scope) => request('renew', scope),
    revoke: (scope) => request('revoke', scope),
  };
};

export type LiveViewFrameEncoding = 'jpeg' | 'png' | 'webp';

export interface LiveViewFrame {
  encoding: LiveViewFrameEncoding;
  data: string;
  width: number;
  height: number;
}

export type LiveViewRelayEvent =
  | { type: 'status'; snapshot: LiveViewSnapshot }
  | { type: 'frame'; frame: LiveViewFrame }
  | { type: 'error'; code: 'expired' | 'revoked' | 'transport_unavailable' | 'invalid_message' };

export const LIVE_VIEW_LIMITS = {
  maxFrameBytes: 4 * 1024 * 1024,
  maxWidth: 4096,
  maxHeight: 4096,
  maxMessageBytes: 5 * 1024 * 1024,
} as const;

const RELAY_EVENTS = new Set(['status', 'frame', 'expired', 'revoked', 'transport_unavailable']);

/** Parse only the bounded relay envelope; all other websocket messages fail closed. */
export function parseLiveViewRelayMessage(raw: string): LiveViewRelayEvent | null {
  if (new TextEncoder().encode(raw).byteLength > LIVE_VIEW_LIMITS.maxMessageBytes) return null;
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object') return null;
  const value = message as Record<string, unknown>;
  if (typeof value.type !== 'string' || !RELAY_EVENTS.has(value.type)) return null;
  if (value.type === 'status') {
    const snapshot = value.snapshot;
    if (!snapshot || typeof snapshot !== 'object') return null;
    return { type: 'status', snapshot: snapshot as LiveViewSnapshot };
  }
  if (value.type !== 'frame') {
    return { type: 'error', code: value.type as 'expired' | 'revoked' | 'transport_unavailable' };
  }
  const frame = value.frame;
  if (!frame || typeof frame !== 'object') return null;
  const candidate = frame as Record<string, unknown>;
  if (
    !['jpeg', 'png', 'webp'].includes(candidate.encoding as string) ||
    typeof candidate.data !== 'string' ||
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number' ||
    !Number.isInteger(candidate.width) ||
    !Number.isInteger(candidate.height) ||
    candidate.width < 1 ||
    candidate.height < 1 ||
    candidate.width > LIVE_VIEW_LIMITS.maxWidth ||
    candidate.height > LIVE_VIEW_LIMITS.maxHeight ||
    candidate.data.length > LIVE_VIEW_LIMITS.maxFrameBytes
  ) {
    return null;
  }
  return { type: 'frame', frame: candidate as unknown as LiveViewFrame };
}

export type LiveViewRelaySocket = Pick<WebSocket, 'send' | 'close'> & {
  readonly readyState: number;
  addEventListener: WebSocket['addEventListener'];
};

export interface LiveViewRelay {
  sendPointer(event: {
    action: 'down' | 'up' | 'move';
    x: number;
    y: number;
    button?: 'left' | 'middle' | 'right';
  }): void;
  sendKeyboard(event: {
    action: 'down' | 'up';
    key: string;
    modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>;
  }): void;
  close(): void;
}

export function connectFacebookLiveViewRelay(
  scope: LiveViewScope,
  onEvent: (event: LiveViewRelayEvent) => void,
  socketFactory: (url: string) => LiveViewRelaySocket = (url) => new WebSocket(url)
): LiveViewRelay {
  if (![scope.user_id, scope.conversation_id, scope.monitor_id].every((value) => value.trim())) {
    throw new Error('FACEBOOK_LIVE_VIEW_SCOPE_REQUIRED');
  }
  const params = new URLSearchParams({
    user_id: scope.user_id,
    conversation_id: scope.conversation_id,
    monitor_id: scope.monitor_id,
  });
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
  const socket = socketFactory(`${protocol}//${host}/api/facebook/live-view/stream?${params}`);
  let terminal = false;
  const fail = () => {
    if (terminal) return;
    terminal = true;
    onEvent({ type: 'error', code: 'transport_unavailable' });
    socket.close();
  };
  socket.addEventListener('message', (event) => {
    const parsed = parseLiveViewRelayMessage((event as MessageEvent<string>).data);
    if (!parsed) return fail();
    onEvent(parsed);
    if (parsed.type === 'error') {
      terminal = true;
      socket.close();
    }
  });
  socket.addEventListener('error', fail);
  socket.addEventListener('close', () => {
    if (!terminal) onEvent({ type: 'error', code: 'transport_unavailable' });
    terminal = true;
  });
  const send = (message: Record<string, unknown>) => {
    if (terminal || socket.readyState !== 1) return;
    const encoded = JSON.stringify(message);
    if (new TextEncoder().encode(encoded).byteLength > LIVE_VIEW_LIMITS.maxMessageBytes) return fail();
    socket.send(encoded);
  };
  return {
    sendPointer: (event) => {
      if (
        !['down', 'up', 'move'].includes(event.action) ||
        !Number.isFinite(event.x) ||
        !Number.isFinite(event.y) ||
        event.x < 0 ||
        event.y < 0 ||
        event.x > LIVE_VIEW_LIMITS.maxWidth ||
        event.y > LIVE_VIEW_LIMITS.maxHeight ||
        (event.button && !['left', 'middle', 'right'].includes(event.button))
      ) {
        return fail();
      }
      send({ type: 'pointer', ...event });
    },
    sendKeyboard: (event) => {
      if (
        !['down', 'up'].includes(event.action) ||
        !event.key ||
        event.key.length > 64 ||
        event.modifiers?.some((modifier) => !['Alt', 'Control', 'Meta', 'Shift'].includes(modifier))
      ) {
        return fail();
      }
      send({ type: 'keyboard', ...event });
    },
    close: () => {
      terminal = true;
      socket.close();
    },
  };
}
