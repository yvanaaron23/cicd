import { BaseSpec } from './types';

export interface PhpProjectFiles {
  composerJsonContent: string | null;
}

export function buildPhpSpec(files: PhpProjectFiles): BaseSpec | undefined {
  if (!files.composerJsonContent) {
    return undefined;
  }

  let composer: { require?: { php?: string }; scripts?: Record<string, string | string[]> };
  try {
    composer = JSON.parse(files.composerJsonContent);
  } catch {
    return undefined;
  }

  const versionMatch = composer.require?.php?.match(/(\d+\.\d+)/);
  const runtimeVersion = versionMatch ? versionMatch[1] : '8.3';
  const scripts = composer.scripts ?? {};

  return {
    ecosystem: 'php',
    packageManager: 'composer',
    runtimeVersion,
    installStep: { name: 'Install dependencies', run: 'composer install --no-progress --prefer-dist' },
    lintStep: scripts.lint ? { name: 'Lint', run: 'composer run lint' } : undefined,
    testStep: scripts.test ? { name: 'Test', run: 'composer run test' } : undefined,
  };
}
