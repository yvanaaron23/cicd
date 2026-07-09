import { CIStep, Ecosystem } from './types';

export interface AugmentFiles {
  hasVercelJson: boolean;
  hasNetlifyToml: boolean;
  hasDockerfile: boolean;
  hasChangesetDir: boolean;
  hasSemanticReleaseConfig: boolean;
  packageJsonContent: string | null;
}

// Deploy/release targets aren't tied to one ecosystem, so they're detected
// separately and layered onto whichever ecosystem spec was found.
export function detectDeployStep(files: AugmentFiles, ecosystem: Ecosystem): CIStep | undefined {
  if (files.hasVercelJson) {
    return { name: 'Deploy to Vercel', run: 'npx vercel deploy --prod --token=$VERCEL_TOKEN' };
  }
  if (files.hasNetlifyToml) {
    return { name: 'Deploy to Netlify', run: 'npx netlify deploy --prod --auth=$NETLIFY_AUTH_TOKEN' };
  }
  // The 'docker' ecosystem already sets its own deploy (push) step.
  if (files.hasDockerfile && ecosystem !== 'docker') {
    return { name: 'Build and push Docker image', run: 'docker build -t $IMAGE_NAME . && docker push $IMAGE_NAME' };
  }
  return undefined;
}

export function detectReleaseStep(files: AugmentFiles): CIStep | undefined {
  if (files.hasChangesetDir) {
    return { name: 'Release', run: 'npx changeset publish' };
  }
  const usesSemanticRelease =
    files.hasSemanticReleaseConfig || (files.packageJsonContent?.includes('"semantic-release"') ?? false);
  if (usesSemanticRelease) {
    return { name: 'Release', run: 'npx semantic-release' };
  }
  return undefined;
}
