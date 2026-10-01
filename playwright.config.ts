import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 180000,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'on-failure' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: isCI,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'Google Chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'Microsoft Edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
});
