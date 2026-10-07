import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readlink,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createUpdateController,verifyChecksum,extractRelease,replaceRelease} from '../apps/api/src/update-runner.mjs'
const hash=data=>createHash('sha256').update(data).digest('hex')
async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'online-update-')),root=join(dir,'installed'),dataDir=join(root,'data'),stage=join(dir,'incoming'),version='2.0.0',filename=`vps-monitor-${version}-linux-x64.tar.gz`,bundle=join(stage,`vps-monitor-${version}`)
 await mkdir(join(bundle,'apps/api/src'),{recursive:true});await mkdir(join(bundle,'apps/worker/src'),{recursive:true});await mkdir(join(bundle,'apps/web/dist'),{recursive:true});await mkdir(join(bundle,'node_modules'),{recursive:true});await mkdir(join(bundle,'packages/core'),{recursive:true})
 await writeFile(join(bundle,'apps/api/src/server.mjs'),'// new API\n');await writeFile(join(bundle,'apps/worker/src/worker.mjs'),'// new Worker\n');await writeFile(join(bundle,'apps/web/dist/index.html'),'<h1>New front end</h1>');await writeFile(join(bundle,'package.json'),JSON.stringify({version}));await writeFile(join(bundle,'package-lock.json'),'{}')
 await writeFile(join(bundle,'release-manifest.json'),JSON.stringify({version,platform:'linux',arch:'x64',includesProductionDependencies:true,includesFrontendBuild:true,packageLockSha256:hash('{}')}));await symlink('../../packages/core',join(bundle,'node_modules/core-link'))
 // A workspace symlink at this depth would escape the bundle; use the real scoped structure.
 await rm(join(bundle,'node_modules/core-link'));await mkdir(join(bundle,'node_modules/@vps-monitor'));await symlink('../../packages/core',join(bundle,'node_modules/@vps-monitor/core'))
 await mkdir(join(root,'apps/api/src'),{recursive:true});await mkdir(dataDir);await writeFile(join(root,'package.json'),'OLD PACKAGE');await writeFile(join(root,'apps/api/src/server.mjs'),'// old API\n');await writeFile(join(root,'.env'),'KEEP ROOT SECRET');await writeFile(join(dataDir,'database.db'),'KEEP BUSINESS DATA')
 const archivePath=join(dir,filename);execFileSync('tar',['-czf',archivePath,'-C',stage,`vps-monitor-${version}`]);const archive=await readFile(archivePath),sums=`${hash(archive)}  ${filename}\n`,target={mode:'release',updateAvailable:true,deployReady:true,remoteVersion:version,assets:{filename,archiveUrl:'https://github.com/fixture/archive',checksumUrl:'https://github.com/fixture/SHA256SUMS',digest:`sha256:${hash(archive)}`}}
 const fetcher=async url=>new Response(url.endsWith('SHA256SUMS')?sums:archive)
 try{await run({dir,root,dataDir,bundle,archive,archivePath,sums,target,fetcher,version})}finally{await rm(dir,{recursive:true,force:true})}
}
test('完整在线更新：真实解压、校验、备份、安装、重启确认；保留数据库和登录配置并拒绝重复更新',()=>fixture(async({root,dataDir,target,fetcher,version})=>{
 let restarted=0;const controller=createUpdateController({root,dataDir,version:'1.0.0',fetcher,restart:()=>restarted++});await controller.initialize();await controller.start(target);await assert.rejects(()=>controller.start(target),/正在进行/)
 const seen=new Set();for(let i=0;i<200;i++){const s=controller.getStatus();seen.add(s.state);if(['restarting','failed'].includes(s.state))break;await new Promise(r=>setTimeout(r,10))}
 const final=controller.getStatus();assert.equal(final.state,'restarting',final.message);assert.equal(final.progress,95);assert.equal(await readlink(join(root,'node_modules/@vps-monitor/core')),'../../packages/core');assert.equal(JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,version);assert.equal(await readFile(join(dataDir,'database.db'),'utf8'),'KEEP BUSINESS DATA');assert.equal(await readFile(join(root,'.env'),'utf8'),'KEEP ROOT SECRET');assert.equal(await readFile(join(final.backup,'package.json'),'utf8'),'OLD PACKAGE')
 await new Promise(r=>setTimeout(r,1100));assert.equal(restarted,1);const newServer=createUpdateController({root,dataDir,version,restart:()=>{}});await newServer.initialize();assert.equal(newServer.getStatus().state,'completed');assert.equal(newServer.getStatus().progress,100)
}));
test('校验失败不修改部署，显示可重试失败状态',()=>fixture(async({root,dataDir,target,archive})=>{
 const bad=async url=>new Response(url.endsWith('SHA256SUMS')?`${'0'.repeat(64)}  ${target.assets.filename}\n`:archive)
 const controller=createUpdateController({root,dataDir,version:'1.0.0',fetcher:bad,restart:()=>assert.fail('不能重启')});await controller.initialize();await controller.start(target)
 for(let i=0;i<100&&controller.getStatus().state!=='failed';i++)await new Promise(r=>setTimeout(r,10));assert.equal(controller.getStatus().state,'failed');assert.match(controller.getStatus().message,/SHA256/);assert.equal(await readFile(join(root,'package.json'),'utf8'),'OLD PACKAGE')
}));
test('错误附件和越界链接拒绝；正常 scoped workspace 链接可解压',()=>fixture(async({dir,bundle,archive,archivePath,sums,target,version})=>{
 assert.equal(verifyChecksum(archive,sums,target.assets.filename),hash(archive));assert.throws(()=>verifyChecksum(archive,sums,'wrong.tar.gz'),/未找到/)
 await mkdir(join(dir,'extract'));await extractRelease(archivePath,join(dir,'extract'),version)
 await symlink('../../../outside',join(bundle,'escape'));const unsafe=join(dir,'unsafe.tar.gz');execFileSync('tar',['-czf',unsafe,'-C',join(dir,'incoming'),`vps-monitor-${version}`]);await assert.rejects(()=>extractRelease(unsafe,join(dir,'extract'),version),/超出/)
}));
test('安装中途写入失败恢复已替换目录，保留旧部署',()=>fixture(async({dir,root,bundle})=>{
 // The first folder swaps successfully; the destination for the next staged folder fails.
 const blocker=join(root,'packages');await writeFile(blocker,'original package path')
 let count=0;await assert.rejects(()=>replaceRelease(root,bundle,join(dir,'backup'),{onProgress:()=>{if(++count===1)throw Error('simulated installation interruption')}}),/simulated/)
 assert.equal(await readFile(join(root,'apps/api/src/server.mjs'),'utf8'),'// old API\n');assert.equal(await readFile(blocker,'utf8'),'original package path');assert.equal(await readFile(join(root,'package.json'),'utf8'),'OLD PACKAGE')
}));
test('源码更新依赖安装失败回退原修订和部署，不重启错误版本',()=>fixture(async({root,dataDir})=>{
 const commands=[];const command=async(tool,args)=>{
  commands.push([tool,...args]);if(tool==='git'&&args[0]==='rev-parse')return {stdout:'new-revision\n'};
  if(tool==='git'&&args[0]==='merge')await writeFile(join(root,'package.json'),'CHANGED PACKAGE');
  if(tool==='npm')throw Error('simulated npm installation failure');return {stdout:''}
 }
 const controller=createUpdateController({root,dataDir,version:'1.0.0',command,restart:()=>assert.fail('失败后不能重启')});await controller.initialize();await controller.start({mode:'git',updateAvailable:true,deployReady:true,branch:'main',localRevision:'old-revision',remoteRevision:'new-revision'})
 for(let i=0;i<100&&controller.getStatus().state!=='failed';i++)await new Promise(r=>setTimeout(r,10));assert.equal(controller.getStatus().state,'failed');assert.match(controller.getStatus().message,/恢复原部署/);assert.ok(commands.some(c=>c.join(' ')==='git reset --hard old-revision'));assert.equal(await readFile(join(root,'package.json'),'utf8'),'OLD PACKAGE');assert.equal(await readFile(join(root,'.env'),'utf8'),'KEEP ROOT SECRET')
}));
