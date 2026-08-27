/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  HTML_FRAGMENT_NAV_SCRIPT,
  injectFragmentNavScript,
} from '@/renderer/pages/conversation/Preview/components/renderers/htmlFragmentNavScript';
import { resolveLocalFileLinkReference } from '@/renderer/components/Markdown/markdownUtils';

describe('HTML and Markdown preview fragment link navigation', () => {
  describe('injectFragmentNavScript for HTML preview iframe/webview', () => {
    it('injects fragment navigation script into HTML with <head>', () => {
      const html =
        '<!DOCTYPE html><html><head><title>Test</title></head><body><a href="#section">Jump</a></body></html>';
      const result = injectFragmentNavScript(html);

      expect(result).toContain('__aionui_preview_fragment_nav__');
      expect(result).toContain(HTML_FRAGMENT_NAV_SCRIPT);
      expect(result).toContain('</head>');
    });

    it('injects fragment navigation script into HTML with <html> but no <head>', () => {
      const html = '<html><body><h1>Doc</h1><a href="#summary">Summary</a></body></html>';
      const result = injectFragmentNavScript(html);

      expect(result).toContain('__aionui_preview_fragment_nav__');
      expect(result).toContain('<head><script id="__aionui_preview_fragment_nav__">');
    });

    it('injects fragment navigation script into bare HTML snippet without head or html tags', () => {
      const html = '<div id="app"><a href="#target">Target</a><div id="target">Content</div></div>';
      const result = injectFragmentNavScript(html);

      expect(result).toContain('__aionui_preview_fragment_nav__');
      expect(result).toContain('<div id="app">');
    });

    it('is idempotent and does not inject multiple times if script is already present', () => {
      const html = '<html><head><title>Page</title></head><body>Content</body></html>';
      const firstPass = injectFragmentNavScript(html);
      const secondPass = injectFragmentNavScript(firstPass);

      expect(firstPass).toBe(secondPass);
      const matches = secondPass.match(/__aionui_preview_fragment_nav__/g);
      expect(matches?.length).toBe(1);
    });

    it('script intercepts fragment links without resolving against base href or breaking out of iframe', () => {
      expect(HTML_FRAGMENT_NAV_SCRIPT).toContain("anchor.getAttribute('href')");
      expect(HTML_FRAGMENT_NAV_SCRIPT).toContain("rawHref.startsWith('#')");
      expect(HTML_FRAGMENT_NAV_SCRIPT).toContain('destElement.scrollIntoView');
      expect(HTML_FRAGMENT_NAV_SCRIPT).toContain('e.preventDefault()');
    });
  });

  describe('Markdown fragment links vs external / local file links', () => {
    it('distinguishes fragment links (#summary) from local workspace file links', () => {
      const fragmentHref = '#summary';
      const localFileHref = 'file:///workspace/docs/architecture.md';
      const externalHref = 'https://example.com/docs#summary';

      expect(fragmentHref.startsWith('#')).toBe(true);
      expect(resolveLocalFileLinkReference(fragmentHref)).toBeNull();

      expect(localFileHref.startsWith('#')).toBe(false);
      expect(resolveLocalFileLinkReference(localFileHref)).not.toBeNull();

      expect(externalHref.startsWith('#')).toBe(false);
      expect(resolveLocalFileLinkReference(externalHref)).toBeNull();
    });

    it('handles encoded fragments such as #%E4%B8%AD%E6%96%87 and #section-1', () => {
      const encodedFragment = '#%E4%B8%AD%E6%96%87%E6%A8%99%E9%A1%8C';
      expect(encodedFragment.startsWith('#')).toBe(true);
      const rawId = encodedFragment.slice(1);
      expect(decodeURIComponent(rawId)).toBe('中文標題');
    });
  });
});
