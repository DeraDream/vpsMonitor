import { existsSync } from 'node:fs'
import { join } from 'node:path'
export const isGitCheckout=root=>existsSync(join(root,'.git'))
export function releaseAssets(release,repository,version){
 const filename=`vps-monitor-${version}-linux-x64.tar.gz`,prefix=`https://github.com/${repository}/releases/download/${release.tag_name}/`
 const pick=name=>(release.assets||[]).find(asset=>asset.name===name&&asset.browser_download_url===prefix+name&&asset.state!=='new')
 const archive=pick(filename),checksum=pick('SHA256SUMS')
 return archive&&checksum?{filename,archiveUrl:archive.browser_download_url,checksumUrl:checksum.browser_download_url,digest:archive.digest||null}:null
}
export async function releaseStatus(root,version,settings,fetcher=fetch){
 const base={configured:Boolean(settings.repository),repository:settings.repository,branch:settings.branch,localVersion:version,remoteVersion:null,localRevision:null,remoteRevision:null,updateAvailable:false,deployReady:false,mode:'release',releaseUrl:null,checkError:null}
 if(!settings.repository)return {...base,message:'尚未配置 GitHub 更新源。'}
 if(!/^[\w.-]+\/[\w.-]+$/.test(settings.repository))return {...base,message:'GitHub 仓库格式无效。'}
 try{
  const response=await fetcher(`https://api.github.com/repos/${settings.repository}/releases/latest`,{headers:{Accept:'application/vnd.github+json','User-Agent':'VPSMonitor-version-check','Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)})
  if(response.status===404)return {...base,message:'该仓库尚无正式发布版本。'}
  if(!response.ok)throw new Error(response.status===403||response.status===429?`GitHub 请求受限（HTTP ${response.status}），请稍后重试`:`GitHub HTTP ${response.status}`)
  const release=await response.json(),remoteVersion=String(release.tag_name||'').replace(/^v/,'')
  const parts=value=>/^\d+\.\d+\.\d+$/.test(value)?value.split('.').map(Number):null
  const local=parts(version),remote=parts(remoteVersion)
  if(!local||!remote||release.draft||release.prerelease)throw new Error('发布版本号格式无效或不是正式版本')
  const index=remote.findIndex((part,i)=>part!==local[i]),newer=index>=0&&remote[index]>local[index]
  const releaseUrl=typeof release.html_url==='string'&&release.html_url.startsWith(`https://github.com/${settings.repository}/releases/`)?release.html_url:null
  const assets=releaseAssets(release,settings.repository,remoteVersion),supported=process.platform==='linux'&&process.arch==='x64',deployReady=Boolean(assets&&supported)
  return {...base,remoteVersion,updateAvailable:newer,deployReady,releaseUrl,assets,message:newer?`发现新版本 v${remoteVersion}。${deployReady?'可在线下载并更新。':supported?'发布包或 SHA256SUMS 缺失，暂不能在线更新。':'当前平台不支持此安装包。'}`:index<0?'已是最新版本。':`当前版本 v${version} 高于已发布版本 v${remoteVersion}。`}
 }catch(e){return {...base,checkError:e.message,message:`无法检查发布版本：${e.message}`}}
}
