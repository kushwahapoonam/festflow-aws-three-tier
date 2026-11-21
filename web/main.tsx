import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import type {Screening,Kitchen,Slot} from '../src/catalog'
import type {Actor,Prep} from '../src/types'
import type {publicBooking,availability} from '../src/booking'
import {finishLogin,getToken,isLocal,login,logout} from './auth'
import './style.css'

type Booking = ReturnType<typeof publicBooking>
type Availability = Awaited<ReturnType<typeof availability>>
type Window = Slot
type CheckoutDraft = {canonical:string;requestId:string;showId:string;owner:string}
const draftKey = (owner:string) => 'ff-checkout-'+owner
function readDraft(owner:string): CheckoutDraft | undefined {
  const stored = sessionStorage.getItem(draftKey(owner))
  return stored ? JSON.parse(stored) : undefined
}
const money = (n:number) => '₹'+n.toLocaleString('en-IN')
const dateFormat = new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'})
const timeFormat = new Intl.DateTimeFormat('en-IN',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'})
const when = (s:string) => dateFormat.format(new Date(s))+' IST'
const time = (s:string) => timeFormat.format(new Date(s))+' IST'
const msg = (e:unknown) => e instanceof Error ? e.message : 'Something went wrong.'
async function call<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T> {
  const token = getToken()
  const response = await fetch('/api'+path,{method,signal,headers:{
    ...(token ? {Authorization:'Bearer '+token} : {}),...(body ? {'Content-Type':'application/json'} : {})
  },body:body === undefined ? undefined : JSON.stringify(body)})
  const value = await response.json().catch(()=>null)
  if (!response.ok) {
    if (response.status === 401 && token) {
      sessionStorage.removeItem('ff-token')
      window.dispatchEvent(new Event('festflow-session-expired'))
    }
    throw Error(value?.message ?? 'Request returned HTTP '+response.status+'.')
  }
  return value
}
function useLoad<T>(path:string,interval=0) {
  const [data,setData] = useState<T>()
  const [error,setError] = useState('')
  const [revision,refresh] = useState(0)
  useEffect(()=>{
    if (!path) return
    const controller = new AbortController()
    let timer:number
    async function load() {
      try {
        if (!document.hidden) {
          const value = await call<T>(path,'GET',undefined,controller.signal)
          if (!controller.signal.aborted) {setData(value);setError('')}
        }
      } catch(e) {if (!controller.signal.aborted) setError(msg(e))}
      if (interval && !controller.signal.aborted) timer = window.setTimeout(load,interval)
    }
    void load()
    return ()=>{controller.abort();window.clearTimeout(timer)}
  },[path,interval,revision])
  return {data,error,refresh:()=>refresh(v=>v+1)}
}
function Status({children}:{children:ReactNode}) {
  return <span className={'status '+String(children).toLowerCase()}>{String(children).replaceAll('_',' ')}</span>
}
function ErrorNote({text}:{text:string}) {
  return text ? <p className="error" role="alert">{text}</p> : null
}
function Poster({show}:{show:Screening}) {
  return <div className={'poster '+show.art} aria-hidden="true"><div className="film-shape"/><span>{show.title}</span></div>
}
function Discovery() {
  const {data,error,refresh} = useLoad<Screening[]>('/events')
  const [venue,setVenue] = useState('')
  const shows = data?.filter(s=>!venue||s.venue===venue).sort((a,b)=>a.startsAt.localeCompare(b.startsAt))
  return <>
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow">BENGALURU FILM & FOOD FESTIVAL</p><h1>Good films.<br/><em>Great food.</em></h1>
        <p>Find your screening, choose your seat, and have something delicious waiting at the venue.</p>
        <a className="button primary" href="#screenings">Explore screenings <span aria-hidden="true">↓</span></a>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="orb"/><div className="orbit one"/><div className="orbit two"/><div className="orbit three"/></div>
    </section>
    <section id="screenings" className="section">
      <div className="section-top"><div><p className="eyebrow">THE PROGRAMME</p><h2>Find your screening</h2></div>
        <label>Venue <select value={venue} onChange={e=>setVenue(e.target.value)}><option value="">All venues</option><option value="banyan">Banyan Courtyard</option><option value="silk">Silk Mill Studio</option></select></label>
      </div>
      <ErrorNote text={error}/>
      {error && <button onClick={refresh}>Try again</button>}
      {!shows && !error && <p>Loading the festival programme…</p>}
      {shows?.length===0 && <p>No screenings are available at this venue.</p>}
      <div className="cards">{shows?.map(s=><article className="card" key={s.id}>
        <Poster show={s}/><div className="card-content"><p className="eyebrow">{s.genre}</p><h3>{s.title}</h3><p>{s.note}</p>
        <p className="muted">{when(s.startsAt)} · {s.venueName}</p><div className="line"><strong>{money(s.price)}</strong>{s.open && Date.parse(s.startsAt)>Date.now() ? <a className="button" href={'/shows/'+s.id}>Choose seats</a> : <Status>CLOSED</Status>}</div>
        </div></article>)}</div>
    </section>
  </>
}
function SelectShow({id,actor}:{id:string;actor?:Actor}) {
  const {data,error,refresh} = useLoad<Availability>('/shows/'+id+'/availability',8000)
  const [chosen,setChosen] = useState<string[]>([])
  const [quantities,setQuantities] = useState<Record<string,number>>({})
  const [slot,setSlot] = useState('')
  const [notice,setNotice] = useState('')
  const [busy,setBusy] = useState(false)
  const lock = useRef(false)
  const kit: (Kitchen & {slots:(Slot&{remaining:number})[]})|undefined = data?.kitchens[0]
  const show = data?.screening
  const items = Object.entries(quantities).filter(([,qty])=>qty>0).map(([id,qty])=>({id,qty}))
  const units = items.reduce((n,i)=>n+i.qty,0)
  const slotAvailable = !!kit?.slots.some(s=>s.id===slot && s.remaining>=units)
  const stale = chosen.some(id=>!data?.seats.some(s=>s.id===id&&s.available))
  const closed = !!show && (!show.open || Date.parse(show.startsAt)<=Date.now())
  const previousDraft = actor && readDraft(actor.sub)
  const canResume = previousDraft?.showId === id
  async function reserve(resume = false) {
    if (lock.current || !show || (!resume && (stale || closed))) return
    if (!actor && !isLocal) {await login().catch(e=>setNotice(msg(e)));return}
    if (actor?.role !== 'customer') {setNotice('Sign in as a customer to reserve inventory.');return}
    lock.current=true
    setBusy(true)
    setNotice('')
    const selection = {showId:id,seats:[...chosen].sort(),...(units&&kit?{food:{kitchenId:kit.id,slotId:slot,items:items.sort((a,b)=>a.id.localeCompare(b.id))}}:{})}
    const canonical = resume && canResume ? previousDraft.canonical : JSON.stringify(selection)
    const requestId = previousDraft?.canonical===canonical ? previousDraft.requestId : crypto.randomUUID()
    sessionStorage.setItem(draftKey(actor.sub),JSON.stringify({canonical,requestId,showId:id,owner:actor.sub}))
    try {
      const held = await call<Booking>('/holds','POST',{...JSON.parse(canonical),requestId})
      sessionStorage.removeItem(draftKey(actor.sub))
      location.assign('/bookings/'+held.id)
    } catch(e) {
      setNotice(msg(e))
      refresh()
    } finally {lock.current=false;setBusy(false)}
  }
  if (!data||!show) return <section className="section"><ErrorNote text={error}/>{!error&&<p>Loading seats and pickup windows…</p>}</section>
  const total = chosen.length*show.price+items.reduce((sum,i)=>sum+i.qty*(kit?.menu.find(d=>d.id===i.id)?.price??0),0)
  return <section className="section">
    <a className="breadcrumb" href="/#screenings">← All screenings</a>
    <p className="eyebrow">{show.genre}</p><h1>{show.title}</h1><p className="muted">{when(show.startsAt)} · {show.venueName}</p>
    <ErrorNote text={error||notice}/>
    {closed && <p role="status" className="error">Booking is closed for this screening.</p>}
    {stale && <p role="status" className="error">A selected seat is no longer available. Deselect it to continue.</p>}
    <div className="split"><div className="panel"><h2>Choose your seats</h2><p className="muted">Up to six seats · {money(show.price)} each</p>
      <div className="screen">SCREEN</div>
      <div className="seatmap">{data.seats.map(s=><button key={s.id} className="seat" aria-pressed={chosen.includes(s.id)}
        disabled={busy||(!chosen.includes(s.id)&&(!s.available||chosen.length===6))}
        onClick={()=>setChosen(v=>v.includes(s.id)?v.filter(n=>n!==s.id):[...v,s.id])}>{s.id}</button>)}</div>
      <p className="muted">Availability refreshes every 8 seconds while this tab is visible.</p>
    </div><div className="panel"><h2>Pre-order food</h2>
      {!kit && <p>No kitchen menu is available for this screening.</p>}
      {kit && <><p className="muted">{kit.name} · Optional</p>{kit.menu.map(item=><div className="line dish" key={item.id}>
        <div><strong>{item.name}</strong><div className="muted">{item.detail} · {money(item.price)}</div></div>
        <select aria-label={item.name+' quantity'} value={quantities[item.id]??0} disabled={busy} onChange={e=>setQuantities(v=>({...v,[item.id]:Number(e.target.value)}))}>
          {[0,1,2,3,4,5,6].map(q=><option key={q}>{q}</option>)}
        </select></div>)}
        {units>0 && <label>Pickup window<select value={slot} disabled={busy} onChange={e=>setSlot(e.target.value)}><option value="">Select a pickup time</option>
          {kit.slots.map(w=><option key={w.id} value={w.id} disabled={w.remaining<units}>{time(w.at)} · {w.remaining} units left</option>)}</select></label>}
        {units>0 && !kit.slots.some(w=>w.remaining>=units) && <p className="error">No pickup window can fit that quantity.</p>}
      </>}
    </div></div>
    <div className="panel summary"><div><strong>{chosen.length} seat{chosen.length===1?'':'s'} · {units} food units</strong><p className="muted">We hold both together during simulated payment.</p></div>
      <strong className="total">{money(total)}</strong><button className="primary" disabled={busy||closed||stale||!chosen.length||units>6||(units>0&&!slotAvailable)} onClick={()=>reserve()}>
        {busy?'Reserving…':!actor?'Sign in to reserve':'Hold and continue'}
      </button>{canResume&&<button disabled={busy} onClick={()=>reserve(true)}>Resume last checkout</button>}</div>
  </section>
}
function Bookings({id}:{id?:string}) {
  const result = useLoad<Booking[]|Booking>(id?'/bookings/'+id:'/bookings',id?4000:0)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [note,setNote] = useState('')
  const [ticket,setTicket] = useState<{url:string;code:string}>()
  const lock=useRef(false)
  const [clock,setClock] = useState(Date.now)
  useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(t)},[])
  async function act(action:string,scenario?:string) {
    if (lock.current) return
    lock.current=true;setBusy(true);setError('')
    try {
      if (action==='ticket') setTicket(await call('/bookings/'+id+'/ticket'))
      else if (action==='payment') {
        const key='ff-pay-'+id+'-'+scenario
        const attemptId=sessionStorage.getItem(key)??crypto.randomUUID()
        sessionStorage.setItem(key,attemptId)
        const value=await call<{outcome:string}>('/bookings/'+id+'/payment','POST',{attemptId,scenario})
        setNote(value.outcome==='APPROVED'?'Simulated payment approved.':'Simulated payment declined. Your hold is still active.')
        result.refresh()
      } else {
        await call('/bookings/'+id+'/cancel','POST')
        setTicket(undefined);setNote('Booking cancelled. Inventory was released.');result.refresh()
      }
    } catch(e) {setError(msg(e));result.refresh()} finally {lock.current=false;setBusy(false)}
  }
  const row = result.data && !Array.isArray(result.data) ? result.data : undefined
  return <section className="section">
    {id && <a className="breadcrumb" href="/bookings">← Booking history</a>}
    <h1>{row?.title??(id?'Your booking':'Booking history')}</h1>
    <ErrorNote text={error||result.error}/>{note&&<p role="status">{note}</p>}
    {!result.data && !result.error && <p>Loading booking information…</p>}
    {Array.isArray(result.data) && (result.data.length ? <div className="rows">{result.data.map(b=><a key={b.id} className="panel line" href={'/bookings/'+b.id}><div><strong>{b.title}</strong><div className="muted">{when(b.startsAt)} · Seats {b.seats.join(', ')}</div></div><Status>{b.status}</Status></a>)}</div> :
      <div className="panel"><p>Your festival bookings will appear here.</p><a className="button" href="/">Explore the programme</a></div>)}
    {row && <div className="split"><div className="panel">
      <div className="line"><h2>Reservation</h2><Status>{row.status}</Status></div>
      <p>{when(row.startsAt)} · Seats {row.seats.join(', ')}</p><p>Total <strong>{money(row.total)}</strong></p>
      {row.food && <p>Food pickup · {row.pickupAt?when(row.pickupAt):row.food.slotId.replace('window-','Window ')} · {(row.dishes??row.food.items.map(i=>({name:i.id,qty:i.qty}))).map(i=>i.qty+' × '+i.name).join(', ')}</p>}
      {row.status==='HELD' && <>
        <p role="status">{clock<Date.parse(row.expiresAt)?'Hold expires in '+Math.ceil((Date.parse(row.expiresAt)-clock)/1000)+' seconds.':'Hold deadline reached. Inventory reconciliation is pending.'}</p>
        <div className="actions"><button className="primary" disabled={busy||clock>=Date.parse(row.expiresAt)} onClick={()=>act('payment','approve')}>Simulate approval</button>
        <button disabled={busy||clock>=Date.parse(row.expiresAt)} onClick={()=>act('payment','decline')}>Simulate decline</button></div>
      </>}
      {((row.status==='HELD'&&clock<Date.parse(row.expiresAt))||
        (row.status==='CONFIRMED'&&!row.checkedAt&&(!row.prep||row.prep==='QUEUED')&&clock<Date.parse(row.startsAt))) &&
        <button className="quiet" disabled={busy} onClick={()=>act('cancel')}>Cancel booking</button>}
    </div><div className="panel"><div className="line"><h2>Entry ticket</h2>{row.status==='CONFIRMED'&&row.ticket&&<Status>{row.ticket}</Status>}</div>
      {row.status==='CONFIRMED'?<>
        {row.ticket==='PENDING'&&<p>Payment is confirmed. Your QR ticket is being prepared.</p>}
        {row.ticket==='FAILED'&&<p>Your booking is confirmed. Ticket delivery needs an operator retry.</p>}
        {row.ticket==='READY'&&<><button disabled={busy} onClick={()=>act('ticket')}>Load QR ticket</button>
          {ticket&&<div className="qr"><img src={ticket.url} alt="Entry QR code"/><a href={ticket.url} target="_blank" rel="noreferrer">Open ticket image</a><button onClick={()=>navigator.clipboard.writeText(ticket.code).then(()=>setNote('Ticket code copied.')).catch(e=>setError(msg(e)))}>Copy code for manual check-in</button></div>}
        </>}
        {row.checkedAt&&<p>Checked in at {when(row.checkedAt)}.</p>}
      </>:<p>Tickets are available for confirmed bookings.</p>}
    </div></div>}
  </section>
}
function QrScanner({onScan}:{onScan:(code:string)=>void}) {
  const video=useRef<HTMLVideoElement>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true
    let stop:(()=>void)|undefined
    import('@zxing/browser').then(async ({BrowserQRCodeReader})=>{
      if (!active || !video.current) return
      const scanner=new BrowserQRCodeReader()
      const controls=await scanner.decodeFromVideoDevice(undefined,video.current,(result,_,c)=>{
        if (active&&result) {active=false;c.stop();onScan(result.getText())}
      })
      stop=()=>controls.stop()
      if (!active) stop()
    }).catch(e=>{if(active)setError(msg(e))})
    return()=>{active=false;stop?.()}
  },[onScan])
  return <><video ref={video} muted playsInline aria-label="QR scanner preview"/><ErrorNote text={error}/></>
}
function Venue({scope}:{scope:string}) {
  const path='/venue/'+scope
  const {data,error,refresh}=useLoad<{shows:Screening[];bookings:Booking[]}>(path+'/bookings',12000)
  const current=data?.shows[0]?.id??''
  const [showId,setShow]=useState('')
  const show=data?.shows.find(s=>s.id===(showId||current))
  const avail=useLoad<Availability>(show?'/shows/'+show.id+'/availability':'')
  const [code,setCode]=useState('')
  const [date,setDate]=useState('')
  const [notice,setNotice]=useState('')
  const [problem,setProblem]=useState('')
  const [camera,setCamera]=useState(false)
  async function change(route:string,body:unknown,method='PATCH') {
    setProblem('');setNotice('')
    try {await call(path+route,method,body);setNotice(route==='/check-in'?'Ticket accepted. Guest checked in.':'Screening updated.');refresh();avail.refresh()}
    catch(e){setProblem(msg(e))}
  }
  return <><ErrorNote text={error||problem||avail.error}/>{notice&&<p role="status">{notice}</p>}
    <div className="split"><div className="panel"><h2>Check in a guest</h2><form onSubmit={e=>{e.preventDefault();void change('/check-in',{code:code.trim()},'POST')}}>
      <label>Ticket code<input value={code} onChange={e=>setCode(e.target.value)} required placeholder="FF1.…"/></label>
      <div className="actions"><button className="primary">Validate ticket</button><button type="button" onClick={()=>setCamera(!camera)}>{camera?'Stop camera':'Scan QR'}</button></div>
      </form>{camera&&<QrScanner onScan={value=>{setCode(value);setCamera(false)}}/>}</div>
      <div className="panel"><h2>Manage screenings</h2>
      {!show?<p>No screenings assigned.</p>:<>
        <label>Screening<select value={show.id} onChange={e=>{setShow(e.target.value);setDate('')}}>{data?.shows.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <p>{when(show.startsAt)} · {show.open?'Bookings open':'Bookings closed'}</p>
        <button onClick={()=>change('/shows/'+show.id,{open:!show.open})}>{show.open?'Close bookings':'Open bookings'}</button>
        <form onSubmit={e=>{e.preventDefault();void change('/shows/'+show.id,{startsAt:date+':00+05:30'})}}>
          <label>New showtime (IST)<input type="datetime-local" required value={date} onChange={e=>setDate(e.target.value)}/></label><button>Update showtime</button>
        </form>
        <p className="muted">Select an unreserved seat to block or unblock it.</p>
        <div className="seatmap">{avail.data?.screening.id===show.id&&avail.data.seats.map(s=><button className="seat" key={s.id}
          aria-pressed={s.blocked} disabled={!s.available&&!s.blocked} onClick={()=>change('/shows/'+show.id+'/seats/'+s.id,{blocked:!s.blocked})}>{s.id}</button>)}</div>
      </>}
    </div></div>
    <div className="panel stacked"><h2>Venue bookings</h2>
      {data?.bookings.length===0&&<p>No reservations at this venue.</p>}
      {data?.bookings.map(b=><div className="line entry" key={b.id}><div><strong>{b.title}</strong><div className="muted">{b.id.slice(0,8)} · {b.seats.join(', ')}</div></div><Status>{b.checkedAt?'CHECKED IN':b.status}</Status></div>)}
    </div></>
}
function KitchenBoard({scope}:{scope:string}) {
  const path='/kitchen/'+scope+'/orders'
  const {data,error,refresh}=useLoad<{windows:Window[];orders:Booking[]}>(path,10000)
  const [problem,setProblem]=useState('')
  const [saving,setSaving]=useState('')
  async function move(id:string,status:Prep) {
    setProblem('');setSaving(id)
    try {await call(path+'/'+id,'PATCH',{status});refresh()} catch(e){setProblem(msg(e))} finally {setSaving('')}
  }
  return <><ErrorNote text={error||problem}/>
    {!data&&!error&&<p>Loading the pickup board…</p>}
    <div className="cards">{data?.windows.map(w=>{
      const orders=data.orders.filter(o=>o.food?.slotId===w.id)
      return <article className="panel" key={w.id}><h2>{time(w.at)}</h2><p className="muted">{w.used} of {w.capacity} units reserved</p>
      {orders.length===0&&<p>No confirmed food orders in this window.</p>}
      {orders.map(o=>{
        const next=o.prep&&({QUEUED:'PREPARING',PREPARING:'READY',READY:'COLLECTED',COLLECTED:undefined} as const)[o.prep]
        return <div className="entry" key={o.id}><div className="line"><strong>{o.id.slice(0,8)}</strong><Status>{o.prep}</Status></div>
          <p>{(o.dishes??o.food?.items.map(i=>({name:i.id,qty:i.qty})))?.map(i=>i.qty+' × '+i.name).join(', ')}</p>{next&&<button disabled={saving===o.id} onClick={()=>move(o.id,next)}>Mark {next.toLowerCase()}</button>}</div>
      })}</article>
    })}</div></>
}
function Admin() {
  const {data,error,refresh}=useLoad<{event:string;at:string;target:string;sk:string}[]>('/admin/audit')
  const [sub,setSub]=useState('')
  const [role,setRole]=useState('venue')
  const [scopes,setScopes]=useState('')
  const [notice,setNotice]=useState('')
  const [problem,setProblem]=useState('')
  async function submit(e:FormEvent) {
    e.preventDefault();setProblem('');setNotice('')
    try {await call('/admin/operators/'+sub.trim(),'PUT',{role,scopes:role==='none'?[]:scopes.split(',').map(s=>s.trim()).filter(Boolean)});setNotice('Assignment saved.');refresh()}
    catch(e){setProblem(msg(e))}
  }
  return <><ErrorNote text={problem||error}/>{notice&&<p role="status">{notice}</p>}<div className="split">
    <div className="panel"><h2>Operator assignments</h2><p>Use the operator’s Cognito subject and existing group. Scope IDs are banyan, silk, curry and tiffin.</p>
    <form onSubmit={submit}><label>Cognito subject<input value={sub} onChange={e=>setSub(e.target.value)} required/></label>
      <label>Role<select value={role} onChange={e=>setRole(e.target.value)}><option value="venue">Venue</option><option value="kitchen">Kitchen</option><option value="none">Revoke assignment</option></select></label>
      {role!=='none'&&<label>Locations (comma separated)<input value={scopes} onChange={e=>setScopes(e.target.value)} required/></label>}<button className="primary">Save assignment</button></form></div>
    <div className="panel"><div className="line"><h2>Audit history</h2><button onClick={refresh}>Refresh</button></div>
      {data?.length===0&&<p>No actions recorded yet.</p>}
      {data?.map(a=><div className="entry" key={a.sk}><strong>{a.event.replaceAll('_',' ')}</strong><div className="muted">{when(a.at)} · {a.target.slice(0,16)}</div></div>)}
    </div></div></>
}
function Operations({actor}:{actor:Actor}) {
  const [scope,setScope]=useState(actor.scopes[0]??'')
  return <section className="section"><div className="section-top"><h1>{actor.role==='venue'?'Venue desk':actor.role==='kitchen'?'Kitchen board':'Platform administration'}</h1>
    {actor.scopes.length>1&&<label>Location<select value={scope} onChange={e=>setScope(e.target.value)}>{actor.scopes.map(s=><option key={s}>{s}</option>)}</select></label>}
    </div>
    {actor.role==='admin'?<Admin/>:actor.role==='venue'&&scope?<Venue key={scope} scope={scope}/>:actor.role==='kitchen'&&scope?<KitchenBoard key={scope} scope={scope}/>:<p>No operator location is assigned.</p>}
  </section>
}
const authReady=finishLogin()
function App() {
  const [actor,setActor]=useState<Actor>()
  const [authError,setAuthError]=useState('')
  const [loading,setLoading]=useState(true)
  const [path,setPath]=useState(location.pathname)
  useEffect(()=>{
    const expired=()=>{setActor(undefined);setAuthError('Your session expired. Sign in again.')}
    window.addEventListener('festflow-session-expired',expired)
    authReady.then(async()=>{setPath(location.pathname);if(getToken())setActor(await call<Actor>('/me'))}).catch(e=>setAuthError(msg(e))).finally(()=>setLoading(false))
    return()=>window.removeEventListener('festflow-session-expired',expired)
  },[])
  const show=/^\/shows\/([\w-]+)$/.exec(path)?.[1]
  const bookings=/^\/bookings(?:\/([a-f0-9]{32}))?\/?$/.exec(path)
  const loginButton=<button className="primary" onClick={()=>login().catch(e=>setAuthError(msg(e)))}>Sign in</button>
  return <>
    <header className="nav"><a className="brand" href="/"><span aria-hidden="true">◈</span>FestFlow</a><nav aria-label="Main navigation">
      <a href="/#screenings">Screenings</a>{actor?.role==='customer'&&<a href="/bookings">My bookings</a>}{actor&&actor.role!=='customer'&&<a href="/operations">Operations</a>}
      {isLocal?<select aria-label="Local demo account" value={getToken()?.replace('local-','')??''} onChange={e=>{
        if(e.target.value) sessionStorage.setItem('ff-token','local-'+e.target.value)
        else sessionStorage.removeItem('ff-token')
        location.reload()
      }}><option value="">Demo sign-in</option><option value="customer-a">Customer A</option><option value="customer-b">Customer B</option><option value="venue">Venue operator</option><option value="kitchen">Kitchen operator</option><option value="admin">Administrator</option></select>:
      !actor && !getToken()?loginButton:<button onClick={()=>logout().catch(e=>setAuthError(msg(e)))}>Sign out</button>}
    </nav></header>
    <main><ErrorNote text={authError}/>{show?<SelectShow id={show} actor={actor}/>:bookings&&actor?.role==='customer'?<Bookings id={bookings[1]}/>:path==='/operations'&&actor&&actor.role!=='customer'?<Operations actor={actor}/>:
      path==='/'?<Discovery/>:<section className="section"><h1>{loading?'Loading…':bookings||path==='/operations'?'Sign in with the appropriate account':'Page unavailable'}</h1><a href="/">Back to the programme</a></section>}</main>
    <footer><a className="brand" href="/">◈ FestFlow</a><span>Bengaluru Film & Food Festival · Demo</span></footer>
  </>
}
createRoot(document.getElementById('root')!).render(<App/>)
