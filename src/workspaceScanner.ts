import * as vscode from 'vscode';
import { detectAuditStep, detectCoverageStep, detectDeployStep, detectNotifyStep, detectReleaseStep, NotifyKind } from './detectors/augment';
import { buildDockerSpec } from './detectors/docker';
import { buildDotnetSpec } from './detectors/dotnet';
import { buildGoSpec } from './detectors/go';
import { assignJobNames } from './detectors/jobNaming';
import { buildJavaGradleSpec } from './detectors/javaGradle';
import { buildJavaMavenSpec } from './detectors/javaMaven';
import { buildNodeSpec } from './detectors/node';
import { buildPhpSpec } from './detectors/php';
import { buildPythonSpec } from './detectors/python';
import { buildRubySpec } from './detectors/ruby';
import { buildRustSpec } from './detectors/rust';
import { BaseSpec, PipelineSpec, WorkspacePipeline } from './detectors/types';

async function tryReadText(uri: vscode.Uri): Promise<string | null> {
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(raw).toString('utf8');
  } catch {
    return null;
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function listDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
  try {
    return await vscode.workspace.fs.readDirectory(uri);
  } catch {
    return [];
  }
}

// Collects a spec for every manifest present, rather than stopping at the first match —
// hybrid projects (e.g. a Laravel app with package.json for the Vite frontend alongside
// composer.json for the PHP backend) have more than one ecosystem at the same root.
async function detectAllBaseSpecs(dirUri: vscode.Uri): Promise<BaseSpec[]> {
  const specs: BaseSpec[] = [];

  const packageJsonContent = await tryReadText(vscode.Uri.joinPath(dirUri, 'package.json'));
  if (packageJsonContent) {
    const nodeSpec = buildNodeSpec({
      packageJsonContent,
      hasPackageLock: await exists(vscode.Uri.joinPath(dirUri, 'package-lock.json')),
      hasYarnLock: await exists(vscode.Uri.joinPath(dirUri, 'yarn.lock')),
      hasPnpmLock: await exists(vscode.Uri.joinPath(dirUri, 'pnpm-lock.yaml')),
      nvmrcContent: await tryReadText(vscode.Uri.joinPath(dirUri, '.nvmrc')),
    });
    if (nodeSpec) {
      specs.push(nodeSpec);
    }
  }

  const pyprojectContent = await tryReadText(vscode.Uri.joinPath(dirUri, 'pyproject.toml'));
  const requirementsTxtContent = await tryReadText(vscode.Uri.joinPath(dirUri, 'requirements.txt'));
  if (pyprojectContent || requirementsTxtContent) {
    const pythonSpec = buildPythonSpec({
      requirementsTxtContent,
      pyprojectContent,
      pythonVersionFileContent: await tryReadText(vscode.Uri.joinPath(dirUri, '.python-version')),
    });
    if (pythonSpec) {
      specs.push(pythonSpec);
    }
  }

  const goModContent = await tryReadText(vscode.Uri.joinPath(dirUri, 'go.mod'));
  if (goModContent) {
    const goSpec = buildGoSpec({ goModContent });
    if (goSpec) {
      specs.push(goSpec);
    }
  }

  const cargoTomlContent = await tryReadText(vscode.Uri.joinPath(dirUri, 'Cargo.toml'));
  if (cargoTomlContent) {
    const rustSpec = buildRustSpec({
      cargoTomlContent,
      rustToolchainContent: await tryReadText(vscode.Uri.joinPath(dirUri, 'rust-toolchain.toml')),
    });
    if (rustSpec) {
      specs.push(rustSpec);
    }
  }

  const pomXmlContent = await tryReadText(vscode.Uri.joinPath(dirUri, 'pom.xml'));
  if (pomXmlContent) {
    const mavenSpec = buildJavaMavenSpec({ pomXmlContent });
    if (mavenSpec) {
      specs.push(mavenSpec);
    }
  }

  const buildGradleContent =
    (await tryReadText(vscode.Uri.joinPath(dirUri, 'build.gradle'))) ??
    (await tryReadText(vscode.Uri.joinPath(dirUri, 'build.gradle.kts')));
  if (buildGradleContent) {
    const gradleSpec = buildJavaGradleSpec({ buildGradleContent });
    if (gradleSpec) {
      specs.push(gradleSpec);
    }
  }

  const composerJsonContent = await tryReadText(vscode.Uri.joinPath(dirUri, 'composer.json'));
  if (composerJsonContent) {
    const phpSpec = buildPhpSpec({ composerJsonContent });
    if (phpSpec) {
      specs.push(phpSpec);
    }
  }

  const gemfileContent = await tryReadText(vscode.Uri.joinPath(dirUri, 'Gemfile'));
  if (gemfileContent) {
    const rubySpec = buildRubySpec({
      gemfileContent,
      rubyVersionFileContent: await tryReadText(vscode.Uri.joinPath(dirUri, '.ruby-version')),
    });
    if (rubySpec) {
      specs.push(rubySpec);
    }
  }

  const dirEntries = await listDirectory(dirUri);
  const csprojName = dirEntries.find(([name, type]) => type === vscode.FileType.File && /\.(csproj|sln)$/.test(name));
  if (csprojName) {
    const csprojContent = await tryReadText(vscode.Uri.joinPath(dirUri, csprojName[0]));
    const dotnetSpec = buildDotnetSpec({ hasProjectFile: true, csprojContent });
    if (dotnetSpec) {
      specs.push(dotnetSpec);
    }
  }

  // Docker only becomes its own job when nothing else was found — alongside another
  // ecosystem it's already handled as a deploy step (see detectDeployStep).
  if (specs.length === 0 && (await exists(vscode.Uri.joinPath(dirUri, 'Dockerfile')))) {
    const dockerSpec = buildDockerSpec({ hasDockerfile: true });
    if (dockerSpec) {
      specs.push(dockerSpec);
    }
  }

  return specs;
}

async function augmentSpec(dirUri: vscode.Uri, base: BaseSpec, notifyKind: NotifyKind | undefined): Promise<BaseSpec> {
  const augmentFiles = {
    hasVercelJson: await exists(vscode.Uri.joinPath(dirUri, 'vercel.json')),
    hasNetlifyToml: await exists(vscode.Uri.joinPath(dirUri, 'netlify.toml')),
    hasDockerfile: await exists(vscode.Uri.joinPath(dirUri, 'Dockerfile')),
    hasChangesetDir: await exists(vscode.Uri.joinPath(dirUri, '.changeset')),
    hasSemanticReleaseConfig:
      (await exists(vscode.Uri.joinPath(dirUri, '.releaserc'))) ||
      (await exists(vscode.Uri.joinPath(dirUri, '.releaserc.json'))) ||
      (await exists(vscode.Uri.joinPath(dirUri, 'release.config.js'))),
    packageJsonContent: await tryReadText(vscode.Uri.joinPath(dirUri, 'package.json')),
    pyprojectContent: await tryReadText(vscode.Uri.joinPath(dirUri, 'pyproject.toml')),
    requirementsTxtContent: await tryReadText(vscode.Uri.joinPath(dirUri, 'requirements.txt')),
  };

  return {
    ...base,
    auditStep: base.auditStep ?? detectAuditStep(base.ecosystem, base.packageManager),
    coverageStep: base.coverageStep ?? detectCoverageStep(base.ecosystem, augmentFiles),
    deployStep: base.deployStep ?? detectDeployStep(augmentFiles, base.ecosystem),
    releaseStep: base.releaseStep ?? detectReleaseStep(augmentFiles),
    notifyStep: notifyKind ? detectNotifyStep(notifyKind) : undefined,
  };
}

function parseEnvExampleKeys(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter((key): key is string => !!key);
}

async function isMonorepo(rootUri: vscode.Uri): Promise<boolean> {
  const markers = ['turbo.json', 'nx.json', 'lerna.json', 'pnpm-workspace.yaml'];
  for (const marker of markers) {
    if (await exists(vscode.Uri.joinPath(rootUri, marker))) {
      return true;
    }
  }
  const pkg = await tryReadText(vscode.Uri.joinPath(rootUri, 'package.json'));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      if (parsed.workspaces) {
        return true;
      }
    } catch {
      // not valid JSON — not a workspaces root
    }
  }
  return false;
}

// Approximates workspace-glob resolution by looking at the conventional
// packages/ and apps/ folders, rather than fully parsing every possible
// workspaces glob syntax (npm/yarn/pnpm/turbo/nx all differ slightly).
async function findMonorepoPackageDirs(rootUri: vscode.Uri): Promise<{ uri: vscode.Uri; relativePath: string }[]> {
  const dirs: { uri: vscode.Uri; relativePath: string }[] = [];
  for (const parent of ['packages', 'apps']) {
    const parentUri = vscode.Uri.joinPath(rootUri, parent);
    const entries = await listDirectory(parentUri);
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        dirs.push({ uri: vscode.Uri.joinPath(parentUri, name), relativePath: `${parent}/${name}` });
      }
    }
  }
  return dirs;
}

async function detectDefaultBranch(rootUri: vscode.Uri): Promise<string> {
  const headContent = await tryReadText(vscode.Uri.joinPath(rootUri, '.git', 'HEAD'));
  const match = headContent?.match(/ref:\s*refs\/heads\/(.+)/);
  if (match) {
    return match[1].trim();
  }
  if (await exists(vscode.Uri.joinPath(rootUri, '.git', 'refs', 'heads', 'master'))) {
    return 'master';
  }
  return 'main';
}

export async function detectWorkspacePipeline(
  rootUri: vscode.Uri,
  matrixVersions?: string[],
  osMatrix?: string[],
  notifyKind?: NotifyKind,
): Promise<WorkspacePipeline | undefined> {
  const branch = await detectDefaultBranch(rootUri);
  const specs: PipelineSpec[] = [];

  if (await isMonorepo(rootUri)) {
    const packageDirs = await findMonorepoPackageDirs(rootUri);
    for (const { uri, relativePath } of packageDirs) {
      const bases = await detectAllBaseSpecs(uri);
      for (const base of bases) {
        const augmented = await augmentSpec(uri, base, notifyKind);
        specs.push({ ...augmented, subdirectory: relativePath });
      }
    }
  }

  if (specs.length === 0) {
    const bases = await detectAllBaseSpecs(rootUri);
    if (bases.length === 0) {
      return undefined;
    }
    for (const base of bases) {
      const augmented = await augmentSpec(rootUri, base, notifyKind);
      specs.push({ ...augmented, subdirectory: '' });
    }
  }

  assignJobNames(specs);

  const envExampleContent = await tryReadText(vscode.Uri.joinPath(rootUri, '.env.example'));
  const requiredSecrets = envExampleContent ? parseEnvExampleKeys(envExampleContent) : undefined;

  return { specs, branch, matrixVersions, osMatrix, requiredSecrets };
}
