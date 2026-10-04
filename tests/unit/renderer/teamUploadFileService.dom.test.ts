/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { trackUploadMock } = vi.hoisted(() => ({ trackUploadMock: vi.fn() }));

vi.mock('@/common/adapter/httpBridge', () => ({
  getBaseUrl: () => 'http://backend.test',
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  trackUpload: (...args: unknown[]) => trackUploadMock(...args),
}));

import { FileService } from '@/renderer/services/FileService';

type XhrListener = () => void;

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];

  upload = { addEventListener: vi.fn() };
  method = '';
  url = '';
  status = 0;
  statusText = '';
  responseText = '';
  withCredentials = false;
  sentBody: unknown;
  headers = new Map<string, string>();
  private listeners: Record<string, XhrListener> = {};

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  addEventListener(name: string, listener: XhrListener): void {
    this.listeners[name] = listener;
  }

  send(body: unknown): void {
    this.sentBody = body;
  }

  respond(status: number, responseText: string): void {
    this.status = status;
    this.responseText = responseText;
    this.listeners.load?.();
  }
}

const waitForRequest = async (): Promise<FakeXMLHttpRequest> => {
  for (let i = 0; i < 20 && FakeXMLHttpRequest.instances.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const xhr = FakeXMLHttpRequest.instances[0];
  expect(xhr, 'expected multipart upload request').toBeDefined();
  return xhr;
};

const fileList = (file: File): FileList =>
  Object.assign([file], { item: (index: number) => (index === 0 ? file : null) }) as unknown as FileList;

describe('FileService Team uploads', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = [];
    trackUploadMock.mockReturnValue({ onProgress: vi.fn(), finish: vi.fn() });
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads a selected image to the Team route and returns only its opaque upload ref', async () => {
    const image = new File(['png-bytes'], 'diagram.png', { type: 'image/png' });
    const pending = FileService.processDroppedFiles(fileList(image), 'conv-1', 'sendbox', 'team-42');
    const xhr = await waitForRequest();

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://backend.test/api/teams/team-42/uploads');
    expect(xhr.withCredentials).toBe(true);
    const form = xhr.sentBody as FormData;
    expect(form.get('file')).toBeInstanceOf(File);
    expect((form.get('file') as File).name).toBe('diagram.png');
    expect(form.has('conversation_id')).toBe(false);
    expect(form.has('file_name')).toBe(false);

    xhr.respond(200, JSON.stringify({ success: true, data: { upload_id: 'opaque-upload-1' } }));
    await expect(pending).resolves.toEqual([
      {
        name: 'diagram.png',
        path: 'diagram.png',
        size: image.size,
        type: 'image/png',
        lastModified: image.lastModified,
        chatRef: { kind: 'team_upload', upload_id: 'opaque-upload-1' },
      },
    ]);
    expect(FakeXMLHttpRequest.instances).toHaveLength(1);
  });

  it('keeps ordinary conversation uploads on the generic route', async () => {
    const image = new File(['png-bytes'], 'diagram.png', { type: 'image/png' });
    const pending = FileService.processDroppedFiles(fileList(image), 'conv-1');
    const xhr = await waitForRequest();

    expect(xhr.url).toBe('http://backend.test/api/fs/upload');
    expect((xhr.sentBody as FormData).get('conversation_id')).toBe('conv-1');
    xhr.respond(200, JSON.stringify({ success: true, data: '/tmp/aionui/diagram.png' }));
    const [uploaded] = await pending;
    expect(uploaded.path).toBe('/tmp/aionui/diagram.png');
    expect(uploaded).not.toHaveProperty('chatRef');
  });

  it('does not retry a failed Team upload through the generic filesystem route', async () => {
    const image = new File(['png-bytes'], 'diagram.png', { type: 'image/png' });
    const pending = FileService.processDroppedFiles(fileList(image), 'conv-1', 'sendbox', 'team-42');
    const xhr = await waitForRequest();
    xhr.statusText = 'Bad Request';
    xhr.respond(400, JSON.stringify({ success: false, error: 'forbidden' }));

    await expect(pending).resolves.toEqual([]);
    expect(FakeXMLHttpRequest.instances).toHaveLength(1);
    expect(FakeXMLHttpRequest.instances[0].url).toContain('/api/teams/team-42/uploads');
  });
});
