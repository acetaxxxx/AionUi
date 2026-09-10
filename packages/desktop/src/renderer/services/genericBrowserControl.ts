import { httpRequest } from '@/common/adapter/httpBridge';
import {
  LIVE_VIEW_LIMITS,
  parseLiveViewRelayMessage,
  type LiveViewFrame,
  type LiveViewRelayEvent,
  type LiveViewRelaySocket,
} from './facebookLiveViewControl';

export type BrowserAuthStatus = 'authenticated' | 'needs_reauth' | 'expired' | 'auth_paused';
export type BrowserLiveViewStatus =
  | 'ready'
  | 'user_takeover'
  | 'auth_paused'
  | 'checkpoint'
  | 'captcha'
  | 'profile_busy'
  | 'session_ended'
  | 'disconnected'
  | 'transport_unavailable';

export interface BrowserProfile {
  profile_id: string;
  account_label: string;
  domain_scope: string;
  auth_status: BrowserAuthStatus;
  last_used_at?: string;
}

export interface BrowserScope {
  user_id: string;
  conversation_id: string;
  task_id: string;
  profile_id: string;
  allowed_origins: string[];
}

export interface BrowserLiveViewSnapshot extends BrowserScope {
  status: BrowserLiveViewStatus;
  detail?: string;
  approval_required: boolean;
  next_scheduled_run_at?: number;
  transport: 'cookie_scoped' | 'planned';
  frame?: LiveViewFrame;
}

export interface GenericBrowserControlPort {
  listProfiles(scope: Pick<BrowserScope, 'user_id' | 'conversation_id'>): Promise<BrowserProfile[]>;
  getStatus(scope: BrowserScope): Promise<BrowserLiveViewSnapshot>;
  start(scope: BrowserScope): Promise<BrowserLiveViewSnapshot>;
  renew(scope: BrowserScope): Promise<BrowserLiveViewSnapshot>;
  end(scope: BrowserScope): Promise<BrowserLiveViewSnapshot>;
  revoke(scope: BrowserScope): Promise<BrowserLiveViewSnapshot>;
  pauseForUser(scope: BrowserScope): Promise<BrowserLiveViewSnapshot>;
  resumeAgent(scope: BrowserScope): Promise<BrowserLiveViewSnapshot>;
  deleteProfile(scope: Pick<BrowserScope, 'user_id' | 'conversation_id' | 'profile_id'>): Promise<void>;
}

const unavailableGenericBrowserOperation = async (): Promise<never> => {
  throw new Error('GENERIC_BROWSER_TRANSPORT_UNAVAILABLE');
};

const requireScope = (scope: Partial<BrowserScope>): void => {
  const values = [scope.user_id, scope.conversation_id, scope.task_id, scope.profile_id];
  if (values.some((value) => !value || !value.trim()) || !scope.allowed_origins?.length) {
    throw new Error('GENERIC_BROWSER_SCOPE_REQUIRED');
  }
};

/** Backend-authoritative cookie session seam. No bearer token is accepted in renderer state or URLs. */
export const createGenericBrowserApi = (): GenericBrowserControlPort => {
  const request = <T>(action: string, scope: BrowserScope) => {
    requireScope(scope);
    return httpRequest<T>('POST', `/api/browser/session/${action}`, scope);
  };
  return {
    listProfiles: (scope) => httpRequest<BrowserProfile[]>('POST', '/api/browser/profiles', scope),
    getStatus: (scope) => request('status', scope),
    start: (scope) => request('start', scope),
    renew: (scope) => request('renew', scope),
    end: (scope) => request('end', scope),
    revoke: (scope) => request('revoke', scope),
    pauseForUser: (scope) => request('pause-for-user', scope),
    resumeAgent: (scope) => request('resume-agent', scope),
    deleteProfile: async (scope) => {
      if ([scope.user_id, scope.conversation_id, scope.profile_id].some((value) => !value.trim())) {
        throw new Error('GENERIC_BROWSER_SCOPE_REQUIRED');
      }
      await httpRequest('POST', '/api/browser/profile/delete', scope);
    },
  };
};

export const createUnavailableGenericBrowserControl = (): GenericBrowserControlPort => {
  return {
    listProfiles: unavailableGenericBrowserOperation,
    getStatus: unavailableGenericBrowserOperation,
    start: unavailableGenericBrowserOperation,
    renew: unavailableGenericBrowserOperation,
    end: unavailableGenericBrowserOperation,
    revoke: unavailableGenericBrowserOperation,
    pauseForUser: unavailableGenericBrowserOperation,
    resumeAgent: unavailableGenericBrowserOperation,
    deleteProfile: unavailableGenericBrowserOperation,
  };
};

export type GenericBrowserRelayEvent = LiveViewRelayEvent;
export { LIVE_VIEW_LIMITS, parseLiveViewRelayMessage };

/** Connects using the authenticated browser session cookie; scope is never put in a token-bearing URL. */
export function connectGenericBrowserRelay(
  scope: BrowserScope,
  onEvent: (event: GenericBrowserRelayEvent) => void,
  socketFactory: (url: string) => LiveViewRelaySocket = (url) => new WebSocket(url)
): { close: () => void } {
  requireScope(scope);
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
  const socket = socketFactory(`${protocol}//${host}/api/browser/live-view/stream`);
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
  });
  socket.addEventListener('error', fail);
  socket.addEventListener('close', () => {
    if (!terminal) onEvent({ type: 'error', code: 'transport_unavailable' });
    terminal = true;
  });
  return {
    close: () => {
      terminal = true;
      socket.close();
    },
  };
}
