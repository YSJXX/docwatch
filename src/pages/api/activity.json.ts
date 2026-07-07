import type { APIRoute } from 'astro';
import { getActivity } from '@/data/activity';
import { DEFAULT_CONFIG } from '@/data/config';
import { targetRepoRoot } from '@/data/paths';

export const prerender = false;

export const GET: APIRoute = async () => {
  const data = await getActivity(targetRepoRoot(), DEFAULT_CONFIG);
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
