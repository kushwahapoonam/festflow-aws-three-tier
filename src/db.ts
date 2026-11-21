import { DynamoDBClient, CreateTableCommand, waitUntilTableExists } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb'

export const table = process.env.TABLE_NAME ?? 'festflow-local'
const endpoint = process.env.DDB_ENDPOINT
const client = new DynamoDBClient(endpoint ? {
  endpoint, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
} : {})
const db = DynamoDBDocumentClient.from(client, {marshallOptions: {removeUndefinedValues: true}})
export type Write = NonNullable<TransactWriteCommandInput['TransactItems']>[number]
export const key = (pk: string, sk = 'META') => ({pk, sk})
export const get = async <T>(pk: string, sk = 'META') =>
  (await db.send(new GetCommand({TableName: table, Key: key(pk, sk), ConsistentRead: true}))).Item as T | undefined

export async function query<T>(pk: string, sort?: {prefix: string} | {through: string}, index?: 'Lookup' | 'Venue' | 'Kitchen', max = Infinity, newest = false): Promise<T[]> {
  const attributes = index === 'Lookup' ? ['gpk', 'gsk'] : index === 'Venue' ? ['vpk', 'vsk'] : index === 'Kitchen' ? ['kpk', 'ksk'] : ['pk', 'sk']
  let expression = '#p = :p'
  const names: Record<string, string> = {'#p': attributes[0]}
  const values: Record<string, string> = {':p': pk}
  if (sort) {
    names['#s'] = attributes[1]
    values[':s'] = 'prefix' in sort ? sort.prefix : sort.through
    expression += 'prefix' in sort ? ' AND begins_with(#s, :s)' : ' AND #s <= :s'
  }
  const items: T[] = []
  let cursor: Record<string, unknown> | undefined
  do {
    const page = await db.send(new QueryCommand({
      TableName: table, IndexName: index, ConsistentRead: !index, ScanIndexForward: !newest, KeyConditionExpression: expression,
      ExpressionAttributeNames: names, ExpressionAttributeValues: values, ExclusiveStartKey: cursor,
      Limit: Number.isFinite(max) ? max - items.length : undefined
    }))
    items.push(...(page.Items ?? []) as T[])
    cursor = page.LastEvaluatedKey
  } while (cursor && items.length < max)
  return items
}
export async function insertOnce(item: Record<string, unknown>) {
  try {
    await db.send(new PutCommand({TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(pk)'}))
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error
  }
}
export function put(item: Record<string, unknown>): Write {
  return {Put: {TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(pk)'}}
}
export function update(Key: ReturnType<typeof key>, UpdateExpression: string, ConditionExpression: string,
  ExpressionAttributeValues: Record<string, unknown>, ExpressionAttributeNames?: Record<string, string>): Write {
  return {Update: {TableName: table, Key, UpdateExpression, ConditionExpression, ExpressionAttributeValues, ExpressionAttributeNames}}
}
// Re-evaluate business rules in the caller after a rejected transaction.
export async function commit(items: Write[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      await db.send(new TransactWriteCommand({TransactItems: items}))
      return true
    } catch (error) {
      if (!(error instanceof Error)) throw error
      if (error.name === 'TransactionCanceledException' && 'CancellationReasons' in error) {
        const reasons = error.CancellationReasons as {Code: string}[] | undefined
        if (reasons?.some(r => r.Code === 'ConditionalCheckFailed')) return false
        if (attempt >= 4 || !reasons?.some(r => r.Code === 'TransactionConflict')) throw error
      } else if (attempt >= 4 || error.name !== 'TransactionInProgressException') throw error
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1) + Math.random() * 30))
    }
  }
}
export async function createLocalTable() {
  if (!endpoint || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(endpoint)) throw Error('A loopback DynamoDB endpoint is required')
  const indexes = [['Lookup','gpk','gsk'], ['Venue','vpk','vsk'], ['Kitchen','kpk','ksk']]
  try {
    await client.send(new CreateTableCommand({
      TableName: table, BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: ['pk','sk',...indexes.flatMap(([,p,s]) => [p,s])].map(AttributeName => ({AttributeName,AttributeType:'S'})),
      KeySchema: [{AttributeName:'pk',KeyType:'HASH'},{AttributeName:'sk',KeyType:'RANGE'}],
      GlobalSecondaryIndexes: indexes.map(([IndexName,p,s]) => ({IndexName, KeySchema: [{AttributeName:p,KeyType:'HASH'},{AttributeName:s,KeyType:'RANGE'}], Projection:{ProjectionType:'ALL'}}))
    }))
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'ResourceInUseException') throw error
  }
  await waitUntilTableExists({client,maxWaitTime:20,minDelay:1}, {TableName: table})
}
