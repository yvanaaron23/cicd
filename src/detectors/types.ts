export type Ecosystem =
  | 'node'
  | 'python'
  | 'go'
  | 'rust'
  | 'java-maven'
  | 'java-gradle'
  | 'php'
  | 'ruby'
  | 'dotnet'
  | 'docker';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'pip' | 'poetry' | 'maven' | 'gradle' | 'composer' | 'bundler';

export interface CIStep {
  name: string;
  run: string;
}

export interface PipelineSpec {
  ecosystem: Ecosystem;
  /** Only meaningful for node (npm/yarn/pnpm) and python (pip/poetry). */
  packageManager?: PackageManager;
  runtimeVersion: string;
  /** '' for the workspace root, else a relative path (monorepo package). */
  subdirectory: string;
  installStep: CIStep;
  lintStep?: CIStep;
  testStep?: CIStep;
  buildStep?: CIStep;
  deployStep?: CIStep;
  releaseStep?: CIStep;
}

/** What an ecosystem builder returns — the subdirectory is filled in by the scanner. */
export type BaseSpec = Omit<PipelineSpec, 'subdirectory'>;

export interface WorkspacePipeline {
  specs: PipelineSpec[];
  branch: string;
  matrixVersions?: string[];
}
