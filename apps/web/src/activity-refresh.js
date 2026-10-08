import {ref,onMounted,onUnmounted} from 'vue'
import {api} from './api.js'
// Public readers learn saved changes within ten seconds, even when the feed interval is long.
export function useActivityRefresh(refresh){
 const interval=ref(10);let timer,settingsTimer,alive=true
 function apply(seconds){if(!Number.isInteger(seconds)||seconds<1||seconds>3600)return;if(timer&&interval.value===seconds)return;interval.value=seconds;clearInterval(timer);timer=setInterval(()=>{if(document.visibilityState==='visible')refresh()},seconds*1000)}
 async function sync(){try{const settings=await api('/api/public/activity-settings');if(alive)apply(settings.refreshIntervalSeconds)}catch{if(alive&&!timer)apply(10)}}
 onMounted(()=>{sync();settingsTimer=setInterval(sync,10000)})
 onUnmounted(()=>{alive=false;clearInterval(timer);clearInterval(settingsTimer)})
 return {interval,apply}
}
