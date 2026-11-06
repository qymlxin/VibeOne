import test from 'node:test';
import assert from 'node:assert/strict';
import { Registry, Scope } from '../dist/index.js';

test('scope cleans up in reverse order, once, even if a disposer fails', async () => {
  const scope = new Scope();
  const calls = [];
  scope.add(() => calls.push('first'));
  scope.add(() => { calls.push('broken'); throw Error('broken'); });
  const release = scope.add(() => calls.push('last'));
  await release();
  await assert.rejects(scope.dispose(), AggregateError);
  await assert.rejects(scope.dispose(), AggregateError);
  assert.deepEqual(calls, ['last', 'broken', 'first']);
  assert.throws(() => scope.add(() => {}), /disposed/);
});

test('an old generation cleanup cannot remove a replacement contribution', async () => {
  const registry = new Registry();
  const owner = { instanceId: 'a', generation: 1 };
  const oldDisposer = registry.register('panel', owner, 'old');
  assert.throws(() => registry.register('panel', owner, 'duplicate'), /registered/);
  registry.removeOwner({ ...owner, generation: 2 });
  assert.equal(registry.get('panel'), 'old');
  registry.removeOwner(owner);
  registry.register('panel', { ...owner, generation: 2 }, 'new');
  await oldDisposer();
  assert.equal(registry.get('panel'), 'new');
});
