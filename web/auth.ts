type Config = {loginUrl:string; clientId:string}
export const isLocal = import.meta.env.DEV
export const getToken = () => sessionStorage.getItem('ff-token')
const redirectUri = () => location.origin+'/'
const encode = (bytes:Uint8Array) => btoa(Array.from(bytes,c=>String.fromCharCode(c)).join('')).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
let configPromise:Promise<Config> | undefined
const config = () => configPromise ??= fetch('/auth-config.json',{cache:'no-store'}).then(response=>{
  if (!response.ok) throw Error('Sign-in configuration is unavailable.')
  return response.json()
})
export async function login() {
  const {loginUrl,clientId} = await config()
  const verifier = encode(crypto.getRandomValues(new Uint8Array(48)))
  const state = crypto.randomUUID()
  const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))
  sessionStorage.setItem('ff-pkce',JSON.stringify({verifier,state,returnPath:location.pathname}))
  const query = new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirectUri(),
    scope:'openid',state,code_challenge:challenge,code_challenge_method:'S256'})
  location.assign(loginUrl+'/oauth2/authorize?'+query)
}
export async function finishLogin() {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const failure = params.get('error')
  if (!code && !failure) return
  const stored = sessionStorage.getItem('ff-pkce')
  sessionStorage.removeItem('ff-pkce')
  history.replaceState(null,'','/')
  if (failure) throw Error('Sign-in did not finish. Try again.')
  const handshake = stored && JSON.parse(stored)
  if (!handshake || handshake.state !== params.get('state')) throw Error('The sign-in session expired. Start again from FestFlow.')
  const {loginUrl,clientId} = await config()
  const response = await fetch(loginUrl+'/oauth2/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code:code!,redirect_uri:redirectUri(),code_verifier:handshake.verifier})
  })
  if (!response.ok) throw Error('The sign-in code could not be exchanged. Try again.')
  sessionStorage.setItem('ff-token',(await response.json()).access_token)
  if (/^\/(?!\/)[\w/-]*$/.test(handshake.returnPath)) history.replaceState(null,'',handshake.returnPath)
}
export async function logout() {
  sessionStorage.removeItem('ff-token')
  if (isLocal) {location.assign('/');return}
  const {loginUrl,clientId} = await config()
  location.assign(loginUrl+'/logout?'+new URLSearchParams({client_id:clientId,logout_uri:redirectUri()}))
}
