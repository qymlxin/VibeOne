import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { RpcPeer } from '../dist/rpc.js';
import { MAX_FRAME_BYTES } from '@vibeone/plugin-sdk/protocol';

test('fragmented UTF-8 frames, invalid JSON and null-id error responses do not corrupt the reader', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const responses = [];
  output.on('data', line => responses.push(JSON.parse(line.toString())));
  const peer = new RpcPeer(input, output);
  const running = peer.run(async request => request.params);
  input.write('bad json\n');
  input.write('{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"bad"}}\n');
  const message = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'echo', params: '中文' })}\n`);
  for (const byte of message) input.write(Buffer.from([byte]));
  await setImmediate();
  input.end();
  await running;
  assert.equal(responses.length, 2);
  assert.equal(responses[0].error.data.code, 'invalid_request');
  assert.equal(responses[1].result, '中文');
});

test('oversized unterminated frames fail with a bounded buffer', async () => {
  const input = new PassThrough();
  const peer = new RpcPeer(input, new PassThrough());
  const running = peer.run(async () => null);
  const failed = assert.rejects(running, error => error.code === 'frame_too_large');
  input.write(Buffer.alloc(MAX_FRAME_BYTES + 1, 97));
  await failed;
});
