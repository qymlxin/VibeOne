import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RpcPeer } from '../dist/rpc.js';
import { loadWorkerPackage } from '../dist/manifest.js';

const fixture = fileURLToPath(new URL('./fixtures', import.meta.url));
const runtime = fileURLToPath(new URL('../dist/main.js', import.meta.url));

async function start(t, onHost = async request => request.params.input) {
  const child = spawn(process.execPath, [runtime], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const peer = new RpcPeer(child.stdout, child.stdin);
  const progress = [];
  const reading = peer.run(async request => {
    if (request.method === 'plugin/progress') { progress.push(request.params); return null; }
    assert.equal(request.method, 'host/call');
    return onHost(request);
  });
  t.after(async () => {
    child.stdin.end();
    const kill = setTimeout(() => child.kill('SIGKILL'), 3_000);
    await exited;
    clearTimeout(kill);
    await reading;
    assert.equal(child.exitCode, 0, stderr);
  });
  await peer.request('plugin/initialize', { protocolVersion: 1 });
  return { peer, progress };
}

const instance = (generation = 1, instanceId = 'fixture') => ({ instanceId, generation });
async function activate(peer, generation = 1, instanceId = 'fixture') {
  return peer.request('plugin/activate', {
    ...instance(generation, instanceId), pluginId: 'dev.vibeone.fixture', packagePath: fixture, config: { generation },
  });
}
const invoke = (peer, handler, extra = {}) => peer.request('plugin/invoke', { ...instance(), handler, ...extra });

test('real Node process isolates concurrent generations and supports reverse RPC', { timeout: 10_000 }, async t => {
  const hostCalls = [];
  const { peer } = await start(t, async request => {
    hostCalls.push(request.params);
    return { echoed: request.params.input };
  });
  await activate(peer);
  await activate(peer, 2);
  const [first, second, reverse] = await Promise.all([
    invoke(peer, 'inspect', { workspaceId: 'a', input: { delay: 25 } }),
    invoke(peer, 'inspect', { generation: 2, workspaceId: 'b' }),
    invoke(peer, 'reverse', { workspaceId: 'c', input: { hello: 'world' } }),
  ]);
  assert.equal(first.generation, 1);
  assert.equal(second.generation, 2);
  assert.equal(first.workspaceId, 'a');
  assert.equal(second.workspaceId, 'b');
  assert.notEqual(first.requestId, second.requestId);
  assert.deepEqual(reverse, { echoed: { hello: 'world' } });
  assert.equal(hostCalls[0].workspaceId, 'c');
  assert.equal(hostCalls[0].instanceId, 'fixture');
  assert.equal(hostCalls[0].generation, 1);
});

test('cancellation is scoped, timeout stops calls, progress and failures do not break the reader', { timeout: 10_000 }, async t => {
  const { peer, progress } = await start(t);
  await activate(peer);
  const waiting = invoke(peer, 'wait');
  const stopped = assert.rejects(waiting, error => error.code === 'cancelled');
  // initialize is node:1, activate is node:2, invoke is node:3.
  await assert.rejects(peer.request('plugin/cancel', { ...instance(2), requestId: 'node:3' }), error => error.code === 'instance_mismatch');
  await peer.request('plugin/cancel', { ...instance(), requestId: 'node:3' });
  await stopped;
  await assert.rejects(invoke(peer, 'wait', { timeoutMs: 10 }), error => error.code === 'timeout');
  assert.equal(await invoke(peer, 'progress'), 'done');
  assert.equal(progress[0].value.percent, 50);
  await assert.rejects(invoke(peer, 'fail'), /Fixture failure/);
  await assert.rejects(invoke(peer, 'missing'), error => error.code === 'handler_missing');
  await peer.request('plugin/deactivate', instance());
  await assert.rejects(invoke(peer, 'inspect'), error => error.code === 'instance_unavailable');
});

test('a pending reverse RPC can be cancelled without deadlocking either side', { timeout: 10_000 }, async t => {
  let entered;
  const hostEntered = new Promise(resolve => { entered = resolve; });
  const { peer } = await start(t, async () => { entered(); return new Promise(() => {}); });
  await activate(peer);
  const waiting = invoke(peer, 'reverse');
  const stopped = assert.rejects(waiting, error => error.code === 'cancelled');
  await hostEntered;
  await peer.request('plugin/cancel', { ...instance(), requestId: 'node:3' });
  await stopped;
  const health = await peer.request('plugin/health', {});
  assert.equal(health.instances, 1);
});

test('manifest rejects API mismatches, duplicate contributions and symlink escapes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vibeone-manifest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(join(fixture, 'plugin.json'), 'utf8'));
  await symlink(join(fixture, 'worker.mjs'), join(directory, 'worker.mjs'));
  await writeFile(join(directory, 'plugin.json'), JSON.stringify(manifest));
  await assert.rejects(loadWorkerPackage(directory), error => error.code === 'entrypoint_escape');
  await rm(join(directory, 'worker.mjs'));
  await writeFile(join(directory, 'worker.mjs'), 'export default {}');
  manifest.engines.pluginApi = '>=9';
  await writeFile(join(directory, 'plugin.json'), JSON.stringify(manifest));
  await assert.rejects(loadWorkerPackage(directory), error => error.code === 'api_incompatible');
  manifest.engines.pluginApi = '>=0.1 <0.2';
  manifest.contributions.push(manifest.contributions[0]);
  await writeFile(join(directory, 'plugin.json'), JSON.stringify(manifest));
  await assert.rejects(loadWorkerPackage(directory), /Duplicate contribution/);
});
