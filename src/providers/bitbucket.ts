import { CIStep, PipelineSpec, WorkspacePipeline } from '../detectors/types';

function imageFor(spec: PipelineSpec): string {
  switch (spec.ecosystem) {
    case 'node':
      return `node:${spec.runtimeVersion}`;
    case 'python':
      return `python:${spec.runtimeVersion}`;
    case 'go':
      return `golang:${spec.runtimeVersion}`;
    case 'rust':
      return spec.runtimeVersion === 'stable' ? 'rust:latest' : `rust:${spec.runtimeVersion}`;
    case 'java-maven':
      return `maven:3-eclipse-temurin-${spec.runtimeVersion}`;
    case 'java-gradle':
      return `gradle:jdk${spec.runtimeVersion}`;
    case 'php':
      return `php:${spec.runtimeVersion}`;
    case 'ruby':
      return `ruby:${spec.runtimeVersion}`;
    case 'dotnet':
      return `mcr.microsoft.com/dotnet/sdk:${spec.runtimeVersion}`;
    case 'docker':
      return 'docker:latest';
  }
}

function scriptLine(step: CIStep | undefined, subdirectory: string): string[] {
  if (!step) {
    return [];
  }
  return [subdirectory ? `cd ${subdirectory} && ${step.run}` : step.run];
}

export function renderBitbucketPipelines(pipeline: WorkspacePipeline): string {
  const spec = pipeline.specs[0];

  const scriptLines = [
    ...scriptLine(spec.installStep, spec.subdirectory),
    ...scriptLine(spec.lintStep, spec.subdirectory),
    ...scriptLine(spec.testStep, spec.subdirectory),
    ...scriptLine(spec.buildStep, spec.subdirectory),
    ...scriptLine(spec.deployStep, spec.subdirectory),
    ...scriptLine(spec.releaseStep, spec.subdirectory),
  ];

  const indentedScript = scriptLines.map((line) => `          - ${line}`).join('\n');

  return `image: ${imageFor(spec)}

pipelines:
  default:
    - step:
        name: Build and Test
        script:
${indentedScript}
`;
}
