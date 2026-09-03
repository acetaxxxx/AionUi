import { httpRequest } from '@/common/adapter/httpBridge';

export type LiveViewStatus =
  | 'ready'
  | 'auth_paused'
  | 'checkpoint'
  | 'captcha'
  | 'profile_busy'
  | 'session_ended';

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
}

const unavailable = (): Promise<LiveViewSnapshot> =>
  Promise.reject(new Error('FACEBOOK_LIVE_VIEW_TRANSPORT_UNAVAILABLE'));

/**
 * Backend-authoritative adapter. The endpoint is intentionally explicit: until
 * the backend contract exists, every operation fails closed instead of opening
 * a browser, accepting credentials, or persisting a token in the renderer.
 */
export const createFacebookLiveViewControl = (): LiveViewControlPort => {
  return { getStatus: unavailable, start: unavailable, stop: unavailable, reauthenticate: unavailable };
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
  };
};
