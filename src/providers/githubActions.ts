import { CIStep, PipelineSpec, WorkspacePipeline } from '../detectors/types';

function versionValue(v: string): string {
  return v.startsWith('${{') ? v : `'${v}'`;
}

function setupStepLines(spec: PipelineSpec, versionRef: string): string[] {
  switch (spec.ecosystem) {
    case 'node': {
      const cache = spec.packageManager ?? 'npm';
      const lines: string[] = [];
      if (spec.packageManager === 'pnpm') {
        lines.push('- uses: pnpm/action-setup@v4', '  with:', '    version: latest');
      }
      lines.push('- uses: actions/setup-node@v4', '  with:', `    node-version: ${versionValue(versionRef)}`, `    cache: '${cache}'`);
      return lines;
    }
    case 'python': {
      const cache = spec.packageManager === 'poetry' ? 'poetry' : 'pip';
      return ['- uses: actions/setup-python@v5', '  with:', `    python-version: ${versionValue(versionRef)}`, `    cache: '${cache}'`];
    }
    case 'go':
      return ['- uses: actions/setup-go@v5', '  with:', `    go-version: ${versionValue(versionRef)}`, '    cache: true'];
    case 'rust':
      return [`- uses: dtolnay/rust-toolchain@${spec.runtimeVersion}`];
    case 'java-maven':
    case 'java-gradle':
      return [
        '- uses: actions/setup-java@v4',
        '  with:',
        `    java-version: '${spec.runtimeVersion}'`,
        '    distribution: temurin',
        `    cache: '${spec.ecosystem === 'java-maven' ? 'maven' : 'gradle'}'`,
      ];
    case 'php':
      return ['- uses: shivammathur/setup-php@v2', '  with:', `    php-version: '${spec.runtimeVersion}'`];
    case 'ruby':
      return ['- uses: ruby/setup-ruby@v1', '  with:', `    ruby-version: '${spec.runtimeVersion}'`, '    bundler-cache: true'];
    case 'dotnet':
      return ['- uses: actions/setup-dotnet@v4', '  with:', `    dotnet-version: '${spec.runtimeVersion}'`];
    case 'docker':
      return ['- uses: docker/setup-buildx-action@v3'];
  }
}

function commandStepLines(step: CIStep | undefined, subdirectory: string): string[] {
  if (!step) {
    return [];
  }
  const lines = [`- name: ${step.name}`, `  run: ${step.run}`];
  if (subdirectory) {
    lines.push(`  working-directory: ${subdirectory}`);
  }
  return lines;
}

function usesMatrix(spec: PipelineSpec, matrixVersions: string[] | undefined): boolean {
  return (matrixVersions?.length ?? 0) > 0 && (spec.ecosystem === 'node' || spec.ecosystem === 'python' || spec.ecosystem === 'go');
}

function jobNameFor(spec: PipelineSpec): string {
  return spec.subdirectory ? spec.subdirectory.replace(/[^a-zA-Z0-9]/g, '_') : 'build';
}

function jobFor(spec: PipelineSpec, matrixVersions: string[] | undefined): string {
  const matrixed = usesMatrix(spec, matrixVersions);
  const versionRef = matrixed ? '${{ matrix.version }}' : spec.runtimeVersion;

  const stepLines = [
    '- uses: actions/checkout@v4',
    ...setupStepLines(spec, versionRef),
    ...commandStepLines(spec.installStep, spec.subdirectory),
    ...commandStepLines(spec.lintStep, spec.subdirectory),
    ...commandStepLines(spec.testStep, spec.subdirectory),
    ...commandStepLines(spec.buildStep, spec.subdirectory),
    ...commandStepLines(spec.deployStep, spec.subdirectory),
    ...commandStepLines(spec.releaseStep, spec.subdirectory),
  ];

  const indentedSteps = stepLines.map((line) => `      ${line}`).join('\n');
  const strategyBlock = matrixed
    ? `    strategy:\n      matrix:\n        version: [${matrixVersions!.map((v) => `'${v}'`).join(', ')}]\n`
    : '';

  return `  ${jobNameFor(spec)}:\n    runs-on: ubuntu-latest\n${strategyBlock}    steps:\n${indentedSteps}`;
}

export function renderGitHubActionsWorkflow(pipeline: WorkspacePipeline): string {
  const jobsBlock = pipeline.specs.map((spec) => jobFor(spec, pipeline.matrixVersions)).join('\n\n');

  return `name: CI

on:
  push:
    branches: [${pipeline.branch}]
  pull_request:
    branches: [${pipeline.branch}]

jobs:
${jobsBlock}
`;
}
