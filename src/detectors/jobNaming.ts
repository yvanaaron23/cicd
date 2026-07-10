import { PipelineSpec } from './types';

// When multiple ecosystems are detected in the same directory (e.g. a Laravel app with a
// package.json for the Vite frontend alongside composer.json for the PHP backend), job
// names must be disambiguated by ecosystem — `subdirectory` alone would collide since
// both specs share it. Single-ecosystem directories are left untouched (jobName stays
// undefined) so existing job-naming output doesn't change.
export function assignJobNames(specs: PipelineSpec[]): void {
  const bySubdirectory = new Map<string, PipelineSpec[]>();
  for (const spec of specs) {
    const group = bySubdirectory.get(spec.subdirectory) ?? [];
    group.push(spec);
    bySubdirectory.set(spec.subdirectory, group);
  }

  for (const group of bySubdirectory.values()) {
    if (group.length <= 1) {
      continue;
    }
    for (const spec of group) {
      const prefix = spec.subdirectory ? `${spec.subdirectory.replace(/[^a-zA-Z0-9]/g, '_')}_` : '';
      spec.jobName = `${prefix}${spec.ecosystem.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }
  }
}
