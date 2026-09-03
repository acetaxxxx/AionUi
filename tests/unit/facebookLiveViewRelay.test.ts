import { describe, expect, it, vi } from 'vitest';
import {
  connectFacebookLiveViewRelay,
  parseLiveViewRelayMessage,
  type LiveViewRelaySocket,
} from '@/renderer/services/facebookLiveViewControl';

describe('Facebook LiveView relay protocol', () => {
  it('accepts only bounded image frames and rejects script/navigation envelopes', () => {
    expect(parseLiveViewRelayMessage(JSON.stringify({ type: 'script', value: 'alert(1)' }))).toBeNull();
    expect(
      parseLiveViewRelayMessage(
        JSON.stringify({ type: 'frame', frame: { encoding: 'jpeg', data: 'x', width: 4097, height: 1 } })
      )
    ).toBeNull();
  });

  it('sends only pointer/keyboard envelopes and closes on malformed relay data', () => {
    let socketMessage: EventListener | undefined;
    const socket: LiveViewRelaySocket = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === 'message') socketMessage = listener;
      }),
    };
    const events = vi.fn();
    const relay = connectFacebookLiveViewRelay(
      { user_id: 'u', conversation_id: 'c', monitor_id: 'm' },
      events,
      () => socket
    );
    relay.sendPointer({ action: 'move', x: 1, y: 2 });
    relay.sendKeyboard({ action: 'down', key: 'Enter' });
    expect(socket.send).toHaveBeenNthCalledWith(1, '{"type":"pointer","action":"move","x":1,"y":2}');
    expect(socket.send).toHaveBeenNthCalledWith(2, '{"type":"keyboard","action":"down","key":"Enter"}');
    socketMessage?.({ data: '{bad' } as MessageEvent<string>);
    expect(events).toHaveBeenCalledWith({ type: 'error', code: 'transport_unavailable' });
    expect(socket.close).toHaveBeenCalled();
  });
});
