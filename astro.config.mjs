import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mdx from '@astrojs/mdx';
import rehypeMermaid from 'rehype-mermaid';

export default defineConfig({
  integrations: [
    starlight({
      title: 'docview',
      sidebar: [{ label: 'Docs', autogenerate: { directory: '.' } }],
    }),
    mdx(),
  ],
  markdown: {
    rehypePlugins: [[rehypeMermaid, { strategy: 'inline-svg' }]],
  },
});
