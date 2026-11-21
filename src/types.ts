export type Role = 'customer' | 'venue' | 'kitchen' | 'admin'
export type Actor = {sub: string; role: Role; scopes: string[]}
export type Food = {kitchenId: string; slotId: string; items: {id: string; qty: number}[]}
export type HoldInput = {requestId: string; showId: string; seats: string[]; food?: Food}
export type State = 'HELD' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED'
export type Prep = 'QUEUED' | 'PREPARING' | 'READY' | 'COLLECTED'
export type TicketState = 'PENDING' | 'READY' | 'FAILED'
export type Booking = {
  pk: string; sk: string; id: string; owner: string; showId: string; venue: string; title: string
  startsAt: string; seats: string[]; food?: Food; pickupAt?: string; dishes?: {name:string;qty:number}[]; units: number; total: number
  fingerprint: string; expiresAt: string; createdAt: string; status: State; qrSecret: string
  ticket?: TicketState; prep?: Prep; checkedAt?: string
}
export class Problem extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
export function demand(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new Problem(status, code, message)
}
