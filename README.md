# Archemist CI/CD Pipeline Generator

Detects your project's stack and generates a tailored **GitHub Actions**, **GitLab CI**, **Azure Pipelines**, **CircleCI**, **Bitbucket Pipelines**, **Jenkins**, **Drone CI**, or **Woodpecker CI** config — install, audit, lint, test, coverage, build, deploy, release, cache, and notification steps wired up automatically, instead of hand-writing YAML from a blank file.

## Usage

- Right-click a project folder in the Explorer → **Generate CI/CD Pipeline**
- Or Command Palette (`Ctrl+Shift+P`) → **CI/CD Pipeline Generator: Generate CI/CD Pipeline**
- The generated pipeline opens as a preview before anything is written — confirm to save it to disk
- Already have a pipeline and just added a script or a dependency? Right-click the folder → **Sync CI/CD Pipeline** to append any newly-detected steps as suggestions, without going through the Overwrite/Merge prompt

## How stack detection works

Looks at the target folder (and, for monorepos, each package under `packages/*`/`apps/*`) for, in this order:

| Files found | Ecosystem | Package manager |
|---|---|---|
| `package.json` | Node.js | `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm |
| `pyproject.toml` with `[tool.poetry]`, or `requirements.txt` | Python | poetry or pip |
| `go.mod` | Go | — |
| `Cargo.toml` | Rust | — |
| `pom.xml` | Java (Maven) | — |
| `build.gradle` / `build.gradle.kts` | Java (Gradle) | — |
| `composer.json` | PHP | — |
| `Gemfile` | Ruby | — |
| `*.csproj` / `*.sln` | .NET | — |
| `Dockerfile` (only, no other manifest) | Docker | — |

For Node/PHP, the `lint`/`test`/`build` scripts (if present in the manifest) become pipeline steps — nothing is guessed for scripts you don't have. Runtime versions come from `.nvmrc`/`engines.node`, `.python-version`/`pyproject.toml`, the `go` directive, `rust-toolchain.toml`, `sourceCompatibility`, `<TargetFramework>`, etc., falling back to a sane default when none is specified.

### Monorepos

If `turbo.json`, `nx.json`, `lerna.json`, `pnpm-workspace.yaml`, or a `workspaces` field in `package.json` is found, each package under `packages/*` and `apps/*` gets detected independently and becomes its own job in the generated pipeline.

### Deploy & release steps

Independently of the ecosystem: a `vercel.json` or `netlify.toml` adds a deploy step; a lone `Dockerfile` alongside another ecosystem adds a build-and-push step; a `.changeset` folder or semantic-release config/dependency adds a release step.

### Build matrix

Set `ciPipelineGenerator.matrixVersions` (e.g. `["18", "20", "22"]`) to run the whole pipeline across multiple runtime versions — supported for Node, Python, and Go. Set `ciPipelineGenerator.matrixOS` (e.g. `["ubuntu-latest", "windows-latest", "macos-latest"]`) to also build across OSes — GitHub Actions only, since it's the only provider with a clean hosted-runner equivalent for all three.

### Dependency caching

Every provider gets a cache step keyed on the relevant lockfile (`package-lock.json`, `poetry.lock`, `go.sum`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`, `pom.xml`, `build.gradle`, or `*.csproj`). GitHub Actions already caches Node/Python/Go/Java/Ruby through their `setup-*` actions, so an explicit cache step is only added there for PHP, Rust, and .NET.

### Security audit

A zero-config audit command (`npm audit`, `pip-audit`, `cargo audit`, `composer audit`, `bundler-audit`) is added right after install, for ecosystems where one exists. No audit step is added for Java, .NET, Go, or Docker — there's no equivalent zero-config command to reach for.

### Coverage upload

If a coverage tool is detected (jest/vitest/nyc/c8 for Node, pytest-cov/coverage for Python), a coverage-upload step (Codecov's universal bash uploader) is added after the test step.

### Failure notifications

Set `ciPipelineGenerator.notifications` to `slack` or `discord` to add a step that posts to `$SLACK_WEBHOOK_URL`/`$DISCORD_WEBHOOK_URL` when the pipeline fails, rendered using each provider's native failure condition (`if: failure()`, `when: on_failure`, `condition: failed()`, `when: on_fail`, or — for Bitbucket, which has no native per-step condition — an `after-script` guarded by `$BITBUCKET_EXIT_CODE`).

### Secrets scaffolding

If a `.env.example` file exists at the project root, its keys are turned into a "required secrets" comment block at the top of the generated pipeline, as a checklist of what to configure in your CI provider's settings.

## How provider detection works

Checks, in order: existing CI config for each provider, then the `origin` remote URL in `.git/config`. No match → you're prompted to pick one. Force it with `ciPipelineGenerator.provider`.

If the target pipeline file already exists, you're asked to **Overwrite** or **Merge** (append any detected steps that aren't already present in the file, as commented suggestions — your hand-edits are never touched). Use the separate **Sync CI/CD Pipeline** command to do the same append-only check without the Overwrite/Merge prompt.

### Status badge

After generating a GitHub Actions or GitLab CI pipeline, if a `README.md` and a parseable `github.com`/`gitlab.com` git remote are found, a status badge is inserted right after the first `# Title` heading (skipped if one is already there).

## Settings

| Setting | Default | Description |
|---|---|---|
| `ciPipelineGenerator.provider` | `auto` | `auto`, `github`, `gitlab`, `azure`, `circleci`, `bitbucket`, `jenkins`, `drone`, or `woodpecker` |
| `ciPipelineGenerator.matrixVersions` | `[]` | Runtime versions to build a matrix across (Node/Python/Go only); empty = no matrix |
| `ciPipelineGenerator.matrixOS` | `[]` | OSes to build a matrix across (GitHub Actions only); empty = no OS matrix |
| `ciPipelineGenerator.notifications` | `none` | `none`, `slack`, or `discord` — adds a failure-notification step |

## CLI

The same generation logic is available outside VS Code:

```
npx generate-pipeline [targetDir] [options]

  --provider=github|gitlab|azure|circleci|bitbucket|jenkins|drone|woodpecker  (default: github)
  --matrix=v1,v2,v3     Build matrix versions (Node/Python/Go only)
  --matrix-os=os1,os2   Build matrix OSes (GitHub Actions only)
  --notify=slack|discord  Add a failure-notification step
  --dry-run             Print the generated pipeline instead of writing it
  --force               Overwrite an existing pipeline file without asking
```

## Development

```
npm install
npm run watch
```

Press `F5` in VS Code (with this folder open as the workspace root) to launch an Extension Development Host with the extension loaded.

## Testing

```
npm test
```

Runs real integration tests in an actual VS Code instance (`@vscode/test-electron`) — the command is executed end-to-end and the generated YAML is asserted on disk, not mocked.

## Packaging & Publishing

```
npm run compile
npx vsce package
npx vsce publish
npx ovsx publish -p <open-vsx-token>
```
