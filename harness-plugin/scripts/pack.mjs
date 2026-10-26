import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(new URL('../packages/',import.meta.url),{recursive:true});
const result=execFileSync('npm',['pack','--ignore-scripts','--json','--cache','.npm-cache','--pack-destination','packages'],{cwd:root,encoding:'utf8'});
const records=JSON.parse(result);
for(const item of records){if(item.files.some(f=>/node_modules|\.runtime|tests\//u.test(f.path)))throw Error('Unexpected runtime/test data in tarball');}
await writeFile(new URL('../packages/manifest.json',import.meta.url),JSON.stringify(records,null,2)+'\n');
console.log(records.map(x=>({filename:x.filename,size:x.size,files:x.files.map(f=>f.path)})));
