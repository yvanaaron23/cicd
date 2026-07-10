import { CIStep, PipelineSpec, WorkspacePipeline } from '../detectors/types';

export type DroneDialect = 'drone' | 'woodpecker';

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

function commandFor(step: CIStep, subdirectory: string): string {
  return subdirectory ? `cd ${subdirectory} && ${step.run}` : step.run;
}

function stepsForSpec(spec: PipelineSpec): string[] {
  const prefix = spec.subdirectory ? `${spec.subdirectory.replace(/[^a-zA-Z0-9]/g, '_')}-` : '';
  const image = imageFor(spec);

  const named: { name: string; step: CIStep | undefined }[] = [
    { name: 'install', step: spec.installStep },
    { name: 'audit', step: spec.auditStep },
    { name: 'lint', step: spec.lintStep },
    { name: 'test', step: spec.testStep },
    { name: 'coverage', step: spec.coverageStep },
    { name: 'build', step: spec.buildStep },
    { name: 'deploy', step: spec.deployStep },
    { name: 'release', step: spec.releaseStep },
  ];

  return named
    .filter((n): n is { name: string; step: CIStep } => !!n.step)
    .map(
      ({ name, step }) =>
        `  - name: ${prefix}${name}\n    image: ${image}\n    commands:\n      - ${commandFor(step, spec.subdirectory)}`,
    );
}

/** Drone and Woodpecker share almost the same step-list format; Woodpecker just omits the kind/type header. */
export function renderDroneCi(pipeline: WorkspacePipeline, dialect: DroneDialect): string {
  const steps = pipeline.specs.flatMap(stepsForSpec);

  const notifyStep = pipeline.specs.map((s) => s.notifyStep).find((s): s is CIStep => !!s);
  if (notifyStep) {
    steps.push(
      `  - name: notify\n    image: alpine\n    commands:\n      - ${notifyStep.run}\n    when:\n      status:\n        - failure`,
    );
  }

  const header = dialect === 'drone' ? 'kind: pipeline\ntype: docker\nname: default\n\n' : '';

  return `${header}steps:\n${steps.join('\n')}\n`;
}
