import { PipelineSpec } from '../detectors/types';

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
  }
}

interface Job {
  name: string;
  stage: string;
  script: string[];
}

export function renderGitlabCi(spec: PipelineSpec): string {
  const installScript = spec.packageManager === 'poetry' ? ['pip install poetry', spec.installStep.run] : [spec.installStep.run];

  const stages: string[] = ['install'];
  const jobs: Job[] = [{ name: 'install', stage: 'install', script: installScript }];

  if (spec.lintStep) {
    stages.push('lint');
    jobs.push({ name: 'lint', stage: 'lint', script: [spec.lintStep.run] });
  }
  if (spec.testStep) {
    stages.push('test');
    jobs.push({ name: 'test', stage: 'test', script: [spec.testStep.run] });
  }
  if (spec.buildStep) {
    stages.push('build');
    jobs.push({ name: 'build', stage: 'build', script: [spec.buildStep.run] });
  }

  const stagesBlock = stages.map((s) => `  - ${s}`).join('\n');
  const jobsBlock = jobs
    .map((job) => {
      const scriptLines = job.script.map((s) => `    - ${s}`).join('\n');
      return `${job.name}:\n  stage: ${job.stage}\n  script:\n${scriptLines}`;
    })
    .join('\n\n');

  return `image: ${imageFor(spec)}

stages:
${stagesBlock}

${jobsBlock}
`;
}
