import { readFileSync } from 'node:fs'
import { parseCategories, parseProducts } from './parser.mjs'
const version=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')).version
export { parseCategories,parseProducts } from './parser.mjs'
export async function discoverGreenCloud({fetchPage=fetch,delayMs=250,concurrency=2,provider={}}={}){
 const deadline=AbortSignal.timeout(60000)
 async function page(url){const response=await fetchPage(url+(url.includes('?')?'&':'?')+'language=english',{headers:{Accept:'text/html','Accept-Language':'en-US,en;q=0.9','User-Agent':`VPSMonitor/${version} (+https://github.com/DeraDream/vpsMonitor)`},signal:AbortSignal.any([deadline,AbortSignal.timeout(15000)]),redirect:'follow'});if(!response.ok)throw Error(`HTTP ${response.status}`);if(response.url&&!/^https:\/\/(?:www\.)?greencloudvps\.com\//.test(response.url))throw Error('响应被重定向到其他站点');if(!/text\/html/i.test(response.headers.get('content-type')||''))throw Error('响应不是 HTML');return response.text()}
 let categories;try{categories=parseCategories(await page('https://greencloudvps.com/billing/store'))}catch(error){error.failures=(provider.categories||[]).map(c=>({categoryId:c.id,categoryName:c.name,error:error.message}));throw error}
 if(categories.length>100)throw Error('分类数量异常，停止本轮抓取')
 const plans=[],completedCategories=[],failures=[];let cursor=0
 async function work(){while(cursor<categories.length){const category=categories[cursor++];try{const html=await page(category.url);plans.push(...parseProducts(html,category));completedCategories.push(category.id)}catch(e){failures.push({categoryId:category.id,categoryName:category.name,error:e.message})}if(delayMs&&!deadline.aborted)await new Promise(r=>setTimeout(r,delayMs))}}
 await Promise.all(Array.from({length:Math.max(1,Math.min(2,concurrency))},work))
 if(!completedCategories.length)throw Object.assign(Error(failures.map(f=>`${f.categoryName}：${f.error}`).join('；')),{failures})
 return {categories,plans,completedCategories,failures}
}
export const greenCloud={key:'greencloud',name:'GreenCloud',version:'1.0.0',provider:{id:'greencloud',name:'GreenCloud',website:'https://greencloudvps.com/',categories:[],dynamicCategories:true,defaultIntervalSeconds:300,notifyOnFirstDiscovery:false},discover:discoverGreenCloud}
