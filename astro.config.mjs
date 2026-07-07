import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'http://localhost:4321',
  integrations: [
    starlight({
      title: 'docview',
      sidebar: [{ label: 'Docs', autogenerate: { directory: '.' } }],
    }),
    mdx(),
  ],
});
