import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
process.env.DDB_ENDPOINT ??= 'http://127.0.0.1:8000'
process.env.TABLE_NAME = 'festflow-test-'+randomUUID()
const {createLocalTable,get,key,insertOnce,query} = await import('../src/db')
const {seed,seats,slots} = await import('../src/catalog')
const {respond} = await import('../src/api')
const {booking,expire,ticketCode,pay} = await import('../src/booking')
const {generateTicket,reconcile} = await import('../src/tickets')
await createLocalTable()
await seed()

const customerA = {sub:'00000000-0000-4000-8000-000000000001',token_use:'access'}
const customerB = {sub:'00000000-0000-4000-8000-000000000002',token_use:'access'}
const operator = {sub:'00000000-0000-4000-8000-000000000003',token_use:'access','cognito:groups':'[silk-demo, venue]'}
const kitchenUser = {sub:'00000000-0000-4000-8000-000000000004',token_use:'access','cognito:groups':['kitchen']}
const admin = {sub:'00000000-0000-4000-8000-000000000005',token_use:'access','cognito:groups':['admin']}
await insertOnce({...key('OP#'+operator.sub),role:'venue',scopes:['silk']})
const call = async (method:string,path:string,payload?:unknown,actor:Record<string,unknown>|undefined=customerA) => {
  const response = await respond(method,'/api'+path,payload===undefined?'':JSON.stringify(payload),actor,randomUUID())
  return {status:response.statusCode,body:JSON.parse(response.body)}
}
const food = {kitchenId:'tiffin',slotId:'window-3',items:[{id:'puff',qty:1}]}
const slotCount = async () => (await slots('tiffin')).find(s=>s.id==='window-3')!.used
const countSeat = async (show:string,id:string) => (await seats(show)).find(s=>s.id===id)?.booking
const reserve = async (showId:string,seat:string, extras?:typeof food) => {
  const response = await call('POST','/holds',{showId,seats:[seat],food:extras,requestId:randomUUID()})
  assert.equal(response.status,200,JSON.stringify(response))
  return response.body
}
const atPayment = (id:string,attemptId=randomUUID(),scenario='approve') => call('POST','/bookings/'+id+'/payment',{attemptId,scenario})

test('competition for the final numbered seat and pickup slot reserves both once',async ()=>{
  const requests = await Promise.all([customerA,customerB].map(actor=>call('POST','/holds',{showId:'last-call',seats:['A1'],food,requestId:randomUUID()},actor)))
  assert.deepEqual(requests.map(r=>r.status).sort(),[200,409])
  const winner = requests.find(r=>r.status===200)!.body
  assert.equal(requests.find(r=>r.status===409)!.body.error,'INVENTORY_CONFLICT')
  assert.equal((await booking(winner.id))?.status,'HELD')
  assert.equal(await countSeat('last-call','A1'),winner.id)
  assert.equal(await slotCount(),1)
  const full = await call('POST','/holds',{showId:'last-call',seats:['A1','A2'],food,requestId:randomUUID()})
  assert.equal(full.status,409)
  assert.equal(await countSeat('last-call','A1'),winner.id)
  const owner = (await booking(winner.id))!.owner
  assert.equal((await call('POST','/bookings/'+winner.id+'/cancel',undefined,owner===customerA.sub?customerA:customerB)).status,200)
  assert.equal(await countSeat('last-call','A1'),undefined)
  assert.equal(await slotCount(),0)
})
test('full pickup slot rolls back otherwise available seats',async ()=>{
  const six = {...food,slotId:'window-1',items:[{id:'puff',qty:6}]}
  const first = await reserve('orbit','A1',six)
  const result = await call('POST','/holds',{showId:'orbit',seats:['A2','A3'],food:{...six,items:[{id:'puff',qty:1}]},requestId:randomUUID()})
  assert.equal(result.status,409)
  assert.equal(result.body.error,'INVENTORY_CONFLICT')
  assert.equal(await countSeat('orbit','A2'),undefined)
  assert.equal(await countSeat('orbit','A3'),undefined)
  assert.equal((await slots('tiffin'))[0].used,6)
  assert.equal((await call('POST','/bookings/'+first.id+'/cancel')).status,200)
})
test('parallel checkout replay and mismatched payload maintain one hold',async ()=>{
  const requestId = randomUUID()
  const payload = {showId:'last-call',seats:['A1'],food,requestId}
  const [a,b] = await Promise.all([call('POST','/holds',payload),call('POST','/holds',payload)])
  assert.equal(a.status,200)
  assert.equal(b.status,200)
  assert.equal(a.body.id,b.body.id)
  assert.equal(await slotCount(),1)
  assert.equal((await call('POST','/holds',{...payload,seats:['A2']})).body.error,'IDEMPOTENCY_MISMATCH')
  assert.equal((await call('POST','/bookings/'+a.body.id+'/cancel')).status,200)
})
test('decline, duplicate payment and late payment preserve receipts and inventory',async ()=>{
  const first = await reserve('monsoon','B1')
  const decline = await atPayment(first.id,randomUUID(),'decline')
  assert.equal(decline.body.outcome,'DECLINED')
  assert.equal(decline.body.booking.status,'HELD')
  const key = randomUUID()
  const replies = await Promise.all([atPayment(first.id,key),atPayment(first.id,key)])
  assert.deepEqual(replies.map(r=>r.status),[200,200])
  assert.deepEqual(replies.map(r=>r.body.outcome),['APPROVED','APPROVED'])
  assert.equal((await query('BOOK#'+first.id,{prefix:'PAY#'})).length,2)
  assert.equal(await countSeat('monsoon','B1'),first.id)
  const late = await reserve('orbit','B1')
  const row = (await booking(late.id))!
  const deadline = Date.parse(row.expiresAt)
  await assert.rejects(pay({...customerA,role:'customer',scopes:[]},row.id,randomUUID(),'approve',deadline),{code:'PAYMENT_WINDOW_CLOSED'})
  assert.equal((await booking(row.id))?.status,'HELD')
  assert.equal(await expire(row,deadline),true)
  assert.equal((await atPayment(row.id)).status,409)
  assert.equal((await booking(row.id))?.status,'EXPIRED')
  assert.equal(await countSeat('orbit','B1'),undefined)
})
test('concurrent eligible confirmation and expiry resolve once in the database',async ()=>{
  const actor = {...customerA,role:'customer' as const,scopes:[]}
  for (const seat of ['B2','B3','B4','B5']) {
    const fresh = await reserve('orbit',seat)
    const row = (await booking(fresh.id))!
    const deadline = Date.parse(row.expiresAt)
    const outcomes = await Promise.allSettled([pay(actor,row.id,randomUUID(),'approve',deadline-1),expire(row,deadline)])
    const final = (await booking(row.id))!
    if (final.status==='CONFIRMED') {
      assert.equal(outcomes[0].status,'fulfilled')
      assert.deepEqual(outcomes[1],{status:'fulfilled',value:false})
      assert.equal(await countSeat('orbit',seat),row.id)
    } else {
      assert.equal(final.status,'EXPIRED')
      assert.equal(outcomes[0].status,'rejected')
      assert.deepEqual(outcomes[1],{status:'fulfilled',value:true})
      assert.equal(await countSeat('orbit',seat),undefined)
    }
  }
})
test('two cancellations release inventory once',async ()=>{
  const b = await reserve('last-call','A1',food)
  assert.equal((await atPayment(b.id)).status,200)
  const out = await Promise.all([1,2].map(()=>call('POST','/bookings/'+b.id+'/cancel')))
  assert.deepEqual(out.map(x=>x.status),[200,200])
  assert.ok(out.every(x=>x.body.status==='CANCELLED'))
  assert.equal(await countSeat('last-call','A1'),undefined)
  assert.equal(await slotCount(),0)
  assert.equal((await query<{target:string;event:string}>('AUDIT#ALL')).filter(e=>e.target===b.id&&e.event==='BOOKING_CANCELLED').length,1)
})
test('confirmed booking stays valid during ticket failure and replay',async ()=>{
  const b = await reserve('monsoon','C1')
  const paid = await atPayment(b.id)
  assert.equal(paid.body.booking.ticket,'PENDING')
  assert.ok(await get('BOOK#'+b.id,'OUTBOX'))
  await assert.rejects(generateTicket(b.id,3,async()=>{throw Error('test object failure')}))
  assert.equal((await booking(b.id))?.ticket,'FAILED')
  assert.equal((await call('GET','/bookings/'+b.id+'/ticket')).status,409)
  assert.equal((await booking(b.id))?.status,'CONFIRMED')
  assert.equal(await countSeat('monsoon','C1'),b.id)
  await generateTicket(b.id)
  assert.equal((await booking(b.id))?.ticket,'READY')
  const file = await call('GET','/bookings/'+b.id+'/ticket')
  assert.equal(file.status,200)
  const png = Buffer.from(file.body.url.split(',')[1],'base64')
  assert.equal(png.subarray(1,4).toString(),'PNG')
  assert.equal((await call('GET','/bookings/'+b.id+'/ticket',undefined,customerB)).status,403)
})
test('duplicate scans admit once, and venue scope protects reads and writes',async ()=>{
  const b = await reserve('orbit','C1')
  await atPayment(b.id)
  const code = ticketCode((await booking(b.id))!)
  const scan = await Promise.all([1,2].map(()=>call('POST','/venue/silk/check-in',{code},operator)))
  assert.deepEqual(scan.map(r=>r.status).sort(),[200,409])
  assert.ok((await booking(b.id))?.checkedAt)
  assert.equal(await countSeat('orbit','C1'),b.id)
  assert.equal((await call('GET','/venue/banyan/bookings',undefined,operator)).status,403)
  assert.equal((await call('PATCH','/venue/banyan/shows/monsoon',{open:false},operator)).status,403)
  assert.equal((await call('PATCH','/venue/silk/shows/monsoon',{open:false},operator)).status,403)
  assert.equal((await call('PATCH','/venue/silk/shows/orbit/seats/D1',{blocked:true},operator)).status,200)
  assert.equal((await call('POST','/holds',{showId:'orbit',seats:['D1'],requestId:randomUUID()})).status,409)
})
test('administrator, kitchen and expiry worker use the published API rules',async ()=>{
  assert.equal((await call('GET','/me',undefined,{})).status,401)
  const assign = await call('PUT','/admin/operators/'+kitchenUser.sub,{role:'kitchen',scopes:['tiffin']},admin)
  assert.equal(assign.status,200)
  const b = await reserve('last-call','A1',food)
  await atPayment(b.id)
  assert.equal((await call('GET','/kitchen/tiffin/orders',undefined,kitchenUser)).status,200)
  assert.equal((await call('PATCH','/kitchen/tiffin/orders/'+b.id,{status:'READY'},kitchenUser)).status,409)
  for (const status of ['PREPARING','READY','COLLECTED']) {
    assert.equal((await call('PATCH','/kitchen/tiffin/orders/'+b.id,{status},kitchenUser)).status,200)
  }
  assert.equal((await call('POST','/bookings/'+b.id+'/cancel')).status,409)
  assert.equal((await call('GET','/admin/audit',undefined,admin)).status,200)
  const e = await reserve('monsoon','D1')
  await reconcile(Date.parse(e.expiresAt)+1)
  assert.equal((await booking(e.id))?.status,'EXPIRED')
  assert.equal(await countSeat('monsoon','D1'),undefined)
  assert.equal((await booking(b.id))?.ticket,'READY')
  assert.equal((await get<{gpk?:string}>('BOOK#'+b.id,'OUTBOX'))?.gpk,undefined)
})
