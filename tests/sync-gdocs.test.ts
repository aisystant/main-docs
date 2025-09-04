import { describe, it, expect } from 'bun:test';
import { syncGDocsFromUrl } from '../scripts/sync-gdocs.ts';
import { Effect } from 'effect';

describe('syncGDocsFromUrl', () => {
  it('fails fast on invalid Google Docs URL (no network/disk)', async () => {
    const bad = 'https://example.com/not-a-google-doc';
    await expect(Effect.runPromise(syncGDocsFromUrl(bad))).rejects.toBeInstanceOf(Error);
  });
});
