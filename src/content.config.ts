import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { DEFAULT_CONFIG, loadConfig } from './data/config';
import { targetRepoRoot } from './data/paths';

const root = targetRepoRoot();
void loadConfig(root);

const docs = defineCollection({
  loader: glob({
    base: root,
    pattern: DEFAULT_CONFIG.include,
  }),
  schema: z.object({
    title: z.string().optional().catch(undefined),
    description: z.string().optional().catch(undefined),
    editUrl: z.union([z.string().url(), z.boolean()]).optional().default(true).catch(true),
    head: z
      .array(
        z.object({
          tag: z
            .enum(['title', 'base', 'link', 'style', 'meta', 'script', 'noscript', 'template'])
            .catch('meta'),
          attrs: z.record(z.union([z.string(), z.boolean(), z.undefined()])).default({}).catch({}),
          content: z.string().default('').catch(''),
        }),
      )
      .default([])
      .catch([]),
    tableOfContents: z.unknown().optional(),
    template: z.enum(['doc', 'splash']).default('doc').catch('doc'),
    hero: z.unknown().optional(),
    lastUpdated: z.union([z.date(), z.boolean()]).optional().catch(undefined),
    prev: z
      .union([
        z.boolean(),
        z.string(),
        z.object({ link: z.string().optional().catch(undefined), label: z.string().optional().catch(undefined) }),
      ])
      .optional()
      .catch(undefined),
    next: z
      .union([
        z.boolean(),
        z.string(),
        z.object({ link: z.string().optional().catch(undefined), label: z.string().optional().catch(undefined) }),
      ])
      .optional()
      .catch(undefined),
    sidebar: z
      .object({
        order: z.number().optional().catch(undefined),
        label: z.string().optional().catch(undefined),
        hidden: z.coerce.boolean().default(false).catch(false),
        badge: z
          .union([
            z.string(),
            z.object({
              variant: z.enum(['note', 'danger', 'success', 'caution', 'tip', 'default']).default('default').catch('default'),
              text: z.string().catch(''),
            }),
          ])
          .optional()
          .catch(undefined),
        attrs: z.record(z.union([z.string(), z.number(), z.boolean(), z.undefined()])).default({}).catch({}),
      })
      .default({})
      .catch({ hidden: false, attrs: {} }),
    banner: z.object({ content: z.string().catch('') }).optional().catch(undefined),
    pagefind: z.coerce.boolean().default(true).catch(true),
    draft: z.coerce.boolean().default(false).catch(false),
    status: z.string().optional().catch(undefined),
    category: z.string().optional().catch(undefined),
    tags: z.preprocess((value) => (typeof value === 'string' ? [value] : value), z.array(z.string()).catch([])).optional().catch([]),
  }),
});

export const collections = { docs };
