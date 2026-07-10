import { PipelineSpec } from '../detectors/types';

export interface CacheConfig {
  paths: string[];
  keyFiles: string[];
}

/** Cache directories and lockfiles to key on, per ecosystem/package manager. Docker has no dependency cache. */
export function cacheConfigFor(spec: PipelineSpec): CacheConfig | undefined {
  switch (spec.ecosystem) {
    case 'node':
      switch (spec.packageManager) {
        case 'yarn':
          return { paths: ['~/.cache/yarn'], keyFiles: ['yarn.lock'] };
        case 'pnpm':
          return { paths: ['~/.pnpm-store'], keyFiles: ['pnpm-lock.yaml'] };
        default:
          return { paths: ['~/.npm'], keyFiles: ['package-lock.json'] };
      }
    case 'python':
      return spec.packageManager === 'poetry'
        ? { paths: ['~/.cache/pypoetry'], keyFiles: ['poetry.lock'] }
        : { paths: ['~/.cache/pip'], keyFiles: ['requirements.txt'] };
    case 'go':
      return { paths: ['~/go/pkg/mod', '~/.cache/go-build'], keyFiles: ['go.sum'] };
    case 'rust':
      return { paths: ['~/.cargo/registry', '~/.cargo/git', 'target'], keyFiles: ['Cargo.lock'] };
    case 'java-maven':
      return { paths: ['~/.m2/repository'], keyFiles: ['pom.xml'] };
    case 'java-gradle':
      return { paths: ['~/.gradle/caches'], keyFiles: ['build.gradle', 'build.gradle.kts'] };
    case 'php':
      return { paths: ['vendor', '~/.composer/cache'], keyFiles: ['composer.lock'] };
    case 'ruby':
      return { paths: ['vendor/bundle'], keyFiles: ['Gemfile.lock'] };
    case 'dotnet':
      return { paths: ['~/.nuget/packages'], keyFiles: ['**/*.csproj'] };
    case 'docker':
      return undefined;
  }
}
