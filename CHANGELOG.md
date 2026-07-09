# Change Log

All notable changes to the "ci-pipeline-generator" extension will be documented in this file.

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
