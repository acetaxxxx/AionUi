/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from '@arco-design/web-react';
import '@arco-design/web-react/dist/css/arco.css';
import enUS from '@arco-design/web-react/es/locale/en-US';

import 'uno.css';
import './styles/arco-override.css';
import './styles/themes/index.css';
import './styles/markdown.css';

import PublicShareViewer from './components/share/PublicShareViewer';
import { extractShareTokenFromLocation } from './shareMainUtils';

export const StandalonePublicShareApp: React.FC = () => {
  const token = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return extractShareTokenFromLocation(window.location.pathname, window.location.search);
  }, []);

  return (
    <ConfigProvider theme={{ primaryColor: '#4E5969' }} locale={enUS}>
      <div className='min-h-screen w-full p-4 sm:p-8 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-y-auto'>
        <PublicShareViewer token={token} />
      </div>
    </ConfigProvider>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<StandalonePublicShareApp />);
}

export default StandalonePublicShareApp;
