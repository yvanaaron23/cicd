# Archemist CI/CD Pipeline Generator

Detects your project's stack and generates a tailored **GitHub Actions**, **GitLab CI**, **Azure Pipelines**, **CircleCI**, or **Bitbucket Pipelines** config — install, lint, test, build, deploy, and release steps wired up automatically, instead of hand-writing YAML from a blank file.

## Usage

- Right-click a project folder in the Explorer → **Generate CI/CD Pipeline**
- Or Command Palette (`Ctrl+Shift+P`) → **CI/CD Pipeline Generator: Generate CI/CD Pipeline**
- The generated pipeline opens as a preview before anything is written — confirm to save it to disk

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

Set `ciPipelineGenerator.matrixVersions` (e.g. `["18", "20", "22"]`) to run the whole pipeline across multiple runtime versions — supported for Node, Python, and Go.

## How provider detection works

Checks, in order: existing CI config for each provider, then the `origin` remote URL in `.git/config`. No match → you're prompted to pick one. Force it with `ciPipelineGenerator.provider`.

If the target pipeline file already exists, you're asked to **Overwrite** or **Merge** (append any detected steps that aren't already present in the file, as commented suggestions — your hand-edits are never touched).

### Status badge

After generating a GitHub Actions or GitLab CI pipeline, if a `README.md` and a parseable `github.com`/`gitlab.com` git remote are found, a status badge is inserted right after the first `# Title` heading (skipped if one is already there).

## Settings

| Setting | Default | Description |
|---|---|---|
| `ciPipelineGenerator.provider` | `auto` | `auto`, `github`, `gitlab`, `azure`, `circleci`, or `bitbucket` |
| `ciPipelineGenerator.matrixVersions` | `[]` | Runtime versions to build a matrix across (Node/Python/Go only); empty = no matrix |

## CLI

The same generation logic is available outside VS Code:

```
npx generate-pipeline [targetDir] [options]

  --provider=github|gitlab|azure|circleci|bitbucket  (default: github)
  --matrix=v1,v2,v3     Build matrix versions (Node/Python/Go only)
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
