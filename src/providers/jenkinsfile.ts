import { CIStep, PipelineSpec, WorkspacePipeline } from '../detectors/types';

function escapeShell(run: string): string {
  return run.replace(/'/g, "\\'");
}

function stageFor(name: string, step: CIStep, subdirectory: string): string {
  const command = `sh '${escapeShell(step.run)}'`;
  const body = subdirectory ? `dir('${subdirectory}') {\n                    ${command}\n                }` : command;
  return `        stage('${name}') {\n            steps {\n                ${body}\n            }\n        }`;
}

function stagesForSpec(spec: PipelineSpec): string[] {
  const prefix = spec.subdirectory ? `${spec.subdirectory} - ` : '';
  const named: { name: string; step: CIStep | undefined }[] = [
    { name: 'Install', step: spec.installStep },
    { name: 'Audit', step: spec.auditStep },
    { name: 'Lint', step: spec.lintStep },
    { name: 'Test', step: spec.testStep },
    { name: 'Coverage', step: spec.coverageStep },
    { name: 'Build', step: spec.buildStep },
    { name: 'Deploy', step: spec.deployStep },
    { name: 'Release', step: spec.releaseStep },
  ];
  return named
    .filter((n): n is { name: string; step: CIStep } => !!n.step)
    .map((n) => stageFor(`${prefix}${n.name}`, n.step, spec.subdirectory));
}

export function renderJenkinsfile(pipeline: WorkspacePipeline): string {
  const stages = pipeline.specs.flatMap(stagesForSpec).join('\n');
  const notifyStep = pipeline.specs.map((s) => s.notifyStep).find((s): s is CIStep => !!s);
  const postBlock = notifyStep
    ? `\n    post {\n        failure {\n            sh '${escapeShell(notifyStep.run)}'\n        }\n    }\n`
    : '\n';

  return `pipeline {\n    agent any\n    stages {\n${stages}\n    }${postBlock}}\n`;
}
