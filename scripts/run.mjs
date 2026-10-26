import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mode=process.argv[2];
if(!['desktop','companion'].includes(mode))throw Error('请选择 desktop 或 companion');
const local=path.join(root,'.local');
const env={...process.env,
 HUIKAN_DATA_HOME:process.env.HUIKAN_DATA_HOME||path.join(local,'desktop'),
 HUIKAN_COMPANION_HOME:process.env.HUIKAN_COMPANION_HOME||path.join(local,'companion'),
 MENGCANG_RECALL_USER_DATA:process.env.MENGCANG_RECALL_USER_DATA||path.join(local,'companion'),
 MENGCANG_RECALL_BRIDGE_DIR:process.env.MENGCANG_RECALL_BRIDGE_DIR||path.join(local,'bridge')};
for(const name of ['HUIKAN_DATA_HOME','HUIKAN_COMPANION_HOME','MENGCANG_RECALL_USER_DATA','MENGCANG_RECALL_BRIDGE_DIR']){
 if(!path.isAbsolute(env[name]))throw Error(`${name} 必须是绝对路径`);
 await mkdir(env[name],{recursive:true,mode:0o700});
}
delete env.ELECTRON_RUN_AS_NODE;
const executable=createRequire(import.meta.url)('electron');
const child=spawn(executable,[path.join(root,mode==='desktop'?'desktop/build':'companion')],{cwd:root,env,stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
