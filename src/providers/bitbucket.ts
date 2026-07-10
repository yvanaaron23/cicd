import { cacheConfigFor } from './cachePaths';
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
  if (!step || step.condition === 'on_failure') {
    return [];
  }
  return [subdirectory ? `cd ${subdirectory} && ${step.run}` : step.run];
}

// Bitbucket has no per-step "on failure" condition, so a notify step is rendered as a
// pipeline-level after-script guarded by $BITBUCKET_EXIT_CODE instead of a script line.
function afterScriptLines(step: CIStep | undefined, subdirectory: string): string[] {
  if (!step || step.condition !== 'on_failure') {
    return [];
  }
  const run = subdirectory ? `cd ${subdirectory} && ${step.run}` : step.run;
  return [`if [ "$BITBUCKET_EXIT_CODE" != "0" ]; then ${run}; fi`];
}

const cacheNameFor = (spec: PipelineSpec): string => `${spec.ecosystem}-cache`;

export function renderBitbucketPipelines(pipeline: WorkspacePipeline): string {
  const spec = pipeline.specs[0];
  const cache = cacheConfigFor(spec);

  const scriptLines = [
    ...scriptLine(spec.installStep, spec.subdirectory),
    ...scriptLine(spec.auditStep, spec.subdirectory),
    ...scriptLine(spec.lintStep, spec.subdirectory),
    ...scriptLine(spec.testStep, spec.subdirectory),
    ...scriptLine(spec.coverageStep, spec.subdirectory),
    ...scriptLine(spec.buildStep, spec.subdirectory),
    ...scriptLine(spec.deployStep, spec.subdirectory),
    ...scriptLine(spec.releaseStep, spec.subdirectory),
  ];

  const afterScriptLinesResolved = afterScriptLines(spec.notifyStep, spec.subdirectory);

  const indentedScript = scriptLines.map((line) => `          - ${line}`).join('\n');
  const cachesBlock = cache ? `        caches:\n          - ${cacheNameFor(spec)}\n` : '';
  const afterScriptBlock =
    afterScriptLinesResolved.length > 0
      ? `        after-script:\n${afterScriptLinesResolved.map((line) => `          - ${line}`).join('\n')}\n`
      : '';
  const definitionsBlock = cache
    ? `\ndefinitions:\n  caches:\n    ${cacheNameFor(spec)}: ${cache.paths[0]}\n`
    : '';

  return `image: ${imageFor(spec)}

pipelines:
  default:
    - step:
        name: Build and Test
${cachesBlock}        script:
${indentedScript}
${afterScriptBlock}${definitionsBlock}`;
}
