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

function providerPickStub(preferredProvider: string) {
  return async (items: unknown) => {
    const resolvedItems = (Array.isArray(items) ? items : await items) as Array<Record<string, string>>;
    return resolvedItems.find((item) => item.provider === preferredProvider) ?? resolvedItems[0];
  };
}

// The "Write this pipeline to X?" confirm and the final success notification both
// go through showInformationMessage — route only the confirm one, ignore the rest.
function confirmWriteStub(confirm = true) {
  return async (message: string) => {
    if (message.startsWith('Write this pipeline')) {
      return confirm ? 'Write' : undefined;
    }
    return undefined;
  };
}

suite('ciPipelineGenerator.generate integration', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-pipeline-generator-test-'));

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

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
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const workflowPath = path.join(projectDir, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(workflowPath), 'workflow file should have been created');
    const content = fs.readFileSync(workflowPath, 'utf8');
    assert.match(content, /node-version: '20'/);
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
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const pipelinePath = path.join(projectDir, '.gitlab-ci.yml');
    assert.ok(fs.existsSync(pipelinePath));
    const content = fs.readFileSync(pipelinePath, 'utf8');
    assert.match(content, /image: python:3\.11/);
    assert.match(content, /poetry install/);
    assert.match(content, /poetry run pytest/);
  });

  test('auto-detects GitHub when .github/workflows already exists, without prompting', async () => {
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
        await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
          await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
        });
      },
    );

    assert.strictEqual(quickPickCalled, false, 'should not have prompted for a provider');
    const workflowPath = path.join(projectDir, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(workflowPath));
    assert.match(fs.readFileSync(workflowPath, 'utf8'), /go-version: '1\.22'/);
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

    assert.ok(errorMessage?.includes('Could not detect'));
    assert.deepStrictEqual(fs.readdirSync(projectDir), []);
  });

  test('declining the write confirmation leaves nothing on disk', async () => {
    const projectDir = makeDir(tmpRoot, 'decline-confirm-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(false), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    assert.ok(!fs.existsSync(path.join(projectDir, '.github')), 'declining the preview confirm should write nothing');
  });

  test('asks before overwriting, and respects Cancel', async () => {
    const projectDir = makeDir(tmpRoot, 'overwrite-cancel-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    fs.mkdirSync(path.join(projectDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'existing content\n');

    await withStub(vscode.window, 'showWarningMessage', async () => undefined, async () => {
      await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
    });

    assert.strictEqual(
      fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8'),
      'existing content\n',
    );
  });

  test('overwrites the pipeline file when the user confirms both prompts', async () => {
    const projectDir = makeDir(tmpRoot, 'overwrite-confirm-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    fs.mkdirSync(path.join(projectDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'existing content\n');

    await withStub(vscode.window, 'showWarningMessage', async () => 'Overwrite', async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    assert.match(fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8'), /run: npm run test/);
  });

  test('merge mode appends only the missing steps as comments', async () => {
    const projectDir = makeDir(tmpRoot, 'merge-project');
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest', build: 'tsc' } }),
    );
    fs.mkdirSync(path.join(projectDir, '.github', 'workflows'), { recursive: true });
    // Hand-edited file that already has the test step, but not the build step.
    fs.writeFileSync(
      path.join(projectDir, '.github', 'workflows', 'ci.yml'),
      'name: CI\njobs:\n  build:\n    steps:\n      - run: npm run test\n      - run: echo "custom step, keep me"\n',
    );

    await withStub(vscode.window, 'showWarningMessage', async () => 'Merge (append missing steps as comments)', async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /echo "custom step, keep me"/, 'the hand-written step should be preserved');
    assert.match(content, /# {3}run: npm run build/, 'the missing build step should be suggested as a comment');
    assert.ok(!content.includes('- run: npm run test\n      - run: npm run test'), 'the already-present test step should not be duplicated');
  });

  test('generates one job per package in a monorepo', async () => {
    const projectDir = makeDir(tmpRoot, 'monorepo-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    fs.mkdirSync(path.join(projectDir, 'packages', 'web'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'packages', 'web', 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
    fs.mkdirSync(path.join(projectDir, 'packages', 'api'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'packages', 'api', 'go.mod'), 'module example.com/api\n\ngo 1.21\n');

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /packages_web:/);
    assert.match(content, /packages_api:/);
    assert.match(content, /working-directory: packages\/web/);
    assert.match(content, /working-directory: packages\/api/);
  });

  test('generates a build matrix when ciPipelineGenerator.matrixVersions is set', async function () {
    this.timeout(10000); // updating a global setting is slower than the default 2s mocha timeout
    const projectDir = makeDir(tmpRoot, 'matrix-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    const config = vscode.workspace.getConfiguration('ciPipelineGenerator');
    await config.update('matrixVersions', ['18', '20', '22'], vscode.ConfigurationTarget.Global);
    try {
      await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
        await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
          await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
        });
      });
    } finally {
      await config.update('matrixVersions', undefined, vscode.ConfigurationTarget.Global);
    }

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /matrix:\s*\n\s*version: \['18', '20', '22'\]/);
    assert.match(content, /node-version: \$\{\{ matrix\.version \}\}/);
  });

  test('inserts a status badge into README.md when the git remote is parseable', async () => {
    const projectDir = makeDir(tmpRoot, 'badge-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    fs.writeFileSync(path.join(projectDir, 'README.md'), '# My Project\n\nSome description.\n');
    fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/widgets.git\n');

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const readme = fs.readFileSync(path.join(projectDir, 'README.md'), 'utf8');
    assert.match(readme, /\[!\[CI\]\(https:\/\/github\.com\/acme\/widgets\/actions\/workflows\/ci\.yml\/badge\.svg/);
  });

  test('generates a CircleCI config when that provider is picked', async () => {
    const projectDir = makeDir(tmpRoot, 'circleci-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('circleci'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const configPath = path.join(projectDir, '.circleci', 'config.yml');
    assert.ok(fs.existsSync(configPath));
    assert.match(fs.readFileSync(configPath, 'utf8'), /image: cimg\/node:20\.0/);
  });
});
