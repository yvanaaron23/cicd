export type Ecosystem = 'node' | 'python' | 'go' | 'rust';
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'pip' | 'poetry';

export interface CIStep {
  name: string;
  run: string;
}

export interface PipelineSpec {
  ecosystem: Ecosystem;
  /** Only meaningful for node (npm/yarn/pnpm) and python (pip/poetry). */
  packageManager?: PackageManager;
  runtimeVersion: string;
  installStep: CIStep;
  lintStep?: CIStep;
  testStep?: CIStep;
  buildStep?: CIStep;
}
