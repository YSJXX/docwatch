import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const target = process.env.DOCWATCH_E2E_TARGET ?? path.resolve('.spike/target');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  webServer: {
    command: `node bin/cli.mjs ${target} --no-open --port 4321`,
    url: 'http://localhost:4321',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:4321', ...devices['Desktop Chrome'] },
});
