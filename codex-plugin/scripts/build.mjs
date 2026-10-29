import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({entryPoints:[path.join(root, 'server.cjs')],outfile:path.join(root, 'dist/server.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22'});
console.log('Built standalone Huikan Codex MCP server.');
