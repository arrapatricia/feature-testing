import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  
  /* FIXED: Match both standard .ts files (like pd_hcp_appform.ts) and .spec.ts files in subfolders */
  testMatch: ['**/*.ts', '**/*.spec.ts'],

  /* Global timeout for long-running Heroku staging flows (3 mins) */
  timeout: 180000,
  
  /* Opt out of parallel execution so sequential test suites share state reliably */
  fullyParallel: false,
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Force 1 worker for sequential suite execution */
  workers: 1,
  
  /* Console list + HTML reporter configured to open automatically after run */
  reporter: [
    ['list'],
    ['html', { open: 'always' }]
  ],
  
  /* Shared settings for all projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Force DOM tracing, screenshots, and video for rich report details */
    trace: 'on',
    screenshot: 'on',
    video: 'on',

    /* Run tests in headed browser mode by default */
    headless: false,
    viewport: { width: 1280, height: 720 },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },

    {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});