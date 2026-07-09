import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

async function withStub<T>(
  obj: Record<string, unknown>,
  method: string,
  stub: T,
  fn: () => Promise<void>,
): Promise<void> {
  const original = obj[method];
  obj[method] = stub;
  try {
    await fn();
  } finally {
    obj[method] = original;
  }
}

function makeDir(tmpRoot: string, name: string): string {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function providerPickStub(preferredProvider: 'github' | 'gitlab') {
  return async (items: unknown) => {
    const resolvedItems = (Array.isArray(items) ? items : await items) as Array<Record<string, string>>;
    return resolvedItems.find((item) => item.provider === preferredProvider) ?? resolvedItems[0];
  };
}

suite('ciPipelineGenerator.generate integration', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-pipeline-generator-test-'));

  suiteTeardown(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (err) {
      console.warn(`Could not fully clean up ${tmpRoot}:`, err);
    }
  });

  test('generates a GitHub Actions workflow for an npm project', async () => {
    const projectDir = makeDir(tmpRoot, 'node-npm-project');
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ engines: { node: '>=20' }, scripts: { lint: 'eslint .', test: 'jest', build: 'tsc' } }),
    );
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), '{}');

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
    });

    const workflowPath = path.join(projectDir, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(workflowPath), 'workflow file should have been created');
    const content = fs.readFileSync(workflowPath, 'utf8');
    assert.match(content, /node-version: '20'/);
    assert.match(content, /cache: 'npm'/);
    assert.match(content, /run: npm ci/);
    assert.match(content, /run: npm run lint/);
    assert.match(content, /run: npm run test/);
    assert.match(content, /run: npm run build/);
  });

  test('generates a GitLab CI pipeline for a poetry project', async () => {
    const projectDir = makeDir(tmpRoot, 'python-poetry-project');
    fs.writeFileSync(
      path.join(projectDir, 'pyproject.toml'),
      '[tool.poetry]\nname = "x"\n\n[tool.poetry.dependencies]\npython = "^3.11"\npytest = "*"\n',
    );

    await withStub(vscode.window, 'showQuickPick', providerPickStub('gitlab'), async () => {
      await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
    });

    const pipelinePath = path.join(projectDir, '.gitlab-ci.yml');
    assert.ok(fs.existsSync(pipelinePath), 'pipeline file should have been created');
    const content = fs.readFileSync(pipelinePath, 'utf8');
    assert.match(content, /image: python:3\.11/);
    assert.match(content, /pip install poetry/);
    assert.match(content, /poetry install/);
    assert.match(content, /poetry run pytest/);
  });

  test('auto-detects GitHub when .github\\workflows already exists, without prompting', async () => {
    const projectDir = makeDir(tmpRoot, 'go-project-existing-github');
    fs.writeFileSync(path.join(projectDir, 'go.mod'), 'module example.com/foo\n\ngo 1.22\n');
    fs.mkdirSync(path.join(projectDir, '.github', 'workflows'), { recursive: true });

    let quickPickCalled = false;
    await withStub(
      vscode.window,
      'showQuickPick',
      async () => {
        quickPickCalled = true;
        return undefined;
      },
      async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      },
    );

    assert.strictEqual(quickPickCalled, false, 'should not have prompted for a provider');
    const workflowPath = path.join(projectDir, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(workflowPath));
    const content = fs.readFileSync(workflowPath, 'utf8');
    assert.match(content, /go-version: '1\.22'/);
    assert.match(content, /run: go build \.\/\.\.\./);
  });

  test('shows an error and writes nothing when no recognized project is found', async () => {
    const projectDir = makeDir(tmpRoot, 'empty-project');

    let errorMessage: string | undefined;
    await withStub(
      vscode.window,
      'showErrorMessage',
      async (message: string) => {
        errorMessage = message;
        return undefined;
      },
      async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      },
    );

    assert.ok(errorMessage?.includes('Could not detect'), 'should show a not-detected error');
    assert.deepStrictEqual(fs.readdirSync(projectDir), [], 'nothing should have been written');
  });

  test('asks before overwriting an existing pipeline file, and respects Cancel', async () => {
    const projectDir = makeDir(tmpRoot, 'overwrite-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    fs.mkdirSync(path.join(projectDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'existing content\n');

    await withStub(vscode.window, 'showWarningMessage', async () => undefined, async () => {
      await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.strictEqual(content, 'existing content\n', 'declining the overwrite prompt should leave the file untouched');
  });

  test('overwrites the pipeline file when the user confirms', async () => {
    const projectDir = makeDir(tmpRoot, 'overwrite-confirm-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    fs.mkdirSync(path.join(projectDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'existing content\n');

    await withStub(vscode.window, 'showWarningMessage', async () => 'Overwrite', async () => {
      await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /run: npm run test/);
  });
});
