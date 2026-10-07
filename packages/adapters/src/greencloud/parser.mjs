import { load } from 'cheerio'
const clean=value=>String(value||'').replace(/\s+/g,' ').trim()
export function merchantUrl(value,base='https://greencloudvps.com/billing/store'){
 const url=new URL(value,base)
 if(url.protocol!=='https:'||!['greencloudvps.com','www.greencloudvps.com'].includes(url.hostname))throw Error('拒绝非 GreenCloud 地址')
 url.hostname='greencloudvps.com';url.hash='';return url
}
export function parseCategories(html){
 const $=load(html),result=new Map()
 $('[menuItemName="Categories"] a[href]').each((_,el)=>{
  let url;try{url=merchantUrl($(el).attr('href'))}catch{return}
  const match=url.pathname.match(/^\/billing\/store\/([^/]+)\/?$/),name=clean($(el).text())
  if(match&&name){url.search='';result.set(match[1],{id:match[1],name,url:url.href})}
 })
 if(!result.size)throw Error('未找到 GreenCloud 分类导航，保留原分类与库存')
 return [...result.values()]
}
function extractDescription($,card){
 const element=card.find('.product-desc p').first().clone();element.find('br').replaceWith('\n')
 return element.text().split(/\n/).map(clean).filter(Boolean)
}
function fieldsFrom(rows){
 const f={}
 for(const {label,value} of rows){const key=label.toLowerCase()
  if(/^ram$/.test(key))f.ram=value
  else if(/^cpu$/.test(key))f.cpu=value
  else if(/^(hard drives?|storage|ssd|nvme|disk)$/.test(key))f.storage=value
  else if(/^ipv4$/.test(key))f.ipv4=value
  else if(/^ipv6$/.test(key))f.ipv6=value
  else if(/^ip$/.test(key)){f.ipv4=value.match(/(\d+)\s*IPv4/i)?.[1]||'';f.ipv6=value.match(/(\/\d+)\s*IPv6/i)?.[1]||''}
  else if(/^(bandwidth|traffic)$/.test(key))f.bandwidth=value
  else if(/^port$/.test(key))f.portSpeed=value
  else if(/^os$/.test(key))f.os=value
  else if(/^location$/.test(key))f.location=value
  else if(/^control panel$/.test(key))f.controlPanel=value
  else if(/^virtualization$/.test(key))f.virtualization=value
  else if(/backup|snapshot/.test(key))f.backups=value
 }
 if(f.storage){f.storageType=[/NVMe/i.test(f.storage)&&'NVMe',/SATA|HDD/i.test(f.storage)&&'SATA/HDD',/SSD/i.test(f.storage)&&!/NVMe/i.test(f.storage)&&'SSD'].filter(Boolean).join(' + ');if(/NVMe/i.test(f.storage))f.nvme=f.storage}
 if(!f.portSpeed&&f.bandwidth)f.portSpeed=f.bandwidth.match(/\b[\d.]+\s*[GM]bps\b/i)?.[0]||''
 return f
}
function descriptiveRow(line){
 const mapping=[[/\bRAM\b/i,'RAM'],[/\b(?:cores?|vCPU)\b/i,'CPU'],[/\b(?:NVMe|SSD|SATA|HDD)\b/i,'Storage'],[/\b(?:Bandwidth|Traffic)\b/i,'Bandwidth'],[/\b(?:Windows|Linux|macOS|Mojave|Catalina)\b/i,'OS']]
 return {label:mapping.find(([re])=>re.test(line))?.[1]||'Description',value:line}
}
export function parseProducts(html,category){
 const $=load(html),cards=$('#products .product[id]'),plans=[],seen=new Set()
 if(!cards.length){
  const empty=$('#order-standard_cart .alert, .cart-body .alert').toArray().some(el=>/^Product group does not contain any visible products\.?$/i.test(clean($(el).text())))
  if(empty)return []
  throw Error(`${category.name}：页面未找到套餐或明确空分类标记`)
 }
 cards.each((_,el)=>{
  const card=$(el),cardId=card.attr('id').match(/^product(\d+)$/)?.[1]
  const name=clean(card.find(`[id="product${cardId}-name"]`).text())
  const order=card.find(`[id="product${cardId}-order-button"]`).first()
  const href=order.attr('href'),buyUrl=href?merchantUrl(href,category.url):null
  const pid=buyUrl?.pathname==='/billing/cart.php'?buyUrl.searchParams.get('pid'):cardId
  if(!pid||!/^\d+$/.test(pid)||!name||seen.has(pid))throw Error(`${category.name}：套餐 ID 或名称异常`)
  seen.add(pid)
  if(buyUrl&&!(/^\/billing\/store\/[^/]+\/[^/]+\/?$/.test(buyUrl.pathname)||(buyUrl.pathname==='/billing/cart.php'&&buyUrl.searchParams.get('a')==='add')))throw Error('套餐订购地址结构异常')
  const pricing=card.find('.product-pricing').first(),amount=clean(pricing.find('.price').text())
  if(!/[$€£]\s*[\d,.]+/.test(amount))throw Error(`${category.name}：${name} 价格缺失`)
  const pricingText=clean(pricing.text()),price=/Starting from/i.test(pricingText)?`Starting from ${amount}`:amount
  const cycle=pricingText.match(/\b(Annually|Biennially|Triennially|Monthly|Quarterly|Semi-Annually|One Time)\b/i)?.[1]||''
  const quantityText=clean(card.find('.qty').text())
  const soldOut=/(?:out of stock|sold out|unavailable)/i.test(quantityText)||/^(?:out of stock|sold out|unavailable)$/i.test(clean(order.text()))||order.is('[disabled],.disabled')||order.attr('aria-disabled')==='true'
  let quantity=null,available,availabilitySource
  if(quantityText&&!soldOut){const match=quantityText.match(/^([\d,]+)\s+Available$/i);if(!match)throw Error(`${category.name}：${name} 库存标记无法识别`);quantity=Number(match[1].replaceAll(',',''));if(!Number.isSafeInteger(quantity))throw Error('库存数量无效');available=quantity>0;availabilitySource='quantity'}
  else if(soldOut){available=false;availabilitySource='sold-out'}
  else if(buyUrl&&/^Order Now$/i.test(clean(order.text()))){available=true;availabilitySource='order-button'}
  else throw Error(`${category.name}：${name} 可售状态不明确`)
  const configuration=[]
  card.find('.product-desc li').each((_,li)=>{const row=$(li),value=clean(row.find('.feature-value').text()),label=clean(row.clone().find('.feature-value').remove().end().text());if(value&&label)configuration.push({label,value});else if(clean(row.text()))configuration.push(descriptiveRow(clean(row.text())))})
  const description=extractDescription($,card)
  if(!configuration.length)configuration.push(...description.map(descriptiveRow))
  const fields=fieldsFrom(configuration)
  if(cycle)configuration.push({label:'Billing cycle',value:cycle})
  const billingCycle=({annually:'year',monthly:'month',quarterly:'quarter',biennially:'2 years',triennially:'3 years','semi-annually':'6 months','one time':'one-time'})[cycle.toLowerCase()]||cycle
  plans.push({externalId:`${category.id}:${pid}`,categoryId:category.id,categoryName:category.name,name,price,billingCycle,runtime:cycle,...fields,configuration,description:description.join('\n'),available,quantity,availabilitySource,specs:[fields.cpu&&`CPU ${fields.cpu}`,fields.ram&&`RAM ${fields.ram}`,fields.storage&&`Disk ${fields.storage}`].filter(Boolean).join(' / '),sourceUrl:category.url,buyUrl:buyUrl?.href||category.url,tags:['greencloud',category.id],listed:true})
 })
 return plans
}
