import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mdx from '@astrojs/mdx';
import { targetRepoRoot } from './src/data/paths.ts';
import { startGitWatch } from './src/data/git-watch.ts';

const gitWatchIntegration = {
  name: 'docwatch-git-watch',
  hooks: {
    'astro:server:setup': ({ server }) => {
      const w = startGitWatch(targetRepoRoot(), () => server.ws.send({ type: 'full-reload', path: '*' }));
      server.httpServer?.once('close', () => w.close());
    },
  },
};

export default defineConfig({
  site: 'http://localhost:4321',
  markdown: {
    syntaxHighlight: false,
  },
  integrations: [
    gitWatchIntegration,
    starlight({
      title: 'docwatch',
      sidebar: [{ label: 'Docs', autogenerate: { directory: '.' } }],
      expressiveCode: false,
      components: {
        Footer: './src/components/Footer.astro',
      },
    }),
    mdx(),
  ],
});
