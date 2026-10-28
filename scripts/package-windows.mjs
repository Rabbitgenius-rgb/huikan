import {build, Platform, Arch} from 'electron-builder';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if(process.platform!=='win32')throw Error('请在 Windows 或仓库的 Build Windows 工作流中构建 Windows 安装包。');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {version,devDependencies}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const output=path.resolve(process.env.HUIKAN_PACKAGE_OUT||path.join(root,'../huikan-release/windows'));
// The preview is deliberately unsigned. Never search the runner's certificate store.
process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';
await build({
 projectDir:root,
 targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),
 publish:'never',
 config:{
  appId:'io.huikan.desktop',productName:'回看',electronVersion:devDependencies.electron,
  directories:{app:path.join(root,'desktop/build'),output},
  asar:false,npmRebuild:false,forceCodeSigning:false,
  files:['**/*','!**/.local/**','!**/*.log'],
  win:{executableName:'Huikan',artifactName:`Huikan-${version}-windows-x64-setup.exe`},
  nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'回看',runAfterFinish:true,deleteAppDataOnUninstall:false},
 }
});
