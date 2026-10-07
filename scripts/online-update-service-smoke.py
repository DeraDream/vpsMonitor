"""Exercise a verified release installer as the production service user in /tmp."""
import hashlib,json,os,pathlib,pwd,subprocess,tarfile,tempfile
root=pathlib.Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version'];filename=f'vps-monitor-{version}-linux-x64.tar.gz';archive=root/'releases'/filename
account=pwd.getpwnam('vpsmonitor')
with tempfile.TemporaryDirectory(prefix='vps-online-service-test-') as task:
 task=pathlib.Path(task);task.chmod(0o755)
 with tarfile.open(archive) as tar:tar.extractall(task,filter='data')
 installed=task/f'vps-monitor-{version}';data=installed/'data';data.mkdir();(data/'preserved-business.txt').write_text('preserved');(installed/'.env').write_text('preserved-login-config')
 (task/filename).write_bytes(archive.read_bytes());(task/'SHA256SUMS').write_text(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {filename}\n')
 helper=task/'exercise.mjs'
 helper.write_text(r'''
import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {spawn} from 'node:child_process';import {once} from 'node:events';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const [base,root,version,filename]=process.argv.slice(2),dataDir=join(root,'data');
const {createUpdateController}=await import(pathToFileURL(join(root,'apps/api/src/update-runner.mjs')).href);
const {createDatabase}=await import(pathToFileURL(join(root,'packages/db/src/database.mjs')).href);
const store=createDatabase(dataDir);const settings=store.getSettings();settings.updates.repository='';store.setSettings(settings);
const env={...process.env,DISABLE_BUILTIN_PROVIDERS:'1',DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(59000+Math.floor(Math.random()*500)),ADMIN_PASSWORD:'service-smoke-password',WORKER_TICK_MS:'500'};const url='http://127.0.0.1:'+env.PORT,children=[];let api,worker,closing=false,restartedAt=0;
const launchWorker=()=>{worker=spawn(process.execPath,['apps/worker/src/worker.mjs'],{cwd:root,env,stdio:'ignore'});children.push(worker);worker.once('exit',()=>{if(!closing)setTimeout(()=>{if(!closing)launchWorker()},300)})};launchWorker();
async function wait(check,timeout=60000){const until=Date.now()+timeout;while(Date.now()<until){try{if(await check())return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('等待服务超时')}
async function stop(child){if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done}}
try{
 await wait(()=>Boolean(store.getRuntime().lastTickAt));const before=store.getRuntime().lastTickAt;
 const archive=await readFile(join(base,filename)),sums=await readFile(join(base,'SHA256SUMS'));const fetcher=async path=>new Response(path.endsWith('SHA256SUMS')?sums:archive);
 const controller=createUpdateController({root,dataDir,version:'1.5.0',fetcher,workerActive:()=>true,restart:()=>{restartedAt=Date.now();api=spawn(process.execPath,['apps/api/src/server.mjs'],{cwd:root,env,stdio:'ignore'});children.push(api);launchWorker()}});await controller.initialize();await controller.start({mode:'release',updateAvailable:true,deployReady:true,remoteVersion:version,assets:{filename,archiveUrl:'https://github.com/fixture/archive',checksumUrl:'https://github.com/fixture/SHA256SUMS'}});
 await wait(()=>['restarting','failed'].includes(controller.getStatus().state));assert.equal(controller.getStatus().state,'restarting',controller.getStatus().message);
 await wait(async()=>{const r=await fetch(url+'/api/public/catalog');return r.ok&&(await r.json()).version===version});
 const result=await (await fetch(url+'/api/updates/progress',{headers:{Authorization:'Basic '+Buffer.from('admin:service-smoke-password').toString('base64')}})).json();assert.equal(result.state,'completed');assert.equal(result.progress,100);
 await wait(()=>Date.parse(store.getRuntime().lastTickAt)>restartedAt&&worker.exitCode===null);assert.equal(await readFile(join(dataDir,'preserved-business.txt'),'utf8'),'preserved');assert.equal(await readFile(join(root,'.env'),'utf8'),'preserved-login-config');assert.equal(worker.exitCode,null);
 console.log(JSON.stringify({version,serviceUser:process.getuid(),result:'PASS',checks:['以生产服务用户实际安装','Worker 暂停确认','SHA256 与真实发布包解压','现有部署备份','保留业务数据及登录配置','新 API 启动后进度完成','新 Worker 启动及新鲜心跳']},null,2));
}finally{closing=true;for(const child of children.reverse())await stop(child);store.close()}
''')
 for directory,dirs,files in os.walk(task):
  os.chown(directory,account.pw_uid,account.pw_gid)
  for name in files:os.chown(pathlib.Path(directory)/name,account.pw_uid,account.pw_gid,follow_symlinks=False)
 result=subprocess.run(['runuser','-u','vpsmonitor','--','node',str(helper),str(task),str(installed),version,filename],capture_output=True,text=True,timeout=90)
 (root/'docs/test-results'/f'v{version}'/'online-update-service.log').write_text(result.stdout+result.stderr)
 print(result.stdout,end='')
 if result.returncode:print(result.stderr);raise SystemExit(result.returncode)
