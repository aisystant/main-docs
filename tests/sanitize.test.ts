import { describe, it, expect } from 'bun:test';
import { sanitizeFilename } from '../scripts/sanitize.ts';

describe('sanitizeFilename', () => {
  it('replaces reserved characters and collapses whitespace', () => {
    const input = '  bad:/\\name*?"<>|   with' + '\t' + 'many' + '\n' + 'spaces  ';
    const out = sanitizeFilename(input);
    expect(out).toBe('bad___name______ withmanyspaces');
  });

  it('trims leading and trailing spaces', () => {
    expect(sanitizeFilename('  hello  ')).toBe('hello');
  });

  it('caps length at 200 chars', () => {
    const long = 'a'.repeat(500);
    expect(sanitizeFilename(long).length).toBe(200);
  });
});
