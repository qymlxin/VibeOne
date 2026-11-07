// The fixed development app loads this source file on every launch.
const path=require('node:path');
const fs=require('node:fs');
const {app}=require('electron');
const root=path.resolve(__dirname,'../../..');
process.env.VIBEONE_DEV_URL='http://127.0.0.1:5174';
process.env.VIBEONE_RESOURCES_DIR=path.join(root,'target/desktop-resources');
let server,watcher,timer;
globalThis.vibeoneDevReady=(async()=>{
  let existing=false;
  try{
    const response=await fetch(process.env.VIBEONE_DEV_URL+'/src/main.jsx',{signal:AbortSignal.timeout(1000)});
    existing=response.ok&&(await response.text()).includes('ProjectSwitcher');
    if(!existing)throw Error('5174端口不是VibeOne开发服务');
  }catch(error){if(error.message.includes('不是VibeOne'))throw error;}
  if(!existing){
    const {createServer}=await import('vite');
    server=await createServer({root:path.join(root,'apps/desktop')});
    await server.listen();
  }
  watcher=fs.watch(__dirname,(_event,name)=>{
    if(!name?.endsWith('.cjs'))return;
    clearTimeout(timer);
    timer=setTimeout(()=>{app.relaunch();app.quit();},350);
  });
})();
// Register Electron protocols synchronously, before app.ready.
require('./main.cjs');
app.on('will-quit',()=>{clearTimeout(timer);watcher?.close();void server?.close();});
