import { CIStep, PipelineSpec, WorkspacePipeline } from '../detectors/types';

function imageFor(spec: PipelineSpec): string {
  switch (spec.ecosystem) {
    case 'node':
      return `cimg/node:${spec.runtimeVersion}.0`;
    case 'python':
      return `cimg/python:${spec.runtimeVersion}`;
    case 'go':
      return `cimg/go:${spec.runtimeVersion}`;
    case 'rust':
      return 'cimg/rust:1.75';
    case 'java-maven':
    case 'java-gradle':
      return `cimg/openjdk:${spec.runtimeVersion}.0`;
    case 'php':
      return `cimg/php:${spec.runtimeVersion}`;
    case 'ruby':
      return `cimg/ruby:${spec.runtimeVersion}`;
    case 'dotnet':
      return `mcr.microsoft.com/dotnet/sdk:${spec.runtimeVersion}`;
    case 'docker':
      return 'cimg/base:current';
  }
}

function runStepLines(step: CIStep | undefined, subdirectory: string): string[] {
  if (!step) {
    return [];
  }
  const command = subdirectory ? `cd ${subdirectory} && ${step.run}` : step.run;
  return ['- run:', `    name: ${step.name}`, `    command: ${command}`];
}

export function renderCircleCi(pipeline: WorkspacePipeline): string {
  const spec = pipeline.specs[0];

  const stepLines = [
    '- checkout',
    ...runStepLines(spec.installStep, spec.subdirectory),
    ...runStepLines(spec.lintStep, spec.subdirectory),
    ...runStepLines(spec.testStep, spec.subdirectory),
    ...runStepLines(spec.buildStep, spec.subdirectory),
    ...runStepLines(spec.deployStep, spec.subdirectory),
    ...runStepLines(spec.releaseStep, spec.subdirectory),
  ];

  const indentedSteps = stepLines.map((line) => `      ${line}`).join('\n');

  return `version: 2.1

jobs:
  build:
    docker:
      - image: ${imageFor(spec)}
    steps:
${indentedSteps}

workflows:
  build-and-test:
    jobs:
      - build
`;
}
