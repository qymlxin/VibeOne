import path from 'node:path';

// Includes the root itself; callers separately check the expected file type.
export function containsPackagePath(root,target,paths=path) {
  const relative=paths.relative(root,target);
  return !paths.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${paths.sep}`);
}
