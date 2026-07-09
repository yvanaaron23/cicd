import { CIStep, PipelineSpec } from '../detectors/types';

function setupStepLines(spec: PipelineSpec): string[] {
  switch (spec.ecosystem) {
    case 'node': {
      const cache = spec.packageManager ?? 'npm';
      const lines: string[] = [];
      if (spec.packageManager === 'pnpm') {
        lines.push('- uses: pnpm/action-setup@v4', '  with:', '    version: latest');
      }
      lines.push(
        '- uses: actions/setup-node@v4',
        '  with:',
        `    node-version: '${spec.runtimeVersion}'`,
        `    cache: '${cache}'`,
      );
      return lines;
    }
    case 'python': {
      const cache = spec.packageManager === 'poetry' ? 'poetry' : 'pip';
      return [
        '- uses: actions/setup-python@v5',
        '  with:',
        `    python-version: '${spec.runtimeVersion}'`,
        `    cache: '${cache}'`,
      ];
    }
    case 'go':
      return [
        '- uses: actions/setup-go@v5',
        '  with:',
        `    go-version: '${spec.runtimeVersion}'`,
        '    cache: true',
      ];
    case 'rust':
      return [`- uses: dtolnay/rust-toolchain@${spec.runtimeVersion}`];
  }
}

function commandStepLines(step: CIStep | undefined): string[] {
  if (!step) {
    return [];
  }
  return [`- name: ${step.name}`, `  run: ${step.run}`];
}

export function renderGitHubActionsWorkflow(spec: PipelineSpec): string {
  const stepLines = [
    '- uses: actions/checkout@v4',
    ...setupStepLines(spec),
    ...commandStepLines(spec.installStep),
    ...commandStepLines(spec.lintStep),
    ...commandStepLines(spec.testStep),
    ...commandStepLines(spec.buildStep),
  ];

  const indentedSteps = stepLines.map((line) => `      ${line}`).join('\n');

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
${indentedSteps}
`;
}
