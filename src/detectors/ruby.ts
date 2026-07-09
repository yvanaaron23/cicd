import { BaseSpec } from './types';

export interface RubyProjectFiles {
  gemfileContent: string | null;
  rubyVersionFileContent: string | null;
}

function extractRubyVersion(files: RubyProjectFiles): string {
  if (files.rubyVersionFileContent) {
    const trimmed = files.rubyVersionFileContent.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  const match = files.gemfileContent?.match(/ruby\s+["'](\d+\.\d+(?:\.\d+)?)["']/);
  return match ? match[1] : '3.3';
}

export function buildRubySpec(files: RubyProjectFiles): BaseSpec | undefined {
  if (!files.gemfileContent) {
    return undefined;
  }

  const hasRspec = files.gemfileContent.includes('rspec');

  return {
    ecosystem: 'ruby',
    packageManager: 'bundler',
    runtimeVersion: extractRubyVersion(files),
    installStep: { name: 'Install dependencies', run: 'bundle install' },
    testStep: { name: 'Test', run: hasRspec ? 'bundle exec rspec' : 'bundle exec rake test' },
  };
}
