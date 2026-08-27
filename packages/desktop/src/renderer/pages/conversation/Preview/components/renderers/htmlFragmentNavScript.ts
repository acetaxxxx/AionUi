/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Injected script for HTML preview documents (iframe and webview)
 * to intercept fragment-only navigation links (<a href="#...">) and scroll to the target
 * element inside the preview container without resolving against <base href> or navigating
 * the top-level Aion shell.
 */
export const HTML_FRAGMENT_NAV_SCRIPT = `
(function() {
  if (window.__aionuiFragmentNavInitialized) return;
  window.__aionuiFragmentNavInitialized = true;

  document.addEventListener('click', function(e) {
    var target = e.target;
    var anchor = target && target.closest ? target.closest('a') : null;
    if (!anchor) return;

    var rawHref = anchor.getAttribute('href');
    if (!rawHref || !rawHref.startsWith('#')) return;

    var id = rawHref.slice(1);
    var decodedId = id;
    try {
      decodedId = decodeURIComponent(id);
    } catch (_) {}

    var destElement = null;
    if (decodedId) {
      destElement = document.getElementById(decodedId);
      if (!destElement && window.CSS && window.CSS.escape) {
        try {
          destElement = document.querySelector('[name="' + window.CSS.escape(decodedId) + '"]');
        } catch (_) {}
      }
    }

    if (destElement) {
      e.preventDefault();
      e.stopPropagation();
      destElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      try {
        history.pushState(null, '', '#' + decodedId);
      } catch (_) {}
    } else if (decodedId === 'top' || !decodedId) {
      e.preventDefault();
      e.stopPropagation();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      // Prevent breaking out to top-level shell or base href navigation
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
})();
`;

/**
 * Injects the fragment navigation script into an HTML string.
 */
export function injectFragmentNavScript(html: string): string {
  if (!html || typeof html !== 'string') return html;
  if (html.includes('__aionui_preview_fragment_nav__')) return html;

  const scriptTag = `<script id="__aionui_preview_fragment_nav__">${HTML_FRAGMENT_NAV_SCRIPT}</script>`;

  if (html.match(/<\/head>/i)) {
    return html.replace(/<\/head>/i, `${scriptTag}</head>`);
  }
  if (html.match(/<head>/i)) {
    return html.replace(/<head>/i, `<head>${scriptTag}`);
  }
  if (html.match(/<html>/i)) {
    return html.replace(/<html>/i, `<html><head>${scriptTag}</head>`);
  }
  return `${scriptTag}${html}`;
}
