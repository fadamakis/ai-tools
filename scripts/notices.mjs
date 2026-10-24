import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const licenseSources=JSON.parse(fs.readFileSync(new URL('./vendor-licenses/sources.json',import.meta.url),'utf8'));
export function writeNotices(results, destination, { baseDirectory = process.cwd(), introduction = '' } = {}) {
 const packages=new Set();
 for(const input of results.flatMap(result=>Object.keys(result.metafile.inputs))) {
  if(!input.includes('node_modules/')) continue;
  const segments=path.resolve(baseDirectory,input).split(path.sep),index=segments.lastIndexOf('node_modules');
  const end=index+(segments[index+1]?.startsWith('@')?3:2);
  const directory=segments.slice(0,end).join(path.sep);
  if(!fs.existsSync(path.join(directory,'package.json')))throw Error(`Bundled dependency has no package metadata: ${input}`);
  packages.add(fs.realpathSync(directory));
 }
 const text=[`# Bundled third-party software\n${introduction ? `\n${introduction}\n` : ''}`];
 for(const directory of [...packages].sort()) {
  const metadata=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
  const legalFiles=fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isFile()&&/(?:^|[-_])(?:LICEN[CS]E|COPYING|NOTICE)(?:[._-]|$)/i.test(entry.name)).map(entry=>entry.name).sort();
  const license=legalFiles.some(file=>/(?:^|[-_])(?:LICEN[CS]E|COPYING)(?:[._-]|$)/i.test(file));
  const declared=typeof metadata.license==='string'?metadata.license:metadata.license?.type||metadata.licenses?.map(value=>value.type).join(' OR ');
  const fallback=licenseSources[`${metadata.name}@${metadata.version}`];
  const fallbackText=!license&&fallback?fs.readFileSync(new URL(`./vendor-licenses/${fallback.file}`,import.meta.url),'utf8'):null;
  if(fallbackText&&(declared!==fallback.license||createHash('sha256').update(fallbackText).digest('hex')!==fallback.sha256))throw Error(`Vendor license provenance differs for ${metadata.name} ${metadata.version}`);
  const legalText=[fallbackText,...legalFiles.map(file=>fs.readFileSync(path.join(directory,file),'utf8'))].filter(Boolean).join('\n\n');
  if(!declared||(!license&&!fallbackText)||!legalText.trim())throw Error(`Missing license declaration or text for bundled dependency ${metadata.name} ${metadata.version}`);
  text.push(`\n## ${metadata.name} ${metadata.version}\nLicense: ${declared}\n\n${legalText}${introduction ? '\n' : ''}`);
 }
 fs.writeFileSync(destination,text.join('\n')+(introduction ? '' : '\n'));
 return packages.size;
}
