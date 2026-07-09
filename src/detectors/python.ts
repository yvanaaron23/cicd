import { BaseSpec } from './types';

export interface PythonProjectFiles {
  requirementsTxtContent: string | null;
  pyprojectContent: string | null;
  pythonVersionFileContent: string | null;
}

function isPoetryProject(pyprojectContent: string | null): boolean {
  return !!pyprojectContent && /\[tool\.poetry\]/.test(pyprojectContent);
}

function extractPythonVersion(files: PythonProjectFiles): string {
  if (files.pythonVersionFileContent) {
    const trimmed = files.pythonVersionFileContent.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  if (files.pyprojectContent) {
    const match = files.pyprojectContent.match(/python\s*=\s*"[\^~]?(\d+\.\d+)/);
    if (match) {
      return match[1];
    }
  }
  return '3.12';
}

function detectTestCommand(files: PythonProjectFiles, isPoetry: boolean): string {
  const hasPytest =
    (files.pyprojectContent?.includes('pytest') ?? false) ||
    (files.requirementsTxtContent?.includes('pytest') ?? false);
  const base = hasPytest ? 'pytest' : 'python -m unittest discover';
  return isPoetry ? `poetry run ${base}` : base;
}

export function buildPythonSpec(files: PythonProjectFiles): BaseSpec | undefined {
  const isPoetry = isPoetryProject(files.pyprojectContent);
  if (!isPoetry && !files.requirementsTxtContent) {
    return undefined;
  }

  const runtimeVersion = extractPythonVersion(files);

  return {
    ecosystem: 'python',
    packageManager: isPoetry ? 'poetry' : 'pip',
    runtimeVersion,
    installStep: isPoetry
      ? { name: 'Install dependencies', run: 'pipx install poetry && poetry install' }
      : { name: 'Install dependencies', run: 'pip install -r requirements.txt' },
    testStep: { name: 'Test', run: detectTestCommand(files, isPoetry) },
  };
}
