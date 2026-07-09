import { BaseSpec } from './types';

export interface JavaGradleFiles {
  buildGradleContent: string | null;
}

export function buildJavaGradleSpec(files: JavaGradleFiles): BaseSpec | undefined {
  if (!files.buildGradleContent) {
    return undefined;
  }

  const versionMatch = files.buildGradleContent.match(/sourceCompatibility\s*=\s*['"]?(\d+)/);
  const runtimeVersion = versionMatch ? versionMatch[1] : '21';

  return {
    ecosystem: 'java-gradle',
    packageManager: 'gradle',
    runtimeVersion,
    installStep: { name: 'Install dependencies', run: './gradlew build -x test' },
    testStep: { name: 'Test', run: './gradlew test' },
    buildStep: { name: 'Build', run: './gradlew build' },
  };
}
