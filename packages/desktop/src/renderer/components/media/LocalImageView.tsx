import { ipcBridge } from '@/common';
import { joinPath } from '@/common/chat/chatLib';
import { LoadingTwo } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useConversationContextSafe } from '@renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';

const LocalImageView: React.FC<{
  src: string;
  alt: string;
  className?: string;
}> = ({ src, alt, className }) => {
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState(src);
  // Resolve relative image paths (e.g. ![](./chart.png)) against the conversation
  // workspace = the agent cwd, and pass it as the fs sandbox workspace. Outside a
  // conversation (settings markdown) there is no workspace, so the src is sent
  // through unchanged — matching the previous default root of ''.
  const root = useConversationContextSafe()?.workspace ?? '';

  const cleanSrc = useMemo(() => {
    if (!src) return '';
    let path = decodeURIComponent(src);
    if (path.startsWith('file://')) {
      path = path.replace(/^file:\/\//i, '');
      if (/^\/[A-Za-z]:\//.test(path)) {
        path = path.slice(1);
      }
    }
    return path;
  }, [src]);

  const absolutePath = useMemo(() => {
    if (!cleanSrc) return '';
    if (
      cleanSrc.startsWith('http') ||
      cleanSrc.startsWith('data:') ||
      cleanSrc.startsWith('/') ||
      cleanSrc.startsWith('\\') ||
      /^[A-Za-z]:/.test(cleanSrc)
    ) {
      return cleanSrc;
    }
    return root ? joinPath(root, cleanSrc) : cleanSrc;
  }, [cleanSrc, root]);

  useEffect(() => {
    setLoading(true);
    ipcBridge.fs.getImageBase64
      .invoke({ path: absolutePath, workspace: root || undefined })
      .then((base64) => {
        if (base64) {
          setUrl(base64);
        }
        setLoading(false);
      })
      .catch((error) => {
        console.error('[LocalImageView] Failed to load image:', {
          path: absolutePath,
          error,
        });
        setLoading(false);
      });
  }, [absolutePath]);
  if (loading)
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <LoadingTwo
          className='loading'
          style={{ display: 'flex' }}
          theme='outline'
          size='14'
          fill={iconColors.primary}
          strokeWidth={2}
        />
        <span>{alt}</span>
      </span>
    );
  return <img src={url} alt={alt} className={className} />;
};

export default LocalImageView;
