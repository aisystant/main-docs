import { describe, it, expect } from 'bun:test';
import { extractDocId, extractDocIdEffect } from '../scripts/gdoc.ts';
import { Effect } from 'effect';

describe('gdoc.extractDocId', () => {
  it('extracts standard /document/d/<id>', () => {
    const url = 'https://docs.google.com/document/d/abc123_DEF-456/edit';
    expect(extractDocId(url)).toBe('abc123_DEF-456');
  });

  it('extracts user shard /document/u/1/d/<id>', () => {
    const url = 'https://docs.google.com/document/u/1/d/xyz-789_ABC/view';
    expect(extractDocId(url)).toBe('xyz-789_ABC');
  });

  it('extracts domain-scoped /a/<domain>/document/d/<id>', () => {
    const url = 'https://docs.google.com/a/example.com/document/d/ID_123-456/edit';
    expect(extractDocId(url)).toBe('ID_123-456');
  });

  it('rejects non-Google Docs URLs', () => {
    const url = 'https://example.com/document/d/abc123/edit';
    expect(extractDocId(url)).toBeUndefined();
  });

  it('rejects IDs with invalid characters', () => {
    const url = 'https://docs.google.com/document/d/abc.123/edit';
    expect(extractDocId(url)).toBeUndefined();
  });
});

describe('gdoc.extractDocIdEffect', () => {
  it('succeeds with a valid URL', async () => {
    const url = 'https://docs.google.com/document/d/abc123_DEF-456/edit';
    const res = await Effect.runPromise(extractDocIdEffect(url));
    expect(res).toBe('abc123_DEF-456');
  });

  it('fails with an invalid URL', async () => {
    const url = 'https://example.com/not-a-doc';
    await expect(Effect.runPromise(extractDocIdEffect(url))).rejects.toBeInstanceOf(Error);
  });
});
