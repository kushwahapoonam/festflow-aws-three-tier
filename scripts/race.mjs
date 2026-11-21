import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
const origin = process.env.FESTFLOW_URL
const tokens = [process.env.FESTFLOW_TOKEN_A,process.env.FESTFLOW_TOKEN_B]
assert(origin && /^https:\/\/[a-z0-9]+\.cloudfront\.net$/.test(origin),'Use your own FestFlow CloudFront URL with no trailing slash')
assert(tokens.every(Boolean) && tokens[0] !== tokens[1],'Provide two distinct customer access tokens')
const food = {kitchenId:'tiffin',slotId:'window-3',items:[{id:'puff',qty:1}]}
async function call(path, token, body) {
  const response = await fetch(origin+'/api'+path,{method:body?'POST':'GET',
    headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000),redirect:'error'})
  return {status:response.status,data:await response.json()}
}
const inventory = async () => {
  const result = await call('/shows/last-call/availability')
  assert.equal(result.status,200)
  assert.equal(result.data.screening.title,'Last Call')
  return [result.data.seats.find(s=>s.id==='A1')?.available,result.data.kitchens[0]?.slots.find(s=>s.id==='window-3')?.remaining]
}
assert.deepEqual(await inventory(),[true,1],'Demo fixture must be free before running the contention test')
const results = await Promise.allSettled(tokens.map(token=>call('/holds',token,{requestId:randomUUID(),showId:'last-call',seats:['A1'],food})))
try {
  const responses = results.map(settled=>{assert.equal(settled.status,'fulfilled');return settled.value})
  assert.deepEqual(responses.map(x=>x.status).sort(),[200,409])
  assert.deepEqual(await inventory(),[false,0])
  console.log('Live hold race passed. HTTP 200 and 409. A1 occupied and one pickup unit consumed.')
} finally {
  for (const [i,r] of results.entries()) {
    if (r.status==='fulfilled' && r.value.status===200) {
      const cancelled = await call('/bookings/'+r.value.data.id+'/cancel',tokens[i],{})
      assert.equal(cancelled.data.status,'CANCELLED')
    }
  }
}
assert.deepEqual(await inventory(),[true,1])
console.log('Winning hold cancelled. Seat and pickup unit recovered.')
