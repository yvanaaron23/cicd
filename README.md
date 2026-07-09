# Archemist CI/CD Pipeline Generator

Detects your project's stack and generates a tailored **GitHub Actions** or **GitLab CI** pipeline — install, lint, test, and build steps wired up automatically, instead of hand-writing YAML from a blank file.

## Usage

- Right-click a project folder in the Explorer → **Generate CI/CD Pipeline**
- Or Command Palette (`Ctrl+Shift+P`) → **CI/CD Pipeline Generator: Generate CI/CD Pipeline**

## How stack detection works

Looks at the target folder for, in this order:

| Files found | Ecosystem | Package manager |
|---|---|---|
| `package.json` | Node.js | `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm |
| `pyproject.toml` with `[tool.poetry]`, or `requirements.txt` | Python | poetry or pip |
| `go.mod` | Go | — |
| `Cargo.toml` | Rust | — |

For Node, the `lint`/`test`/`build` npm scripts (if present in `package.json`) become pipeline steps — nothing is guessed for scripts you don't have. The runtime version comes from `.nvmrc`/`engines.node` (Node), `.python-version`/`pyproject.toml` (Python), the `go` directive in `go.mod`, or `rust-toolchain.toml` (Rust), falling back to a sane default when none is specified.

## How provider detection works

Checks, in order: an existing `.github/workflows` folder, an existing `.gitlab-ci.yml`, then the `origin` remote URL in `.git/config`. No match → you're prompted to pick one. Force it with `ciPipelineGenerator.provider`.

If the target pipeline file already exists, you're asked before it's overwritten.

## Settings

| Setting | Default | Description |
|---|---|---|
| `ciPipelineGenerator.provider` | `auto` | `auto`, `github`, or `gitlab` |

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
