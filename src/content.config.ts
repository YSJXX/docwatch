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
    title: z.string().optional(),
    description: z.string().optional(),
    editUrl: z.union([z.string().url(), z.boolean()]).optional().default(true),
    head: z
      .array(
        z.object({
          tag: z.enum(['title', 'base', 'link', 'style', 'meta', 'script', 'noscript', 'template']),
          attrs: z.record(z.union([z.string(), z.boolean(), z.undefined()])).default({}),
          content: z.string().default(''),
        }),
      )
      .default([]),
    tableOfContents: z.unknown().optional(),
    template: z.enum(['doc', 'splash']).default('doc'),
    hero: z.unknown().optional(),
    lastUpdated: z.union([z.date(), z.boolean()]).optional(),
    prev: z
      .union([z.boolean(), z.string(), z.object({ link: z.string().optional(), label: z.string().optional() }).strict()])
      .optional(),
    next: z
      .union([z.boolean(), z.string(), z.object({ link: z.string().optional(), label: z.string().optional() }).strict()])
      .optional(),
    sidebar: z
      .object({
        order: z.number().optional(),
        label: z.string().optional(),
        hidden: z.boolean().default(false),
        badge: z
          .union([
            z.string(),
            z.object({
              variant: z.enum(['note', 'danger', 'success', 'caution', 'tip', 'default']).default('default'),
              text: z.string(),
            }),
          ])
          .optional(),
        attrs: z.record(z.union([z.string(), z.number(), z.boolean(), z.undefined()])).default({}),
      })
      .default({}),
    banner: z.object({ content: z.string() }).optional(),
    pagefind: z.boolean().default(true),
    draft: z.boolean().default(false),
    status: z.enum(['draft', 'in-progress', 'done']).optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = { docs };
