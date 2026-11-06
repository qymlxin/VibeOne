import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { asObject, PluginError, requiredString } from '@vibeone/plugin-sdk/protocol';

export interface WorkerPackage {
  id: string;
  version: string;
  entrypoint: string;
  handlers: string[];
}

export async function loadWorkerPackage(directory: string): Promise<WorkerPackage> {
  const root = await realpath(directory);
  const contained = async (path: string) => {
    if (isAbsolute(path)) throw new PluginError('invalid_manifest', 'Package paths must be relative');
    const full = await realpath(resolve(root, path));
    const rel = relative(root, full);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new PluginError('entrypoint_escape', 'Package path escapes its directory');
    }
    return full;
  };
  const manifestPath = await contained('plugin.json');
  if ((await stat(manifestPath)).size > 65_536) throw new PluginError('invalid_manifest', 'Manifest exceeds 64 KiB');
  const manifest = asObject(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (manifest.manifestVersion !== 1) throw new PluginError('manifest_incompatible', 'Expected manifestVersion 1');
  const id = requiredString(manifest.id, 'id');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new PluginError('invalid_manifest', 'Invalid plugin id');
  const version = requiredString(manifest.version, 'version');
  const engines = asObject(manifest.engines);
  // P0 intentionally accepts one explicitly documented API range, not arbitrary semver expressions.
  if (engines.pluginApi !== '>=0.1 <0.2') throw new PluginError('api_incompatible', 'Supported pluginApi range is >=0.1 <0.2');
  const worker = asObject(asObject(manifest.entrypoints).worker);
  if (worker.runtime !== 'node' || worker.protocolVersion !== 1) throw new PluginError('runtime_incompatible', 'Expected node worker protocol 1');
  const entrypoint = await contained(requiredString(worker.path, 'worker.path'));
  if (!/\.(mjs|js)$/.test(entrypoint)) throw new PluginError('invalid_manifest', 'Worker must be JavaScript ESM');
  if (!(await stat(entrypoint)).isFile()) throw new PluginError('invalid_manifest', 'Worker entry must be a file');
  if (!Array.isArray(manifest.contributions)) throw new PluginError('invalid_manifest', 'contributions must be an array');
  const ids = new Set<string>();
  const handlers: string[] = [];
  const kinds = new Set(['app.panel', 'app.view', 'app.slot', 'app.command', 'notification.channel', 'agent.provider', 'settings.section']);
  for (const raw of manifest.contributions) {
    const contribution = asObject(raw);
    const contributionId = requiredString(contribution.id, 'contribution.id');
    if (ids.has(contributionId)) throw new PluginError('invalid_manifest', 'Duplicate contribution id');
    ids.add(contributionId);
    if (!kinds.has(String(contribution.kind)) || contribution.kindVersion !== 1) {
      throw new PluginError('contribution_incompatible', 'Unknown contribution kind or version');
    }
    const binding = asObject(contribution.binding);
    if (!['worker', 'app', 'declarative'].includes(String(binding.type))) throw new PluginError('invalid_manifest', 'Unknown contribution binding');
    if (binding.type === 'worker') handlers.push(requiredString(binding.handler, 'binding.handler'));
  }
  return { id, version, entrypoint, handlers };
}
