export async function api(path, options={}) {
  const headers={...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})};
  const response=await fetch(path,{...options,headers});
  if(response.status===204)return null;
  const data=await response.json().catch(()=>({}));
  if(response.status===401&&!path.startsWith('/api/auth/'))window.dispatchEvent(new Event('auth-expired'));
  if(!response.ok)throw new Error(data.error||`请求失败 (${response.status})`);
  return data;
}
