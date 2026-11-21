import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
process.env.DDB_ENDPOINT ??= 'http://127.0.0.1:8000'
const {createLocalTable,insertOnce,key} = await import('../src/db')
const {seed} = await import('../src/catalog')
const {respond} = await import('../src/api')
const {reconcile} = await import('../src/tickets')
await createLocalTable()
await seed()
const demo = {
  'customer-a': ['00000000-0000-4000-8000-000000000001', ''],
  'customer-b': ['00000000-0000-4000-8000-000000000002', ''],
  venue: ['00000000-0000-4000-8000-000000000003','venue'],
  kitchen: ['00000000-0000-4000-8000-000000000004','kitchen'],
  admin: ['00000000-0000-4000-8000-000000000005','admin']
}
await insertOnce({...key('OP#'+demo.venue[0]),role:'venue',scopes:['silk','banyan']})
await insertOnce({...key('OP#'+demo.kitchen[0]),role:'kitchen',scopes:['tiffin','curry']})
let working = false
setInterval(async () => {
  if (working) return
  working = true
  try { await reconcile() } catch (error) { console.error(error) } finally { working = false }
},5000).unref()
createServer(async (req,res)=>{
  const name = req.headers.authorization?.replace(/^Bearer local-/,'')
  const user = demo[name as keyof typeof demo]
  const chunks:Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 12000) { res.writeHead(413).end(); return }
    chunks.push(chunk)
  }
  const out = await respond(req.method ?? 'GET',new URL(req.url ?? '/', 'http://localhost').pathname,Buffer.concat(chunks).toString(),
    user ? {sub:user[0],token_use:'access','cognito:groups':user[1]} : undefined,randomUUID())
  res.writeHead(out.statusCode,out.headers).end(out.body)
}).listen(8787,'127.0.0.1',()=>console.log('Local API on 127.0.0.1:8787'))
