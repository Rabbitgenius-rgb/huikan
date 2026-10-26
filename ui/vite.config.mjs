import {defineConfig} from 'vite';
export default defineConfig({base:'./',cacheDir:'.vite-cache',build:{outDir:'dist',emptyOutDir:true,rollupOptions:{onwarn(warning,warn){if(warning.code==='MODULE_LEVEL_DIRECTIVE'&&warning.message.includes('use client'))return;warn(warning);}}},server:{host:'127.0.0.1',port:4396,strictPort:true}});
