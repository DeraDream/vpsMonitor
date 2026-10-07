import {readFile,writeFile,rename,mkdir,cp,rm,mkdtemp,access} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join,resolve,relative,isAbsolute} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const execute=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms))
const managed=['apps','packages','node_modules','scripts','docs','deploy','package.json','package-lock.json','release-manifest.json','README.md','CHANGELOG.md','.env.example']
const activeStates=['checking','downloading','verifying','extracting','backing_up','installing','restarting']
export const updateActive=status=>activeStates.includes(status?.state)
export async function downloadAsset(url,{fetcher=fetch,onProgress=()=>{},limit=256*1024*1024}={}){
 const response=await fetcher(url,{signal:AbortSignal.timeout(180000),headers:{'User-Agent':'VPSMonitor-online-update'}})
 if(!response.ok)throw Error(`下载失败：HTTP ${response.status}`)
 if(response.url&&!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(new URL(response.url).hostname))throw Error('下载响应跳转到不受信任的地址')
 const total=Number(response.headers.get('content-length'))||0;if(total>limit)throw Error('发布附件过大')
 const chunks=[];let received=0
 for await(const chunk of response.body){received+=chunk.length;if(received>limit)throw Error('发布附件过大');chunks.push(chunk);onProgress(received,total)}
 if(total&&received!==total)throw Error('下载未完成，请重试')
 return Buffer.concat(chunks)
}
export function verifyChecksum(archive,checksum,filename,digest=null){
 const row=checksum.toString('utf8').split(/\r?\n/).find(line=>line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)?.[2]===filename)
 if(!row)throw Error('SHA256SUMS 中未找到对应安装包')
 const expected=row.match(/^([a-fA-F0-9]{64})/)[1].toLowerCase(),actual=createHash('sha256').update(archive).digest('hex')
 if(actual!==expected||digest&&digest!==`sha256:${actual}`)throw Error('安装包 SHA256 校验失败，未修改现有部署')
 return actual
}
export async function extractRelease(archive,stage,version){
 const prefix=`vps-monitor-${version}/`,listing=(await execute('tar',['-tzf',archive],{maxBuffer:8*1024*1024})).stdout.split('\n').filter(Boolean)
 if(!listing.length||listing.some(name=>!name.startsWith(prefix)||name.split('/').some(part=>['..','.env','.env.release','.git','data'].includes(part))))throw Error('安装包包含不安全路径或业务数据')
 const verbose=(await execute('tar',['-tvzf',archive],{maxBuffer:8*1024*1024})).stdout.split('\n')
 for(const line of verbose){if(line.startsWith('h'))throw Error('安装包包含不支持的硬链接');if(line.startsWith('l')){
  const [left,target]=line.split(' -> '),name=left.split(/\s+/).at(-1);if(!target)throw Error('无效安装包链接')
  const link=resolve(stage,name,'..',target),base=resolve(stage,prefix);if(isAbsolute(target)||relative(base,link).startsWith('..'))throw Error('安装包链接超出发布目录')
 }}
 await execute('tar',['-xzf',archive,'--no-same-owner','--no-same-permissions','-C',stage])
 const bundle=join(stage,`vps-monitor-${version}`),manifest=JSON.parse(await readFile(join(bundle,'release-manifest.json'),'utf8')),pkg=JSON.parse(await readFile(join(bundle,'package.json'),'utf8'))
 if(manifest.version!==version||pkg.version!==version||manifest.platform!=='linux'||manifest.arch!=='x64'||!manifest.includesProductionDependencies||!manifest.includesFrontendBuild)throw Error('安装包版本或平台清单不匹配')
 const lock=createHash('sha256').update(await readFile(join(bundle,'package-lock.json'))).digest('hex');if(lock!==manifest.packageLockSha256)throw Error('安装包依赖清单校验失败')
 for(const path of ['apps/api/src/server.mjs','apps/worker/src/worker.mjs','apps/web/dist/index.html','node_modules'])await access(join(bundle,path))
 await execute(process.execPath,['--check',join(bundle,'apps/api/src/server.mjs')]);await execute(process.execPath,['--check',join(bundle,'apps/worker/src/worker.mjs')])
 return bundle
}
export async function replaceRelease(root,bundle,backup,{onProgress=()=>{}}={}){
 await mkdir(backup,{recursive:true,mode:0o700});const transaction=randomUUID(),existing=[],prepared=[],swapped=[]
 try{
  for(const name of managed){
   if(existsSync(join(root,name))){await cp(join(root,name),join(backup,name),{recursive:true,dereference:false,verbatimSymlinks:true});existing.push(name)}
   if(existsSync(join(bundle,name))){const next=join(root,`.update-next-${transaction}-${name.replaceAll('/','-')}`);await cp(join(bundle,name),next,{recursive:true,dereference:false,verbatimSymlinks:true});prepared.push({name,next,old:join(root,`.update-old-${transaction}-${name.replaceAll('/','-')}`)})}
  }
  for(const entry of prepared){if(existsSync(join(root,entry.name)))await rename(join(root,entry.name),entry.old);swapped.push(entry);await rename(entry.next,join(root,entry.name));onProgress(swapped.length,prepared.length)}
  for(const entry of swapped)await rm(entry.old,{recursive:true,force:true})
 }catch(error){
  for(const entry of swapped.reverse()){if(existsSync(entry.old)){await rm(join(root,entry.name),{recursive:true,force:true});await rename(entry.old,join(root,entry.name))}else if(!existing.includes(entry.name))await rm(join(root,entry.name),{recursive:true,force:true})}
  throw error
 }finally{for(const entry of prepared)await rm(entry.next,{recursive:true,force:true})}
}
export function createUpdateController({root,dataDir,version,restart=()=>process.exit(0),workerActive=()=>false,fetcher=fetch,command=execute}){
 const journal=join(dataDir,'.update-status.json'),maintenance=join(dataDir,'.update-in-progress'),paused=join(dataDir,'.worker-paused')
 let status={state:'idle',progress:0,message:'尚未开始更新'},busy=false,writing=Promise.resolve()
 async function persist(patch){status={...status,...patch,updatedAt:new Date().toISOString()};const value=JSON.stringify(status);writing=writing.then(async()=>{await mkdir(dataDir,{recursive:true});await writeFile(journal+'.tmp',value);await rename(journal+'.tmp',journal)});await writing;return status}
 async function initialize(){
  try{status=JSON.parse(await readFile(journal,'utf8'))}catch{}
  if(updateActive(status)){if(status.targetVersion===version&&status.state==='restarting')await persist({state:'completed',progress:100,message:'更新完成，服务已重启',version});else await persist({state:'failed',message:'上次更新中断，请重新检查更新'})}
  await rm(maintenance,{force:true});await rm(paused,{force:true});return status
 }
 async function pause(){await rm(paused,{force:true});const active=workerActive();await writeFile(maintenance,String(Date.now()));if(!active)return;for(let i=0;i<160;i++){if(existsSync(paused))return;await sleep(500)}throw Error('监控任务未能暂停，现有部署未修改，请稍后重试')}
 async function runGit(target){
  const backup=join(dataDir,'update-backups',status.id);let changed=false
  try{
   await persist({state:'downloading',progress:15,message:'正在拉取 GitHub 发布分支'})
   await command('git',['fetch','origin',target.branch],{cwd:root,timeout:120000})
   const remote=(await command('git',['rev-parse',`origin/${target.branch}`],{cwd:root})).stdout.trim()
   if(remote!==target.remoteRevision)throw Error('远端版本已变化，请重新检查并确认')
   await persist({state:'backing_up',progress:35,message:'正在暂停监控并备份原部署',backup});await pause();await mkdir(backup,{recursive:true,mode:0o700})
   for(const name of managed)if(existsSync(join(root,name)))await cp(join(root,name),join(backup,name),{recursive:true,dereference:false,verbatimSymlinks:true})
   changed=true;await persist({state:'installing',progress:50,message:'正在更新源码'})
   await command('git',['merge','--ff-only',target.remoteRevision],{cwd:root,timeout:60000})
   await persist({progress:65,message:'正在安装生产及构建依赖'})
   await command('npm',['ci'],{cwd:root,timeout:300000,maxBuffer:8*1024*1024})
   await persist({progress:82,message:'正在构建前端'})
   await command('npm',['run','build:web'],{cwd:root,timeout:180000,maxBuffer:8*1024*1024})
   const next=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version
   await persist({state:'restarting',progress:95,targetVersion:next,message:'更新完成，正在重启服务并等待重新连接'})
   await rm(maintenance,{force:true});await writeFile(join(dataDir,'.restart-worker'),String(Date.now()));setTimeout(restart,1000)
  }catch(error){
   if(changed){await command('git',['reset','--hard',target.localRevision],{cwd:root});for(const name of managed)if(existsSync(join(backup,name))){await rm(join(root,name),{recursive:true,force:true});await cp(join(backup,name),join(root,name),{recursive:true,dereference:false,verbatimSymlinks:true})}}
   await persist({state:'failed',message:`更新失败：${error.message}。${changed?'已恢复原部署。':''}`});await rm(maintenance,{force:true});busy=false
  }finally{await rm(paused,{force:true})}
 }
 async function run(target){let stage
  try{
   await persist({state:'downloading',progress:5,message:'正在下载发布包与 SHA256SUMS'})
   const archive=await downloadAsset(target.assets.archiveUrl,{fetcher,onProgress:(received,total)=>{status={...status,progress:total?Math.min(35,5+Math.floor(received/total*30)):15,message:`正在下载发布包（${(received/1048576).toFixed(1)} MB${total?` / ${(total/1048576).toFixed(1)} MB`:''}）`}}})
   const sums=await downloadAsset(target.assets.checksumUrl,{fetcher,limit:1024*1024})
   await persist({state:'verifying',progress:40,message:'正在校验安装包 SHA256'});verifyChecksum(archive,sums,target.assets.filename,target.assets.digest)
   stage=await mkdtemp(join(tmpdir(),'vpsmonitor-online-'));const archivePath=join(stage,target.assets.filename);await writeFile(archivePath,archive)
   await persist({state:'extracting',progress:48,message:'正在解压并验证版本和生产依赖'});const bundle=await extractRelease(archivePath,stage,target.remoteVersion)
   await persist({state:'backing_up',progress:58,message:'正在暂停监控并备份原部署'});await pause();const backup=join(dataDir,'update-backups',status.id)
   await persist({state:'installing',progress:65,message:'正在备份并安装新版本，保留数据库和设置',backup})
   await replaceRelease(root,bundle,backup,{onProgress:(done,total)=>{status={...status,progress:65+Math.floor(done/total*25)}}})
   await persist({state:'restarting',progress:95,message:'安装完成，正在重启服务并等待重新连接'})
   await rm(maintenance,{force:true});await writeFile(join(dataDir,'.restart-worker'),String(Date.now()));setTimeout(restart,1000)
  }catch(error){await persist({state:'failed',message:`更新失败：${error.message}。可重新检查并重试。`});await rm(maintenance,{force:true});busy=false}
  finally{await rm(paused,{force:true});if(stage)await rm(stage,{recursive:true,force:true})}
 }
 async function start(target){
  if(busy||updateActive(status)){const e=Error('已有更新正在进行');e.status=409;throw e}
  if(!target.updateAvailable||!target.deployReady||(target.mode!=='git'&&!target.assets))throw Error(target.message||'没有可安装的新版本')
  busy=true;await persist({id:`update_${randomUUID()}`,state:'checking',progress:1,message:'已确认更新，准备下载',fromVersion:version,targetVersion:target.remoteVersion,startedAt:new Date().toISOString()});void (target.mode==='git'?runGit(target):run(target));return {...status}
 }
 return {initialize,start,getStatus:()=>({...status})}
}
