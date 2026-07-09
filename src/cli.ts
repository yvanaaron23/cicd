#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { detectDeployStep, detectReleaseStep } from './detectors/augment';
import { buildDockerSpec } from './detectors/docker';
import { buildDotnetSpec } from './detectors/dotnet';
import { buildGoSpec } from './detectors/go';
import { buildJavaGradleSpec } from './detectors/javaGradle';
import { buildJavaMavenSpec } from './detectors/javaMaven';
import { buildNodeSpec } from './detectors/node';
import { buildPhpSpec } from './detectors/php';
import { buildPythonSpec } from './detectors/python';
import { buildRubySpec } from './detectors/ruby';
import { buildRustSpec } from './detectors/rust';
import { BaseSpec, CIStep, PipelineSpec, WorkspacePipeline } from './detectors/types';
import { renderAzurePipelines } from './providers/azurePipelines';
import { renderBitbucketPipelines } from './providers/bitbucket';
import { renderCircleCi } from './providers/circleci';
import { renderGitHubActionsWorkflow } from './providers/githubActions';
import { renderGitlabCi } from './providers/gitlabCi';

type Provider = 'github' | 'gitlab' | 'azure' | 'circleci' | 'bitbucket';

function tryReadText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function detectBaseSpec(dir: string): BaseSpec | undefined {
  const packageJsonContent = tryReadText(path.join(dir, 'package.json'));
  if (packageJsonContent) {
    const nodeSpec = buildNodeSpec({
      packageJsonContent,
      hasPackageLock: exists(path.join(dir, 'package-lock.json')),
      hasYarnLock: exists(path.join(dir, 'yarn.lock')),
      hasPnpmLock: exists(path.join(dir, 'pnpm-lock.yaml')),
      nvmrcContent: tryReadText(path.join(dir, '.nvmrc')),
    });
    if (nodeSpec) {
      return nodeSpec;
    }
  }

  const pyprojectContent = tryReadText(path.join(dir, 'pyproject.toml'));
  const requirementsTxtContent = tryReadText(path.join(dir, 'requirements.txt'));
  if (pyprojectContent || requirementsTxtContent) {
    const pythonSpec = buildPythonSpec({
      requirementsTxtContent,
      pyprojectContent,
      pythonVersionFileContent: tryReadText(path.join(dir, '.python-version')),
    });
    if (pythonSpec) {
      return pythonSpec;
    }
  }

  const goModContent = tryReadText(path.join(dir, 'go.mod'));
  if (goModContent) {
    const goSpec = buildGoSpec({ goModContent });
    if (goSpec) {
      return goSpec;
    }
  }

  const cargoTomlContent = tryReadText(path.join(dir, 'Cargo.toml'));
  if (cargoTomlContent) {
    const rustSpec = buildRustSpec({
      cargoTomlContent,
      rustToolchainContent: tryReadText(path.join(dir, 'rust-toolchain.toml')),
    });
    if (rustSpec) {
      return rustSpec;
    }
  }

  const pomXmlContent = tryReadText(path.join(dir, 'pom.xml'));
  if (pomXmlContent) {
    const mavenSpec = buildJavaMavenSpec({ pomXmlContent });
    if (mavenSpec) {
      return mavenSpec;
    }
  }

  const buildGradleContent = tryReadText(path.join(dir, 'build.gradle')) ?? tryReadText(path.join(dir, 'build.gradle.kts'));
  if (buildGradleContent) {
    const gradleSpec = buildJavaGradleSpec({ buildGradleContent });
    if (gradleSpec) {
      return gradleSpec;
    }
  }

  const composerJsonContent = tryReadText(path.join(dir, 'composer.json'));
  if (composerJsonContent) {
    const phpSpec = buildPhpSpec({ composerJsonContent });
    if (phpSpec) {
      return phpSpec;
    }
  }

  const gemfileContent = tryReadText(path.join(dir, 'Gemfile'));
  if (gemfileContent) {
    const rubySpec = buildRubySpec({
      gemfileContent,
      rubyVersionFileContent: tryReadText(path.join(dir, '.ruby-version')),
    });
    if (rubySpec) {
      return rubySpec;
    }
  }

  let csprojFile: string | undefined;
  try {
    csprojFile = fs.readdirSync(dir).find((name) => /\.(csproj|sln)$/.test(name));
  } catch {
    csprojFile = undefined;
  }
  if (csprojFile) {
    const dotnetSpec = buildDotnetSpec({ hasProjectFile: true, csprojContent: tryReadText(path.join(dir, csprojFile)) });
    if (dotnetSpec) {
      return dotnetSpec;
    }
  }

  if (exists(path.join(dir, 'Dockerfile'))) {
    return buildDockerSpec({ hasDockerfile: true });
  }

  return undefined;
}

function augmentSpec(dir: string, base: BaseSpec): BaseSpec {
  const augmentFiles = {
    hasVercelJson: exists(path.join(dir, 'vercel.json')),
    hasNetlifyToml: exists(path.join(dir, 'netlify.toml')),
    hasDockerfile: exists(path.join(dir, 'Dockerfile')),
    hasChangesetDir: exists(path.join(dir, '.changeset')),
    hasSemanticReleaseConfig:
      exists(path.join(dir, '.releaserc')) || exists(path.join(dir, '.releaserc.json')) || exists(path.join(dir, 'release.config.js')),
    packageJsonContent: tryReadText(path.join(dir, 'package.json')),
  };

  return {
    ...base,
    deployStep: base.deployStep ?? detectDeployStep(augmentFiles, base.ecosystem),
    releaseStep: base.releaseStep ?? detectReleaseStep(augmentFiles),
  };
}

function isMonorepo(dir: string): boolean {
  const markers = ['turbo.json', 'nx.json', 'lerna.json', 'pnpm-workspace.yaml'];
  if (markers.some((marker) => exists(path.join(dir, marker)))) {
    return true;
  }
  const pkg = tryReadText(path.join(dir, 'package.json'));
  if (pkg) {
    try {
      return !!JSON.parse(pkg).workspaces;
    } catch {
      return false;
    }
  }
  return false;
}

function findMonorepoPackageDirs(rootDir: string): { dir: string; relativePath: string }[] {
  const dirs: { dir: string; relativePath: string }[] = [];
  for (const parent of ['packages', 'apps']) {
    const parentDir = path.join(rootDir, parent);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(parentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push({ dir: path.join(parentDir, entry.name), relativePath: `${parent}/${entry.name}` });
      }
    }
  }
  return dirs;
}

function detectDefaultBranch(rootDir: string): string {
  const headContent = tryReadText(path.join(rootDir, '.git', 'HEAD'));
  const match = headContent?.match(/ref:\s*refs\/heads\/(.+)/);
  if (match) {
    return match[1].trim();
  }
  if (exists(path.join(rootDir, '.git', 'refs', 'heads', 'master'))) {
    return 'master';
  }
  return 'main';
}

function detectWorkspacePipeline(rootDir: string, matrixVersions?: string[]): WorkspacePipeline | undefined {
  const branch = detectDefaultBranch(rootDir);
  const specs: PipelineSpec[] = [];

  if (isMonorepo(rootDir)) {
    for (const { dir, relativePath } of findMonorepoPackageDirs(rootDir)) {
      const base = detectBaseSpec(dir);
      if (base) {
        specs.push({ ...augmentSpec(dir, base), subdirectory: relativePath });
      }
    }
  }

  if (specs.length === 0) {
    const base = detectBaseSpec(rootDir);
    if (!base) {
      return undefined;
    }
    specs.push({ ...augmentSpec(rootDir, base), subdirectory: '' });
  }

  return { specs, branch, matrixVersions };
}

function outputPathFor(provider: Provider): string[] {
  switch (provider) {
    case 'github':
      return ['.github', 'workflows', 'ci.yml'];
    case 'gitlab':
      return ['.gitlab-ci.yml'];
    case 'azure':
      return ['azure-pipelines.yml'];
    case 'circleci':
      return ['.circleci', 'config.yml'];
    case 'bitbucket':
      return ['bitbucket-pipelines.yml'];
  }
}

function renderPipeline(provider: Provider, pipeline: WorkspacePipeline): string {
  switch (provider) {
    case 'github':
      return renderGitHubActionsWorkflow(pipeline);
    case 'gitlab':
      return renderGitlabCi(pipeline);
    case 'azure':
      return renderAzurePipelines(pipeline);
    case 'circleci':
      return renderCircleCi(pipeline);
    case 'bitbucket':
      return renderBitbucketPipelines(pipeline);
  }
}

function allSteps(spec: PipelineSpec): CIStep[] {
  return [spec.installStep, spec.lintStep, spec.testStep, spec.buildStep, spec.deployStep, spec.releaseStep].filter(
    (s): s is CIStep => !!s,
  );
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags[key] = value ?? 'true';
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printUsage(): void {
  console.log(`Usage: generate-pipeline [targetDir] [options]

Options:
  --provider=github|gitlab|azure|circleci|bitbucket|auto  (default: auto)
  --matrix=v1,v2,v3           Build matrix versions (Node/Python/Go only)
  --dry-run                   Print the generated pipeline instead of writing it
  --force                     Overwrite an existing pipeline file without asking
  --help                      Show this message
`);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

export function run(argv: string[]): void {
  const { positional, flags } = parseArgs(argv);

  if (flags.help !== undefined) {
    printUsage();
    return;
  }

  const rootDir = path.resolve(positional[0] ?? process.cwd());
  if (!exists(rootDir)) {
    fail(`target directory does not exist: ${rootDir}`);
  }

  const matrixVersions = flags.matrix ? flags.matrix.split(',').map((v) => v.trim()) : undefined;
  const pipeline = detectWorkspacePipeline(rootDir, matrixVersions);
  if (!pipeline) {
    fail('could not detect a recognized project in ' + rootDir);
  }

  const provider = (flags.provider ?? 'github') as Provider;
  if (!outputPathFor(provider)) {
    fail(`unknown provider "${provider}"`);
  }

  const content = renderPipeline(provider, pipeline);

  if (flags['dry-run'] !== undefined) {
    console.log(content);
    return;
  }

  const outputSegments = outputPathFor(provider);
  const outputPath = path.join(rootDir, ...outputSegments);

  if (exists(outputPath) && flags.force === undefined) {
    const existingContent = fs.readFileSync(outputPath, 'utf8');
    const missing = pipeline.specs.flatMap((spec) => allSteps(spec)).filter((step) => !existingContent.includes(step.run));
    if (missing.length === 0) {
      console.log(`${outputSegments.join('/')} already exists and already contains every detected step — nothing to do.`);
      return;
    }
    fail(
      `${outputSegments.join('/')} already exists. Pass --force to overwrite, or --dry-run to preview, or resolve manually (missing steps: ${missing.map((s) => s.name).join(', ')}).`,
    );
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`Generated a ${provider} pipeline at ${outputSegments.join('/')}`);
}

/* istanbul ignore next -- exercised via the compiled bin entry point, not unit tests */
if (require.main === module) {
  run(process.argv.slice(2));
}
