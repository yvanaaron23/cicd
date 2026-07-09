# Change Log

All notable changes to the "ci-pipeline-generator" extension will be documented in this file.

## [0.0.1] - 2026-07-09

- Initial release
- Stack detection: Node (npm/yarn/pnpm), Python (pip/poetry), Go, Rust
- GitHub Actions and GitLab CI generation, with install/lint/test/build steps derived from the detected project
- Provider auto-detection from existing CI config or git remote, with a manual fallback prompt
- Overwrite confirmation when a pipeline file already exists
