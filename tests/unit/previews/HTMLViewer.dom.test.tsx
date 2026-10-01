/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

const writeRendererLogInvoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getImageBase64: { invoke: vi.fn(() => Promise.resolve('')) },
      readFile: { invoke: vi.fn(() => Promise.resolve('')) },
    },
    application: {
      writeRendererLog: { invoke: writeRendererLogInvoke },
    },
  },
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid='monaco-editor'>{value}</div>,
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    useMessage: () => [{ info: vi.fn(), success: vi.fn(), error: vi.fn() }, null],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import HTMLViewer from '@/renderer/pages/conversation/Preview/components/viewers/HTMLViewer';
import HTMLRenderer from '@/renderer/pages/conversation/Preview/components/renderers/HTMLRenderer';
import { ipcBridge } from '@/common';

function createConsoleMessageEvent({
  level,
  line,
  message,
  sourceId,
}: {
  level: number;
  line: number;
  message: string;
  sourceId: string;
}): Event {
  const event = new Event('console-message');
  Object.defineProperties(event, {
    level: { value: level },
    line: { value: line },
    message: { value: message },
    sourceId: { value: sourceId },
  });
  return event;
}

describe('HTMLViewer', () => {
  it('renders iframe with HTML content', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
  });

  it('hides toolbar when hideToolbar is true', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' hideToolbar />);
    expect(container.querySelector('[class*="toolbar"]')).not.toBeInTheDocument();
  });

  it('accepts file_path prop', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' file_path='/test/index.html' />);
    expect(container.querySelector('iframe')).toBeInTheDocument();
  });
});

describe('HTMLRenderer', () => {
  const electronAPI = {};

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.mocked(ipcBridge.fs.getImageBase64.invoke).mockReset().mockResolvedValue('');
    vi.mocked(ipcBridge.fs.readFile.invoke).mockReset().mockResolvedValue('');
    vi.clearAllMocks();
  });

  it('loads clean local HTML files through file URL in Electron', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    const { container } = render(
      <HTMLRenderer
        content='<script src="https://cdn.example.com/app.js"></script><script>localStorage.getItem("theme")</script>'
        file_path='/workspace/financial-wechat-miniapp.html'
      />
    );

    const webview = container.querySelector('webview');
    expect(webview).toBeInTheDocument();
    expect(webview?.getAttribute('src')).toBe('file:///workspace/financial-wechat-miniapp.html');
  });

  it('keeps dirty local HTML content in memory in Electron', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    const dirtyProps = {
      content: '<h1>Unsaved edit</h1>',
      file_path: '/workspace/index.html',
      isDirty: true,
    } as React.ComponentProps<typeof HTMLRenderer> & { isDirty: boolean };

    const { container } = render(<HTMLRenderer {...dirtyProps} />);

    const webview = container.querySelector('webview');
    expect(webview).toBeInTheDocument();
    expect(webview?.getAttribute('src')).toContain('data:text/html');
    expect(webview?.getAttribute('src')).toContain('Unsaved%20edit');
  });

  it('loads independent relative images with bounded concurrency', async () => {
    const resolvers: Array<(value: string | null) => void> = [];
    vi.mocked(ipcBridge.fs.getImageBase64.invoke).mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );
    const images = Array.from({ length: 6 }, (_, index) => `<img src="image-${index}.jpg">`).join('');
    const { unmount } = render(
      <HTMLRenderer content={images} file_path="/workspace/index.html" workspace="/workspace" />
    );

    await waitFor(() => expect(ipcBridge.fs.getImageBase64.invoke).toHaveBeenCalledTimes(4));
    expect(resolvers).toHaveLength(4);

    for (const resolve of resolvers.splice(0)) resolve('data:image/jpeg;base64,abc');
    await waitFor(() => expect(ipcBridge.fs.getImageBase64.invoke).toHaveBeenCalledTimes(6));
    for (const resolve of resolvers.splice(0)) resolve('data:image/jpeg;base64,abc');
    unmount();
  });

  it('deduplicates the same asset referenced by HTML and CSS', async () => {
    vi.mocked(ipcBridge.fs.readFile.invoke).mockResolvedValue('a { background: url("./img/shared.jpg"); }');
    vi.mocked(ipcBridge.fs.getImageBase64.invoke).mockResolvedValue('data:image/jpeg;base64,abc');

    render(
      <HTMLRenderer
        content={'<link rel="stylesheet" href="style.css"><img src="img/shared.jpg">'}
        file_path="/workspace/index.html"
        workspace="/workspace"
      />
    );

    await waitFor(() => expect(ipcBridge.fs.getImageBase64.invoke).toHaveBeenCalledTimes(1));
    expect(ipcBridge.fs.getImageBase64.invoke).toHaveBeenCalledWith(
      { path: '/workspace/img/shared.jpg', workspace: '/workspace' },
      expect.objectContaining({ signal: expect.anything() })
    );
    expect(ipcBridge.fs.readFile.invoke).toHaveBeenCalledTimes(1);
  });

  it('loads HTML images and stylesheets in the same bounded request phase', async () => {
    let resolveImage: ((value: string | null) => void) | undefined;
    vi.mocked(ipcBridge.fs.getImageBase64.invoke).mockImplementation(
      () => new Promise((resolve) => (resolveImage = resolve))
    );
    vi.mocked(ipcBridge.fs.readFile.invoke).mockResolvedValue('body { color: black; }');

    const { unmount } = render(
      <HTMLRenderer
        content={'<img src="photo.jpg"><link rel="stylesheet" href="style.css">'}
        file_path="/workspace/index.html"
        workspace="/workspace"
      />
    );

    await waitFor(() => {
      expect(ipcBridge.fs.getImageBase64.invoke).toHaveBeenCalledTimes(1);
      expect(ipcBridge.fs.readFile.invoke).toHaveBeenCalledTimes(1);
    });

    resolveImage?.('data:image/jpeg;base64,abc');
    unmount();
  });

  it('keeps inlined HTML, CSS, scripts, and images in source order when requests finish out of order', async () => {
    const imageResolvers = new Map<string, (value: string | null) => void>();
    const fileResolvers = new Map<string, (value: string | null) => void>();
    vi.mocked(ipcBridge.fs.getImageBase64.invoke).mockImplementation(
      ({ path }) => new Promise((resolve) => imageResolvers.set(path, resolve))
    );
    vi.mocked(ipcBridge.fs.readFile.invoke).mockImplementation(
      ({ path }) => new Promise((resolve) => fileResolvers.set(path, resolve))
    );

    const { container } = render(
      <HTMLRenderer
        content={
          '<img src="first.jpg">' +
          '<link href="style.css" rel="stylesheet">' +
          '<script src="app.js"></script>' +
          '<img src="second.jpg">'
        }
        file_path="/workspace/index.html"
        workspace="/workspace"
      />
    );

    await waitFor(() => {
      expect(imageResolvers.size).toBe(2);
      expect(fileResolvers.size).toBe(2);
    });

    await act(async () => {
      fileResolvers.get('/workspace/app.js')?.('window.previewApp = true;');
      imageResolvers.get('/workspace/second.jpg')?.('data:image/jpeg;base64,second');
    });
    await act(async () => {
      fileResolvers.get('/workspace/style.css')?.('body { background-image: url("./bg.jpg"); }');
    });
    await waitFor(() => expect(imageResolvers.has('/workspace/bg.jpg')).toBe(true));
    await act(async () => {
      imageResolvers.get('/workspace/bg.jpg')?.('data:image/png;base64,bg');
      imageResolvers.get('/workspace/first.jpg')?.('data:image/jpeg;base64,first');
    });

    const expectedMarkup = [
      '<img src="data:image/jpeg;base64,first">',
      '<style>body { background-image: url("data:image/png;base64,bg"); }</style>',
      '<script>window.previewApp = true;</script>',
      '<img src="data:image/jpeg;base64,second">',
    ].join('');
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain(expectedMarkup));
  });

  it('aborts outstanding resource requests when the preview unmounts', async () => {
    vi.mocked(ipcBridge.fs.getImageBase64.invoke).mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(
      <HTMLRenderer content='<img src="slow.jpg">' file_path="/workspace/index.html" workspace="/workspace" />
    );

    await waitFor(() => expect(ipcBridge.fs.getImageBase64.invoke).toHaveBeenCalledTimes(1));
    const requestOptions = vi.mocked(ipcBridge.fs.getImageBase64.invoke).mock.calls[0][1];
    expect(requestOptions?.signal?.aborted).toBe(false);

    unmount();
    expect(requestOptions?.signal?.aborted).toBe(true);
  });

  it('writes preview source selection to the renderer log bridge', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    render(<HTMLRenderer content='<h1>Test</h1>' file_path='/workspace/financial-wechat-miniapp.html' />);

    await waitFor(() =>
      expect(writeRendererLogInvoke).toHaveBeenCalledWith({
        level: 'info',
        tag: 'HTMLRenderer',
        message: 'html_preview_source_selected',
        data: expect.objectContaining({
          source: 'file',
          reason: 'clean-local-file',
          fileName: 'financial-wechat-miniapp.html',
          hasFilePath: true,
          contentLength: 13,
          src: 'file://financial-wechat-miniapp.html',
        }),
      })
    );
  });

  it('writes level 2 preview console messages as renderer warnings', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    const { container } = render(<HTMLRenderer content='<h1>Test</h1>' file_path='/workspace/index.html' />);
    const webview = container.querySelector('webview');

    await waitFor(() => expect(writeRendererLogInvoke).toHaveBeenCalled());
    vi.clearAllMocks();

    webview?.dispatchEvent(
      createConsoleMessageEvent({
        level: 2,
        line: 64,
        message: 'cdn.tailwindcss.com should not be used in production.',
        sourceId: 'https://cdn.tailwindcss.com/',
      })
    );

    await waitFor(() =>
      expect(writeRendererLogInvoke).toHaveBeenCalledWith({
        level: 'warn',
        tag: 'HTMLRenderer',
        message: 'html_preview_console_warning',
        data: {
          level: 2,
          line: 64,
          message: 'cdn.tailwindcss.com should not be used in production.',
          source: 'https://cdn.tailwindcss.com/',
        },
      })
    );
  });
});
