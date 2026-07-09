import { BaseSpec } from './types';

export interface DotnetProjectFiles {
  hasProjectFile: boolean;
  csprojContent: string | null;
}

export function buildDotnetSpec(files: DotnetProjectFiles): BaseSpec | undefined {
  if (!files.hasProjectFile) {
    return undefined;
  }

  const versionMatch = files.csprojContent?.match(/<TargetFramework>net(\d+\.\d+)</);
  const runtimeVersion = versionMatch ? versionMatch[1] : '8.0';

  return {
    ecosystem: 'dotnet',
    runtimeVersion,
    installStep: { name: 'Restore dependencies', run: 'dotnet restore' },
    testStep: { name: 'Test', run: 'dotnet test --no-restore' },
    buildStep: { name: 'Build', run: 'dotnet build --no-restore' },
  };
}
