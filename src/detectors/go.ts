import { PipelineSpec } from './types';

export interface GoProjectFiles {
  goModContent: string | null;
}

export function buildGoSpec(files: GoProjectFiles): PipelineSpec | undefined {
  if (!files.goModContent) {
    return undefined;
  }

  const versionMatch = files.goModContent.match(/^go\s+(\d+\.\d+)/m);
  const runtimeVersion = versionMatch ? versionMatch[1] : '1.22';

  return {
    ecosystem: 'go',
    runtimeVersion,
    installStep: { name: 'Download dependencies', run: 'go mod download' },
    testStep: { name: 'Test', run: 'go test ./...' },
    buildStep: { name: 'Build', run: 'go build ./...' },
  };
}
