import { BaseSpec } from './types';

export interface JavaMavenFiles {
  pomXmlContent: string | null;
}

export function buildJavaMavenSpec(files: JavaMavenFiles): BaseSpec | undefined {
  if (!files.pomXmlContent) {
    return undefined;
  }

  const versionMatch =
    files.pomXmlContent.match(/<maven\.compiler\.(?:source|release)>(\d+)</) ||
    files.pomXmlContent.match(/<java\.version>(\d+)</);
  const runtimeVersion = versionMatch ? versionMatch[1] : '21';

  return {
    ecosystem: 'java-maven',
    packageManager: 'maven',
    runtimeVersion,
    installStep: { name: 'Install dependencies', run: 'mvn install -DskipTests -B' },
    testStep: { name: 'Test', run: 'mvn test -B' },
    buildStep: { name: 'Build', run: 'mvn package -DskipTests -B' },
  };
}
