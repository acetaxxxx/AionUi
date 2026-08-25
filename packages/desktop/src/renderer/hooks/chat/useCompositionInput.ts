import { useRef, useState } from 'react';

/**
 * 共享的输入法合成事件处理hook
 * 消除SendBox组件和GUID页面中的IME处理重复代码
 */
export interface KeyDownHandlerOptions {
  isMobile?: boolean;
}

export const createCompositionKeyDownHandler = (
  isComposingRef: { current: boolean },
  onEnterPress: () => void,
  onKeyDownIntercept?: (e: React.KeyboardEvent) => boolean,
  options?: KeyDownHandlerOptions
) => {
  return (e: React.KeyboardEvent) => {
    if (isComposingRef.current) return;
    if (onKeyDownIntercept?.(e)) return;
    if (e.key === 'Enter') {
      if (options?.isMobile) {
        // On Web/PWA/iOS mobile, Return inserts a newline; send button is the primary mobile send path.
        // Allow Ctrl+Enter / Cmd+Enter if user presses a modifier with hardware keyboard.
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
          e.preventDefault();
          onEnterPress();
        }
        return;
      }
      if (!e.shiftKey) {
        e.preventDefault();
        onEnterPress();
      }
    }
  };
};

export const useCompositionInput = () => {
  const isComposing = useRef(false);
  const [isComposingState, setIsComposingState] = useState(false);

  const compositionHandlers = {
    onCompositionStartCapture: () => {
      isComposing.current = true;
      setIsComposingState(true);
    },
    onCompositionEndCapture: () => {
      isComposing.current = false;
      setIsComposingState(false);
    },
  };

  const createKeyDownHandler = (
    onEnterPress: () => void,
    onKeyDownIntercept?: (e: React.KeyboardEvent) => boolean,
    options?: KeyDownHandlerOptions
  ) => {
    return createCompositionKeyDownHandler(isComposing, onEnterPress, onKeyDownIntercept, options);
  };

  return {
    isComposing,
    isComposingState,
    compositionHandlers,
    createKeyDownHandler,
  };
};
