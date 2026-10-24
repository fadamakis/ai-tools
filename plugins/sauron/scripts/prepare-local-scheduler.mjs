import {writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataPath} from '../src/server/data-path.mjs';
// Generate a reviewable plist only. Never installs, loads, or changes a schedule.
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--expected-store-id','--output','--runtime'].includes(args[i])||!args[i+1])throw Error('Use --expected-store-id UUID --runtime PLUGIN_DIR --output FILE');options[args[i]]=args[i+1];}
if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(options['--expected-store-id']??'')||!options['--output'])throw Error('An expected store ID and output file are required.');
const root=resolve(options['--runtime']??fileURLToPath(new URL('..',import.meta.url)));
const helper=resolve(root,'dist/server/check-local-attention.js');if(!existsSync(helper))throw Error('Build the runtime before generating its schedule.');
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const argv=[process.execPath,helper,'--expected-store-id',options['--expected-store-id']];
const plist=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.sauron.local-attention</string>\n<key>ProgramArguments</key><array>${argv.map(value=>`<string>${xml(value)}</string>`).join('')}</array>\n<key>WorkingDirectory</key><string>${xml(root)}</string>\n<key>EnvironmentVariables</key><dict><key>ATTENTION_DB</key><string>${xml(dataPath())}</string></dict>\n<key>RunAtLoad</key><true/><key>StartInterval</key><integer>60</integer>\n<key>ProcessType</key><string>Background</string>\n</dict></plist>\n`;
writeFileSync(resolve(options['--output']),plist,{mode:0o600,flag:'wx'});
console.log('Prepared an inactive local schedule. Review the runtime path and complete verified writer cutover before loading it.');
