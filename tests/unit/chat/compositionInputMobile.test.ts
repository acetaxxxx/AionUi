/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createCompositionKeyDownHandler } from '@/renderer/hooks/chat/useCompositionInput';

describe('useCompositionInput - Mobile Return & Desktop Enter shortcuts', () => {
  it('desktop mode (isMobile: false): Enter triggers send, Shift+Enter inserts newline', () => {
    const isComposingRef = { current: false };
    const onSend = vi.fn();
    const handler = createCompositionKeyDownHandler(isComposingRef, onSend, undefined, { isMobile: false });

    // Plain Enter on desktop -> triggers onSend and prevents default
    const enterEvent = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent;

    handler(enterEvent);
    expect(enterEvent.preventDefault).toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledTimes(1);

    // Shift+Enter on desktop -> allows newline (does not prevent default, does not trigger onSend)
    const shiftEnterEvent = {
      key: 'Enter',
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent;

    handler(shiftEnterEvent);
    expect(shiftEnterEvent.preventDefault).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('mobile / PWA / iOS mode (isMobile: true): Return inserts newline (does not send)', () => {
    const isComposingRef = { current: false };
    const onSend = vi.fn();
    const handler = createCompositionKeyDownHandler(isComposingRef, onSend, undefined, { isMobile: true });

    // Plain Enter on mobile -> does NOT prevent default, does NOT call onSend (inserts newline)
    const enterEvent = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent;

    handler(enterEvent);
    expect(enterEvent.preventDefault).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();

    // Ctrl+Enter or Cmd+Enter on mobile hardware keyboard -> triggers send
    const cmdEnterEvent = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent;

    handler(cmdEnterEvent);
    expect(cmdEnterEvent.preventDefault).toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter when IME is actively composing', () => {
    const isComposingRef = { current: true };
    const onSend = vi.fn();
    const handler = createCompositionKeyDownHandler(isComposingRef, onSend, undefined, { isMobile: false });

    const enterEvent = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent;

    handler(enterEvent);
    expect(enterEvent.preventDefault).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('honors intercept handler before checking key', () => {
    const isComposingRef = { current: false };
    const onSend = vi.fn();
    const onIntercept = vi.fn(() => true);
    const handler = createCompositionKeyDownHandler(isComposingRef, onSend, onIntercept, { isMobile: false });

    const event = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent;

    handler(event);
    expect(onIntercept).toHaveBeenCalledWith(event);
    expect(onSend).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
