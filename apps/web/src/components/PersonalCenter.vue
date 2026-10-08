<script setup>
import {reactive,ref} from 'vue'
import {api} from '../api.js'
import PasskeySettings from './PasskeySettings.vue'
defineProps({settings:Object})
const passkey=ref(null)
defineExpose({refresh:()=>passkey.value?.refresh()})
const passwords=reactive({currentPassword:'',newPassword:'',confirmPassword:''}),passwordBusy=ref(false),passwordMessage=ref(''),passwordError=ref(false)
async function changePassword(){passwordBusy.value=true;passwordMessage.value='';passwordError.value=false;try{await api('/api/auth/password',{method:'POST',body:JSON.stringify(passwords)});Object.assign(passwords,{currentPassword:'',newPassword:'',confirmPassword:''});passwordMessage.value='密码已修改，其他登录会话已退出。'}catch(e){passwordError.value=true;passwordMessage.value=e.message}finally{passwordBusy.value=false}}
</script>
<template><div class="personal-center"><p class="hint">管理你的登录密码和 Passkey。</p><div class="personal-cards"><form class="panel settings-card" @submit.prevent="changePassword"><h2>修改密码</h2><p>修改后当前会话保持登录，其他设备需要使用新密码重新登录。</p><template v-if="settings.security?.passwordProtected"><div class="field"><label for="current-password">当前密码</label><input id="current-password" v-model="passwords.currentPassword" type="password" autocomplete="current-password" required maxlength="1024"></div><div class="field"><label for="new-password">新密码</label><input id="new-password" v-model="passwords.newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></div><div class="field"><label for="confirm-password">确认新密码</label><input id="confirm-password" v-model="passwords.confirmPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></div><button class="button" :disabled="passwordBusy">{{passwordBusy?'正在修改…':'修改密码'}}</button><p v-if="passwordMessage" :role="passwordError?'alert':'status'">{{passwordMessage}}</p></template><p v-else>请先通过 ADMIN_PASSWORD 配置初始登录密码。</p></form><PasskeySettings ref="passkey"/></div></div></template>
