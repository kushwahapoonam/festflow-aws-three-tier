import {createHash, randomUUID, timingSafeEqual} from 'node:crypto'
import {get, key, query, put, update, commit, table, type Write} from './db'
import {show, kitchen, kitchens, slots, type Seat, type Slot} from './catalog'
import {demand, type Actor, type Booking, type HoldInput, type Prep} from './types'

export const timestamp = (now = Date.now()) => new Date(now).toISOString()
export const workKey = (date: string, id: string) => date + '#' + id
const encode = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const booking = (id: string) => get<Booking>('BOOK#'+id)
export function publicBooking(row: Booking) {
  const {id, showId, venue, title, startsAt, seats, food, pickupAt, dishes, total, expiresAt, createdAt, status, ticket, prep, checkedAt} = row
  return {id, showId, venue, title, startsAt, seats, food, pickupAt, dishes, total, expiresAt, createdAt, status, ticket, prep, checkedAt}
}
export async function owned(actor: Actor, id: string) {
  const row = await booking(id)
  demand(row,404,'NOT_FOUND','Booking was not found.')
  demand(row.owner === actor.sub,403,'FORBIDDEN','This booking belongs to another customer.')
  return row
}
export function audit(actor: string, event: string, target: string, at = timestamp()) {
  return put({...key('AUDIT#ALL',workKey(at,randomUUID())), actor, event, target, at})
}
export async function availability(id: string) {
  const [screening, rows, menus] = await Promise.all([
    show(id), query<Seat>('SHOW#'+id,{prefix:'SEAT#'}), kitchens()
  ])
  demand(screening,404,'NOT_FOUND','Screening was not found.')
  return {
    screening,
    seats: rows.map(({id,booking,blocked}) => ({id,available:!booking && !blocked,blocked:!!blocked})),
    kitchens: await Promise.all(menus.filter(k => k.venue === screening.venue).map(async k => ({
      ...k, slots: (await slots(k.id)).filter(s => s.at <= screening.startsAt && s.at > timestamp()).map(s => ({...s, remaining:s.capacity-s.used}))
    })))
  }
}
export async function hold(actor: Actor, input: HoldInput, now = Date.now()) {
  const id = encode([actor.sub,input.requestId]).slice(0,32)
  const pk = 'BOOK#'+id
  const seatIds = [...input.seats].sort()
  const food = input.food && {...input.food,items:[...input.food.items].sort((a,b)=>a.id.localeCompare(b.id))}
  const fingerprint = encode([input.showId,seatIds,food])
  const prior = await booking(id)
  if (prior) {
    demand(prior.fingerprint === fingerprint,409,'IDEMPOTENCY_MISMATCH','Use a new checkout key after changing your selection.')
    return prior
  }
  const at = timestamp(now)
  const screening = await show(input.showId)
  demand(screening?.open && screening.startsAt > at,409,'SHOW_CLOSED','This screening is closed to new bookings.')
  let price = screening.price * seatIds.length
  let units = 0
  let pickupAt: string | undefined
  const dishes: NonNullable<Booking['dishes']> = []
  let ends = Date.parse(screening.startsAt)
  const extra: Write[] = []
  if (food) {
    const [menu, slot] = await Promise.all([kitchen(food.kitchenId),get<Slot>('KITCHEN#'+food.kitchenId,'SLOT#'+food.slotId)])
    demand(menu?.venue === screening.venue && slot && slot.at <= screening.startsAt && slot.at > at,400,'INVALID_PICKUP','Choose a valid pickup window at this venue.')
    for (const item of food.items) {
      const dish = menu.menu.find(d => d.id === item.id)
      demand(dish,400,'INVALID_DISH','Choose dishes from the selected kitchen.')
      dishes.push({name:dish.name,qty:item.qty})
      units += item.qty
      price += dish.price * item.qty
    }
    demand(units > 0 && units <= 6,400,'INVALID_QUANTITY','Choose one to six food items.')
    pickupAt = slot.at
    ends = Math.min(ends,Date.parse(slot.at))
    extra.push(update(key('KITCHEN#'+food.kitchenId,'SLOT#'+food.slotId),'ADD #used :units',
      '#used <= :free AND #capacity = :capacity AND #at = :slotAt',
      {':units':units,':free':slot.capacity-units,':capacity':slot.capacity,':slotAt':slot.at},{'#at':'at','#used':'used','#capacity':'capacity'}))
  }
  const expiresAt = timestamp(Math.min(ends,now+1000*Number(process.env.HOLD_SECONDS ?? 120)))
  const row: Booking = {
    ...key(pk),id,owner:actor.sub,showId:screening.id,venue:screening.venue,title:screening.title,startsAt:screening.startsAt,
    seats:seatIds,food,pickupAt,dishes:food?dishes:undefined,units,total:price,fingerprint,expiresAt,createdAt:at,status:'HELD',qrSecret:randomUUID()
  }
  const ok = await commit([
    update(key('FESTIVAL','SHOW#'+screening.id),'ADD bookingCount :one',
      '#open = :true AND startsAt = :start',{':one':1,':true':true,':start':screening.startsAt},{'#open':'open'}),
    ...seatIds.map(seat => update(key('SHOW#'+screening.id,'SEAT#'+seat),'SET booking = :id',
      'attribute_exists(pk) AND attribute_not_exists(booking) AND (attribute_not_exists(blocked) OR blocked = :off)',{':id':id,':off':false})),
    ...extra,
    put({...row,gpk:'DUE',gsk:workKey(expiresAt,id),vpk:'VENUE#'+row.venue,vsk:workKey(at,id)}),
    put({...key(pk,'OWNER'),gpk:'OWNER#'+actor.sub,gsk:workKey(at,id),id}),
    audit(actor.sub,'HOLD_CREATED',id,at)
  ])
  if (ok) return row
  const winner = await booking(id)
  if (winner) {
    demand(winner.fingerprint === fingerprint,409,'IDEMPOTENCY_MISMATCH','Use a new checkout key after changing your selection.')
    return winner
  }
  demand(false,409,'INVENTORY_CONFLICT','A seat or pickup window changed. Review live availability and try again.')
}
export async function history(actor: Actor) {
  const pointers = await query<{id:string}>('OWNER#'+actor.sub,undefined,'Lookup',100,true)
  const rows = await Promise.all(pointers.map(p => booking(p.id)))
  return rows.flatMap(row => row && row.owner === actor.sub ? [publicBooking(row)] : [])
}
function release(row: Booking): Write[] {
  const writes = row.seats.map(seat => update(key('SHOW#'+row.showId,'SEAT#'+seat),'REMOVE booking',
    'booking = :id',{':id':row.id}))
  if (row.food) writes.push(update(key('KITCHEN#'+row.food.kitchenId,'SLOT#'+row.food.slotId),'ADD #used :negative',
    '#used >= :units',{':negative':-row.units,':units':row.units},{'#used':'used'}))
  return writes
}
export async function expire(row: Booking, now = Date.now()) {
  const at = timestamp(now)
  return await commit([
    update(key(row.pk),'SET #status = :expired REMOVE gpk, gsk','#status = :held AND expiresAt <= :now',
      {':expired':'EXPIRED',':held':'HELD',':now':at},{'#status':'status'}),
    ...release(row), audit('system','HOLD_EXPIRED',row.id,at)
  ])
}
export async function cancel(actor: Actor, id: string, now = Date.now()) {
  const row = await owned(actor,id)
  if (row.status === 'CANCELLED') return row
  const at = timestamp(now)
  const ok = await commit([
    update(key(row.pk),'SET #status = :cancelled REMOVE gpk, gsk, kpk, ksk',
      '(#status = :held AND expiresAt > :now) OR (#status = :confirmed AND startsAt > :now AND attribute_not_exists(checkedAt) AND (attribute_not_exists(prep) OR prep = :queued))',
      {':cancelled':'CANCELLED',':held':'HELD',':confirmed':'CONFIRMED',':now':at,':queued':'QUEUED'},{'#status':'status'}),
    ...release(row), audit(actor.sub,'BOOKING_CANCELLED',id,at)
  ])
  const fresh = await owned(actor,id)
  demand(ok || fresh.status === 'CANCELLED',409,'CANNOT_CANCEL','This booking can no longer be cancelled.')
  return fresh
}
type PaymentResult = {outcome:'APPROVED'|'DECLINED'; scenario:'approve'|'decline'}
export async function pay(actor: Actor, id: string, attemptId: string, scenario: 'approve'|'decline', now?: number) {
  const row = await owned(actor,id)
  const sk = 'PAY#'+attemptId
  const existing = async () => {
    const receipt = await get<PaymentResult>(row.pk,sk)
    if (!receipt) return undefined
    demand(receipt.scenario === scenario,409,'IDEMPOTENCY_MISMATCH','This payment key was used with a different scenario.')
    return {outcome:receipt.outcome,booking:publicBooking(await owned(actor,id))}
  }
  const previous = await existing()
  if (previous) return previous
  const at = timestamp(now)
  const approved = scenario === 'approve'
  const outcome = approved ? 'APPROVED' : 'DECLINED'
  const condition = '#status = :held AND expiresAt > :now'
  const values = {':held':'HELD',':now':at}
  const writes: Write[] = [put({...key(row.pk,sk),scenario,outcome,at}),audit(actor.sub,'PAYMENT_'+outcome,id,at)]
  if (approved) {
    const foodValues = row.food ? {':prep':'QUEUED',':kp':'KITCHEN#'+row.food.kitchenId,':ks':row.food.slotId+'#'+at+'#'+id} : {}
    const foodUpdate = row.food ? ', prep = :prep, kpk = :kp, ksk = :ks' : ''
    writes.push(update(key(row.pk),'SET #status = :confirmed, ticket = :pending'+foodUpdate+' REMOVE gpk, gsk',
      condition,{...values,':confirmed':'CONFIRMED',':pending':'PENDING',...foodValues},{'#status':'status'}))
    writes.push(put({...key(row.pk,'OUTBOX'),id,gpk:'OUTBOX',gsk:workKey(at,id),createdAt:at}))
  } else {
    writes.push({ConditionCheck:{TableName: table, Key:key(row.pk),ConditionExpression:condition,
      ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:values}})
  }
  if (await commit(writes)) return {outcome,booking:publicBooking(await owned(actor,id))}
  const duplicate = await existing()
  if (duplicate) return duplicate
  demand(false,409,'PAYMENT_WINDOW_CLOSED','This hold has expired or was already settled. View your booking for its current status.')
}
export const ticketCode = (row: Booking) => 'FF1.'+row.id+'.'+row.qrSecret
export async function checkIn(actor: Actor, venue: string, code: string, now = Date.now()) {
  const match = /^FF1\.([a-f0-9]{32})\.([a-f0-9-]{36})$/.exec(code)
  demand(match,400,'INVALID_TICKET','Scan or paste a valid FestFlow ticket.')
  const row = await booking(match[1])
  demand(row,404,'NOT_FOUND','Ticket was not found.')
  demand(row.venue === venue,403,'WRONG_VENUE','This ticket is for another venue.')
  demand(timingSafeEqual(Buffer.from(match[2]),Buffer.from(row.qrSecret)),404,'NOT_FOUND','Ticket was not found.')
  const at = timestamp(now)
  const ok = await commit([
    update(key(row.pk),'SET checkedAt = :now','#status = :confirmed AND attribute_not_exists(checkedAt)',
      {':now':at,':confirmed':'CONFIRMED'},{'#status':'status'}), audit(actor.sub,'TICKET_CHECKED_IN',row.id,at)
  ])
  demand(ok,409,'CHECK_IN_CONFLICT','This booking has been cancelled or already checked in.')
  return {id:row.id,checkedAt:at}
}
export async function prepare(actor: Actor, kitchenId: string, id: string, status: Prep) {
  const row = await booking(id)
  demand(row,404,'NOT_FOUND','Booking was not found.')
  demand(row.food?.kitchenId === kitchenId,403,'FORBIDDEN','This order belongs to another kitchen.')
  if (row.prep === status && row.status === 'CONFIRMED') return publicBooking(row)
  const previous = {QUEUED:'',PREPARING:'QUEUED',READY:'PREPARING',COLLECTED:'READY'}[status]
  const ok = await commit([
    update(key(row.pk),'SET prep = :next','#status = :confirmed AND prep = :previous',
      {':next':status,':confirmed':'CONFIRMED',':previous':previous},{'#status':'status'}),
    audit(actor.sub,'KITCHEN_'+status,id)
  ])
  demand(ok,409,'ORDER_CHANGED','Refresh the order before changing its status.')
  return publicBooking((await booking(id))!)
}
