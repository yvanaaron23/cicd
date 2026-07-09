import { BaseSpec, PackageManager } from './types';

export interface NodeProjectFiles {
  packageJsonContent: string;
  hasPackageLock: boolean;
  hasYarnLock: boolean;
  hasPnpmLock: boolean;
  nvmrcContent: string | null;
}

export function detectPackageManager(files: NodeProjectFiles): PackageManager {
  if (files.hasPnpmLock) {
    return 'pnpm';
  }
  if (files.hasYarnLock) {
    return 'yarn';
  }
  return 'npm';
}

function extractNodeVersion(nvmrcContent: string | null, engineRange: string | undefined): string {
  if (nvmrcContent) {
    const trimmed = nvmrcContent.trim().replace(/^v/, '');
    if (trimmed) {
      return trimmed;
    }
  }
  if (engineRange) {
    const match = engineRange.match(/(\d+)(?:\.\d+){0,2}/);
    if (match) {
      return match[1];
    }
  }
  return '20';
}

function installCommandFor(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'pnpm':
      return 'pnpm install --frozen-lockfile';
    case 'yarn':
      return 'yarn install --frozen-lockfile';
    default:
      return 'npm ci';
  }
}

function runScriptCommand(packageManager: PackageManager, script: string): string {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm run ${script}`;
    case 'yarn':
      return `yarn ${script}`;
    default:
      return `npm run ${script}`;
  }
}

export function buildNodeSpec(files: NodeProjectFiles): BaseSpec | undefined {
  let pkg: { engines?: { node?: string }; scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(files.packageJsonContent);
  } catch {
    return undefined;
  }

  const packageManager = detectPackageManager(files);
  const runtimeVersion = extractNodeVersion(files.nvmrcContent, pkg.engines?.node);
  const scripts = pkg.scripts ?? {};

  return {
    ecosystem: 'node',
    packageManager,
    runtimeVersion,
    installStep: { name: 'Install dependencies', run: installCommandFor(packageManager) },
    lintStep: scripts.lint ? { name: 'Lint', run: runScriptCommand(packageManager, 'lint') } : undefined,
    testStep: scripts.test ? { name: 'Test', run: runScriptCommand(packageManager, 'test') } : undefined,
    buildStep: scripts.build ? { name: 'Build', run: runScriptCommand(packageManager, 'build') } : undefined,
  };
}
