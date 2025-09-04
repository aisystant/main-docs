import test from 'node:test';
import assert from 'node:assert/strict';

import { extnameNoDot, toDestPath, buildGDocExportUrl, parseGDocMeta } from '../scripts/sync-markdown.ts';

test('extnameNoDot handles common cases', () => {
  assert.equal(extnameNoDot('file.md'), 'md');
  assert.equal(extnameNoDot('file.MD'), 'md');
  // Node's path.extname treats dotfiles as no extension
  assert.equal(extnameNoDot('.env'), '');
  assert.equal(extnameNoDot('noext'), '');
});

test('toDestPath converts non-md to .md under out dir', () => {
  assert.equal(toDestPath('a/b/c.ts', 'out'), 'out/a/b/c.md');
  assert.equal(toDestPath('a/readme.md', 'out'), 'out/a/readme.md');
  assert.equal(toDestPath('a/readme.markdown', 'out'), 'out/a/readme.markdown');
});

test('buildGDocExportUrl extracts id', () => {
  const url = 'https://docs.google.com/document/d/ABC123_DEF/edit';
  assert.equal(buildGDocExportUrl(url), 'https://docs.google.com/document/d/ABC123_DEF/export?format=txt');
  assert.equal(buildGDocExportUrl('https://example.com'), null);
});

test('parseGDocMeta falls back gracefully', () => {
  const json = JSON.stringify({ url: 'https://docs.google.com/document/d/ID/edit', title: 'Title' });
  const parsed = parseGDocMeta(json, 'Fallback');
  assert.equal(parsed.url, 'https://docs.google.com/document/d/ID/edit');
  assert.equal(parsed.title, 'Title');

  const malformed = '{not json';
  const parsed2 = parseGDocMeta(malformed, 'Fallback2');
  assert.equal(parsed2.url, '');
  assert.equal(parsed2.title, 'Fallback2');
});
