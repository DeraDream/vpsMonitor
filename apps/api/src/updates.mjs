import { existsSync } from 'node:fs'
import { join } from 'node:path'
export async function releaseStatus(root,version,settings,fetcher=fetch){
 const base={configured:Boolean(settings.repository),repository:settings.repository,branch:settings.branch,localVersion:version,remoteVersion:null,localRevision:null,remoteRevision:null,updateAvailable:false,deployReady:false,mode:'release',releaseUrl:null}
 if(!settings.repository)return {...base,message:'尚未配置 GitHub 更新源。'}
 if(!/^[\w.-]+\/[\w.-]+$/.test(settings.repository))return {...base,message:'GitHub 仓库格式无效。'}
 try{
  const response=await fetcher(`https://api.github.com/repos/${settings.repository}/releases/latest`,{headers:{Accept:'application/vnd.github+json','User-Agent':'VPSMonitor-version-check'},signal:AbortSignal.timeout(10000)})
  if(response.status===404)return {...base,message:'该仓库尚无正式发布版本。'}
  if(!response.ok)throw new Error(`GitHub HTTP ${response.status}`)
  const release=await response.json(),remoteVersion=String(release.tag_name||'').replace(/^v/,'')
  const parts=value=>/^\d+\.\d+\.\d+$/.test(value)?value.split('.').map(Number):null
  const local=parts(version),remote=parts(remoteVersion)
  if(!local||!remote)throw new Error('发布版本号格式无效')
  const index=remote.findIndex((part,i)=>part!==local[i]),newer=index>=0&&remote[index]>local[index]
  const releaseUrl=typeof release.html_url==='string'&&release.html_url.startsWith(`https://github.com/${settings.repository}/releases/`)?release.html_url:null
  return {...base,remoteVersion,updateAvailable:newer,releaseUrl,message:newer?`发现新版本 v${remoteVersion}。当前为安装包部署，请下载发布包更新。`:index<0?'已是最新版本。':`当前版本 v${version} 高于已发布版本 v${remoteVersion}。`}
 }catch(e){return {...base,message:`无法检查发布版本：${e.message}`}}
}
export const isGitCheckout=root=>existsSync(join(root,'.git'))
