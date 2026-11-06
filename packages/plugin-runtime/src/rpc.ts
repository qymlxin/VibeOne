import type { Readable, Writable } from 'node:stream';
import { MAX_FRAME_BYTES, PluginError, asObject, errorResponse, type Json, type RpcRequest, type RpcMessage } from '@vibeone/plugin-sdk/protocol';

interface Pending {
  resolve(value: Json): void;
  reject(error: Error): void;
  cleanup(): void;
}

/** A continuously reading, bidirectional JSON-RPC peer. Never awaits handlers in the reader. */
export class RpcPeer {
  readonly #pending = new Map<string, Pending>();
  readonly #incoming = new Set<string>();
  #sequence = 0;
  #closed = false;
  #writes = 0;
  constructor(readonly input: Readable, readonly output: Writable) {}

  request(method: string, params: Json, signal?: AbortSignal, timeoutMs = 30_000): Promise<Json> {
    if (this.#closed) return Promise.reject(new PluginError('host_closed', 'RPC connection is closed'));
    if (signal?.aborted) return Promise.reject(new PluginError('cancelled', 'Call cancelled'));
    if (this.#pending.size >= 128) return Promise.reject(new PluginError('busy', 'Too many host calls'));
    const id = `node:${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        pending.cleanup();
        reject(error);
      };
      const timer = setTimeout(() => fail(new PluginError('host_timeout', 'Host call timed out')), timeoutMs);
      const abort = () => fail(new PluginError('cancelled', 'Call cancelled'));
      this.#pending.set(id, {
        resolve, reject,
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); },
      });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.send({ jsonrpc: '2.0', id, method, params }); } catch (error) { fail(error as Error); }
    });
  }

  notify(method: string, params: Json): void { this.send({ jsonrpc: '2.0', method, params }); }

  send(message: RpcMessage): void {
    if (this.#closed) throw new PluginError('host_closed', 'RPC connection is closed');
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new PluginError('frame_too_large', 'RPC output exceeds frame limit');
    if (this.#writes >= 256) throw new PluginError('busy', 'RPC output queue is full');
    this.#writes++;
    this.output.write(line, error => { this.#writes--; if (error) this.close(error); });
  }

  async run(handle: (request: RpcRequest) => Promise<Json>): Promise<void> {
    let buffer = Buffer.alloc(0);
    try {
      for await (const chunk of this.input) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        // Bound accumulation even when the sender never emits a newline.
        let offset = 0;
        while (offset < bytes.length) {
          const end = bytes.indexOf(10, offset);
          const piece = bytes.subarray(offset, end < 0 ? bytes.length : end);
          if (buffer.length + piece.length > MAX_FRAME_BYTES) throw new PluginError('frame_too_large', 'RPC input exceeds frame limit');
          buffer = Buffer.concat([buffer, piece]);
          if (end < 0) break;
          this.#dispatch(buffer.toString('utf8'), handle);
          buffer = Buffer.alloc(0);
          offset = end + 1;
        }
      }
      if (buffer.length) throw new PluginError('invalid_frame', 'RPC frame must end with a newline');
    } finally { this.close(); }
  }

  #dispatch(line: string, handle: (request: RpcRequest) => Promise<Json>): void {
    if (!line.trim()) return;
    let message: Record<string, unknown>;
    try {
      message = asObject(JSON.parse(line));
      if (message.jsonrpc !== '2.0') throw new Error('Expected JSON-RPC 2.0');
      if (message.id === null && typeof message.method !== 'string') return;
      if (message.id !== undefined && (typeof message.id !== 'string' || !message.id || message.id.length > 128)) {
        throw new Error('RPC id must be a non-empty string of at most 128 characters');
      }
    } catch (error) {
      this.send(errorResponse(null, new PluginError('invalid_request', error instanceof Error ? error.message : 'Invalid frame')));
      return;
    }
    if (typeof message.method !== 'string') {
      const id = message.id as string;
      const pending = this.#pending.get(id);
      if (!pending) return; // Includes late responses to cancelled or timed-out calls.
      this.#pending.delete(id);
      pending.cleanup();
      if (message.error) {
        const error = message.error as { message?: string; data?: { code?: string } };
        pending.reject(new PluginError(error.data?.code ?? 'host_failed', error.message ?? 'Host call failed'));
      } else if ('result' in message) pending.resolve(message.result as Json);
      else pending.reject(new PluginError('invalid_response', 'Host response has no result or error'));
      return;
    }
    const request = message as unknown as RpcRequest;
    if (request.id && this.#incoming.has(request.id)) {
      // Sending a second response with the same ID would corrupt the original call.
      throw new PluginError('duplicate_request', 'RPC request ID is already executing');
    }
    if (this.#incoming.size >= 128 && request.method !== 'plugin/cancel' && request.method !== 'plugin/deactivate') {
      if (request.id) this.send(errorResponse(request.id, new PluginError('busy', 'Too many plugin calls')));
      return;
    }
    if (request.id) this.#incoming.add(request.id);
    void Promise.resolve().then(() => handle(request)).then(
      result => { if (request.id && !this.#closed) this.send({ jsonrpc: '2.0', id: request.id, result }); },
      error => { if (request.id && !this.#closed) this.send(errorResponse(request.id, error)); },
    ).catch(error => this.close(error as Error)).finally(() => {
      if (request.id) this.#incoming.delete(request.id);
    });
  }

  close(error: Error = new PluginError('host_closed', 'RPC connection closed')): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) { pending.cleanup(); pending.reject(error); }
    this.#pending.clear();
    this.input.destroy();
  }
}
