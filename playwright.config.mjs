import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
const version=JSON.parse(fs.readFileSync('plugins/shelob/plugin.json','utf8')).version;
export default defineConfig({testDir:'./tests/ui',workers:1,timeout:30000,reporter:[['list'],['json',{outputFile:`dist/releases/${version}/ui-results.json`}]],use:{browserName:'chromium',headless:true,viewport:{width:1440,height:1000},launchOptions:process.env.SHELOB_BROWSER?{executablePath:process.env.SHELOB_BROWSER}:{},trace:'retain-on-failure'},outputDir:`dist/releases/${version}/ui-traces`});
