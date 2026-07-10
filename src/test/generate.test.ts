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

  test('adds a security audit step for a node project', async () => {
    const projectDir = makeDir(tmpRoot, 'audit-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /run: npm audit --audit-level=high/);
  });

  test('adds an explicit cache step for ecosystems without built-in setup-action caching (PHP on GitHub Actions)', async () => {
    const projectDir = makeDir(tmpRoot, 'php-cache-project');
    fs.writeFileSync(
      path.join(projectDir, 'composer.json'),
      JSON.stringify({ require: { php: '^8.2' }, scripts: { test: 'phpunit' } }),
    );

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /actions\/cache@v4/);
    assert.match(content, /run: composer audit/);
  });

  test('adds a cache block on GitLab CI for every ecosystem', async () => {
    const projectDir = makeDir(tmpRoot, 'gitlab-cache-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('gitlab'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.gitlab-ci.yml'), 'utf8');
    assert.match(content, /cache:\s*\n\s*key:\s*\n\s*files:\s*\n\s*- package-lock\.json/);
  });

  test('adds a coverage upload step when a coverage tool is detected', async () => {
    const projectDir = makeDir(tmpRoot, 'coverage-project');
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }),
    );

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /codecov\.io\/bash/);
  });

  test('does not add a coverage step when no coverage tool is detected', async () => {
    const projectDir = makeDir(tmpRoot, 'no-coverage-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.ok(!content.includes('codecov'), 'no coverage tool was detected, so no upload step should be added');
  });

  test('generates an OS matrix when ciPipelineGenerator.matrixOS is set (GitHub Actions only)', async function () {
    this.timeout(10000);
    const projectDir = makeDir(tmpRoot, 'os-matrix-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    const config = vscode.workspace.getConfiguration('ciPipelineGenerator');
    await config.update('matrixOS', ['ubuntu-latest', 'windows-latest'], vscode.ConfigurationTarget.Global);
    try {
      await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
        await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
          await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
        });
      });
    } finally {
      await config.update('matrixOS', undefined, vscode.ConfigurationTarget.Global);
    }

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /os: \['ubuntu-latest', 'windows-latest'\]/);
    assert.match(content, /runs-on: \$\{\{ matrix\.os \}\}/);
  });

  test('adds a failure notification step when ciPipelineGenerator.notifications is set', async function () {
    this.timeout(10000);
    const projectDir = makeDir(tmpRoot, 'notify-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    const config = vscode.workspace.getConfiguration('ciPipelineGenerator');
    await config.update('notifications', 'slack', vscode.ConfigurationTarget.Global);
    try {
      await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
        await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
          await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
        });
      });
    } finally {
      await config.update('notifications', undefined, vscode.ConfigurationTarget.Global);
    }

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /SLACK_WEBHOOK_URL/);
    assert.match(content, /if: failure\(\)/);
  });

  test('inserts a required-secrets comment block when .env.example is present', async () => {
    const projectDir = makeDir(tmpRoot, 'secrets-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    fs.writeFileSync(path.join(projectDir, '.env.example'), 'API_KEY=\n# a comment\nDB_URL=postgres://\n');

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /Required secrets/);
    assert.match(content, /# - API_KEY/);
    assert.match(content, /# - DB_URL/);
  });

  test('generates a Jenkinsfile when that provider is picked', async () => {
    const projectDir = makeDir(tmpRoot, 'jenkins-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('jenkins'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const jenkinsfilePath = path.join(projectDir, 'Jenkinsfile');
    assert.ok(fs.existsSync(jenkinsfilePath));
    assert.match(fs.readFileSync(jenkinsfilePath, 'utf8'), /stage\('Test'\)/);
  });

  test('uses Groovy-style // comments for the secrets header in a Jenkinsfile, not YAML #', async () => {
    const projectDir = makeDir(tmpRoot, 'jenkins-secrets-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    fs.writeFileSync(path.join(projectDir, '.env.example'), 'API_KEY=\n');

    await withStub(vscode.window, 'showQuickPick', providerPickStub('jenkins'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, 'Jenkinsfile'), 'utf8');
    assert.match(content, /^\/\/ Required secrets/m);
    assert.match(content, /^\/\/ - API_KEY/m);
    assert.ok(!content.includes('# Required secrets'), 'Jenkinsfiles are Groovy — # is not a valid comment there');
  });

  test('generates a Drone CI config when that provider is picked', async () => {
    const projectDir = makeDir(tmpRoot, 'drone-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('drone'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const dronePath = path.join(projectDir, '.drone.yml');
    assert.ok(fs.existsSync(dronePath));
    assert.match(fs.readFileSync(dronePath, 'utf8'), /kind: pipeline/);
  });

  test('generates a Woodpecker CI config when that provider is picked', async () => {
    const projectDir = makeDir(tmpRoot, 'woodpecker-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('woodpecker'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const woodpeckerPath = path.join(projectDir, '.woodpecker.yml');
    assert.ok(fs.existsSync(woodpeckerPath));
    const content = fs.readFileSync(woodpeckerPath, 'utf8');
    assert.match(content, /steps:/);
    assert.ok(!content.includes('kind: pipeline'), 'woodpecker output should omit the drone-specific kind/type header');
  });

  test('sync command appends newly-detected steps without prompting Overwrite/Merge', async () => {
    const projectDir = makeDir(tmpRoot, 'sync-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    fs.mkdirSync(path.join(projectDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.github', 'workflows', 'ci.yml'),
      'name: CI\njobs:\n  build:\n    steps:\n      - run: npm run test\n',
    );
    // Simulate a lint script added after the pipeline was first generated.
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest', lint: 'eslint .' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', async (message: string) => (message.includes('newly-detected') ? 'Append' : undefined), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.sync', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /# {3}run: npm run lint/, 'the newly-detected lint step should be suggested as a comment');
  });

  test('sync command reports up to date when nothing new is detected', async () => {
    const projectDir = makeDir(tmpRoot, 'sync-uptodate-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    let lastMessage: string | undefined;
    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(
        vscode.window,
        'showInformationMessage',
        async (message: string) => {
          lastMessage = message;
          return undefined;
        },
        async () => {
          await vscode.commands.executeCommand('ciPipelineGenerator.sync', vscode.Uri.file(projectDir));
        },
      );
    });

    assert.ok(lastMessage?.includes('already up to date'));
  });

  test('sync command tells the user to generate first when no pipeline file exists yet', async () => {
    const projectDir = makeDir(tmpRoot, 'sync-missing-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    let lastMessage: string | undefined;
    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(
        vscode.window,
        'showInformationMessage',
        async (message: string) => {
          lastMessage = message;
          return undefined;
        },
        async () => {
          await vscode.commands.executeCommand('ciPipelineGenerator.sync', vscode.Uri.file(projectDir));
        },
      );
    });

    assert.ok(lastMessage?.includes("doesn't exist yet"));
    assert.ok(!fs.existsSync(path.join(projectDir, '.github')));
  });

  test('detects multiple ecosystems at the same root and generates one job per ecosystem (hybrid stack)', async () => {
    // e.g. a Laravel app: package.json for the Vite frontend (no test/lint script),
    // composer.json for the PHP backend (a real phpunit test script) — both at the root,
    // not a monorepo. Previously only the first-detected ecosystem (node) got a job,
    // silently dropping the PHP tests.
    const projectDir = makeDir(tmpRoot, 'hybrid-laravel-vite-project');
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ private: true, scripts: { build: 'vite build', dev: 'vite' } }),
    );
    fs.writeFileSync(
      path.join(projectDir, 'composer.json'),
      JSON.stringify({ require: { php: '^8.3' }, scripts: { test: 'phpunit' } }),
    );

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /^ {2}node:/m, 'should have a distinct node job');
    assert.match(content, /^ {2}php:/m, 'should have a distinct php job');
    assert.match(content, /run: npm run build/);
    assert.match(content, /run: composer run test/);
  });

  test('hybrid stack also disambiguates GitLab CI job names by ecosystem', async () => {
    const projectDir = makeDir(tmpRoot, 'hybrid-laravel-vite-gitlab-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ private: true, scripts: { build: 'vite build' } }));
    fs.writeFileSync(
      path.join(projectDir, 'composer.json'),
      JSON.stringify({ require: { php: '^8.3' }, scripts: { test: 'phpunit' } }),
    );

    await withStub(vscode.window, 'showQuickPick', providerPickStub('gitlab'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.gitlab-ci.yml'), 'utf8');
    assert.match(content, /^node_build:/m);
    assert.match(content, /^php_test:/m);
  });

  test('a lone ecosystem at the root still gets the plain "build" job name (no regression)', async () => {
    const projectDir = makeDir(tmpRoot, 'single-ecosystem-project');
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));

    await withStub(vscode.window, 'showQuickPick', providerPickStub('github'), async () => {
      await withStub(vscode.window, 'showInformationMessage', confirmWriteStub(), async () => {
        await vscode.commands.executeCommand('ciPipelineGenerator.generate', vscode.Uri.file(projectDir));
      });
    });

    const content = fs.readFileSync(path.join(projectDir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(content, /^ {2}build:/m);
  });
});
