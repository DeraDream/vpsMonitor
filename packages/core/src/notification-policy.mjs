export const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validateQuietHours(input, previous={enabled:false,start:'23:00',end:'08:00'}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('免打扰设置必须是对象');
  if(Object.keys(input).some(key=>!['enabled','start','end'].includes(key)))throw Error('未知免打扰设置字段');
  const value={...previous,...input};
  if(typeof value.enabled!=='boolean')throw Error('免打扰开关必须是布尔值');
  if(!timePattern.test(value.start)||!timePattern.test(value.end))throw Error('免打扰时间必须为 HH:mm（00:00 至 23:59）');
  if(value.start===value.end)throw Error('免打扰开始和结束时间不能相同');
  return value;
}
const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
export function quietHoursStatus(settings, now=Date.now()) {
  const quiet=settings.quietHours;
  if(!quiet?.enabled||!timePattern.test(quiet.start)||!timePattern.test(quiet.end)||quiet.start===quiet.end)return {active:false,resumeAt:null};
  // Beijing is UTC+8 year-round; this calculation does not use the VPS timezone.
  const shifted=new Date(now+8*3600000),minute=shifted.getUTCHours()*60+shifted.getUTCMinutes();
  const start=minutes(quiet.start),end=minutes(quiet.end);
  const active=start<end?minute>=start&&minute<end:minute>=start||minute<end;
  if(!active)return {active:false,resumeAt:null};
  const midnight=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate())-8*3600000;
  const resume=midnight+end*60000+(end<=minute?86400000:0);
  return {active:true,resumeAt:new Date(resume).toISOString()};
}
export function beijingTimestamp(value){return new Intl.DateTimeFormat('zh-CN',{timeZone:BEIJING_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));}
