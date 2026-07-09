import * as vscode from 'vscode';
import { CIStep, PipelineSpec, WorkspacePipeline } from './detectors/types';
import { renderAzurePipelines } from './providers/azurePipelines';
import { renderBitbucketPipelines } from './providers/bitbucket';
import { renderCircleCi } from './providers/circleci';
import { renderGitHubActionsWorkflow } from './providers/githubActions';
import { renderGitlabCi } from './providers/gitlabCi';
import { detectWorkspacePipeline } from './workspaceScanner';

type Provider = 'github' | 'gitlab' | 'azure' | 'circleci' | 'bitbucket';

const providerLabels: Record<Provider, string> = {
  github: 'GitHub Actions',
  gitlab: 'GitLab CI',
  azure: 'Azure Pipelines',
  circleci: 'CircleCI',
  bitbucket: 'Bitbucket Pipelines',
};

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

function readForcedProvider(): Provider | 'auto' {
  return vscode.workspace.getConfiguration('ciPipelineGenerator').get('provider', 'auto');
}

function readMatrixVersions(): string[] {
  return vscode.workspace.getConfiguration('ciPipelineGenerator').get('matrixVersions', []);
}

async function detectProviderFromWorkspace(rootUri: vscode.Uri): Promise<Provider | undefined> {
  if (await exists(vscode.Uri.joinPath(rootUri, '.github', 'workflows'))) {
    return 'github';
  }
  if (await exists(vscode.Uri.joinPath(rootUri, '.gitlab-ci.yml'))) {
    return 'gitlab';
  }
  if (await exists(vscode.Uri.joinPath(rootUri, 'azure-pipelines.yml'))) {
    return 'azure';
  }
  if (await exists(vscode.Uri.joinPath(rootUri, '.circleci', 'config.yml'))) {
    return 'circleci';
  }
  if (await exists(vscode.Uri.joinPath(rootUri, 'bitbucket-pipelines.yml'))) {
    return 'bitbucket';
  }

  const gitConfig = await tryReadText(vscode.Uri.joinPath(rootUri, '.git', 'config'));
  if (gitConfig) {
    if (/gitlab\.com/.test(gitConfig)) {
      return 'gitlab';
    }
    if (/bitbucket\.org/.test(gitConfig)) {
      return 'bitbucket';
    }
    if (/dev\.azure\.com|visualstudio\.com/.test(gitConfig)) {
      return 'azure';
    }
    if (/github\.com/.test(gitConfig)) {
      return 'github';
    }
  }

  return undefined;
}

async function resolveProvider(rootUri: vscode.Uri): Promise<Provider | undefined> {
  const forced = readForcedProvider();
  if (forced !== 'auto') {
    return forced;
  }

  const detected = await detectProviderFromWorkspace(rootUri);
  if (detected) {
    return detected;
  }

  const picked = await vscode.window.showQuickPick(
    (Object.keys(providerLabels) as Provider[]).map((provider) => ({ label: providerLabels[provider], provider })),
    { placeHolder: 'Could not detect a CI provider from git remote — pick one' },
  );

  return picked?.provider;
}

async function pickTargetFolder(clickedUri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (clickedUri) {
    return clickedUri;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders?.length === 1) {
    return workspaceFolders[0].uri;
  }

  const defaultUri = workspaceFolders?.[0]?.uri;
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri,
    openLabel: 'Generate pipeline here',
  });

  return picked?.[0];
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

function findMissingSteps(existingContent: string, pipeline: WorkspacePipeline): CIStep[] {
  const missing: CIStep[] = [];
  for (const spec of pipeline.specs) {
    for (const step of allSteps(spec)) {
      if (!existingContent.includes(step.run)) {
        missing.push(step);
      }
    }
  }
  return missing;
}

function appendMissingStepsComment(existingContent: string, missing: CIStep[]): string {
  const trimmed = existingContent.endsWith('\n') ? existingContent : `${existingContent}\n`;
  const lines = missing.map((s) => `# - name: ${s.name}\n#   run: ${s.run}`).join('\n');
  return `${trimmed}\n# --- Detected steps not found in this file (Archemist CI/CD Pipeline Generator) ---\n${lines}\n`;
}

function parseRepoSlug(gitConfigContent: string, host: string): string | undefined {
  const escapedHost = host.replace(/\./g, '\\.');
  const match = gitConfigContent.match(new RegExp(`${escapedHost}[:/]([^/\\s]+)/([^/.\\s]+)(?:\\.git)?`));
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function badgeMarkdownFor(provider: Provider, slug: string, branch: string): string | undefined {
  switch (provider) {
    case 'github':
      return `[![CI](https://github.com/${slug}/actions/workflows/ci.yml/badge.svg?branch=${branch})](https://github.com/${slug}/actions/workflows/ci.yml)`;
    case 'gitlab':
      return `[![pipeline status](https://gitlab.com/${slug}/badges/${branch}/pipeline.svg)](https://gitlab.com/${slug}/-/commits/${branch})`;
    default:
      return undefined;
  }
}

async function insertStatusBadge(rootUri: vscode.Uri, provider: Provider, branch: string): Promise<void> {
  const readmeUri = vscode.Uri.joinPath(rootUri, 'README.md');
  const readmeContent = await tryReadText(readmeUri);
  if (readmeContent === null) {
    return;
  }

  const host = provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : undefined;
  if (!host) {
    return;
  }

  const gitConfigContent = await tryReadText(vscode.Uri.joinPath(rootUri, '.git', 'config'));
  const slug = gitConfigContent ? parseRepoSlug(gitConfigContent, host) : undefined;
  if (!slug) {
    return;
  }

  const badge = badgeMarkdownFor(provider, slug, branch);
  if (!badge || readmeContent.includes(badge)) {
    return;
  }

  const lines = readmeContent.split('\n');
  const titleIndex = lines.findIndex((line) => line.startsWith('# '));
  const insertAt = titleIndex >= 0 ? titleIndex + 1 : 0;
  lines.splice(insertAt, 0, '', badge);
  await vscode.workspace.fs.writeFile(readmeUri, Buffer.from(lines.join('\n'), 'utf8'));
}

async function generatePipeline(clickedUri?: vscode.Uri): Promise<void> {
  const rootUri = await pickTargetFolder(clickedUri);
  if (!rootUri) {
    return;
  }

  const matrixVersions = readMatrixVersions();
  const pipeline = await detectWorkspacePipeline(rootUri, matrixVersions.length > 0 ? matrixVersions : undefined);
  if (!pipeline) {
    vscode.window.showErrorMessage(
      'Could not detect a recognized project (looked for package.json, pyproject.toml/requirements.txt, go.mod, Cargo.toml, pom.xml, build.gradle, composer.json, Gemfile, *.csproj/*.sln, or Dockerfile).',
    );
    return;
  }

  const provider = await resolveProvider(rootUri);
  if (!provider) {
    return;
  }

  const outputSegments = outputPathFor(provider);
  const outputUri = vscode.Uri.joinPath(rootUri, ...outputSegments);
  const relativeOutputPath = outputSegments.join('/');
  const existingContent = await tryReadText(outputUri);

  let contentToWrite: string;

  if (existingContent !== null) {
    const choice = await vscode.window.showWarningMessage(
      `${relativeOutputPath} already exists.`,
      { modal: true },
      'Overwrite',
      'Merge (append missing steps as comments)',
    );
    if (!choice) {
      return;
    }
    if (choice === 'Merge (append missing steps as comments)') {
      const missing = findMissingSteps(existingContent, pipeline);
      if (missing.length === 0) {
        vscode.window.showInformationMessage('Nothing to merge — every detected step is already present.');
        return;
      }
      contentToWrite = appendMissingStepsComment(existingContent, missing);
    } else {
      contentToWrite = renderPipeline(provider, pipeline);
    }
  } else {
    contentToWrite = renderPipeline(provider, pipeline);
  }

  const previewDoc = await vscode.workspace.openTextDocument({ content: contentToWrite, language: 'yaml' });
  await vscode.window.showTextDocument(previewDoc, { preview: true });

  const confirm = await vscode.window.showInformationMessage(`Write this pipeline to ${relativeOutputPath}?`, { modal: true }, 'Write');
  if (confirm !== 'Write') {
    return;
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(outputUri, '..'));
  await vscode.workspace.fs.writeFile(outputUri, Buffer.from(contentToWrite, 'utf8'));

  const document = await vscode.workspace.openTextDocument(outputUri);
  await vscode.window.showTextDocument(document);

  await insertStatusBadge(rootUri, provider, pipeline.branch);

  const ecosystems = [...new Set(pipeline.specs.map((s) => s.ecosystem))].join(', ');
  vscode.window.showInformationMessage(`Generated a ${providerLabels[provider]} pipeline for your ${ecosystems} project.`);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ciPipelineGenerator.generate', (uri?: vscode.Uri) => generatePipeline(uri)),
  );
}

export function deactivate(): void {}
