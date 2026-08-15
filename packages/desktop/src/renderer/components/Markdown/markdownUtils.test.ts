import { describe, expect, it } from 'vitest';
import { isImageDataUrl } from './markdownUtils';

describe('isImageDataUrl', () => {
  it('accepts inline image data URLs', () => {
    expect(isImageDataUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isImageDataUrl(' DATA:image/svg+xml;charset=utf-8,%3Csvg%3E')).toBe(true);
  });

  it('rejects non-image data URLs', () => {
    expect(isImageDataUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isImageDataUrl('https://example.com/image.png')).toBe(false);
    expect(isImageDataUrl('data:image/png')).toBe(false);
  });
});
