import { BaseSpec } from './types';

export interface DockerProjectFiles {
  hasDockerfile: boolean;
}

// Lowest-priority fallback: only used when no other ecosystem was detected but a
// Dockerfile exists on its own. If another ecosystem *is* detected alongside a
// Dockerfile, that Dockerfile becomes a deploy step instead (see augment.ts).
export function buildDockerSpec(files: DockerProjectFiles): BaseSpec | undefined {
  if (!files.hasDockerfile) {
    return undefined;
  }

  return {
    ecosystem: 'docker',
    runtimeVersion: 'latest',
    installStep: { name: 'Build Docker image', run: 'docker build -t $IMAGE_NAME .' },
    testStep: undefined,
    buildStep: undefined,
    deployStep: { name: 'Push Docker image', run: 'docker push $IMAGE_NAME' },
  };
}
