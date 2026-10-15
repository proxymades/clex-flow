/* global window */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.CLEX_BROWSER_EXECUTABLE});
 const page = await browser.newPage({viewport:{width:1440,height:1100}}), errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.isTauri=true; window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  let environment=null,next=1; window.__sdkChecks=[]; window.__sdkInstallCalls=0;
  const root=String.raw`X:\Espressif\frameworks\esp-idf-v5.4.4`,python=String.raw`X:\Espressif\python_env\idf5.4_py3.11_env\Scripts\python.exe`;
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>next++,unregisterCallback:()=>{},invoke:async(command,args={})=>{
   if(command.startsWith('plugin:event|'))return next++;
   if(command==='list_projects')return [];
   if(command==='storage_path')return String.raw`D:\CLEX Projects`;
   if(command==='idf_ports')return [];
   if(command==='sdk_list')return {installations:environment?[{id:'external-x',version:'5.4.4',root,managed:false,state:'ready',environment}]:[],active:environment?{esp32s3:'external-x'}:{},available:[{version:'5.4.4',supported:true}],catalogError:'',managedPath:'/fixture/managed',host:'windows-x86_64',environment};
   if(command==='idf_environment'){
    window.__sdkChecks.push(args);
    if(!args.root)throw 'Нужна ESP-IDF 5.4.4';
    if(args.toolsPath && args.toolsPath!==String.raw`X:\Espressif`){environment=null;throw 'В указанной папке инструментов не найден файл constraints';}
    environment={target:'esp32s3',root,python,toolsPath:String.raw`X:\Espressif`,sdkVersion:'5.4.4',identity:'fixture-x',version:'ESP-IDF v5.4.4',compilerVersion:'Xtensa GCC fixture',cmakeVersion:'CMake fixture',ninjaVersion:'1.12',diagnostics:''};return environment;
   }
   if(command==='sdk_install'){window.__sdkInstallCalls++;throw 'Unexpected SDK installation';}
   throw new Error('Unexpected fixture RPC '+command);
  }};
 });
 try {
  await page.goto(process.env.CLEX_PREVIEW_URL||'http://127.0.0.1:1430'); await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByText('SDK не обнаружены.',{exact:false}).waitFor();
  await page.locator('.sdk-external summary').click();
  await page.getByRole('textbox',{name:'Каталог ESP-IDF',exact:true}).fill(String.raw`X:\Espressif`);
  await page.getByRole('button',{name:'Проверить пути',exact:true}).click();
  await page.getByText('Окружение готово',{exact:true}).waitFor();
  const first=await page.evaluate(()=>window.__sdkChecks.at(-1));assert.equal(first.root,String.raw`X:\Espressif`);assert.equal(first.python,null);assert.equal(first.toolsPath,null);
  assert.equal(await page.getByRole('textbox',{name:'Каталог инструментов ESP-IDF',exact:true}).inputValue(),String.raw`X:\Espressif`);
  assert.match(await page.getByRole('textbox',{name:'Python окружения ESP-IDF',exact:true}).inputValue(),/python_env/);
  assert.match(await page.getByRole('textbox',{name:'Каталог ESP-IDF',exact:true}).inputValue(),/frameworks/);
  assert.equal(await page.locator('.sdk-row').getByRole('button',{name:'Удалить',exact:true}).count(),0);
  await page.getByRole('textbox',{name:'Каталог инструментов ESP-IDF',exact:true}).fill(String.raw`Z:\Wrong tools`);
  await page.getByRole('button',{name:'Проверить пути',exact:true}).click();
  await page.locator('.sdk-manager .inspector-warning').filter({hasText:'constraints'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__sdkChecks.at(-1).toolsPath),String.raw`Z:\Wrong tools`);
  await page.getByRole('textbox',{name:'Каталог инструментов ESP-IDF',exact:true}).fill(String.raw`X:\Espressif`);
  await page.getByRole('button',{name:'Проверить пути',exact:true}).click();await page.getByText('Окружение готово',{exact:true}).waitFor();
  await page.screenshot({path:'.artifacts/sdk-external/manual-x-drive.png'});
  assert.equal(await page.evaluate(()=>window.__sdkInstallCalls),0);assert.deepEqual(errors,[]);
  console.log('PASS: external SDK on X, container root, optional Python/tools autofill, manual tools override/error, no external removal and no installation. UI RPC simulated; filesystem discovery covered by Rust tests.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
