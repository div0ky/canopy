import { createServer, type Server } from 'node:http'

import { UndergrowthStore } from './store.js'

export interface UndergrowthServerOptions {
  readonly connectionString: string
  readonly host?: string
  readonly port?: number
}

export interface UndergrowthHost {
  readonly url: URL
  readonly shutdown: () => Promise<void>
}

export async function listenUndergrowth(options: UndergrowthServerOptions): Promise<UndergrowthHost> {
  const host = options.host ?? '127.0.0.1'
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('Undergrowth binds to loopback only. Use a local tunnel deliberately if remote access is required.')
  }
  const port = options.port ?? 4_400
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new TypeError('Undergrowth port must be between 0 and 65535.')
  const store = new UndergrowthStore(options.connectionString)
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${host}`)
      if (request.method !== 'GET') return json(response, 405, { ok: false, code: 'method_not_allowed', message: 'Undergrowth is read-only.', data: null })
      if (url.pathname === '/api/executions') {
        const data = await store.executions({
          ...(url.searchParams.get('kind') ? { kind: url.searchParams.get('kind')! } : {}),
          ...(url.searchParams.get('phase') ? { phase: url.searchParams.get('phase')! } : {}),
          ...(url.searchParams.get('search') ? { search: url.searchParams.get('search')! } : {}),
        })
        return json(response, 200, { ok: true, data })
      }
      if (url.pathname.startsWith('/api/timeline/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/timeline/'.length))
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json(response, 400, { ok: false, code: 'invalid_execution', message: 'Execution ID is invalid.', data: null })
        return json(response, 200, { ok: true, data: await store.timeline(id) })
      }
      if (url.pathname === '/api/health') return json(response, 200, { ok: true, data: { service: 'undergrowth' } })
      if (url.pathname === '/' || url.pathname === '/index.html') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        response.end(UNDERGROWTH_HTML)
        return
      }
      return json(response, 404, { ok: false, code: 'not_found', message: 'Not found.', data: null })
    } catch (error) {
      return json(response, 500, { ok: false, code: 'undergrowth_error', message: error instanceof Error ? error.message : 'Undergrowth failed.', data: null })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Undergrowth did not expose a TCP address.')
  return {
    url: new URL(`http://${host === '::1' ? '[::1]' : host}:${address.port}/`),
    shutdown: async () => { await closeServer(server); await store.close() },
  }
}

function json(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

const UNDERGROWTH_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Undergrowth · Canopy</title><style>
:root{color-scheme:dark;--bg:#06100e;--panel:#091512;--panel2:#0d1c18;--line:#21342e;--muted:#82958f;--text:#edf4ef;--green:#6ed690;--blue:#57a8ff;--red:#ff665e;--amber:#e9aa43;--mono:ui-monospace,SFMono-Regular,Menlo,monospace;--sans:Inter,ui-sans-serif,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 60% -20%,#123327 0,transparent 42%),var(--bg);color:var(--text);font:13px/1.45 var(--sans);overflow:hidden}button,input,select{font:inherit;color:inherit}.shell{height:100vh;display:grid;grid-template-rows:68px 1fr 28px}.top{display:grid;grid-template-columns:390px 1fr 260px;align-items:center;border-bottom:1px solid var(--line);padding:0 20px;gap:20px}.brand{display:flex;gap:13px;align-items:center}.mark{width:34px;height:34px;border:1px solid #2e5d46;background:#102b20;display:grid;place-items:center;color:var(--green);font-size:20px;border-radius:9px}.brand strong{display:block;font-size:19px;letter-spacing:-.02em}.brand small{color:var(--muted)}.search{height:40px;border:1px solid #31483f;border-radius:9px;background:#07100e;display:flex;align-items:center;padding:0 13px;gap:10px}.search input{border:0;outline:0;background:transparent;width:100%;font-family:var(--mono)}.local{justify-self:end;border:1px solid #30433c;background:#0b1714;border-radius:8px;padding:8px 13px}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:8px;box-shadow:0 0 10px #6ed69088}.workspace{min-height:0;display:grid;grid-template-columns:minmax(300px,25%) minmax(500px,1fr) minmax(330px,27%)}.pane{min-width:0;min-height:0;border-right:1px solid var(--line);display:flex;flex-direction:column}.pane:last-child{border-right:0}.pane-head{height:52px;flex:none;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 18px}.pane-head h2{font-size:14px;margin:0}.filters{padding:10px 12px;border-bottom:1px solid var(--line);display:flex;gap:6px;overflow:auto}.chip{border:1px solid var(--line);background:transparent;border-radius:6px;padding:5px 9px;color:var(--muted);cursor:pointer}.chip.active{background:#182822;color:var(--text);border-color:#385447}.scroll{overflow:auto;min-height:0}.execution{width:calc(100% - 20px);margin:8px 10px;padding:13px;border:1px solid transparent;background:transparent;text-align:left;display:grid;gap:8px;cursor:pointer;border-radius:7px}.execution:hover{background:#0d1b17}.execution.active{background:#121d1a;border-color:#4f8d68}.execution.failed{border-left:2px solid var(--red)}.execution-top,.execution-meta{display:flex;align-items:center;gap:8px}.execution-name{font:600 13px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.execution-meta{color:var(--muted);font:11px var(--mono)}.execution-meta .duration{margin-left:auto}.status{width:8px;height:8px;border-radius:50%;background:var(--green)}.status.failed{background:var(--red)}.kind{font:10px var(--mono);text-transform:uppercase;color:var(--green);background:#173322;padding:3px 5px;border-radius:4px}.empty{margin:auto;text-align:center;color:var(--muted);max-width:280px;padding:30px}.empty strong{display:block;color:var(--text);font-size:15px;margin-bottom:6px}.timeline{padding:22px 20px 60px}.observation{position:relative;display:grid;grid-template-columns:72px 26px minmax(0,1fr) auto;gap:10px;min-height:86px}.observation:before{content:"";position:absolute;left:84px;top:23px;bottom:-10px;width:1px;background:var(--blue)}.observation:last-child:before{display:none}.time{color:var(--muted);font:11px var(--mono);padding-top:6px;text-align:right}.node{width:12px;height:12px;margin:5px auto;border:2px solid var(--blue);background:var(--bg);border-radius:50%;z-index:1}.node.failed{border-color:var(--red);box-shadow:0 0 0 5px #ff665e19}.obs-card{padding:1px 10px 15px;cursor:pointer;min-width:0}.obs-card:hover .obs-name{color:var(--green)}.obs-kind{font:10px var(--mono);text-transform:uppercase;color:var(--muted)}.obs-name{font:600 14px var(--mono);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.obs-role{font:11px var(--mono);color:var(--muted);margin-top:4px}.obs-duration{font:11px var(--mono);color:var(--muted);padding-top:6px}.inspector{padding:18px;display:grid;gap:20px}.failure{color:var(--red);font-weight:650}.section h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 9px}.kv{display:grid;grid-template-columns:110px 1fr;gap:7px;font:11px var(--mono)}.kv dt{color:var(--muted)}.kv dd{margin:0;overflow-wrap:anywhere}.code{margin:0;background:#06100e;border:1px solid var(--line);border-radius:7px;padding:12px;white-space:pre-wrap;overflow:auto;max-height:280px;color:#b9d8cb;font:11px/1.55 var(--mono)}.footer{border-top:1px solid var(--line);display:flex;align-items:center;padding:0 14px;color:var(--muted);font:10px var(--mono)}.footer span:last-child{margin-left:auto}.error-banner{padding:9px 14px;background:#3b1715;color:#ffaaa5;border-bottom:1px solid #6a2823;display:none}.loading{opacity:.55;pointer-events:none}@media(max-width:1050px){.workspace{grid-template-columns:320px 1fr}.inspector-pane{position:fixed;right:0;top:68px;bottom:28px;width:390px;background:var(--panel);box-shadow:-20px 0 60px #0008}.top{grid-template-columns:280px 1fr}.local{display:none}}@media(max-width:720px){body{overflow:auto}.shell{height:auto;min-height:100vh}.top{grid-template-columns:1fr;padding:12px;height:auto}.search{display:none}.workspace{display:block}.pane{height:55vh;border-bottom:1px solid var(--line)}.inspector-pane{position:static;width:auto}.footer{display:none}}
</style><style>
.filters{flex:0 0 auto;overflow-x:auto;overflow-y:hidden}.chip{flex:0 0 auto}.scroll{flex:1 1 auto}
.kv{grid-template-columns:110px minmax(0,1fr)}
@media(max-width:720px){body{overflow-x:hidden;overflow-y:auto}.shell{width:100%;height:auto;min-height:100vh}.workspace{display:block;width:100%;min-width:0;max-width:100%;overflow:hidden}.pane{width:100%;min-width:0;max-width:100%;height:55vh}.timeline{padding:18px 10px 45px}.observation{grid-template-columns:44px 20px minmax(0,1fr) auto;gap:6px}.observation:before{left:55px}.inspector-pane{width:100%}.kv{grid-template-columns:88px minmax(0,1fr)}}
</style></head><body><div class="shell">
<header class="top"><div class="brand"><div class="mark">⌁</div><div><strong>Undergrowth</strong><small>Everything beneath your Canopy</small></div></div><label class="search"><span>⌕</span><input id="search" placeholder="Search executions, routes, jobs, events, roles…"></label><button class="local"><span class="dot"></span>Local</button></header>
<main class="workspace"><section class="pane"><div class="pane-head"><h2>Executions</h2><span id="count">0</span></div><div class="filters" id="filters"><button class="chip active" data-kind="" data-phase="">All</button><button class="chip" data-kind="http">HTTP</button><button class="chip" data-kind="job">Queue</button><button class="chip" data-kind="event">Event</button><button class="chip" data-kind="schedule">Schedule</button><button class="chip" data-phase="failed">Failed</button></div><div class="error-banner" id="error"></div><div class="scroll" id="executions"><div class="empty"><strong>Waiting beneath the surface</strong>Run your Canopy application and executions will appear here.</div></div></section>
<section class="pane"><div class="pane-head"><h2>Timeline</h2><span id="correlation"></span></div><div class="scroll timeline" id="timeline"><div class="empty"><strong>Choose an execution</strong>Follow every action, query, transaction, model, event, listener, job and exception in causal order.</div></div></section>
<aside class="pane inspector-pane"><div class="pane-head"><h2>Inspector</h2><span id="selected-kind">—</span></div><div class="scroll inspector" id="inspector"><div class="empty"><strong>No observation selected</strong>Select a point on the timeline to inspect its safe, redacted evidence.</div></div></aside></main>
<footer class="footer"><span><span class="dot"></span>Watching PostgreSQL</span><span>Read-only · secrets redacted</span></footer></div>
<script type="module">
const state={executions:[],timeline:[],execution:null,observation:null,kind:'',phase:'',search:''};const el=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const fmt=v=>v==null?'—':v<1?v.toFixed(2)+' ms':v<1000?Math.round(v)+' ms':(v/1000).toFixed(2)+' s';
async function api(url){const r=await fetch(url);const body=await r.json();if(!r.ok||!body.ok)throw new Error(body.message||'Undergrowth request failed');return body.data}
async function loadExecutions(){try{el('error').style.display='none';const p=new URLSearchParams();if(state.kind)p.set('kind',state.kind);if(state.phase)p.set('phase',state.phase);if(state.search)p.set('search',state.search);state.executions=await api('/api/executions?'+p);renderExecutions();if(!state.execution&&state.executions[0])await chooseExecution(state.executions[0].executionId)}catch(e){el('error').textContent=e.message;el('error').style.display='block'}}
function renderExecutions(){el('count').textContent=state.executions.length;el('executions').innerHTML=state.executions.length?state.executions.map(x=>'<button class="execution '+(x.executionId===state.execution?'active ':'')+(x.phase==='failed'?'failed':'')+'" data-id="'+esc(x.executionId)+'"><div class="execution-top"><span class="status '+(x.phase==='failed'?'failed':'')+'"></span><span class="kind">'+esc(x.transport||'run')+'</span><span class="execution-name">'+esc(x.name)+'</span></div><div class="execution-meta"><span>'+new Date(x.occurredAt).toLocaleTimeString()+'</span><span>· '+esc(x.phase)+'</span><span class="duration">'+fmt(x.durationMilliseconds)+'</span></div></button>').join(''):'<div class="empty"><strong>Waiting beneath the surface</strong>Run your Canopy application and executions will appear here.</div>';document.querySelectorAll('.execution').forEach(b=>b.onclick=()=>chooseExecution(b.dataset.id))}
async function chooseExecution(id){state.execution=id;renderExecutions();state.timeline=await api('/api/timeline/'+encodeURIComponent(id));state.observation=state.timeline.findLast(x=>x.phase==='failed')||state.timeline.at(-1)||null;el('correlation').textContent=state.timeline[0]?.context?.correlationId?'correlation '+state.timeline[0].context.correlationId.slice(0,8):'';renderTimeline();renderInspector()}
function renderTimeline(){if(!state.timeline.length){el('timeline').innerHTML='<div class="empty"><strong>No evidence recorded</strong>This execution has no observations.</div>';return}const base=Date.parse(state.timeline[0].occurredAt);el('timeline').innerHTML=state.timeline.map(x=>'<div class="observation"><div class="time">+'+(Date.parse(x.occurredAt)-base)+' ms</div><div class="node '+(x.phase==='failed'?'failed':'')+'"></div><div class="obs-card" data-id="'+esc(x.id)+'"><div class="obs-kind">'+esc(x.kind)+' · '+esc(x.phase)+'</div><div class="obs-name">'+esc(x.name)+'</div><div class="obs-role">'+esc(x.roleId||x.context.transportName||'framework boundary')+'</div></div><div class="obs-duration">'+fmt(x.durationMilliseconds)+'</div></div>').join('');document.querySelectorAll('.obs-card').forEach(b=>b.onclick=()=>{state.observation=state.timeline.find(x=>x.id===b.dataset.id);renderInspector()})}
function renderInspector(){const x=state.observation;if(!x)return;el('selected-kind').textContent=x.kind;const context=Object.entries(x.context||{}).map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('');el('inspector').innerHTML='<section class="section"><h3>Observation</h3><div class="'+(x.phase==='failed'?'failure':'')+'">'+esc(x.name)+' · '+esc(x.phase)+'</div></section>'+(x.error?'<section class="section"><h3>Exception</h3><div class="kv"><dt>class</dt><dd>'+esc(x.error.name)+'</dd><dt>message</dt><dd>'+esc(x.error.message)+'</dd></div></section>':'')+'<section class="section"><h3>Context</h3><dl class="kv"><dt>occurred</dt><dd>'+esc(new Date(x.occurredAt).toLocaleString())+'</dd><dt>duration</dt><dd>'+fmt(x.durationMilliseconds)+'</dd>'+context+'</dl></section><section class="section"><h3>Safe attributes</h3><pre class="code">'+esc(JSON.stringify(x.attributes,null,2))+'</pre></section>'+(x.error?.stack?'<section class="section"><h3>Stack</h3><pre class="code">'+esc(x.error.stack)+'</pre></section>':'')}
el('filters').onclick=e=>{const b=e.target.closest('[data-kind],[data-phase]');if(!b)return;state.kind=b.dataset.kind??'';state.phase=b.dataset.phase??'';document.querySelectorAll('.chip').forEach(x=>x.classList.toggle('active',x===b));loadExecutions()};let timer;el('search').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{state.search=e.target.value;loadExecutions()},180)};loadExecutions();setInterval(loadExecutions,3000);
</script></body></html>`
