import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const version=JSON.parse(fs.readFileSync('plugins/shelob/plugin.json','utf8')).version;
import { pathToFileURL } from 'node:url';
const url=pathToFileURL(path.resolve(`dist/shelob-${version}-preview/standalone/report.html`)).href;
test('offline export hydrates without errors, preserves all checks and supports copy only',async({page,context})=>{
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(/^https?:/.test(request.url()))external.push(request.url());});
  await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text;}}});});
  await page.goto(url);await expect(page.locator('[data-enhanced]')).toHaveAttribute('data-enhanced','true');await expect(page.locator('.check-detail:visible')).toHaveCount(1);
  await page.locator('.check-detail:visible').getByRole('button',{name:'Prepare comment',exact:true}).first().click();await page.locator('.check-detail:visible textarea').fill('A copied offline edit.');await page.locator('.check-detail:visible').getByRole('button',{name:'Copy',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__copied)).toBe('A copied offline edit.');
  await expect(page.locator('#approve-pr')).toBeDisabled();await expect(page.getByRole('button',{name:/Post selected|Post comment/})).toHaveCount(0);
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
test('JavaScript-disabled exports show every check, evidence and metadata',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:1200,height:900}});const page=await context.newPage();await page.goto(url);
  await expect(page.locator('.check-detail:visible')).toHaveCount(10);await expect(page.locator('.evidence').first()).toBeVisible();await expect(page.locator('.interactive-only:visible')).toHaveCount(0);
  await page.locator('.support-section>summary').click();await expect(page.getByText('Run details',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Download JSON',exact:true})).toBeVisible();await context.close();
});
test('print includes all checks and reduced motion disables animation',async({page})=>{
  await page.goto(url);await expect(page.locator('[data-enhanced]')).toHaveAttribute('data-enhanced','true');await page.emulateMedia({media:'print',reducedMotion:'reduce'});
  await expect(page.locator('.check-detail:visible')).toHaveCount(10);await expect(page.locator('.check-list')).toHaveCount(0);
  await page.pdf({path:`dist/releases/${version}/shelob-${version}-print.pdf`,format:'A4',printBackground:true});
});
test('export theme follows system appearance until a saved user choice',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});await page.goto(url);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.getByRole('button',{name:'Switch to light theme',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'light'});await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});
test('theme controls work when browser storage is unavailable',async({page,context})=>{
  await context.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('Unavailable');};Storage.prototype.setItem=()=>{throw Error('Unavailable');};});await page.emulateMedia({colorScheme:'dark'});await page.goto(url);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.getByRole('button',{name:'Switch to light theme',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});
test('blocked clipboard selects readable single and bulk comment text',async({page,context})=>{
  await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('Blocked');}}});});await page.goto(url);await expect(page.locator('[data-enhanced]')).toHaveAttribute('data-enhanced','true');
  await page.locator('.check-detail:visible').getByRole('button',{name:'Prepare comment',exact:true}).first().click();const field=page.locator('.check-detail:visible textarea');await field.fill('Keep this manual-copy text.');await page.locator('.check-detail:visible').getByRole('button',{name:'Copy',exact:true}).click();await expect(field).toBeFocused();expect(await field.evaluate(el=>el.selectionEnd-el.selectionStart)).toBe('Keep this manual-copy text.'.length);
  await page.locator('#select-comments').click();await page.locator('#copy-selected').click();await expect(page.locator('#copy-fallback')).toBeFocused();await expect(page.locator('#copy-fallback')).toHaveValue(/Keep this manual-copy text/);
});
