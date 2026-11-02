/* MainTroll front-end.
   Data source:
   - API_BASE empty  -> demo mode: records live in this browser's localStorage (same key as before).
   - API_BASE set    -> live mode: expects REST endpoints below. Adjust `request()` paths to match
                        your API Gateway / Lambda routes.
        GET    {API_BASE}/equipment | /tasks | /documents | /alerts   -> JSON arrays
        POST   {API_BASE}/{kind}            (create)
        PATCH  {API_BASE}/{kind}/{id}       (update)
        DELETE {API_BASE}/{kind}/{id}       (remove)
*/
"use strict";

const API_BASE = ""; // e.g. "https://abc123.execute-api.eu-north-1.amazonaws.com/prod"
const STORAGE_KEY = "maintroll-demo-v1";

const initialData = {
  equipment: [
    {id:1,name:"Main pump A",location:"Platform 1",criticality:"Critical",status:"Operational"},
    {id:2,name:"Gas compressor B",location:"Platform 1",criticality:"Critical",status:"Under Maintenance"},
    {id:3,name:"Fire pump C",location:"Platform 2",criticality:"Warning",status:"Operational"},
    {id:4,name:"Crane D",location:"Deck 3",criticality:"Warning",status:"Out of Service"},
    {id:5,name:"Lighting panel E",location:"Deck 1",criticality:"Normal",status:"Operational"}
  ],
  tasks: [
    {id:1,title:"Quarterly inspection",equipment:"Main pump A",due:"2026-10-04",priority:"High",status:"Pending",assigned:"Not assigned"},
    {id:2,title:"Replace seals",equipment:"Gas compressor B",due:"2026-10-25",priority:"Critical",status:"In Progress",assigned:"A. Hansen"},
    {id:3,title:"Load test",equipment:"Crane D",due:"2026-11-03",priority:"Medium",status:"Pending",assigned:"M. Berg"},
    {id:4,title:"Battery check",equipment:"Lighting panel E",due:"2026-11-18",priority:"Low",status:"Pending",assigned:"Not assigned"}
  ],
  documents: [
    {id:1,name:"Pressure test report",equipment:"Gas compressor B",expires:"2026-10-23"},
    {id:2,name:"Inspection certificate",equipment:"Main pump A",expires:"2026-11-07"},
    {id:3,name:"Service report",equipment:"Crane D",expires:"2026-11-12"},
    {id:4,name:"Safety certificate",equipment:"Lighting panel E",expires:"2026-11-25"}
  ],
  alerts: [
    {id:1,priority:90,type:"Overdue maintenance",item:"Replace seals (Gas compressor B)",state:"Sent"},
    {id:2,priority:90,type:"Document expired",item:"Pressure test report (Gas compressor B)",state:"Open"},
    {id:3,priority:80,type:"Overdue maintenance",item:"Quarterly inspection (Main pump A)",state:"Open"},
    {id:4,priority:70,type:"Document expiring",item:"Inspection certificate (Main pump A)",state:"Open"}
  ]
};

/* ---------- Constants & helpers ---------- */
const TASK_STATUSES = ["Pending","In Progress","Completed","Cancelled"];
const EQUIP_STATUSES = ["Operational","Under Maintenance","Out of Service","Retired"];
const ALERT_STATES = ["Open","Sent","Acknowledged","Resolved"];
const PRIORITY_RANK = {Critical:0,High:1,Medium:2,Low:3};
const VIEWS = {
  dashboard:{title:"Dashboard"}, alerts:{title:"Alerts"}, tasks:{title:"Maintenance Tasks"},
  equipment:{title:"Equipment"}, documents:{title:"Documents"}, reports:{title:"Reports"}, settings:{title:"Settings"}
};

const ICONS = {
  home:'<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  bell:'<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  tasks:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 14l2 2 4-4"/>',
  equipment:'<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><path d="M7 7h.01M7 17h.01"/>',
  document:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings:'<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  upload:'<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  check:'<path d="M5 12l5 5 9-10"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  warn:'<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'
};
const icon = n => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[n]||""}</svg>`;

function esc(v=""){ return String(v).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
const pad = n => String(n).padStart(2,"0");
function today(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function daysUntil(dateStr){ return Math.round((new Date(dateStr+"T12:00:00") - new Date(today()+"T12:00:00"))/86400000); }
function fmtDate(date){ if(!date) return "—"; return new Date(date+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); }
function plural(n,w){ return `${n} ${w}${n===1?"":"s"}`; }

const isOpenTask = t => !["Completed","Cancelled"].includes(t.status);
const isOverdue = t => isOpenTask(t) && t.due < today();
const alertActive = a => ["Open","Sent"].includes(a.state);
const severity = p => p>=90?"Critical":p>=75?"High":p>=50?"Medium":"Low";
function docState(d){ const n=daysUntil(d.expires); return n<0?"Expired":n<=30?"Expiring soon":"Valid"; }

function pillClass(value){
  return "pill pill-"+String(value).toLowerCase().replace(/\s+/g,"-");
}
const pill = v => `<span class="${pillClass(v)}">${esc(v)}</span>`;

/* ---------- Data layer ---------- */
let data = {equipment:[],tasks:[],documents:[],alerts:[]};

async function request(method,path,body){
  const res = await fetch(API_BASE+path,{method,headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});
  if(!res.ok) throw new Error(`${method} ${path} failed (${res.status})`);
  return res.status===204 ? null : res.json();
}
function loadLocal(){
  try { const s=localStorage.getItem(STORAGE_KEY); return s?JSON.parse(s):structuredClone(initialData); }
  catch { return JSON.parse(JSON.stringify(initialData)); }
}
function saveLocal(){ try { localStorage.setItem(STORAGE_KEY,JSON.stringify(data)); } catch(e){ console.warn("Could not save demo data",e); } }

const store = {
  demo: !API_BASE,
  async load(){
    if(this.demo){ data = loadLocal(); return; }
    const kinds=["equipment","tasks","documents","alerts"];
    const results = await Promise.all(kinds.map(k=>request("GET","/"+k)));
    kinds.forEach((k,i)=>{ data[k]=Array.isArray(results[i])?results[i]:[]; });
  },
  async add(kind,rec){
    if(this.demo){ data[kind].push({id:Date.now(),...rec}); saveLocal(); return; }
    await request("POST","/"+kind,rec); await this.load();
  },
  async update(kind,id,patch){
    if(this.demo){ const r=data[kind].find(x=>x.id===id); if(r) Object.assign(r,patch); saveLocal(); return; }
    await request("PATCH",`/${kind}/${id}`,patch); await this.load();
  },
  async remove(kind,id){
    if(this.demo){ data[kind]=data[kind].filter(x=>x.id!==id); saveLocal(); return; }
    await request("DELETE",`/${kind}/${id}`); await this.load();
  },
  reset(){ data=structuredClone(initialData); saveLocal(); }
};

/* ---------- State ---------- */
const state = {
  view:"dashboard", query:"", status:"loading", error:"",
  filters:{
    alerts:{state:"All",severity:"All"},
    tasks:{tab:"open",priority:"All",equipment:"All",sort:"due"},
    equipment:{status:"All",criticality:"All"},
    documents:{validity:"All",equipment:"All"},
    reports:{from:"",to:""}
  }
};
const $ = id => document.getElementById(id);
const matches = (...vals) => { const q=state.query.trim().toLowerCase(); return !q || vals.join(" ").toLowerCase().includes(q); };
let toastTimer;
function toast(msg){ const el=$("toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),3500); }

/* ---------- Reusable components ---------- */
function panel(title,subtitle,actionHtml,body,cls=""){
  return `<section class="panel ${cls}"><div class="panel-heading"><div><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:""}</div>${actionHtml||""}</div>${body}</section>`;
}
function kpi({label,value,note,ico,href,tone=""}){
  const inner = `<span class="kpi-label">${icon(ico)}${esc(label)}</span><span class="kpi-value">${value}</span><span class="kpi-note">${esc(note)}</span>`;
  return href ? `<a class="kpi tone-${tone}" href="${href}">${inner}</a>` : `<div class="kpi tone-${tone}">${inner}</div>`;
}
function table(label,cols,rows,emptyMsg){
  return `<div class="table-wrap"><table aria-label="${esc(label)}"><thead><tr>${cols.map(c=>`<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.length?rows.join(""):`<tr><td class="empty-state" colspan="${cols.length}">${esc(emptyMsg)}</td></tr>`}</tbody></table></div>`;
}
function selectField(id,path,label,options,current){
  return `<label class="field" for="${id}">${esc(label)}<select id="${id}" data-filter="${path}">${options.map(o=>{const [v,t]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${String(current)===String(v)?"selected":""}>${esc(t)}</option>`;}).join("")}</select></label>`;
}
function segmented(path,options,current){
  return `<div class="segmented" role="group" aria-label="Filter by view">${options.map(([v,t,n])=>`<button type="button" data-filter="${path}" data-value="${v}" aria-pressed="${current===v}">${esc(t)}<span class="n">${n}</span></button>`).join("")}</div>`;
}
function bars(items,total){
  const max = Math.max(1,...items.map(i=>i.value));
  return `<div class="bars" role="list">${items.map(i=>`<div class="bar-row" role="listitem"><span>${esc(i.label)}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill ${i.tone||""}" style="width:${Math.round(i.value/max*100)}%"></div></div><b>${i.value}</b></div>`).join("")}</div>`;
}
function searchChip(){
  return state.query.trim() ? `<div class="chip">Search: “${esc(state.query)}”<button type="button" data-clear-search aria-label="Clear search">×</button></div>` : "";
}
function openTasksFor(name){ return data.tasks.filter(t=>t.equipment===name && isOpenTask(t)); }

/* ---------- Views ---------- */
function dashboardView(){
  const total=data.equipment.length;
  const operational=data.equipment.filter(e=>e.status==="Operational").length;
  const overdue=data.tasks.filter(isOverdue).length;
  const upcoming=data.tasks.filter(t=>isOpenTask(t)&&!isOverdue(t)).length;
  const critical=data.alerts.filter(a=>alertActive(a)&&a.priority>=90).length;
  const hour=new Date().getHours();
  const greet = hour<12?"Good morning":hour<18?"Good afternoon":"Good evening";
  const dateLabel = new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

  const nextTasks=data.tasks.filter(isOpenTask).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,5);
  const topAlerts=data.alerts.filter(alertActive).sort((a,b)=>b.priority-a.priority).slice(0,4);

  const counts=EQUIP_STATUSES.map(s=>({s,n:data.equipment.filter(e=>e.status===s).length}));
  const healthBody = total ? `<div class="panel-body">
      <div class="health-bar" role="img" aria-label="${counts.map(c=>`${c.n} ${c.s}`).join(", ")}">${counts.filter(c=>c.n).map(c=>`<span class="s-${c.s.toLowerCase().replace(/\s+/g,"-")}" style="width:${c.n/total*100}%"></span>`).join("")}</div>
      <div class="legend">${counts.map(c=>`<div class="legend-row"><span class="lab"><i class="swatch s-${c.s.toLowerCase().replace(/\s+/g,"-")}"></i>${esc(c.s)}</span><span><b>${c.n}</b><span class="pct">${Math.round(c.n/total*100)}%</span></span></div>`).join("")}</div>
    </div>` : `<p class="empty-state">No equipment registered yet.</p>`;

  const taskRows = nextTasks.length ? nextTasks.map(t=>`<div class="list-row"><div><strong>${esc(t.title)}</strong><span class="sub">${esc(t.equipment)}</span></div><div class="right"><span class="${isOverdue(t)?"overdue-text":""}">${fmtDate(t.due)}${isOverdue(t)?" (overdue)":""}</span>${pill(t.status)}</div></div>`).join("") : `<p class="empty-state">No open maintenance tasks.</p>`;
  const alertRows = topAlerts.length ? topAlerts.map(a=>`<div class="list-row"><div><strong>${esc(a.type)}</strong><span class="sub">${esc(a.item)}</span></div><div class="right">${pill(severity(a.priority))}${pill(a.state)}</div></div>`).join("") : `<p class="empty-state">No unresolved alerts.</p>`;

  return `
  <section class="greeting hero" aria-label="Welcome"><div class="hero-inner"><p class="eyebrow hero-eyebrow">OFFSHORE OPERATIONS</p><p class="greeting-title">${greet}, User</p><p class="greeting-sub">${esc(dateLabel)} · Here is the current state of your offshore assets.</p></div></section>

  <section class="kpi-grid" aria-label="Summary">
    ${kpi({label:"Total equipment",value:total,note:"Registered assets",ico:"equipment",href:"#equipment"})}
    ${kpi({label:"Operational",value:operational,note:total?`${Math.round(operational/total*100)}% of equipment`:"No equipment",ico:"check",href:"#equipment?status=Operational",tone:"green"})}
    ${kpi({label:"Upcoming maintenance",value:upcoming,note:"Open, not yet overdue",ico:"clock",href:"#tasks?tab=upcoming"})}
    ${kpi({label:"Overdue maintenance",value:overdue,note:overdue?"Needs action":"Nothing overdue",ico:"warn",href:"#tasks?tab=overdue",tone:overdue?"red":""})}
    ${kpi({label:"Open critical alerts",value:critical,note:"Severity 90+, unresolved",ico:"bell",href:"#alerts?severity=Critical",tone:critical?"red":""})}
  </section>

  <section class="quick-grid" aria-label="Quick actions">
    <button type="button" class="quick-action" data-open-modal="equipmentModal"><span class="quick-icon">${icon("plus")}</span><span><strong>Add equipment</strong><small>Register a new asset</small></span></button>
    <button type="button" class="quick-action" data-open-modal="taskModal"><span class="quick-icon">${icon("tasks")}</span><span><strong>Create maintenance task</strong><small>Schedule inspection or repair</small></span></button>
    <button type="button" class="quick-action" data-open-modal="documentModal"><span class="quick-icon">${icon("upload")}</span><span><strong>Upload document</strong><small>Add certificate or report</small></span></button>
    <a class="quick-action" href="#reports"><span class="quick-icon">${icon("chart")}</span><span><strong>View reports</strong><small>Analytics and insights</small></span></a>
  </section>

  <div class="grid-dash">
    ${panel("Critical and recent alerts","Highest severity, unresolved first",`<a class="panel-link" href="#alerts">View all alerts →</a>`,alertRows)}
    ${panel("Equipment health","Current status of all equipment",`<a class="panel-link" href="#equipment">View equipment →</a>`,healthBody)}
    ${panel("Upcoming maintenance","Next open tasks, earliest due date first",`<a class="panel-link" href="#tasks">View all tasks →</a>`,taskRows,"span-2")}
  </div>`;
}

function alertsView(){
  const f=state.filters.alerts;
  const base=data.alerts.filter(a=>matches(a.type,a.item,a.state,severity(a.priority)));
  const items=base.filter(a=>(f.state==="All"||a.state===f.state)&&(f.severity==="All"||severity(a.priority)===f.severity)).sort((a,b)=>b.priority-a.priority);
  const rows=items.map(a=>{
    const sev=severity(a.priority);
    return `<tr><td><span class="sev sev-${sev.toLowerCase()}">${pill(sev)}<span class="sev-bar" aria-hidden="true"><i style="width:${a.priority}%"></i></span><b title="Priority score">${a.priority}</b></span></td><td><strong>${esc(a.type)}</strong></td><td>${esc(a.item)}</td><td>${pill(a.state)}</td><td>${a.state==="Resolved"?"—":`<button class="btn btn-light btn-small" type="button" data-alert-action="${a.id}">${a.state==="Acknowledged"?"Mark resolved":"Acknowledge"}</button>`}</td></tr>`;
  });
  return `
  <div class="view-head"><div><p>Overdue maintenance, expiring documents and critical equipment issues.</p></div></div>
  ${panel("All alerts",`${plural(items.length,"alert")} shown`,"",
    `${searchChip()}<div class="toolbar">
      ${selectField("alertState","alerts.state","State",[["All","All states"],...ALERT_STATES],f.state)}
      ${selectField("alertSeverity","alerts.severity","Severity",[["All","All severities"],"Critical","High","Medium","Low"],f.severity)}
    </div>`+table("Alerts",["Severity","Alert","Affected item","State","Action"],rows,"No alerts match these filters.")+
    `<div class="panel-foot"><span class="sub">Alert records currently have no timestamp field, so no time column is shown.</span></div>`)}`;
}

function tasksView(){
  const f=state.filters.tasks;
  const base=data.tasks.filter(t=>matches(t.title,t.equipment,t.priority,t.status,t.assigned));
  const tabs={open:isOpenTask,overdue:isOverdue,upcoming:t=>isOpenTask(t)&&!isOverdue(t),completed:t=>t.status==="Completed",all:()=>true};
  const n=k=>base.filter(tabs[k]).length;
  let items=base.filter(tabs[f.tab]||tabs.open).filter(t=>(f.priority==="All"||t.priority===f.priority)&&(f.equipment==="All"||t.equipment===f.equipment));
  items.sort(f.sort==="priority"?(a,b)=>PRIORITY_RANK[a.priority]-PRIORITY_RANK[b.priority]||a.due.localeCompare(b.due):(a,b)=>a.due.localeCompare(b.due));
  const rows=items.map(t=>{const od=isOverdue(t);return `<tr><td><strong>${esc(t.title)}</strong></td><td>${esc(t.equipment)}</td><td class="nowrap ${od?"overdue-text":""}">${fmtDate(t.due)}${od?" (overdue)":""}</td><td>${pill(t.priority)}</td><td><select class="inline-select" aria-label="Status for ${esc(t.title)}" data-task-status="${t.id}">${TASK_STATUSES.map(s=>`<option ${t.status===s?"selected":""}>${s}</option>`).join("")}</select></td><td>${esc(t.assigned||"Not assigned")}</td><td><button class="btn btn-danger btn-small" type="button" data-delete-task="${t.id}" aria-label="Delete task ${esc(t.title)}">Delete</button></td></tr>`;});
  const equipNames=[...new Set(data.tasks.map(t=>t.equipment))];
  return `
  <div class="view-head"><div><p>Scheduled, ongoing, completed and overdue maintenance activities.</p></div><div class="actions"><button class="btn btn-primary" type="button" data-open-modal="taskModal">${icon("plus")}Create task</button></div></div>
  ${panel("Maintenance tasks",`${plural(items.length,"task")} shown`,"",
    `${searchChip()}<div class="toolbar">
      ${segmented("tasks.tab",[["open","Open",n("open")],["overdue","Overdue",n("overdue")],["upcoming","Upcoming",n("upcoming")],["completed","Completed",n("completed")],["all","All",n("all")]],f.tab)}
      ${selectField("taskPriority","tasks.priority","Priority",[["All","All priorities"],"Critical","High","Medium","Low"],f.priority)}
      ${selectField("taskEquipmentFilter","tasks.equipment","Equipment",[["All","All equipment"],...equipNames],f.equipment)}
      ${selectField("taskSort","tasks.sort","Sort by",[["due","Due date"],["priority","Priority"]],f.sort)}
    </div>`+table("Maintenance tasks",["Task","Equipment","Due","Priority","Status","Assigned to",""],rows,"No tasks match these filters."))}`;
}

function equipmentView(){
  const f=state.filters.equipment;
  const items=data.equipment.filter(e=>matches(e.name,e.location,e.criticality,e.status)&&(f.status==="All"||e.status===f.status)&&(f.criticality==="All"||e.criticality===f.criticality));
  const rows=items.map(e=>{
    const open=openTasksFor(e.name).sort((a,b)=>a.due.localeCompare(b.due));
    const next=open[0];
    return `<tr><td><button type="button" class="link-button" data-equipment-detail="${e.id}">${esc(e.name)}</button></td><td>${esc(e.location)}</td><td>${pill(e.criticality)}</td><td><select class="inline-select" aria-label="Status for ${esc(e.name)}" data-equipment-status="${e.id}">${EQUIP_STATUSES.map(s=>`<option ${e.status===s?"selected":""}>${s}</option>`).join("")}</select></td><td>${open.length}</td><td class="nowrap">${next?`<span class="${isOverdue(next)?"overdue-text":""}">${fmtDate(next.due)}</span>`:"—"}</td><td><button class="btn btn-light btn-small" type="button" data-equipment-detail="${e.id}">View record</button></td></tr>`;
  });
  return `
  <div class="view-head"><div><p>Equipment inventory with condition, criticality and maintenance status.</p></div><div class="actions"><button class="btn btn-primary" type="button" data-open-modal="equipmentModal">${icon("plus")}Add equipment</button></div></div>
  ${panel("Equipment inventory",`${plural(items.length,"asset")} shown`,"",
    `${searchChip()}<div class="toolbar">
      ${selectField("equipStatus","equipment.status","Status",[["All","All statuses"],...EQUIP_STATUSES],f.status)}
      ${selectField("equipCrit","equipment.criticality","Criticality",[["All","All levels"],"Critical","Warning","Normal"],f.criticality)}
    </div>`+table("Equipment",["Equipment","Location","Criticality","Status","Open tasks","Next due",""],rows,"No equipment matches these filters."))}`;
}

function documentsView(){
  const f=state.filters.documents;
  const items=data.documents.filter(d=>matches(d.name,d.equipment,d.expires,docState(d))&&(f.validity==="All"||docState(d)===f.validity)&&(f.equipment==="All"||d.equipment===f.equipment)).sort((a,b)=>a.expires.localeCompare(b.expires));
  const rows=items.map(d=>{const n=daysUntil(d.expires);const st=docState(d);return `<tr><td><strong>${esc(d.name)}</strong></td><td>${esc(d.equipment)}</td><td class="nowrap">${fmtDate(d.expires)}<span class="sub">${n<0?plural(-n,"day")+" ago":n===0?"Today":"in "+plural(n,"day")}</span></td><td>${pill(st)}</td></tr>`;});
  const equipNames=[...new Set(data.documents.map(d=>d.equipment))];
  return `
  <div class="view-head"><div><p>Certificates, reports and records linked to equipment.</p></div><div class="actions"><button class="btn btn-primary" type="button" data-open-modal="documentModal">${icon("upload")}Upload document</button></div></div>
  ${panel("Documents",`${plural(items.length,"document record")} shown, earliest expiry first`,"",
    `${searchChip()}<div class="toolbar">
      ${selectField("docValidity","documents.validity","Validity",[["All","All"],"Expired","Expiring soon","Valid"],f.validity)}
      ${selectField("docEquipment","documents.equipment","Equipment",[["All","All equipment"],...equipNames],f.equipment)}
    </div>`+table("Documents",["Document","Equipment","Expires","Validity"],rows,"No documents match these filters.")+
    `<div class="panel-foot"><span class="sub">Document type, upload date and file download are not part of the current data model.</span></div>`)}`;
}

function reportsView(){
  const f=state.filters.reports;
  const inRange=t=>(!f.from||t.due>=f.from)&&(!f.to||t.due<=f.to);
  const tasks=data.tasks.filter(inRange);
  const done=tasks.filter(t=>t.status==="Completed").length;
  const considered=tasks.filter(t=>t.status!=="Cancelled").length;
  const rate=considered?Math.round(done/considered*100)+"%":"—";
  const byStatus=TASK_STATUSES.map(s=>({label:s,value:tasks.filter(t=>t.status===s).length,tone:{Completed:"t-green","In Progress":"t-amber",Pending:"t-blue",Cancelled:"t-grey"}[s]}));
  const byPriority=["Critical","High","Medium","Low"].map(p=>({label:p,value:tasks.filter(t=>t.priority===p).length,tone:{Critical:"t-red",High:"t-amber",Medium:"t-amber",Low:"t-blue"}[p]}));
  const byEquip=EQUIP_STATUSES.map(s=>({label:s,value:data.equipment.filter(e=>e.status===s).length,tone:{Operational:"t-green","Under Maintenance":"t-amber","Out of Service":"t-red",Retired:"t-grey"}[s]}));
  const byAlert=ALERT_STATES.map(s=>({label:s,value:data.alerts.filter(a=>a.state===s).length,tone:{Open:"t-red",Sent:"t-amber",Acknowledged:"t-blue",Resolved:"t-green"}[s]}));
  const byDoc=["Expired","Expiring soon","Valid"].map(s=>({label:s,value:data.documents.filter(d=>docState(d)===s).length,tone:{Expired:"t-red","Expiring soon":"t-amber",Valid:"t-green"}[s]}));
  const rangeNote = (f.from||f.to) ? `Task figures limited to due dates ${f.from?"from "+fmtDate(f.from):""} ${f.to?"to "+fmtDate(f.to):""}.` : "Task figures cover all due dates.";
  return `
  <div class="view-head"><div><p>Summaries calculated from the current records. ${esc(rangeNote)}</p></div></div>
  <section class="panel" style="margin-bottom:16px"><div class="toolbar" style="padding-top:14px">
    <label class="field" for="repFrom">Tasks due from<input id="repFrom" type="date" value="${esc(f.from)}" data-filter="reports.from"></label>
    <label class="field" for="repTo">Tasks due to<input id="repTo" type="date" value="${esc(f.to)}" data-filter="reports.to"></label>
    ${(f.from||f.to)?`<button type="button" class="btn btn-light btn-small" data-clear-range>Clear dates</button>`:""}
  </div></section>

  <section class="kpi-grid" aria-label="Report summary">
    ${kpi({label:"Tasks in range",value:tasks.length,note:"By due date",ico:"tasks"})}
    ${kpi({label:"Completion rate",value:rate,note:"Completed of non-cancelled",ico:"check",tone:"green"})}
    ${kpi({label:"Overdue tasks",value:tasks.filter(isOverdue).length,note:"Open past due date",ico:"warn",tone:tasks.some(isOverdue)?"red":""})}
    ${kpi({label:"Equipment not operational",value:data.equipment.filter(e=>e.status!=="Operational").length,note:"All statuses except Operational",ico:"equipment"})}
    ${kpi({label:"Unresolved alerts",value:data.alerts.filter(alertActive).length,note:"Open or sent",ico:"bell"})}
  </section>

  <div class="grid-2">
    ${panel("Maintenance performance","Tasks by status","",bars(byStatus))}
    ${panel("Task priority","Tasks by priority","",bars(byPriority))}
    ${panel("Equipment condition","Equipment by status","",bars(byEquip))}
    ${panel("Alerts","Alerts by state","",bars(byAlert))}
    ${panel("Document validity","Records by expiry state","",bars(byDoc))}
    <section class="placeholder-card"><strong>Downtime, costs and sustainability <span class="tag">Not connected</span></strong>These reports need downtime, cost and spare-parts data that the current data model does not contain. They will appear here once the API provides it.</section>
  </div>`;
}

function settingsView(){
  return `
  <div class="view-head"><div><p>Data source and local demo options.</p></div></div>
  ${panel("Data source","","",`<dl class="kv">
    <dt>Mode</dt><dd>${store.demo?"Demo (browser storage)":"Live API"}</dd>
    <dt>API base URL</dt><dd>${API_BASE?esc(API_BASE):"Not configured — set <code>API_BASE</code> in script.js"}</dd>
    <dt>Records</dt><dd>${data.equipment.length} equipment · ${data.tasks.length} tasks · ${data.documents.length} documents · ${data.alerts.length} alerts</dd>
  </dl>${store.demo?`<div class="panel-foot"><button type="button" class="btn btn-light btn-small" data-reset-demo>Reset demo data</button></div>`:""}`)}`;
}

const RENDERERS={dashboard:dashboardView,alerts:alertsView,tasks:tasksView,equipment:equipmentView,documents:documentsView,reports:reportsView,settings:settingsView};

/* ---------- Rendering ---------- */
function updateChrome(){
  const active=data.alerts.filter(a=>a.state==="Open").length;
  const navCount=$("navAlertCount"), dot=$("notificationDot");
  navCount.textContent=active; dot.textContent=active;
  navCount.hidden=dot.hidden=!active||state.status!=="ready";
  $("notificationsButton").setAttribute("aria-label",active?`${plural(active,"open alert")}`:"Alerts");
  document.querySelectorAll(".nav-link").forEach(l=>{ if(l.dataset.view===state.view) l.setAttribute("aria-current","page"); else l.removeAttribute("aria-current"); });
  $("pageTitle").textContent=VIEWS[state.view].title;
  document.title=`${VIEWS[state.view].title} | MainTroll`;
  $("footerMode").textContent=store.demo?"Demo version · Data is stored locally in this browser":"Connected to API";
  ["taskEquipment","documentEquipment"].forEach(id=>{const sel=$(id),cur=sel.value;sel.innerHTML=data.equipment.map(e=>`<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");if(cur&&data.equipment.some(e=>e.name===cur))sel.value=cur;});
  $("documentNote").hidden=!store.demo;
}
function render(){
  const focusId=document.activeElement&&document.activeElement.id;
  const view=$("view");
  updateChrome();
  const notice = store.demo ? `<div class="notice" role="status"><span aria-hidden="true">ⓘ</span><span>Demo mode: showing sample data stored in this browser. Set <code>API_BASE</code> to load live records.</span></div>` : "";
  if(state.status==="loading"){
    view.setAttribute("aria-busy","true");
    view.innerHTML=`<div class="loading" role="status"><span class="visually-hidden">Loading data…</span><div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:260px"></div></div>`;
    return;
  }
  view.setAttribute("aria-busy","false");
  if(state.status==="error"){
    view.innerHTML=`<div class="notice error" role="alert"><span>Could not load data: ${esc(state.error)}</span><button class="btn btn-light btn-small" type="button" data-retry>Try again</button></div>`;
    return;
  }
  view.innerHTML=notice+RENDERERS[state.view]();
  if(focusId){ const el=document.getElementById(focusId); if(el&&view.contains(el)) el.focus(); }
}

/* ---------- Routing ---------- */
function applyRoute(){
  const raw=location.hash.replace(/^#/,"")||"dashboard";
  const [name,qs]=raw.split("?");
  state.view=VIEWS[name]?name:"dashboard";
  if(qs){ const p=new URLSearchParams(qs); const f=state.filters[state.view]; if(f) for(const [k,v] of p) if(k in f) f[k]=v; }
  closeNav(); render();
  const view=$("view"); view.scrollIntoView({block:"start"}); view.focus({preventScroll:true});
}
function closeNav(){ $("sidebar").classList.remove("open"); $("scrim").hidden=true; $("menuToggle").setAttribute("aria-expanded","false"); }
function openNav(){ $("sidebar").classList.add("open"); $("scrim").hidden=false; $("menuToggle").setAttribute("aria-expanded","true"); }

/* ---------- Search ---------- */
function renderSearchResults(){
  const box=$("searchResults"), q=state.query.trim().toLowerCase();
  if(!q){ box.hidden=true; box.innerHTML=""; return; }
  const m=(...v)=>v.join(" ").toLowerCase().includes(q);
  const sets=[
    ["equipment","Equipment",data.equipment.filter(e=>m(e.name,e.location,e.criticality,e.status)).length],
    ["tasks","Maintenance Tasks",data.tasks.filter(t=>m(t.title,t.equipment,t.priority,t.status,t.assigned)).length],
    ["documents","Documents",data.documents.filter(d=>m(d.name,d.equipment,d.expires,docState(d))).length],
    ["alerts","Alerts",data.alerts.filter(a=>m(a.type,a.item,a.state,severity(a.priority))).length]
  ].filter(s=>s[2]);
  box.innerHTML=sets.length?sets.map(s=>`<a href="#${s[0]}"><span>${s[1]}</span><span class="count">${plural(s[2],"match")}</span></a>`).join(""):`<p class="none">No results for “${esc(state.query)}”.</p>`;
  box.hidden=false;
}
function clearSearch(){ state.query=""; $("globalSearch").value=""; renderSearchResults(); render(); }

/* ---------- Equipment record dialog ---------- */
function openEquipmentDetail(id){
  const e=data.equipment.find(x=>x.id===id); if(!e) return;
  const tasks=data.tasks.filter(t=>t.equipment===e.name).sort((a,b)=>a.due.localeCompare(b.due));
  const docs=data.documents.filter(d=>d.equipment===e.name);
  const alerts=data.alerts.filter(a=>a.item.includes(`(${e.name})`));
  const list=(arr,fn,none)=>arr.length?`<ul>${arr.map(fn).join("")}</ul>`:`<p class="none">${none}</p>`;
  $("detailBody").innerHTML=`
    <div class="modal-heading"><div><p class="eyebrow">EQUIPMENT RECORD</p><h2 id="detailTitle">${esc(e.name)}</h2></div><button type="button" class="close-modal" data-close-modal aria-label="Close">×</button></div>
    <div class="detail-meta"><div><span>Location</span>${esc(e.location)}</div><div><span>Criticality</span>${pill(e.criticality)}</div><div><span>Status</span>${pill(e.status)}</div></div>
    <div class="detail-section"><h3>Maintenance tasks</h3>${list(tasks,t=>`<li><span>${esc(t.title)} · <span class="${isOverdue(t)?"overdue-text":""}">${fmtDate(t.due)}</span></span>${pill(t.status)}</li>`,"No tasks for this equipment.")}</div>
    <div class="detail-section"><h3>Documents</h3>${list(docs,d=>`<li><span>${esc(d.name)} · ${fmtDate(d.expires)}</span>${pill(docState(d))}</li>`,"No documents for this equipment.")}</div>
    <div class="detail-section"><h3>Alerts</h3>${list(alerts,a=>`<li><span>${esc(a.type)}</span>${pill(a.state)}</li>`,"No alerts for this equipment.")}</div>
    <div class="modal-actions"><button type="button" class="btn btn-light" data-close-modal>Close</button></div>`;
  $("detailModal").showModal();
}

/* ---------- Mutations ---------- */
async function mutate(fn,okMsg){
  try { await fn(); render(); if(okMsg) toast(okMsg); }
  catch(err){ console.error(err); toast("Could not save change: "+err.message); await refresh(); }
}
const savedNote = () => store.demo ? " (demo only, not saved to AWS)" : "";

/* ---------- Events ---------- */
document.addEventListener("click",e=>{
  const t=e.target;
  const open=t.closest("[data-open-modal]"); if(open){ const d=$(open.dataset.openModal); if(d&&!d.open) d.showModal(); return; }
  if(t.closest("[data-close-modal]")){ t.closest("dialog")?.close(); return; }
  const filterBtn=t.closest("button[data-filter]");
  if(filterBtn){ const [view,key]=filterBtn.dataset.filter.split("."); state.filters[view][key]=filterBtn.dataset.value; render(); return; }
  if(t.closest("[data-clear-search]")){ clearSearch(); return; }
  if(t.closest("[data-clear-range]")){ state.filters.reports.from=state.filters.reports.to=""; render(); return; }
  if(t.closest("[data-retry]")){ refresh(); return; }
  if(t.closest("[data-reset-demo]")){ if(confirm("Reset all demo data in this browser?")){ store.reset(); render(); toast("Demo data reset."); } return; }
  const det=t.closest("[data-equipment-detail]"); if(det){ openEquipmentDetail(Number(det.dataset.equipmentDetail)); return; }
  const alertBtn=t.closest("[data-alert-action]");
  if(alertBtn){ const a=data.alerts.find(x=>x.id===Number(alertBtn.dataset.alertAction)); if(a){ const next=a.state==="Acknowledged"?"Resolved":"Acknowledged"; mutate(()=>store.update("alerts",a.id,{state:next}),`Alert marked ${next.toLowerCase()}${savedNote()}.`); } return; }
  const del=t.closest("[data-delete-task]");
  if(del&&confirm("Delete this task?")){ mutate(()=>store.remove("tasks",Number(del.dataset.deleteTask)),`Task deleted${savedNote()}.`); return; }
  if(!t.closest(".search-wrap")) $("searchResults").hidden=true;
});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset.filter&&t.tagName!=="BUTTON"){ const [view,key]=t.dataset.filter.split("."); state.filters[view][key]=t.value; render(); return; }
  if(t.dataset.taskStatus){ mutate(()=>store.update("tasks",Number(t.dataset.taskStatus),{status:t.value}),`Task status updated${savedNote()}.`); }
  if(t.dataset.equipmentStatus){ mutate(()=>store.update("equipment",Number(t.dataset.equipmentStatus),{status:t.value}),`Equipment status updated${savedNote()}.`); }
});

function wireForm(id,kind,build,msg){
  $(id).addEventListener("submit",e=>{
    e.preventDefault();
    const form=e.currentTarget, f=new FormData(form);
    mutate(async()=>{ await store.add(kind,build(f)); form.closest("dialog").close(); form.reset(); },msg);
  });
}
wireForm("equipmentForm","equipment",f=>({name:f.get("name").trim(),location:f.get("location").trim(),criticality:f.get("criticality"),status:f.get("status")}),"Equipment added"+(store.demo?" to the local demo. It has not been saved to AWS.":"."));
wireForm("taskForm","tasks",f=>({title:f.get("title").trim(),equipment:f.get("equipment"),due:f.get("due"),priority:f.get("priority"),status:f.get("status"),assigned:f.get("assigned").trim()||"Not assigned"}),"Task added"+(store.demo?" to the local demo. It has not been saved to AWS.":"."));
wireForm("documentForm","documents",f=>{const file=f.get("file");return {name:f.get("name").trim()+(file&&file.name?` (${file.name})`:""),equipment:f.get("equipment"),expires:f.get("expires")};},"Document record added"+(store.demo?" locally. The file was not uploaded to S3.":"."));

const searchInput=$("globalSearch");
searchInput.addEventListener("input",()=>{ state.query=searchInput.value; renderSearchResults(); if(state.view!=="dashboard") render(); });
searchInput.addEventListener("keydown",e=>{ if(e.key==="Escape"){ if(state.query) clearSearch(); else $("searchResults").hidden=true; } });
$("searchResults").addEventListener("click",()=>{ $("searchResults").hidden=true; });
$("menuToggle").addEventListener("click",()=>$("sidebar").classList.contains("open")?closeNav():openNav());
$("scrim").addEventListener("click",closeNav);
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeNav(); });
window.addEventListener("hashchange",applyRoute);

/* ---------- Boot ---------- */
document.querySelectorAll("[data-icon]").forEach(el=>{ el.innerHTML=icon(el.dataset.icon); });
async function refresh(){
  state.status="loading"; render();
  try { await store.load(); state.status="ready"; }
  catch(err){ state.status="error"; state.error=err.message||"Unknown error"; }
  render();
}
(async function init(){ state.status="loading"; applyRoute(); await refresh(); })();
