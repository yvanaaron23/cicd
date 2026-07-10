import { cacheConfigFor } from './cachePaths';
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
  const lines = ['- run:', `    name: ${step.name}`, `    command: ${command}`];
  if (step.condition === 'on_failure') {
    lines.push('    when: on_fail');
  }
  return lines;
}

function restoreCacheLines(spec: PipelineSpec): string[] {
  const cache = cacheConfigFor(spec);
  if (!cache) {
    return [];
  }
  return ['- restore_cache:', `    key: ${spec.ecosystem}-cache-{{ checksum "${cache.keyFiles[0]}" }}`];
}

function saveCacheLines(spec: PipelineSpec): string[] {
  const cache = cacheConfigFor(spec);
  if (!cache) {
    return [];
  }
  return [
    '- save_cache:',
    `    key: ${spec.ecosystem}-cache-{{ checksum "${cache.keyFiles[0]}" }}`,
    '    paths:',
    ...cache.paths.map((p) => `      - ${p}`),
  ];
}

export function renderCircleCi(pipeline: WorkspacePipeline): string {
  const spec = pipeline.specs[0];

  const stepLines = [
    '- checkout',
    ...restoreCacheLines(spec),
    ...runStepLines(spec.installStep, spec.subdirectory),
    ...saveCacheLines(spec),
    ...runStepLines(spec.auditStep, spec.subdirectory),
    ...runStepLines(spec.lintStep, spec.subdirectory),
    ...runStepLines(spec.testStep, spec.subdirectory),
    ...runStepLines(spec.coverageStep, spec.subdirectory),
    ...runStepLines(spec.buildStep, spec.subdirectory),
    ...runStepLines(spec.deployStep, spec.subdirectory),
    ...runStepLines(spec.releaseStep, spec.subdirectory),
    ...runStepLines(spec.notifyStep, spec.subdirectory),
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
