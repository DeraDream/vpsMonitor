import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseStatus,isGitCheckout } from '../apps/api/src/updates.mjs'
const settings={repository:'DeraDream/vpsMonitor',branch:'main'}
const result=(tag)=>async url=>{assert.equal(url,'https://api.github.com/repos/DeraDream/vpsMonitor/releases/latest');return {ok:true,json:async()=>({tag_name:tag,html_url:'https://github.com/DeraDream/vpsMonitor/releases/tag/'+tag})}}
test('安装包不依赖 Git：相同、新版、旧版、异常版本与无发布',async()=>{
 assert.equal(isGitCheckout('/tmp/no-such-vpsmonitor-checkout'),false)
 const same=await releaseStatus('/tmp','1.3.0',settings,result('v1.3.0'));assert.equal(same.mode,'release');assert.equal(same.updateAvailable,false);assert.match(same.message,/已是最新/);assert.equal(same.deployReady,false)
 const newer=await releaseStatus('/tmp','1.3.0',settings,result('v1.10.0'));assert.equal(newer.updateAvailable,true);assert.equal(newer.remoteVersion,'1.10.0');assert.equal(newer.deployReady,false)
 const older=await releaseStatus('/tmp','1.3.1',settings,result('v1.3.0'));assert.equal(older.updateAvailable,false);assert.match(older.message,/高于/)
 assert.match((await releaseStatus('/tmp','1.3.0',settings,result('latest'))).message,/格式无效/)
 assert.match((await releaseStatus('/tmp','1.3.0',settings,async()=>({status:404}))).message,/尚无正式/)
 assert.match((await releaseStatus('/tmp','1.3.0',settings,async()=>({status:403,ok:false}))).message,/HTTP 403/)
 assert.match((await releaseStatus('/tmp','1.3.0',settings,async()=>{throw Error('timeout')})).message,/timeout/)
 assert.equal((await releaseStatus('/tmp','1.3.0',{repository:''})).configured,false)
})
test('完整正式发布包提供在线更新入口，缺失或外站附件不能在线安装',async()=>{
 const version='1.6.0',name=`vps-monitor-${version}-linux-x64.tar.gz`,prefix=`https://github.com/${settings.repository}/releases/download/v${version}/`
 const release={tag_name:'v'+version,html_url:`https://github.com/${settings.repository}/releases/tag/v${version}`,assets:[{name,browser_download_url:prefix+name},{name:'SHA256SUMS',browser_download_url:prefix+'SHA256SUMS'}]}
 const fetcher=async()=>({ok:true,json:async()=>release});const ready=await releaseStatus('/tmp','1.5.0',settings,fetcher);assert.equal(ready.updateAvailable,true);assert.equal(ready.deployReady,true);assert.equal(ready.assets.filename,name)
 release.assets[0].browser_download_url='https://evil.example/'+name;assert.equal((await releaseStatus('/tmp','1.5.0',settings,fetcher)).deployReady,false)
});
