import { cacheConfigFor } from './cachePaths';
import { CIStep, PipelineSpec, WorkspacePipeline } from '../detectors/types';

function usesMatrix(spec: PipelineSpec, matrixVersions: string[] | undefined): boolean {
  return (matrixVersions?.length ?? 0) > 0 && (spec.ecosystem === 'node' || spec.ecosystem === 'python' || spec.ecosystem === 'go');
}

function imageFor(spec: PipelineSpec, matrixed: boolean): string {
  const versionRef = matrixed ? '$VERSION' : spec.runtimeVersion;
  switch (spec.ecosystem) {
    case 'node':
      return `node:${versionRef}`;
    case 'python':
      return `python:${versionRef}`;
    case 'go':
      return `golang:${versionRef}`;
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

interface Job {
  name: string;
  stage: string;
  script: string[];
  matrixed: boolean;
  onFailure: boolean;
  cache?: { paths: string[]; keyFiles: string[] };
}

function scriptLine(run: string, subdirectory: string): string {
  return subdirectory ? `cd ${subdirectory} && ${run}` : run;
}

function jobsForSpec(spec: PipelineSpec, matrixVersions: string[] | undefined): { stages: string[]; jobs: Job[] } {
  const matrixed = usesMatrix(spec, matrixVersions);
  const prefix = spec.jobName ? `${spec.jobName}_` : spec.subdirectory ? `${spec.subdirectory.replace(/[^a-zA-Z0-9]/g, '_')}_` : '';
  const cache = cacheConfigFor(spec);

  const namedSteps: { key: string; step: CIStep }[] = [
    { key: 'install', step: spec.installStep },
    ...(spec.auditStep ? [{ key: 'audit', step: spec.auditStep }] : []),
    ...(spec.lintStep ? [{ key: 'lint', step: spec.lintStep }] : []),
    ...(spec.testStep ? [{ key: 'test', step: spec.testStep }] : []),
    ...(spec.coverageStep ? [{ key: 'coverage', step: spec.coverageStep }] : []),
    ...(spec.buildStep ? [{ key: 'build', step: spec.buildStep }] : []),
    ...(spec.deployStep ? [{ key: 'deploy', step: spec.deployStep }] : []),
    ...(spec.releaseStep ? [{ key: 'release', step: spec.releaseStep }] : []),
    ...(spec.notifyStep ? [{ key: 'notify', step: spec.notifyStep }] : []),
  ];

  const stages: string[] = [];
  const jobs: Job[] = namedSteps.map(({ key, step }) => {
    stages.push(key);
    return {
      name: `${prefix}${key}`,
      stage: key,
      script: [scriptLine(step.run, spec.subdirectory)],
      matrixed,
      onFailure: step.condition === 'on_failure',
      cache,
    };
  });

  return { stages, jobs };
}

export function renderGitlabCi(pipeline: WorkspacePipeline): string {
  const allStages: string[] = [];
  const allJobs: { spec: PipelineSpec; jobs: Job[] }[] = [];

  for (const spec of pipeline.specs) {
    const { stages, jobs } = jobsForSpec(spec, pipeline.matrixVersions);
    for (const stage of stages) {
      if (!allStages.includes(stage)) {
        allStages.push(stage);
      }
    }
    allJobs.push({ spec, jobs });
  }

  const stagesBlock = allStages.map((s) => `  - ${s}`).join('\n');

  const jobsBlock = allJobs
    .flatMap(({ spec, jobs }) =>
      jobs.map((job) => {
        const image = `image: ${imageFor(spec, job.matrixed)}`;
        const scriptLines = job.script.map((s) => `    - ${s}`).join('\n');
        const matrixBlock = job.matrixed
          ? `  parallel:\n    matrix:\n      - VERSION: [${(pipeline.matrixVersions ?? []).map((v) => `"${v}"`).join(', ')}]\n`
          : '';
        const cacheBlock = job.cache
          ? `  cache:\n    key:\n      files:\n${job.cache.keyFiles.map((f) => `        - ${f}`).join('\n')}\n    paths:\n${job.cache.paths.map((p) => `      - ${p}`).join('\n')}\n`
          : '';
        const whenLine = job.onFailure ? '  when: on_failure\n' : '';
        return `${job.name}:\n  ${image}\n  stage: ${job.stage}\n${matrixBlock}${cacheBlock}${whenLine}  script:\n${scriptLines}`;
      }),
    )
    .join('\n\n');

  return `stages:
${stagesBlock}

${jobsBlock}
`;
}
