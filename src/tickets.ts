import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import QRCode from 'qrcode'
import {S3Client, PutObjectCommand, GetObjectCommand} from '@aws-sdk/client-s3'
import {getSignedUrl} from '@aws-sdk/s3-request-presigner'
import {SQSClient, SendMessageCommand} from '@aws-sdk/client-sqs'
import type {SQSEvent, SQSBatchResponse} from 'aws-lambda'
import {booking, expire, timestamp, ticketCode, audit} from './booking'
import {commit, get, key, query, update} from './db'
import type {Booking} from './types'

const s3 = new S3Client({})
const sqs = new SQSClient({})
const objectKey = (id: string) => 'tickets/'+id+'.png'
const local = !!process.env.DDB_ENDPOINT
const fileRoot = process.env.TICKET_DIR ?? '.festflow/tickets'
const eligible = '#status = :confirmed AND ticket IN (:pending, :failed)'
const eligibleValues = {':confirmed':'CONFIRMED',':pending':'PENDING',':failed':'FAILED'}
type Outbox = {pk:string; id:string; createdAt:string; gpk?:string}

export async function ticketLink(id: string) {
  const command = new GetObjectCommand({Bucket:process.env.TICKET_BUCKET,Key:objectKey(id)})
  if (local) {
    const entry = (await booking(id))!
    return {url:'data:image/png;base64,'+(await readFile(join(fileRoot,id+'.png'))).toString('base64'), code:ticketCode(entry)}
  }
  return {url:await getSignedUrl(s3,command,{expiresIn:90}),code:ticketCode((await booking(id))!)}
}
export async function generateTicket(id: string, receiveCount = 1, storeOverride?: (id:string, image:Buffer)=>Promise<void>) {
  const row = await booking(id)
  if (!row || row.status !== 'CONFIRMED' || row.ticket === 'READY') return
  try {
    if (process.env.FAIL_TICKET_ID === id) throw Error('InjectedTicketFailure')
    const image = await QRCode.toBuffer(ticketCode(row), {width:360, margin:3, errorCorrectionLevel:'M'})
    if (storeOverride) await storeOverride(id,image)
    else if (local) {
      await mkdir(fileRoot,{recursive:true})
      await writeFile(join(fileRoot,id+'.png'),image)
    } else await s3.send(new PutObjectCommand({
      Bucket:process.env.TICKET_BUCKET,Key:objectKey(id),Body:image,ContentType:'image/png',CacheControl:'private, no-store'
    }))
  } catch (error) {
    if (receiveCount >= 3) await commit([
      update(key(row.pk),'SET ticket = :failed','#status = :confirmed AND ticket = :pending',eligibleValues,{'#status':'status'}),
      audit('system','TICKET_FAILED',id)
    ])
    throw error
  }
  await commit([
    update(key(row.pk),'SET ticket = :ready',eligible,{...eligibleValues,':ready':'READY'},{'#status':'status'}),
    audit('system','TICKET_READY',id)
  ])
}
export async function consume(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures = []
  for (const message of event.Records) {
    try {
      const {id} = JSON.parse(message.body)
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw Error('InvalidTicketJob')
      await generateTicket(id,Number(message.attributes.ApproximateReceiveCount))
    } catch (error) {
      console.error(JSON.stringify({event:'ticket_job_failed',messageId:message.messageId,errorType:(error as Error).name}))
      batchItemFailures.push({itemIdentifier:message.messageId})
    }
  }
  return {batchItemFailures}
}
export async function reconcile(now = Date.now()) {
  const at = timestamp(now)
  const due = await query<Booking>('DUE',{through:at+'#~'},'Lookup',25)
  let expired = 0
  for (const row of due) {
    if (await expire(row,now)) expired++
  }
  const pending = await query<Outbox>('OUTBOX',undefined,'Lookup',25)
  let sent = 0
  let failures = 0
  for (const candidate of pending) {
    const job = await get<Outbox>(candidate.pk,'OUTBOX')
    if (job?.gpk !== 'OUTBOX') continue
    try {
      if (local) await generateTicket(job.id)
      else await sqs.send(new SendMessageCommand({QueueUrl:process.env.TICKET_QUEUE,MessageBody:JSON.stringify({id:job.id})}))
      const marked = await commit([update(key(job.pk,'OUTBOX'),'SET sentAt = :at REMOVE gpk, gsk','gpk = :pending',
        {':at':at,':pending':'OUTBOX'})])
      if (marked) sent++
    } catch (error) {
      failures++
      console.error(JSON.stringify({event:'outbox_send_failed',bookingId:job.id,errorType:(error as Error).name}))
    }
  }
  const result = {event:'reconcile',expired,sent,failures,
    expiryLagSeconds:due.length ? Math.max(0,Math.floor((now-Date.parse(due[0].expiresAt))/1000)) : 0}
  console.log(JSON.stringify(result))
  return result
}

export async function scheduled() {
  return reconcile()
}
