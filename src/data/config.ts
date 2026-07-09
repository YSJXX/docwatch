export type CategoryRule = { name: string; match: string | string[]; icon?: string };
export type DocwatchConfig = { include: string[]; exclude: string[]; categories: CategoryRule[]; watchFiles: string[]; todoGlobs: string[] };

export const DEFAULT_CONFIG: DocwatchConfig = {
  include: ['docs/**/*.md', 'AGENTS.md', 'README.md', 'CLAUDE.md', '.omc/**/*.md', '.claude/plans/*.md'],
  exclude: ['**/node_modules/**', '.git/**', '.docwatch-cache/**'],
  categories: [
    { name: 'ADR',   match: 'docs/adr/**',                            icon: '📐' },
    { name: 'PRD',   match: ['docs/prd*', '.omc/prd-*'],              icon: '📋' },
    { name: 'Plans', match: '.claude/plans/**',                       icon: '🗺' },
    { name: 'Root',  match: ['AGENTS.md', 'README.md', 'CLAUDE.md'],  icon: '📄' },
  ],
  watchFiles: [
    'package.json', 'package-lock.json', 'pnpm-lock.yaml',
    'tsconfig*.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod',
    'Dockerfile', 'docker-compose.{yml,yaml}',
    '*.config.{js,ts,mjs,cjs}', '.github/workflows/*.{yml,yaml}',
    '**/openapi*.{yaml,yml,json}', '**/swagger*.{yaml,yml,json}', '**/*.{graphql,gql,proto,prisma}',
    '**/*.{mermaid,mmd}', 'docs/**/*.svg',
  ],
  todoGlobs: ['**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte,py,go,rs,rb,java,kt,c,h,cpp,cs,php,sh}'],
};

export function mergeConfig(override: Partial<DocwatchConfig>): DocwatchConfig {
  const overridden = new Set((override.categories ?? []).map(c => c.name));
  return {
    include: override.include ?? DEFAULT_CONFIG.include,
    exclude: override.exclude ?? DEFAULT_CONFIG.exclude,
    watchFiles: override.watchFiles ?? DEFAULT_CONFIG.watchFiles,
    todoGlobs: override.todoGlobs ?? DEFAULT_CONFIG.todoGlobs,
    categories: [
      ...DEFAULT_CONFIG.categories.filter(c => !overridden.has(c.name)),
      ...(override.categories ?? []),
    ],
  };
}

export async function loadConfig(rootDir: string): Promise<DocwatchConfig> {
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  const p = path.join(rootDir, 'docwatch.config.ts');
  try { await fs.access(p); } catch { return DEFAULT_CONFIG; }
  const mod = await import(/* @vite-ignore */ p);
  return mergeConfig((mod.default ?? {}) as Partial<DocwatchConfig>);
}
