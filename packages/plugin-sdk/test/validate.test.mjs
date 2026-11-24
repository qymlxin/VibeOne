import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validatePluginDirectory } from '../../../scripts/validate-plugin.mjs';

test('validatePluginDirectory accepts the bundled workspace-tools example', () => {
  const result = validatePluginDirectory(resolve('examples/plugins/workspace-tools'));
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.pluginId, 'dev.vibeone.workspace-tools');
});

test('validatePluginDirectory rejects invalid manifestVersion, traversal and undeclared dependencies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vibeone-plugin-validate-'));
  try {
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist/app.mjs'), 'export default {};');
    writeFileSync(
      join(dir, 'plugin.json'),
      JSON.stringify({
        manifestVersion: 2,
        id: 'bad plugin!',
        name: 'Bad',
        version: '0.1.0',
        engines: { pluginApi: '>=0.2' },
        dependencies: { react: '^19.0.0' },
        entrypoints: { app: { path: '../escape.mjs' } },
        contributions: [
          {
            id: 'p1',
            kind: 'app.panel',
            kindVersion: 1,
            binding: { type: 'worker' },
          },
        ],
      }),
    );
    const result = validatePluginDirectory(dir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('id 无效')));
    assert.ok(result.errors.some((e) => e.includes('manifestVersion')));
    assert.ok(result.errors.some((e) => e.includes('pluginApi')));
    assert.ok(result.errors.some((e) => e.includes('dependencies')));
    assert.ok(result.errors.some((e) => e.includes('entrypoints.app')));
    assert.ok(result.errors.some((e) => e.includes('binding.type')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
