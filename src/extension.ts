import * as vscode from 'vscode';
import { renderGitHubActionsWorkflow } from './providers/githubActions';
import { renderGitlabCi } from './providers/gitlabCi';
import { detectPipelineSpec } from './workspaceScanner';

type Provider = 'github' | 'gitlab';

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

async function detectProviderFromWorkspace(rootUri: vscode.Uri): Promise<Provider | undefined> {
  if (await exists(vscode.Uri.joinPath(rootUri, '.github', 'workflows'))) {
    return 'github';
  }
  if (await exists(vscode.Uri.joinPath(rootUri, '.gitlab-ci.yml'))) {
    return 'gitlab';
  }

  const gitConfig = await tryReadText(vscode.Uri.joinPath(rootUri, '.git', 'config'));
  if (gitConfig) {
    if (/gitlab\.com/.test(gitConfig)) {
      return 'gitlab';
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
    [
      { label: 'GitHub Actions', provider: 'github' as const },
      { label: 'GitLab CI', provider: 'gitlab' as const },
    ],
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
  return provider === 'github' ? ['.github', 'workflows', 'ci.yml'] : ['.gitlab-ci.yml'];
}

async function generatePipeline(clickedUri?: vscode.Uri): Promise<void> {
  const rootUri = await pickTargetFolder(clickedUri);
  if (!rootUri) {
    return;
  }

  const spec = await detectPipelineSpec(rootUri);
  if (!spec) {
    vscode.window.showErrorMessage(
      'Could not detect a recognized project (looked for package.json, pyproject.toml/requirements.txt, go.mod, or Cargo.toml).',
    );
    return;
  }

  const provider = await resolveProvider(rootUri);
  if (!provider) {
    return;
  }

  const outputUri = vscode.Uri.joinPath(rootUri, ...outputPathFor(provider));

  if (await exists(outputUri)) {
    const choice = await vscode.window.showWarningMessage(
      `${outputPathFor(provider).join('/')} already exists. Overwrite it?`,
      { modal: true },
      'Overwrite',
    );
    if (choice !== 'Overwrite') {
      return;
    }
  }

  const content = provider === 'github' ? renderGitHubActionsWorkflow(spec) : renderGitlabCi(spec);

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(outputUri, '..'));
  await vscode.workspace.fs.writeFile(outputUri, Buffer.from(content, 'utf8'));

  const document = await vscode.workspace.openTextDocument(outputUri);
  await vscode.window.showTextDocument(document);

  const providerLabel = provider === 'github' ? 'GitHub Actions' : 'GitLab CI';
  vscode.window.showInformationMessage(`Generated a ${providerLabel} pipeline for your ${spec.ecosystem} project.`);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ciPipelineGenerator.generate', (uri?: vscode.Uri) => generatePipeline(uri)),
  );
}

export function deactivate(): void {}
