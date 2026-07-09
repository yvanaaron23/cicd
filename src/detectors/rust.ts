import { BaseSpec } from './types';

export interface RustProjectFiles {
  cargoTomlContent: string | null;
  rustToolchainContent: string | null;
}

export function buildRustSpec(files: RustProjectFiles): BaseSpec | undefined {
  if (!files.cargoTomlContent) {
    return undefined;
  }

  const channelMatch = files.rustToolchainContent?.match(/channel\s*=\s*"([^"]+)"/);
  const runtimeVersion = channelMatch ? channelMatch[1] : 'stable';

  return {
    ecosystem: 'rust',
    runtimeVersion,
    installStep: { name: 'Fetch dependencies', run: 'cargo fetch' },
    buildStep: { name: 'Build', run: 'cargo build --verbose' },
    testStep: { name: 'Test', run: 'cargo test --verbose' },
  };
}
