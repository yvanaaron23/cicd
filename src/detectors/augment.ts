import { CIStep, Ecosystem, PackageManager } from './types';

export interface AugmentFiles {
  hasVercelJson: boolean;
  hasNetlifyToml: boolean;
  hasDockerfile: boolean;
  hasChangesetDir: boolean;
  hasSemanticReleaseConfig: boolean;
  packageJsonContent: string | null;
  pyprojectContent: string | null;
  requirementsTxtContent: string | null;
}

// Deploy/release targets aren't tied to one ecosystem, so they're detected
// separately and layered onto whichever ecosystem spec was found.
export function detectDeployStep(files: AugmentFiles, ecosystem: Ecosystem): CIStep | undefined {
  if (files.hasVercelJson) {
    return { name: 'Deploy to Vercel', run: 'npx vercel deploy --prod --token=$VERCEL_TOKEN' };
  }
  if (files.hasNetlifyToml) {
    return { name: 'Deploy to Netlify', run: 'npx netlify deploy --prod --auth=$NETLIFY_AUTH_TOKEN' };
  }
  // The 'docker' ecosystem already sets its own deploy (push) step.
  if (files.hasDockerfile && ecosystem !== 'docker') {
    return { name: 'Build and push Docker image', run: 'docker build -t $IMAGE_NAME . && docker push $IMAGE_NAME' };
  }
  return undefined;
}

export function detectReleaseStep(files: AugmentFiles): CIStep | undefined {
  if (files.hasChangesetDir) {
    return { name: 'Release', run: 'npx changeset publish' };
  }
  const usesSemanticRelease =
    files.hasSemanticReleaseConfig || (files.packageJsonContent?.includes('"semantic-release"') ?? false);
  if (usesSemanticRelease) {
    return { name: 'Release', run: 'npx semantic-release' };
  }
  return undefined;
}

// Only ecosystems with a simple, widely-used, zero-config audit command get one —
// no fabricated commands for ecosystems without an obvious universal tool (java/dotnet/go/docker).
export function detectAuditStep(ecosystem: Ecosystem, packageManager: PackageManager | undefined): CIStep | undefined {
  switch (ecosystem) {
    case 'node':
      switch (packageManager) {
        case 'yarn':
          return { name: 'Security audit', run: 'yarn audit' };
        case 'pnpm':
          return { name: 'Security audit', run: 'pnpm audit' };
        default:
          return { name: 'Security audit', run: 'npm audit --audit-level=high' };
      }
    case 'python':
      return packageManager === 'poetry'
        ? { name: 'Security audit', run: 'poetry run pip install pip-audit && poetry run pip-audit' }
        : { name: 'Security audit', run: 'pip install pip-audit && pip-audit -r requirements.txt' };
    case 'rust':
      return { name: 'Security audit', run: 'cargo install cargo-audit && cargo audit' };
    case 'php':
      return { name: 'Security audit', run: 'composer audit' };
    case 'ruby':
      return { name: 'Security audit', run: 'bundle exec bundler-audit check --update' };
    default:
      return undefined;
  }
}

export type NotifyKind = 'slack' | 'discord';

export function detectNotifyStep(kind: NotifyKind): CIStep {
  if (kind === 'discord') {
    return {
      name: 'Notify on failure',
      run: 'curl -X POST -H "Content-Type: application/json" --data \'{"content":"Build failed"}\' "$DISCORD_WEBHOOK_URL"',
      condition: 'on_failure',
    };
  }
  return {
    name: 'Notify on failure',
    run: 'curl -X POST -H "Content-Type: application/json" --data \'{"text":"Build failed"}\' "$SLACK_WEBHOOK_URL"',
    condition: 'on_failure',
  };
}

// Universal uploader (codecov's bash script) — avoids maintaining a separate upload
// action/command per language, but only added when a coverage tool is actually detected.
export function detectCoverageStep(ecosystem: Ecosystem, files: AugmentFiles): CIStep | undefined {
  if (ecosystem === 'node') {
    let deps: Record<string, string> = {};
    try {
      const pkg = JSON.parse(files.packageJsonContent ?? '{}') as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
      // not valid JSON — treat as no coverage tool present
    }
    const hasCoverageTool = ['jest', 'vitest', 'nyc', 'c8'].some((tool) => tool in deps);
    if (!hasCoverageTool) {
      return undefined;
    }
  } else if (ecosystem === 'python') {
    const manifest = `${files.pyprojectContent ?? ''}\n${files.requirementsTxtContent ?? ''}`;
    const hasCoverageTool = /pytest-cov|coverage/.test(manifest);
    if (!hasCoverageTool) {
      return undefined;
    }
  } else {
    return undefined;
  }
  return { name: 'Upload coverage', run: 'bash <(curl -s https://codecov.io/bash)' };
}
