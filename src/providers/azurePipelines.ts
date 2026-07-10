import { cacheConfigFor } from './cachePaths';
import { CIStep, PipelineSpec, WorkspacePipeline } from '../detectors/types';

function toolStepLines(spec: PipelineSpec): string[] {
  switch (spec.ecosystem) {
    case 'node':
      return ['- task: NodeTool@0', '  inputs:', `    versionSpec: '${spec.runtimeVersion}.x'`];
    case 'python':
      return ['- task: UsePythonVersion@0', '  inputs:', `    versionSpec: '${spec.runtimeVersion}'`];
    case 'go':
      return ['- task: GoTool@0', '  inputs:', `    version: '${spec.runtimeVersion}'`];
    case 'java-maven':
    case 'java-gradle':
      return ['- task: JavaToolInstaller@0', '  inputs:', `    versionSpec: '${spec.runtimeVersion}'`, '    jdkArchitectureOption: x64', '    jdkSourceOption: PreInstalled'];
    case 'dotnet':
      return ['- task: UseDotNet@2', '  inputs:', `    version: '${spec.runtimeVersion}.x'`];
    default:
      return [];
  }
}

function scriptStepLines(step: CIStep | undefined, subdirectory: string): string[] {
  if (!step) {
    return [];
  }
  const lines = [`- script: ${step.run}`, `  displayName: '${step.name}'`];
  if (subdirectory) {
    lines.push(`  workingDirectory: ${subdirectory}`);
  }
  if (step.condition === 'on_failure') {
    lines.push('  condition: failed()');
  }
  return lines;
}

function cacheStepLines(spec: PipelineSpec): string[] {
  const cache = cacheConfigFor(spec);
  if (!cache) {
    return [];
  }
  const keyFilesGlob = cache.keyFiles.join(', ');
  return [
    '- task: Cache@2',
    '  inputs:',
    `    key: '${spec.ecosystem} | "$(Agent.OS)" | ${keyFilesGlob}'`,
    `    path: ${cache.paths[0]}`,
  ];
}

export function renderAzurePipelines(pipeline: WorkspacePipeline): string {
  // Azure Pipelines here is single-job only — with a monorepo or a hybrid-stack root
  // (multiple ecosystems detected in the same directory), only the first spec is used.
  const spec = pipeline.specs[0];

  const stepLines = [
    ...toolStepLines(spec),
    ...cacheStepLines(spec),
    ...scriptStepLines(spec.installStep, spec.subdirectory),
    ...scriptStepLines(spec.auditStep, spec.subdirectory),
    ...scriptStepLines(spec.lintStep, spec.subdirectory),
    ...scriptStepLines(spec.testStep, spec.subdirectory),
    ...scriptStepLines(spec.coverageStep, spec.subdirectory),
    ...scriptStepLines(spec.buildStep, spec.subdirectory),
    ...scriptStepLines(spec.deployStep, spec.subdirectory),
    ...scriptStepLines(spec.releaseStep, spec.subdirectory),
    ...scriptStepLines(spec.notifyStep, spec.subdirectory),
  ];

  const indentedSteps = stepLines.map((line) => `  ${line}`).join('\n');

  return `trigger:
  - ${pipeline.branch}

pool:
  vmImage: 'ubuntu-latest'

steps:
${indentedSteps}
`;
}
