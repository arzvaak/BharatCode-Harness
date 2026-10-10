import {build} from 'esbuild';
const shared={entryPoints:['src/client.jsx'],bundle:true,platform:'browser',target:'es2022',jsx:'automatic',external:['react','react/jsx-runtime','react-dom'],legalComments:'eof'};
await build({...shared,outfile:'lib/client.js',format:'cjs',banner:{js:'window.__ModuleLoader__.load({id:"@arzvaak/dsh-provider-hub",factory:(require)=>{var module={exports:{}};var exports=module.exports;'},footer:{js:'return module.exports;}});'}});
await build({...shared,outfile:'tests/client.bundle.js',format:'esm'});
