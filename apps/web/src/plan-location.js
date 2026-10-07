// Translate only GreenCloud geography at display time, preserving source data.
const places = {
 'Staten Island':'史泰登岛','New York City':'纽约市','New York':'纽约','Los Angeles':'洛杉矶','San Jose':'圣何塞','San Francisco':'旧金山','Salt Lake City':'盐湖城','Kansas City':'堪萨斯城','Ho Chi Minh City':'胡志明市',
 'Tokyo':'东京','Osaka':'大阪','Singapore':'新加坡','Hong Kong':'香港','Seoul':'首尔','Taipei':'台北','Hanoi':'河内','Bangkok':'曼谷','Jakarta':'雅加达','Kuala Lumpur':'吉隆坡','Mumbai':'孟买','Chennai':'金奈','Sydney':'悉尼','Melbourne':'墨尔本','Auckland':'奥克兰',
 'Dallas':'达拉斯','Seattle':'西雅图','Chicago':'芝加哥','Atlanta':'亚特兰大','Miami':'迈阿密','Phoenix':'凤凰城','Denver':'丹佛','Ashburn':'阿什本','Buffalo':'布法罗','Las Vegas':'拉斯维加斯','Bend':'本德','Portland':'波特兰','Toronto':'多伦多','Montreal':'蒙特利尔','Vancouver':'温哥华',
 'Amsterdam':'阿姆斯特丹','Frankfurt':'法兰克福','London':'伦敦','Coventry':'考文垂','Manchester':'曼彻斯特','Paris':'巴黎','Bucharest':'布加勒斯特','Sofia':'索非亚','Warsaw':'华沙','Stockholm':'斯德哥尔摩','Zurich':'苏黎世','Luxembourg':'卢森堡',
 'United States':'美国','United Kingdom':'英国','Netherlands':'荷兰','Germany':'德国','Romania':'罗马尼亚','Vietnam':'越南','Japan':'日本','Australia':'澳大利亚','Canada':'加拿大','France':'法国','South Korea':'韩国','Thailand':'泰国','Indonesia':'印度尼西亚','Malaysia':'马来西亚','India':'印度',
 'JP':'日本','US':'美国','USA':'美国','UK':'英国','GB':'英国','DE':'德国','NL':'荷兰','SG':'新加坡','HK':'香港','KR':'韩国','VN':'越南','AU':'澳大利亚','CA':'加利福尼亚州','NY':'纽约州','TX':'得克萨斯州','WA':'华盛顿州','IL':'伊利诺伊州','FL':'佛罗里达州','AZ':'亚利桑那州','UT':'犹他州','OR':'俄勒冈州','VA':'弗吉尼亚州','MO':'密苏里州','GA':'佐治亚州','RO':'罗马尼亚','FR':'法国','IN':'印度','ID':'印度尼西亚','MY':'马来西亚','TH':'泰国'
}
const pattern = new RegExp(`\\b(${Object.keys(places).sort((a,b)=>b.length-a.length).join('|')})\\b`, 'gi')
const translations = new Map(Object.entries(places).map(([key,value])=>[key.toLowerCase(),value]))
export function planLocation(plan, value = plan.location) {
 if (!value || plan.providerId !== 'greencloud') return value
 return String(value).replace(pattern, name=>translations.get(name.toLowerCase()))
}
