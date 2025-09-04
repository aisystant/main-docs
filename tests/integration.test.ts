import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { run } from '../scripts/sync-markdown.ts';

async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readUtf8(p: string) {
  return fs.readFile(p, 'utf8');
}

// Integration test exercises the end-to-end sync in a temp workspace.
// It avoids network by using a .gdoc with a non-Google URL (export URL = null),
// which produces a placeholder body with source URL retained.

test('integration: sync generates docs from source and respects boundary', async () => {
  const origCwd = process.cwd();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'main-docs-integ-'));
  const srcDir = path.join(tmpRoot, 'source');
  const outDir = path.join(tmpRoot, 'docs');

  try {
    // Seed input tree
    await fs.mkdir(path.join(srcDir, 'alpha'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'beta'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'gamma'), { recursive: true });

    await fs.writeFile(path.join(srcDir, 'alpha', 'readme.md'), '# Alpha\n\nAlpha body.\n');
    await fs.writeFile(path.join(srcDir, 'beta', 'notes.markdown'), 'Beta text.');

    // gdoc with non-Google URL to avoid network fetch; ensures placeholder content path
    const gdocMeta = { url: 'https://example.com/foo', title: 'Gamma Doc' };
    await fs.writeFile(path.join(srcDir, 'gamma', 'page.gdoc'), JSON.stringify(gdocMeta));

    // Pre-create docs with a sentinel file to ensure CLEAN removes it
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, 'OLD.md'), 'old');

    // Run from tmpRoot so SRC_DIR/OUT_DIR constants resolve correctly
    process.chdir(tmpRoot);
    await run();

    // Assertions: outputs exist and match expectations
    const alphaOut = path.join(outDir, 'alpha', 'readme.md');
    const betaOut = path.join(outDir, 'beta', 'notes.markdown');
    const gammaOut = path.join(outDir, 'gamma', 'page.md');

    assert.equal(await exists(alphaOut), true);
    assert.equal(await exists(betaOut), true);
    assert.equal(await exists(gammaOut), true);

    // CLEAN=true should have removed the sentinel
    assert.equal(await exists(path.join(outDir, 'OLD.md')), false);

    const alphaText = await readUtf8(alphaOut);
    const betaText = await readUtf8(betaOut);
    const gammaText = await readUtf8(gammaOut);

    assert.ok(alphaText.includes('# Alpha'));
    assert.ok(alphaText.includes('Alpha body.'));
    assert.equal(betaText, 'Beta text.');

    // .gdoc conversion should include a heading and placeholder with the source URL
    assert.ok(gammaText.startsWith('# Gamma Doc'));
    assert.ok(gammaText.includes('Source: https://example.com/foo'));
    assert.ok(/Content not fetched/i.test(gammaText));

    // No writes outside docs/: only expected top-level entries
    const topEntries = await fs.readdir(tmpRoot);
    const allowed = new Set(['source', 'docs']);
    for (const name of topEntries) {
      assert.ok(allowed.has(name), `Unexpected top-level entry created: ${name}`);
    }

    // Second run should yield the same contents (idempotent output values)
    await run();

    const alphaText2 = await readUtf8(alphaOut);
    const betaText2 = await readUtf8(betaOut);
    const gammaText2 = await readUtf8(gammaOut);

    assert.equal(alphaText2, alphaText);
    assert.equal(betaText2, betaText);
    assert.equal(gammaText2, gammaText);
  } finally {
    process.chdir(origCwd);
    // Cleanup temp workspace
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

