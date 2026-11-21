import { get, insertOnce, key, query } from './db'

export type Screening = {id: string; venue: string; venueName: string; title: string; note: string; genre: string; startsAt: string; open: boolean; price: number; art: string}
export type Seat = {id: string; booking?: string; blocked?: boolean}
export type Slot = {id: string; at: string; used: number; capacity: number}
export type Dish = {id: string; name: string; price: number; detail: string}
export type Kitchen = {id: string; name: string; venue: string; menu: Dish[]}

export const screenings = () => query<Screening>('FESTIVAL', {prefix:'SHOW#'})
export const show = (id: string) => get<Screening>('FESTIVAL', 'SHOW#' + id)
export const seats = (id: string) => query<Seat>('SHOW#' + id, {prefix:'SEAT#'})
export const kitchens = () => query<Kitchen>('FESTIVAL', {prefix:'KITCHEN#'})
export const kitchen = (id: string) => get<Kitchen>('FESTIVAL', 'KITCHEN#' + id)
export const slots = (id: string) => query<Slot>('KITCHEN#' + id, {prefix:'SLOT#'})
export async function seed(now = Date.now()) {
  const date = new Date(now + 7 * 86400000).toISOString().slice(0,10)
  const at = (time: string) => date + 'T' + time + ':00.000Z'
  const shows: Screening[] = [
    {id:'monsoon', venue:'banyan', venueName:'Banyan Courtyard', title:'The Monsoon Cut', note:'A Bengaluru sound recordist follows the first rain through a city that never goes quiet.', genre:'Independent cinema', startsAt:at('12:30'), open:true, price:320, art:'rain'},
    {id:'orbit', venue:'silk', venueName:'Silk Mill Studio', title:'Between Orbits', note:'Three strangers meet on the last bus before a lunar eclipse.', genre:'Science fiction', startsAt:at('13:30'), open:true, price:280, art:'moon'},
    {id:'afterlight', venue:'banyan', venueName:'Banyan Courtyard', title:'Afterlight', note:'Short films about the city after the shops close.', genre:'Short film collection', startsAt:at('15:00'), open:true, price:250, art:'sun'},
    {id:'last-call', venue:'silk', venueName:'Silk Mill Studio', title:'Last Call', note:'A trio of midnight comedies from local filmmakers.', genre:'Comedy shorts', startsAt:at('16:30'), open:true, price:250, art:'moon'}
  ]
  const menus: Kitchen[] = [
    {id:'curry',name:'Curry Leaf Counter',venue:'banyan',menu:[{id:'bun',name:'Ghee podi bun',price:120,detail:'Chilli, curry leaf and jaggery butter'},{id:'lime',name:'Salted lime soda',price:80,detail:'Fresh lime and black salt'}]},
    {id:'tiffin',name:'The Tiffin Window',venue:'silk',menu:[{id:'puff',name:'Pepper mushroom puff',price:140,detail:'Flaky pastry and cracked pepper'},{id:'coffee',name:'Cold filter coffee',price:100,detail:'Chicory blend over ice'}]}
  ]
  for (const s of shows) {
    await insertOnce({...key('FESTIVAL', 'SHOW#'+s.id), ...s})
    const ids = s.id === 'last-call' ? ['A1'] : ['A','B','C','D'].flatMap(row => [1,2,3,4,5,6].map(n => row+n))
    for (const id of ids) await insertOnce({...key('SHOW#'+s.id,'SEAT#'+id),id})
  }
  for (const k of menus) {
    await insertOnce({...key('FESTIVAL','KITCHEN#'+k.id),...k})
    const times = k.id === 'curry' ? ['11:45','12:00','14:30'] : ['12:45','13:00','16:00']
    for (const [i,time] of times.entries()) {
      const id = 'window-'+(i+1)
      await insertOnce({...key('KITCHEN#'+k.id,'SLOT#'+id),id,at:at(time),used:0,capacity:i === 2 ? 1 : 6})
    }
  }
}
