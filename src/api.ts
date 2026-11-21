import type {APIGatewayProxyEventV2WithJWTAuthorizer} from 'aws-lambda'
import {booking, publicBooking, owned, history, hold, cancel, pay, availability, checkIn, prepare, audit, timestamp} from './booking'
import {get, key, query, update, commit} from './db'
import {screenings, show, slots, kitchen} from './catalog'
import {demand, Problem, type Actor, type Booking, type Food, type Role} from './types'
import {ticketLink} from './tickets'

const roles = ['venue','kitchen','admin'] as const
type Claims = Record<string, unknown>
type Assignment = {role:Role; scopes:string[]}
async function actorFrom(claims: Claims = {}): Promise<Actor> {
  const {sub} = claims
  demand(typeof sub === 'string' && claims.token_use === 'access',401,'AUTH_REQUIRED','Sign in to continue.')
  const groupClaim = claims['cognito:groups']
  const groups = Array.isArray(groupClaim) ? groupClaim : String(groupClaim ?? '').replace(/[[\]"']/g,'').split(/[\s,]+/)
  const operatorRole = roles.find(role => groups.includes(role))
  if (groups.includes('admin')) return {sub,role:'admin',scopes:[]}
  if (operatorRole) {
    const assignment = await get<Assignment>('OP#'+sub)
    demand(assignment && assignment.role === operatorRole,403,'NO_ASSIGNMENT','An administrator must assign your work locations.')
    return {sub,...assignment}
  }
  return {sub,role:'customer',scopes:[]}
}
function permit(actor:Actor, role:Role, scope?:string) {
  demand(actor.role === role && (!scope || actor.scopes.includes(scope)),403,'FORBIDDEN','Your account does not have access to this operation or location.')
}
const slug = (value:unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
const strings = (value:unknown, max:number): value is string[] => Array.isArray(value) && value.length <= max && value.every(slug) && new Set(value).size === value.length
function foodInput(value:unknown): Food | undefined {
  if (value === undefined) return
  demand(value && typeof value === 'object',400,'INVALID_FOOD','Choose a kitchen, window and food items.')
  const {kitchenId,slotId,items} = value as Food
  demand(slug(kitchenId) && slug(slotId) && Array.isArray(items) && items.length > 0 && items.length <= 6 &&
    items.every(i => i && slug(i.id) && Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= 6) &&
    new Set(items.map(i=>i.id)).size === items.length,400,'INVALID_FOOD','Choose a valid kitchen, window and food quantities.')
  return {kitchenId,slotId,items:items.map(({id,qty})=>({id,qty}))}
}
async function route(method:string, path:string, raw:string, claims?:Claims): Promise<{data:unknown; status?:number}> {
  const match = /^\/api\/([a-z-]+)(?:\/([^/]+))?(?:\/([a-z-]+))?(?:\/([^/]+))?(?:\/([a-z-]+)\/([^/]+))?$/.exec(path)
  demand(match,404,'NOT_FOUND','Route was not found.')
  const [,group,id,action,subject,leaf,seat] = match
  if (method === 'GET' && path === '/api/events') return {data:await screenings()}
  if (method === 'GET' && group === 'shows' && id && action === 'availability' && !subject) return {data:await availability(id)}
  const actor = await actorFrom(claims)
  let body: Record<string,unknown> = {}
  if (!['GET','HEAD'].includes(method)) {
    try { body = JSON.parse(raw || '{}') } catch { throw new Problem(400,'INVALID_JSON','Send a valid JSON object.') }
    demand(body && typeof body === 'object' && !Array.isArray(body),400,'INVALID_JSON','Send a JSON object.')
  }
  if (method === 'GET' && path === '/api/me') return {data:{...actor,paymentMode:'simulation'}}
  if (method === 'POST' && path === '/api/holds') {
    permit(actor,'customer')
    const {requestId,showId,seats,food} = body
    demand(slug(requestId) && slug(showId) && strings(seats,6) && seats.length > 0,400,'INVALID_HOLD','Choose one to six distinct seats and include a checkout key.')
    return {data:publicBooking(await hold(actor,{requestId,showId,seats,food:foodInput(food)}))}
  }
  if (group === 'bookings' && !subject) {
    permit(actor,'customer')
    if (method === 'GET' && !id) return {data:await history(actor)}
    if (method === 'GET' && id && !action) return {data:publicBooking(await owned(actor,id))}
    if (method === 'POST' && id && action === 'payment') {
      const {attemptId,scenario} = body
      demand(slug(attemptId) && (scenario === 'approve' || scenario === 'decline'),400,'INVALID_PAYMENT','Choose a payment simulation and include an attempt key.')
      return {data:await pay(actor,id,attemptId,scenario)}
    }
    if (method === 'POST' && id && action === 'cancel') return {data:publicBooking(await cancel(actor,id))}
    if (method === 'GET' && id && action === 'ticket') {
      const row = await owned(actor,id)
      demand(row.status === 'CONFIRMED' && row.ticket === 'READY',409,'TICKET_UNAVAILABLE','A downloadable ticket is not available yet.')
      return {data:await ticketLink(id)}
    }
  }
  if (group === 'venue' && id) {
    permit(actor,'venue',id)
    if (method === 'GET' && action === 'bookings' && !subject) {
      const rows = await query<Booking>('VENUE#'+id,undefined,'Venue',100)
      return {data:{bookings:rows.filter(row=>row.venue===id).map(publicBooking),shows:(await screenings()).filter(s=>s.venue===id)}}
    }
    if (method === 'POST' && action === 'check-in' && !subject) {
      demand(typeof body.code === 'string' && body.code.length <= 100,400,'INVALID_TICKET','Scan or paste a ticket code.')
      return {data:await checkIn(actor,id,body.code)}
    }
    if (method === 'PATCH' && action === 'shows' && subject) {
      demand((await show(subject))?.venue === id,403,'FORBIDDEN','The screening is not assigned to this venue.')
      if (leaf === 'seats' && seat) {
        demand(typeof body.blocked === 'boolean',400,'INVALID_SEAT','Send a blocked flag.')
        const ok = await commit([update(key('SHOW#'+subject,'SEAT#'+seat),'SET blocked = :flag',
          'attribute_exists(pk) AND attribute_not_exists(booking)',{':flag':body.blocked}),audit(actor.sub,'SEAT_UPDATED',subject+'/'+seat)])
        demand(ok,409,'SEAT_IN_USE','The seat is reserved or does not exist.')
      } else if (!leaf) {
        const {open,startsAt} = body
        demand(open !== undefined || startsAt !== undefined,400,'INVALID_SHOW','Supply a booking flag or a future showtime.')
        const values:Record<string,unknown> = {':v':id}
        const names:Record<string,string> = {}
        const fields = []
        let condition = 'venue = :v'
        if (open !== undefined) {
          demand(typeof open === 'boolean',400,'INVALID_SHOW','The booking flag must be true or false.')
          fields.push('#open = :o')
          values[':o'] = open
          names['#open'] = 'open'
        }
        if (startsAt !== undefined) {
          demand(typeof startsAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(startsAt) &&
            Date.parse(startsAt) > Date.now(),400,'INVALID_SHOW','Provide a future ISO timestamp with an offset.')
          fields.push('startsAt = :s')
          values[':s'] = timestamp(Date.parse(startsAt))
          condition += ' AND attribute_not_exists(bookingCount)'
        }
        const ok = await commit([update(key('FESTIVAL','SHOW#'+subject),'SET '+fields.join(', '),condition,values,
          Object.keys(names).length ? names : undefined),audit(actor.sub,'SHOW_UPDATED',subject)])
        demand(ok,409,'SHOW_HAS_BOOKINGS','The showtime is fixed once a booking has been created.')
      } else throw new Problem(404,'NOT_FOUND','Route was not found.')
      return {data:{ok:true}}
    }
  }
  if (group === 'kitchen' && id && action === 'orders') {
    permit(actor,'kitchen',id)
    if (method === 'GET' && !subject) {
      const indexed = await query<Booking>('KITCHEN#'+id,undefined,'Kitchen',100)
      const latest = await Promise.all(indexed.map(r=>booking(r.id)))
      return {data:{windows:await slots(id),orders:latest.flatMap(r=>r?.status==='CONFIRMED'&&r.food?.kitchenId===id ? [publicBooking(r)] : [])}}
    }
    if (method === 'PATCH' && subject && !leaf) {
      const {status} = body
      demand(status === 'PREPARING' || status === 'READY' || status === 'COLLECTED',400,'INVALID_PREP','Choose a valid kitchen status.')
      return {data:await prepare(actor,id,subject,status)}
    }
  }
  if (group === 'admin') {
    permit(actor,'admin')
    if (method === 'GET' && path === '/api/admin/audit') {
      return {data:await query('AUDIT#ALL',undefined,undefined,100,true)}
    }
  }
  throw new Problem(404,'NOT_FOUND','Route was not found.')
}
async function assign(method:string,path:string,raw:string,claims?:Claims) {
  const match = /^\/api\/admin\/operators\/([0-9a-f-]{36})$/.exec(path)
  if (!match || method !== 'PUT') return route(method,path,raw,claims)
  const actor = await actorFrom(claims)
  permit(actor,'admin')
  let body
  try { body = JSON.parse(raw) } catch { throw new Problem(400,'INVALID_JSON','Send a valid JSON object.') }
  const {role,scopes} = body ?? {}
  demand((role === 'venue' || role === 'kitchen' || role === 'none') && strings(scopes,10) &&
    (role === 'none' ? scopes.length === 0 : scopes.length > 0),400,'INVALID_ASSIGNMENT','Supply an operator role and valid scope list.')
  const venues = new Set((await screenings()).map(s=>s.venue))
  for (const location of scopes) {
    demand(role === 'venue' ? venues.has(location) : await kitchen(location),400,'UNKNOWN_SCOPE','A selected scope does not exist.')
  }
  const target = match[1]
  await commit([{
    ...update(key('OP#'+target),'SET #role = :role, scopes = :scopes','attribute_not_exists(pk) OR attribute_exists(pk)',
      {':role':role,':scopes':scopes},{'#role':'role'})
  },audit(actor.sub,'OPERATOR_ASSIGNMENT_CHANGED',target)])
  return {data:{role,scopes}}
}
export async function respond(method:string,path:string,raw:string,claims:Claims|undefined,requestId:string) {
  let statusCode = 200
  let data:unknown
  let code = 'OK'
  try {
    demand(raw.length <= 12_000,413,'BODY_TOO_LARGE','The request is too large.')
    const result = await assign(method,path,raw,claims)
    data = result.data
    statusCode = result.status ?? 200
  } catch (error) {
    statusCode = error instanceof Problem ? error.status : 500
    code = error instanceof Problem ? error.code : 'INTERNAL'
    if (statusCode === 500) console.error(JSON.stringify({event:'api_error',requestId,errorType:(error as Error).name}))
    data = {error:code,message:error instanceof Problem ? error.message : 'FestFlow could not complete the request. Try again.',requestId}
  }
  // Route family only. Paths can contain actor subjects and booking identifiers.
  console.log(JSON.stringify({event:'api',requestId,method,route:path.split('/')[2],status:statusCode,code}))
  return {statusCode,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':requestId},body:JSON.stringify(data)}
}
export async function handler(event:APIGatewayProxyEventV2WithJWTAuthorizer) {
  return respond(event.requestContext.http.method,event.rawPath,
    event.isBase64Encoded ? Buffer.from(event.body ?? '','base64').toString() : event.body ?? '',
    event.requestContext.authorizer?.jwt?.claims,event.requestContext.requestId)
}
