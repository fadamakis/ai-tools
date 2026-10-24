import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/ui',workers:1,fullyParallel:false,
  timeout:30_000,reporter:[['list'],['json',{outputFile:'test-results/ui-results.json'}]],
  use:{browserName:'chromium',headless:true,trace:'retain-on-failure',
    launchOptions:process.env.ATTENTION_BROWSER?{executablePath:process.env.ATTENTION_BROWSER}:{}}});
