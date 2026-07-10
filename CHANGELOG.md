# Change Log

All notable changes to the "ci-pipeline-generator" extension will be documented in this file.

## [0.0.2] - 2026-07-10

- Dependency caching: GitHub Actions gains explicit cache steps for PHP/Rust/.NET (Node/Python/Go/Java/Ruby already cached via their setup actions), and GitLab CI, Azure Pipelines, CircleCI, and Bitbucket Pipelines gain cache configs for every ecosystem
- Security audit step (`npm audit`/`pip-audit`/`cargo audit`/`composer audit`/`bundler-audit`) added automatically where a safe zero-config command exists
- Build matrix across OSes (`ciPipelineGenerator.matrixOS`) — GitHub Actions only, combinable with the existing runtime-version matrix
- Failure-notification step (`ciPipelineGenerator.notifications`: `slack`/`discord`) rendered as each provider's native "on failure" condition
- Coverage upload step (codecov) added when a coverage tool (jest/vitest/nyc/c8, pytest-cov/coverage) is detected
- New **Sync CI/CD Pipeline** command: re-scans a folder that already has a pipeline and appends newly-detected steps without the Overwrite/Merge prompt
- Three new providers: Jenkins (Jenkinsfile), Drone CI, and Woodpecker CI
- Secrets scaffolding: a `.env.example` at the project root is turned into a "required secrets" comment block at the top of the generated pipeline
- CLI parity: `--matrix-os`, `--notify`, and the three new providers are all available via `npx generate-pipeline`

## [0.0.1] - 2026-07-10

- Initial release
- Stack detection: Node (npm/yarn/pnpm), Python (pip/poetry), Go, Rust, Java (Maven/Gradle), PHP, Ruby, .NET, Docker
- GitHub Actions, GitLab CI, Azure Pipelines, CircleCI, and Bitbucket Pipelines generation, with install/lint/test/build steps derived from the detected project
- Provider auto-detection from existing CI config or git remote, with a manual fallback prompt
- Monorepo support: one job per package under `packages/*`/`apps/*` when a workspaces config is detected
- Deploy step detection (Vercel/Netlify/Docker) and release step detection (Changesets/semantic-release)
- Build matrix support across runtime versions (Node/Python/Go)
- Preview of the generated pipeline before it's written to disk
- Merge mode: append missing detected steps as comments instead of overwriting a hand-edited file
- Status badge auto-inserted into README.md (GitHub/GitLab)
- Standalone CLI (`npx generate-pipeline`) reusing the same generation core
