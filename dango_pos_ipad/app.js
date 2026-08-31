
const DEFAULT_PRICE = 120;
let currentPrice = DEFAULT_PRICE;
let confirmedPrice = null;
let order = { shoyu:0, mitarashi:0 };
let confirmed = false;
let db;
let modalAction = null;
let registering = false;

function money(n){ return Number(n).toLocaleString('ja-JP'); }
function pad(n){ return String(n).padStart(2,'0'); }
function localDateKey(d=new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function isoLocal(d=new Date()){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function newTxId(d=new Date()){
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
}
function activeStatus(x){ return !x.status || x.status === 'active'; }

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('DangoPOS',2);
    req.onupgradeneeded=e=>{
      const database=e.target.result;
      if(!database.objectStoreNames.contains('transactions')){
        const store=database.createObjectStore('transactions',{keyPath:'id'});
        store.createIndex('timestamp','timestamp');
        store.createIndex('dateKey','dateKey');
      }
      if(!database.objectStoreNames.contains('settings')){
        database.createObjectStore('settings',{keyPath:'key'});
      }
    };
    req.onsuccess=e=>{db=e.target.result; resolve(db);}
    req.onerror=()=>reject(req.error);
  });
}
function getSetting(key){
  return new Promise((resolve,reject)=>{
    const t=db.transaction('settings','readonly');
    const r=t.objectStore('settings').get(key);
    r.onsuccess=()=>resolve(r.result ? r.result.value : undefined);
    r.onerror=()=>reject(r.error);
  });
}
function setSetting(key,value){
  return new Promise((resolve,reject)=>{
    const t=db.transaction('settings','readwrite');
    t.objectStore('settings').put({key,value});
    t.oncomplete=resolve;
    t.onerror=()=>reject(t.error);
  });
}
function txUnitPrice(tx){
  const p=Number(tx.unitPrice);
  if(Number.isFinite(p) && p>0) return p;
  const q=Number(tx.totalQty);
  const total=Number(tx.totalPrice);
  if(Number.isFinite(q) && q>0 && Number.isFinite(total)) return total/q;
  return DEFAULT_PRICE;
}
function orderUnitPrice(){
  return confirmed && confirmedPrice != null ? confirmedPrice : currentPrice;
}
function storeTx(tx){
  return new Promise((resolve,reject)=>{
    const t=db.transaction('transactions','readwrite');
    t.objectStore('transactions').put(tx);
    t.oncomplete=resolve;
    t.onerror=()=>reject(t.error);
  });
}
function clearTxs(){
  return new Promise((resolve,reject)=>{
    const t=db.transaction('transactions','readwrite');
    t.objectStore('transactions').clear();
    t.oncomplete=resolve;
    t.onerror=()=>reject(t.error);
  });
}
function allTxs(){
  return new Promise((resolve,reject)=>{
    const t=db.transaction('transactions','readonly');
    const r=t.objectStore('transactions').getAll();
    r.onsuccess=()=>resolve(r.result.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)));
    r.onerror=()=>reject(r.error);
  });
}

function switchTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id===`tab-${name}`));
  if(name==='dashboard') renderDashboard();
}

function changeQty(sku,delta){
  if(confirmed) return;
  order[sku]=Math.max(0, order[sku]+delta);
  renderOrder();
}
function resetOrder(){
  order={shoyu:0,mitarashi:0};
  confirmed=false;
  confirmedPrice=null;
  renderOrder();
}
function renderOrder(){
  const qty=order.shoyu+order.mitarashi;
  const price=orderUnitPrice();
  document.getElementById('qShoyu').textContent=order.shoyu;
  document.getElementById('qMitarashi').textContent=order.mitarashi;
  document.querySelectorAll('.current-unit-price').forEach(el=>el.textContent=money(price));
  document.getElementById('shoyuCalc').textContent=`${money(price)}円 × ${order.shoyu} = ${money(order.shoyu*price)}円`;
  document.getElementById('mitarashiCalc').textContent=`${money(price)}円 × ${order.mitarashi} = ${money(order.mitarashi*price)}円`;
  document.getElementById('orderQty').textContent=qty;
  document.getElementById('orderPrice').textContent=money(qty*price);

  ['qShoyu','qMitarashi','shoyuCalc','mitarashiCalc','orderQtyWrap','orderPriceWrap']
    .forEach(id=>document.getElementById(id).classList.toggle('confirmed',confirmed));

  ['shoyuMinus','shoyuPlus','mitarashiMinus','mitarashiPlus']
    .forEach(id=>document.getElementById(id).disabled=confirmed);

  document.getElementById('confirmBtn').disabled = confirmed || qty===0;
  const registerBtn=document.getElementById('registerBtn');
  registerBtn.disabled = !confirmed || qty===0 || registering;
  registerBtn.classList.toggle('ready', confirmed && qty>0 && !registering);
}

function confirmOrder(){
  if(confirmed || order.shoyu+order.mitarashi===0) return;
  confirmedPrice=currentPrice;
  confirmed=true;
  renderOrder();
  toast(`注文内容を確定しました（${money(confirmedPrice)}円/本）`);
}

async function registerSale(){
  const qty=order.shoyu+order.mitarashi;
  if(!confirmed || qty===0 || registering) return;
  registering=true;
  renderOrder();
  try{
    const now=new Date();
    const unitPrice=confirmedPrice != null ? confirmedPrice : currentPrice;
    const tx={
      id:newTxId(now),
      timestamp:isoLocal(now),
      dateKey:localDateKey(now),
      shoyu:Number(order.shoyu),
      mitarashi:Number(order.mitarashi),
      totalQty:qty,
      unitPrice:unitPrice,
      totalPrice:qty*unitPrice,
      status:'active',
      cancelledAt:''
    };
    await storeTx(tx);
    resetOrder();
    await refresh();
    toast(`登録しました：${qty}本 / ¥${money(qty*unitPrice)}`);
  }catch(e){
    alert('販売登録に失敗しました。\n'+e.message);
  }finally{
    registering=false;
    renderOrder();
  }
}

function askReset(){
  if(order.shoyu+order.mitarashi===0 && !confirmed){
    toast('現在の注文は空です');
    return;
  }
  openModal({
    title:'注文をリセットしますか？',
    message: confirmed
      ? '確定済みの注文内容を破棄します。売上には登録されません。'
      : '入力中の注文内容を破棄します。',
    orderText:currentOrderText(),
    action:()=>{
      resetOrder();
      toast('注文をリセットしました');
    }
  });
}

function currentOrderText(){
  const qty=order.shoyu+order.mitarashi;
  const price=orderUnitPrice();
  return `しょうゆ ${order.shoyu}本 / みたらし ${order.mitarashi}本\n単価 ${money(price)}円 / 合計 ${qty}本　¥${money(qty*price)}`;
}

function openModal({title,message,orderText='',action}){
  modalAction=action;
  document.getElementById('modalTitle').textContent=title;
  document.getElementById('modalMessage').textContent=message;
  const box=document.getElementById('modalOrder');
  if(orderText){
    box.textContent=orderText;
    box.style.display='block';
    box.style.whiteSpace='pre-line';
  }else{
    box.style.display='none';
  }
  const bd=document.getElementById('modalBackdrop');
  bd.classList.add('show');
  bd.setAttribute('aria-hidden','false');
  document.getElementById('modalConfirmBtn').onclick=async()=>{
    const fn=modalAction;
    closeModal();
    if(fn) await fn();
  };
}
function closeModal(){
  document.getElementById('modalBackdrop').classList.remove('show');
  document.getElementById('modalBackdrop').setAttribute('aria-hidden','true');
  modalAction=null;
}
document.getElementById('modalBackdrop').addEventListener('click',e=>{
  if(e.target.id==='modalBackdrop') closeModal();
});

async function requestCancelTransaction(id){
  const txs=await allTxs();
  const tx=txs.find(x=>x.id===id);
  if(!tx || !activeStatus(tx)) return;
  const parts=[];
  if(tx.shoyu) parts.push(`しょうゆ ${tx.shoyu}本`);
  if(tx.mitarashi) parts.push(`みたらし ${tx.mitarashi}本`);
  openModal({
    title:'この取引を取り消しますか？',
    message:'本日累計・時間帯集計から除外します。取引履歴とCSVには「取消済」として残ります。',
    orderText:`${tx.timestamp.slice(11,16)}\n${parts.join(' / ')}\n${tx.totalQty}本　¥${money(tx.totalPrice)}`,
    action:async()=>{
      tx.status='cancelled';
      tx.cancelledAt=isoLocal(new Date());
      await storeTx(tx);
      await refresh();
      toast('取引を取り消しました');
    }
  });
}


function txDateObject(tx){
  const d=new Date(tx.timestamp);
  return Number.isNaN(d.getTime()) ? null : d;
}
function formatJapaneseDate(dateKey){
  const [y,m,d]=dateKey.split('-').map(Number);
  const dt=new Date(y,m-1,d);
  const weekdays=['日','月','火','水','木','金','土'];
  return `${y}年${m}月${d}日（${weekdays[dt.getDay()]}）`;
}
function dashboardHourRange(active){
  if(!active.length) return {start:9,end:15};
  const hours=active.map(x=>Number(x.timestamp.slice(11,13))).filter(Number.isFinite);
  if(!hours.length) return {start:9,end:15};
  return {start:Math.min(...hours),end:Math.max(...hours)};
}
function svgEl(tag,attrs={},text=''){
  const ns='http://www.w3.org/2000/svg';
  const el=document.createElementNS(ns,tag);
  Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));
  if(text!=='' && text!=null) el.textContent=text;
  return el;
}
function emptyChart(container,message='データがありません'){
  container.innerHTML='';
  const div=document.createElement('div');
  div.className='empty';
  div.style.padding='80px 8px';
  div.textContent=message;
  container.appendChild(div);
}
function renderStackedBarChart(container,rows,opts={}){
  container.innerHTML='';
  if(!rows.length){emptyChart(container);return;}
  const W=720,H=300,ml=48,mr=16,mt=20,mb=42;
  const cw=W-ml-mr,ch=H-mt-mb;
  const maxVal=Math.max(1,...rows.map(r=>(r.shoyu||0)+(r.mitarashi||0)));
  const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,class:'chart-svg','aria-label':opts.ariaLabel||'販売本数グラフ'});
  const ticks=5;
  for(let i=0;i<=ticks;i++){
    const v=Math.round(maxVal*i/ticks);
    const y=mt+ch-(v/maxVal)*ch;
    svg.appendChild(svgEl('line',{x1:ml,y1:y,x2:W-mr,y2:y,class:'chart-gridline'}));
    svg.appendChild(svgEl('text',{x:ml-8,y:y+4,'text-anchor':'end',class:'chart-label'},String(v)));
  }
  svg.appendChild(svgEl('line',{x1:ml,y1:mt,x2:ml,y2:mt+ch,class:'chart-axis'}));
  svg.appendChild(svgEl('line',{x1:ml,y1:mt+ch,x2:W-mr,y2:mt+ch,class:'chart-axis'}));
  const slot=cw/rows.length;
  const bw=Math.max(14,Math.min(48,slot*.62));
  rows.forEach((r,i)=>{
    const x=ml+slot*i+(slot-bw)/2;
    const sh=Number(r.shoyu||0),mi=Number(r.mitarashi||0);
    const shH=(sh/maxVal)*ch, miH=(mi/maxVal)*ch;
    const yBase=mt+ch;
    if(sh>0) svg.appendChild(svgEl('rect',{x,y:yBase-shH,width:bw,height:shH,class:'bar-shoyu',rx:2}));
    if(mi>0) svg.appendChild(svgEl('rect',{x,y:yBase-shH-miH,width:bw,height:miH,class:'bar-mitarashi',rx:2}));
    const total=sh+mi;
    svg.appendChild(svgEl('text',{x:x+bw/2,y:yBase-shH-miH-5,'text-anchor':'middle',class:'chart-value'},String(total)));
    svg.appendChild(svgEl('text',{x:x+bw/2,y:H-16,'text-anchor':'middle',class:'chart-label'},r.label));
  });
  container.appendChild(svg);
}
function renderLineChart(container,rows){
  container.innerHTML='';
  if(!rows.length){emptyChart(container);return;}
  const W=720,H=300,ml=48,mr=18,mt=22,mb=42;
  const cw=W-ml-mr,ch=H-mt-mb;
  const maxVal=Math.max(1,...rows.map(r=>Number(r.value||0)));
  const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,class:'chart-svg','aria-label':'取引件数推移グラフ'});
  const ticks=5;
  for(let i=0;i<=ticks;i++){
    const v=Math.round(maxVal*i/ticks);
    const y=mt+ch-(v/maxVal)*ch;
    svg.appendChild(svgEl('line',{x1:ml,y1:y,x2:W-mr,y2:y,class:'chart-gridline'}));
    svg.appendChild(svgEl('text',{x:ml-8,y:y+4,'text-anchor':'end',class:'chart-label'},String(v)));
  }
  svg.appendChild(svgEl('line',{x1:ml,y1:mt,x2:ml,y2:mt+ch,class:'chart-axis'}));
  svg.appendChild(svgEl('line',{x1:ml,y1:mt+ch,x2:W-mr,y2:mt+ch,class:'chart-axis'}));
  const step=rows.length>1 ? cw/(rows.length-1) : 0;
  const pts=rows.map((r,i)=>{
    const x=rows.length>1 ? ml+i*step : ml+cw/2;
    const y=mt+ch-(Number(r.value||0)/maxVal)*ch;
    return {x,y,r};
  });
  if(pts.length){
    const areaPts=[`${pts[0].x},${mt+ch}`,...pts.map(p=>`${p.x},${p.y}`),`${pts[pts.length-1].x},${mt+ch}`].join(' ');
    svg.appendChild(svgEl('polygon',{points:areaPts,class:'line-area'}));
    svg.appendChild(svgEl('polyline',{points:pts.map(p=>`${p.x},${p.y}`).join(' '),class:'line-tx'}));
    pts.forEach(p=>{
      svg.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:4,class:'line-point'}));
      svg.appendChild(svgEl('text',{x:p.x,y:p.y-9,'text-anchor':'middle',class:'chart-value'},String(p.r.value)));
      svg.appendChild(svgEl('text',{x:p.x,y:H-16,'text-anchor':'middle',class:'chart-label'},p.r.label));
    });
  }
  container.appendChild(svg);
}
function tenMinuteBucketLabel(d){
  return `${pad(d.getHours())}:${pad(Math.floor(d.getMinutes()/10)*10)}`;
}
function recentTenMinuteRows(active){
  const dates=active.map(txDateObject).filter(Boolean);
  const latest=dates.length ? new Date(Math.max(...dates.map(d=>d.getTime()))) : new Date();
  latest.setSeconds(0,0);
  latest.setMinutes(Math.floor(latest.getMinutes()/10)*10);
  const rows=[];
  for(let i=6;i>=0;i--){
    const start=new Date(latest.getTime()-i*10*60*1000);
    const end=new Date(start.getTime()+10*60*1000);
    let shoyu=0,mitarashi=0;
    active.forEach(x=>{
      const d=txDateObject(x);
      if(d && d>=start && d<end){
        shoyu+=Number(x.shoyu||0);
        mitarashi+=Number(x.mitarashi||0);
      }
    });
    rows.push({label:tenMinuteBucketLabel(start),shoyu,mitarashi});
  }
  return rows;
}
function segmentKeyForHour(h){
  if(h<12) return 'morning';
  if(h<15) return 'noon';
  if(h<18) return 'afternoon';
  return 'evening';
}
async function renderDashboard(){
  if(!db) return;
  const all=await allTxs();
  const today=localDateKey();
  const active=all.filter(x=>x.dateKey===today && activeStatus(x));

  const shoyu=active.reduce((s,x)=>s+Number(x.shoyu||0),0);
  const mita=active.reduce((s,x)=>s+Number(x.mitarashi||0),0);
  const qty=shoyu+mita;
  const sales=active.reduce((s,x)=>s+Number(x.totalPrice||0),0);
  const txCount=active.length;
  const avgPrice=qty>0 ? Math.round(sales/qty) : currentPrice;

  document.getElementById('dashDate').textContent=formatJapaneseDate(today);
  document.getElementById('dashSales').textContent=money(sales);
  document.getElementById('dashQty').textContent=qty;
  document.getElementById('dashShoyu').textContent=shoyu;
  document.getElementById('dashMitarashi').textContent=mita;
  document.getElementById('dashTxCount').textContent=txCount;
  document.getElementById('dashAvgPrice').textContent=money(avgPrice);

  const range=dashboardHourRange(active);
  const hourly=[],hourlyTx=[];
  for(let h=range.start;h<=range.end;h++){
    const bucket=active.filter(x=>Number(x.timestamp.slice(11,13))===h);
    hourly.push({
      label:`${pad(h)}:00`,
      shoyu:bucket.reduce((s,x)=>s+Number(x.shoyu||0),0),
      mitarashi:bucket.reduce((s,x)=>s+Number(x.mitarashi||0),0)
    });
    hourlyTx.push({label:`${pad(h)}:00`,value:bucket.length});
  }
  renderStackedBarChart(document.getElementById('hourlyQtyChart'),hourly,{ariaLabel:'時間別販売本数'});
  renderLineChart(document.getElementById('hourlyTxChart'),hourlyTx);
  renderStackedBarChart(document.getElementById('recent10Chart'),recentTenMinuteRows(active),{ariaLabel:'10分単位販売本数'});

  const donut=document.getElementById('productDonut');
  donut.innerHTML='';
  if(qty===0){
    emptyChart(donut,'販売データがありません');
  }else{
    const shPct=shoyu/qty*100;
    const miPct=100-shPct;
    const ring=document.createElement('div');
    ring.className='donut';
    ring.style.setProperty('--shoyu-pct',`${shPct}%`);
    ring.innerHTML=`
      <div class="donut-center"><span>合計</span><strong>${qty}本</strong></div>
      <div class="donut-label shoyu">しょうゆ<br>${shoyu}本<br>(${shPct.toFixed(1)}%)</div>
      <div class="donut-label mitarashi">みたらし<br>${mita}本<br>(${miPct.toFixed(1)}%)</div>`;
    donut.appendChild(ring);
  }

  const segments=[
    {key:'morning',label:'午前（〜11:59）',shoyu:0,mitarashi:0,tx:0},
    {key:'noon',label:'昼（12:00〜14:59）',shoyu:0,mitarashi:0,tx:0},
    {key:'afternoon',label:'午後（15:00〜17:59）',shoyu:0,mitarashi:0,tx:0},
    {key:'evening',label:'夕方〜夜（18:00〜）',shoyu:0,mitarashi:0,tx:0}
  ];
  active.forEach(x=>{
    const h=Number(x.timestamp.slice(11,13));
    const seg=segments.find(s=>s.key===segmentKeyForHour(h));
    if(seg){
      seg.shoyu+=Number(x.shoyu||0);
      seg.mitarashi+=Number(x.mitarashi||0);
      seg.tx+=1;
    }
  });

  const body=document.getElementById('dashSegmentBody');
  const foot=document.getElementById('dashSegmentFoot');
  body.innerHTML='';
  segments.forEach(s=>{
    const total=s.shoyu+s.mitarashi;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${s.label}</td><td>${total}本</td><td>${s.shoyu}本</td><td>${s.mitarashi}本</td><td>${s.tx}件</td>`;
    body.appendChild(tr);
  });
  foot.innerHTML=`<tr><td>合計</td><td>${qty}本</td><td>${shoyu}本</td><td>${mita}本</td><td>${txCount}件</td></tr>`;

  const recent=document.getElementById('dashRecentTx');
  recent.innerHTML='';
  const recentRows=[...active].reverse().slice(0,5);
  if(!recentRows.length){
    recent.innerHTML='<div class="empty">まだ取引がありません</div>';
  }else{
    recentRows.forEach(x=>{
      const parts=[];
      if(x.shoyu) parts.push(`しょうゆ ${x.shoyu}本`);
      if(x.mitarashi) parts.push(`みたらし ${x.mitarashi}本`);
      const div=document.createElement('div');
      div.className='recent-dash-row';
      div.innerHTML=`
        <div class="r-top"><span>${x.timestamp.slice(11,16)}</span><span>登録済</span></div>
        <div class="r-main">${parts.join(' / ')}</div>
        <div class="r-total">${x.totalQty}本　¥${money(x.totalPrice)}</div>`;
      recent.appendChild(div);
    });
  }
}
async function refresh(){
  const all=await allTxs();
  const today=localDateKey();
  const todayAll=all.filter(x=>x.dateKey===today);
  const active=todayAll.filter(activeStatus);

  const shoyu=active.reduce((s,x)=>s+Number(x.shoyu||0),0);
  const mita=active.reduce((s,x)=>s+Number(x.mitarashi||0),0);
  const qty=shoyu+mita;
  document.getElementById('totalShoyu').textContent=shoyu;
  document.getElementById('totalMitarashi').textContent=mita;
  document.getElementById('totalQty').textContent=qty;
  const sales=active.reduce((s,x)=>s+Number(x.totalPrice||0),0);
  document.getElementById('totalSales').textContent=money(sales);

  // Recent pane: active transactions only, so cancelled transaction disappears from the sales screen.
  const recent=[...active].reverse().slice(0,20);
  const recentList=document.getElementById('recentList');
  recentList.innerHTML='';
  if(!recent.length){
    recentList.innerHTML='<div class="empty">まだ販売記録がありません</div>';
  }else{
    recent.forEach(x=>{
      const parts=[];
      if(x.shoyu) parts.push(`しょうゆ${x.shoyu}`);
      if(x.mitarashi) parts.push(`みたらし${x.mitarashi}`);
      const b=document.createElement('button');
      b.className='recent-item';
      b.onclick=()=>requestCancelTransaction(x.id);
      b.innerHTML=`
        <div class="recent-top"><span>${x.timestamp.slice(11,16)}</span><span>${x.id.slice(-4)}</span></div>
        <div class="recent-main">${parts.join(' / ')}</div>
        <div class="recent-total">${x.totalQty}本　¥${money(x.totalPrice)}</div>`;
      recentList.appendChild(b);
    });
  }

  // Hourly active aggregate
  const hourly={};
  active.forEach(x=>{
    const h=Number(x.timestamp.slice(11,13));
    if(!hourly[h]) hourly[h]={shoyu:0,mitarashi:0,sales:0};
    hourly[h].shoyu += Number(x.shoyu||0);
    hourly[h].mitarashi += Number(x.mitarashi||0);
    hourly[h].sales += Number(x.totalPrice||0);
  });
  const body=document.getElementById('hourlyBody');
  const foot=document.getElementById('hourlyFoot');
  body.innerHTML=''; foot.innerHTML='';
  const hours=Object.keys(hourly).map(Number).sort((a,b)=>a-b);
  if(!hours.length){
    body.innerHTML='<tr><td colspan="5" style="color:#6b7785">受領済・登録すると時間帯別集計が表示されます</td></tr>';
  }else{
    hours.forEach(h=>{
      const a=hourly[h], q=a.shoyu+a.mitarashi;
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${pad(h)}:00–${pad((h+1)%24)}:00</td><td>${a.shoyu}本</td><td>${a.mitarashi}本</td><td>${q}本</td><td>¥${money(a.sales)}</td>`;
      body.appendChild(tr);
    });
    foot.innerHTML=`<tr><td>合計</td><td>${shoyu}本</td><td>${mita}本</td><td>${qty}本</td><td>¥${money(sales)}</td></tr>`;
  }

  // Full transaction history includes cancelled for audit trail.
  const txList=document.getElementById('transactionList');
  txList.innerHTML='';
  const rows=[...todayAll].reverse();
  if(!rows.length){
    txList.innerHTML='<div class="empty">まだ取引履歴がありません</div>';
  }else{
    rows.forEach(x=>{
      const parts=[];
      if(x.shoyu) parts.push(`しょうゆ${x.shoyu}`);
      if(x.mitarashi) parts.push(`みたらし${x.mitarashi}`);
      const cancelled=!activeStatus(x);
      const div=document.createElement('div');
      div.className='tx-row'+(cancelled?' cancelled':'');
      div.innerHTML=`
        <div class="tx-top"><span>${x.timestamp.slice(11,16)}</span><span>${cancelled?'<span class="cancel-badge">取消済</span>':x.id.slice(-4)}</span></div>
        <div class="tx-main">${parts.join(' / ')}</div>
        <div class="tx-total">${x.totalQty}本　¥${money(x.totalPrice)}</div>`;
      txList.appendChild(div);
    });
  }

  if(document.getElementById('tab-dashboard').classList.contains('active')){
    renderDashboard();
  }
}


async function applyPrice(){
  const input=document.getElementById('priceInput');
  const value=Number(input.value);
  if(!Number.isInteger(value) || value<1 || value>100000){
    alert('単価は1～100,000円の整数で入力してください。');
    input.focus();
    return;
  }
  currentPrice=value;
  await setSetting('unitPrice',currentPrice);
  document.getElementById('currentPriceSetting').textContent=money(currentPrice);
  input.value=currentPrice;
  renderOrder();
  toast(`単価を${money(currentPrice)}円に変更しました`);
}

async function askDeleteAll(){
  const txs=await allTxs();
  if(!txs.length){
    toast('削除する販売記録がありません');
    return;
  }
  openModal({
    title:'本当にすべての記録を削除しますか？',
    message:'この操作では、登録済み・取消済みを含むすべての取引記録を削除します。削除の直前に現在の全データをCSVとして自動出力します。',
    orderText:`対象：${txs.length}件\n単価設定は保持されます。`,
    action:async()=>{
      try{
        await exportCSV(true);
        await new Promise(resolve=>setTimeout(resolve,250));
        await clearTxs();
        resetOrder();
        await refresh();
        toast('CSVを出力し、すべての取引記録を削除しました');
      }catch(e){
        alert('全記録のリセットに失敗しました。\n'+e.message);
      }
    }
  });
}

async function exportCSV(silent=false){
  const txs=await allTxs();
  const headers=['record_type','timestamp','transaction_id','shoyu_qty','mitarashi_qty','total_qty','unit_price','total_price','status','cancelled_at'];
  const lines=[headers.join(',')];
  txs.forEach(x=>{
    lines.push([
      'SALE',x.timestamp,x.id,x.shoyu,x.mitarashi,x.totalQty,txUnitPrice(x),x.totalPrice,
      activeStatus(x)?'active':'cancelled',x.cancelledAt||''
    ].join(','));
  });
  const csv='\uFEFF'+lines.join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const now=new Date();
  const filename=`dango_sales_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  if(!silent) toast(`CSVを出力しました：${filename}`);
  return filename;
}
function parseCSVLine(line){return line.split(',');}
async function importCSV(event){
  const file=event.target.files && event.target.files[0];
  event.target.value='';
  if(!file) return;
  openModal({
    title:'CSVから復元しますか？',
    message:'現在の販売履歴をCSVの内容で置き換えます。先に現在データのCSVを出力することを推奨します。',
    orderText:file.name,
    action:async()=>{
      try{
        const text=(await file.text()).replace(/^\uFEFF/,'').trim();
        const lines=text ? text.split(/\r?\n/).filter(Boolean) : [];
        if(!lines.length) throw new Error('CSVが空です');
        const header=parseCSVLine(lines[0]);
        const oldHeader=['record_type','timestamp','transaction_id','shoyu_qty','mitarashi_qty','total_qty','unit_price','total_price'];
        const newHeader=[...oldHeader,'status','cancelled_at'];
        const isNew=newHeader.every((h,i)=>header[i]===h);
        const isOld=oldHeader.every((h,i)=>header[i]===h);
        if(!isNew && !isOld) throw new Error('このアプリのCSV形式ではありません');
        const rows=[];
        for(let i=1;i<lines.length;i++){
          const c=parseCSVLine(lines[i]);
          if(c[0]!=='SALE') continue;
          const ts=c[1], id=c[2], sh=Number(c[3]), mi=Number(c[4]), tq=Number(c[5]), up=Number(c[6]), tp=Number(c[7]);
          if(!ts || !id || [sh,mi,tq,up,tp].some(Number.isNaN)) throw new Error(`${i+1}行目の形式が不正です`);
          rows.push({
            id,timestamp:ts,dateKey:ts.slice(0,10),shoyu:sh,mitarashi:mi,totalQty:tq,unitPrice:up,totalPrice:tp,
            status:isNew?(c[8]||'active'):'active',
            cancelledAt:isNew?(c[9]||''):''
          });
        }
        await clearTxs();
        for(const r of rows) await storeTx(r);
        await refresh();
        toast(`${rows.length}件の取引を復元しました`);
      }catch(e){
        alert('CSV復元に失敗しました。\n'+e.message);
      }
    }
  });
}

function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>el.classList.remove('show'),2300);
}

window.addEventListener('load',async()=>{
  try{
    await openDB();
    const savedPrice=Number(await getSetting('unitPrice'));
    currentPrice=Number.isInteger(savedPrice) && savedPrice>0 ? savedPrice : DEFAULT_PRICE;
    if(!(Number.isInteger(savedPrice) && savedPrice>0)){
      await setSetting('unitPrice',currentPrice);
    }
    document.getElementById('currentPriceSetting').textContent=money(currentPrice);
    document.getElementById('priceInput').value=currentPrice;
    renderOrder();
    await refresh();
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }
  }catch(e){
    alert('アプリの保存領域を初期化できませんでした。\n'+e.message);
  }
});
