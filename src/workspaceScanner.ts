import * as vscode from 'vscode';
import { buildGoSpec } from './detectors/go';
import { buildNodeSpec } from './detectors/node';
import { buildPythonSpec } from './detectors/python';
import { buildRustSpec } from './detectors/rust';
import { PipelineSpec } from './detectors/types';

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

// Tries each ecosystem in turn (node, python, go, rust) and returns the first
// match. Monorepos with multiple ecosystems at the root aren't split apart —
// this generates a single pipeline for the first one found.
export async function detectPipelineSpec(rootUri: vscode.Uri): Promise<PipelineSpec | undefined> {
  const packageJsonContent = await tryReadText(vscode.Uri.joinPath(rootUri, 'package.json'));
  if (packageJsonContent) {
    const nodeSpec = buildNodeSpec({
      packageJsonContent,
      hasPackageLock: await exists(vscode.Uri.joinPath(rootUri, 'package-lock.json')),
      hasYarnLock: await exists(vscode.Uri.joinPath(rootUri, 'yarn.lock')),
      hasPnpmLock: await exists(vscode.Uri.joinPath(rootUri, 'pnpm-lock.yaml')),
      nvmrcContent: await tryReadText(vscode.Uri.joinPath(rootUri, '.nvmrc')),
    });
    if (nodeSpec) {
      return nodeSpec;
    }
  }

  const pyprojectContent = await tryReadText(vscode.Uri.joinPath(rootUri, 'pyproject.toml'));
  const requirementsTxtContent = await tryReadText(vscode.Uri.joinPath(rootUri, 'requirements.txt'));
  if (pyprojectContent || requirementsTxtContent) {
    const pythonSpec = buildPythonSpec({
      requirementsTxtContent,
      pyprojectContent,
      pythonVersionFileContent: await tryReadText(vscode.Uri.joinPath(rootUri, '.python-version')),
    });
    if (pythonSpec) {
      return pythonSpec;
    }
  }

  const goModContent = await tryReadText(vscode.Uri.joinPath(rootUri, 'go.mod'));
  if (goModContent) {
    const goSpec = buildGoSpec({ goModContent });
    if (goSpec) {
      return goSpec;
    }
  }

  const cargoTomlContent = await tryReadText(vscode.Uri.joinPath(rootUri, 'Cargo.toml'));
  if (cargoTomlContent) {
    const rustSpec = buildRustSpec({
      cargoTomlContent,
      rustToolchainContent: await tryReadText(vscode.Uri.joinPath(rootUri, 'rust-toolchain.toml')),
    });
    if (rustSpec) {
      return rustSpec;
    }
  }

  return undefined;
}
