<script setup>
import { onMounted,onUnmounted,ref } from 'vue'
import { api } from './api.js'
import Dashboard from './Dashboard.vue'
import LoginPage from './components/LoginPage.vue'
const ready=ref(false),authenticated=ref(false),username=ref('admin'),error=ref(''),enabled=ref(true)
async function check(){error.value='';try{const session=await api('/api/auth/session');authenticated.value=session.authenticated;username.value=session.username;enabled.value=session.enabled}catch(e){error.value=e.message}finally{ready.value=true}}
function expired(){authenticated.value=false}
async function logout(){try{await api('/api/auth/logout',{method:'POST',body:'{}'});authenticated.value=false;location.hash='overview'}catch(e){error.value=e.message}}
onMounted(()=>{check();window.addEventListener('auth-expired',expired)})
onUnmounted(()=>window.removeEventListener('auth-expired',expired))
</script>
<template><div v-if="!ready" class="auth-loading" role="status">正在连接 VPS Monitor…</div><div v-else-if="error" class="auth-loading"><p role="alert">{{error}}</p><button class="button" @click="check">重试连接</button></div><Dashboard v-else-if="authenticated" :login-enabled="enabled" @logout="logout"/><LoginPage v-else :username="username" @authenticated="check"/></template>
