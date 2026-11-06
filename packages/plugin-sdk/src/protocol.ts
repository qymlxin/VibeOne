export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const PLUGIN_API_VERSION = '0.1.0';
export const PLUGIN_PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1024 * 1024;

export class PluginError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PluginError';
  }
}

export interface RpcRequest {
  jsonrpc: '2.0';
  id?: string;
  method: string;
  params?: Json;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: string | null;
  result?: Json;
  error?: { code: number; message: string; data?: { code: string } };
}

export type RpcMessage = RpcRequest | RpcResponse;

export function errorResponse(id: string | null, error: unknown): RpcResponse {
  return {
    jsonrpc: '2.0', id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
      data: { code: error instanceof PluginError ? error.code : 'plugin_failed' },
    },
  };
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginError('invalid_params', 'Expected an object');
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginError('invalid_params', `${name} must be a non-empty string`);
  }
  return value;
}
