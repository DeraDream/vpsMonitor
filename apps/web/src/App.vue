<script setup>
import { onMounted,onUnmounted,ref } from 'vue'
import { api } from './api.js'
import PublicSite from './components/PublicSite.vue'
const admin=location.pathname.startsWith('/admin')
import Dashboard from './Dashboard.vue'
import LoginPage from './components/LoginPage.vue'
const ready=ref(false),authenticated=ref(false),username=ref('admin'),error=ref(''),enabled=ref(true),passkeySupported=ref(false),passkeyAvailable=ref(false)
async function check(){error.value='';try{const session=await api('/api/auth/session');authenticated.value=session.authenticated;username.value=session.username;enabled.value=session.enabled;passkeySupported.value=session.passkeySupported;passkeyAvailable.value=session.passkeyAvailable}catch(e){error.value=e.message}finally{ready.value=true}}
function expired(){authenticated.value=false}
async function logout(){try{await api('/api/auth/logout',{method:'POST',body:'{}'});authenticated.value=false;location.href='/'}catch(e){error.value=e.message}}
onMounted(()=>{check();window.addEventListener('auth-expired',expired)})
onUnmounted(()=>window.removeEventListener('auth-expired',expired))
</script>
<template><PublicSite v-if="!admin" :authenticated="authenticated"/><div v-else-if="!ready" class="auth-loading" role="status">正在连接 VPS Monitor…</div><div v-else-if="error" class="auth-loading"><p role="alert">{{error}}</p><button class="button" @click="check">重试连接</button></div><Dashboard v-else-if="authenticated" :login-enabled="enabled" @logout="logout"/><LoginPage v-else :username="username" :passkey-supported="passkeySupported" :passkey-available="passkeyAvailable" @authenticated="check"/></template>
