const DEFAULT_PRICE = 120;
let currentPrice = DEFAULT_PRICE;
let confirmedPrice = null;
let order = { shoyu:0, mitarashi:0 };
let confirmed = false;
let db;
let modalAction = null;
let modalSaveAction = null;
let registering = false;
let soundEnabled = true;
let dashboardBucketMinutes = 15;

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

function normalizeDisplayKey(value){
  const s=String(value ?? '').trim();
  if(!/^\d{1,4}$/.test(s)) return '';
  return s.padStart(4,'0');
}
function displayKey(tx){
  return normalizeDisplayKey(tx && tx.key4);
}
async function nextDisplayKey(dateKey){
  const txs=await allTxs();
  let maxKey=0;

  txs.forEach(tx=>{
    if(tx.dateKey!==dateKey) return;
    const key=normalizeDisplayKey(tx.key4);
    if(!key) return;
    maxKey=Math.max(maxKey,Number(key));
  });

  if(maxKey>=9999){
    throw new Error('本日の4桁キーが9999に達しました。');
  }
  return String(maxKey+1).padStart(4,'0');
}


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
  if(name==='all-data') renderAllData();
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


function updateSoundSettingUI(){
  const check=document.getElementById('soundEnabledCheck');
  const state=document.getElementById('soundStateText');

  if(check) check.checked=Boolean(soundEnabled);
  if(state) state.textContent=`効果音：${soundEnabled ? 'ON' : 'OFF'}`;
}

async function applySoundSetting(){
  const check=document.getElementById('soundEnabledCheck');
  soundEnabled=check ? Boolean(check.checked) : true;

  await setSetting('soundEnabled',soundEnabled);
  updateSoundSettingUI();

  if(soundEnabled){
    toast('効果音をONにしました');
  }else{
    toast('効果音をOFFにしました');
  }
}

function prepareCashRegisterSound(){
  if(!soundEnabled) return;

  const audio=document.getElementById('cashRegisterSound');
  if(!audio) return;

  /*
   * Safari / iPad対策:
   * 「受領済・登録」を押した瞬間（最初のawaitより前）に、
   * 無音で同じaudio要素の再生を開始してユーザー操作と結び付ける。
   */
  try{
    audio.pause();
    audio.currentTime=0;
    audio.muted=true;

    const promise=audio.play();
    if(promise && typeof promise.then==='function'){
      promise.then(()=>{
        /*
         * 登録処理が完了するまでは無音状態のまま。
         * 成功時のplayCashRegisterSound()で先頭へ戻して音を出す。
         */
      }).catch(err=>{
        console.warn('効果音の事前準備に失敗しました:',err);
        audio.muted=false;
      });
    }
  }catch(err){
    console.warn('効果音の事前準備に失敗しました:',err);
    audio.muted=false;
  }
}

function cancelPreparedCashRegisterSound(){
  const audio=document.getElementById('cashRegisterSound');
  if(!audio) return;

  try{
    audio.pause();
    audio.currentTime=0;
    audio.muted=false;
  }catch(err){
    console.warn('効果音の停止に失敗しました:',err);
  }
}

function playCashRegisterSound(){
  if(!soundEnabled){
    cancelPreparedCashRegisterSound();
    return;
  }

  const audio=document.getElementById('cashRegisterSound');
  if(!audio) return;

  try{
    audio.pause();
    audio.currentTime=0;
    audio.muted=false;
    audio.volume=1;

    const promise=audio.play();
    if(promise && typeof promise.catch==='function'){
      promise.catch(err=>{
        console.warn('効果音を再生できませんでした:',err);
      });
    }
  }catch(err){
    console.warn('効果音を再生できませんでした:',err);
  }
}

function testCashRegisterSound(){
  if(!soundEnabled){
    toast('効果音がOFFです');
    return;
  }

  const audio=document.getElementById('cashRegisterSound');
  if(!audio){
    alert('効果音ファイルを読み込めませんでした。');
    return;
  }

  try{
    audio.pause();
    audio.currentTime=0;
    audio.muted=false;
    audio.volume=1;

    const promise=audio.play();
    if(promise && typeof promise.catch==='function'){
      promise.catch(err=>{
        console.warn('テスト再生に失敗しました:',err);
        alert('効果音を再生できませんでした。iPad / Safariの音量・消音設定を確認してください。');
      });
    }
  }catch(err){
    console.warn('テスト再生に失敗しました:',err);
    alert('効果音を再生できませんでした。iPad / Safariの音量・消音設定を確認してください。');
  }
}

async function registerSale(){
  const qty=order.shoyu+order.mitarashi;
  if(!confirmed || qty===0 || registering) return;

  prepareCashRegisterSound();

  registering=true;
  renderOrder();
  try{
    const now=new Date();
    const unitPrice=confirmedPrice != null ? confirmedPrice : currentPrice;
    const dateKey=localDateKey(now);
    const key4=await nextDisplayKey(dateKey);
    const tx={
      id:newTxId(now),
      key4:key4,
      timestamp:isoLocal(now),
      dateKey:dateKey,
      shoyu:Number(order.shoyu),
      mitarashi:Number(order.mitarashi),
      totalQty:qty,
      unitPrice:unitPrice,
      totalPrice:qty*unitPrice,
      status:'active',
      cancelledAt:'',
      note:'',
      noteUpdatedAt:'',
      noteResolved:false,
      noteResolvedAt:''
    };
    await storeTx(tx);
    playCashRegisterSound();
    resetOrder();
    await refresh();
    toast(`登録しました：${qty}本 / ¥${money(qty*unitPrice)}`);
  }catch(e){
    cancelPreparedCashRegisterSound();
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

function openModal({
  title,
  message,
  orderText='',
  action,
  confirmLabel='実行',
  showConfirm=true,
  noteMode=false,
  note='',
  resolved=false,
  saveAction=null,
  resolvedAction=null
}){
  modalAction=action;
  modalSaveAction=saveAction;

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

  const noteArea=document.getElementById('modalNoteArea');
  const noteInput=document.getElementById('modalNoteInput');
  const resolvedCheck=document.getElementById('modalResolvedCheck');
  const saveBtn=document.getElementById('modalSaveBtn');
  const detailCancelArea=document.getElementById('modalDetailCancelArea');
  const detailCancelBtn=document.getElementById('modalDetailCancelBtn');
  const genericActions=document.getElementById('modalGenericActions');
  const confirmBtn=document.getElementById('modalConfirmBtn');

  if(noteMode){
    noteArea.style.display='block';
    genericActions.style.display='none';
    noteInput.value=note || '';
    resolvedCheck.checked=Boolean(resolved);

    saveBtn.onclick=async()=>{
      const fn=modalSaveAction;
      if(fn) await fn(noteInput.value);
    };

    resolvedCheck.onchange=async()=>{
      if(resolvedAction){
        await resolvedAction(Boolean(resolvedCheck.checked));
      }
    };

    detailCancelArea.style.display=showConfirm ? 'block' : 'none';
    detailCancelBtn.textContent=confirmLabel;
    detailCancelBtn.onclick=async()=>{
      const fn=modalAction;
      if(fn) await fn();
    };
  }else{
    noteArea.style.display='none';
    genericActions.style.display='flex';
    noteInput.value='';
    resolvedCheck.checked=false;
    resolvedCheck.onchange=null;
    saveBtn.onclick=null;
    detailCancelArea.style.display='none';
    detailCancelBtn.onclick=null;

    confirmBtn.textContent=confirmLabel;
    confirmBtn.style.display=showConfirm ? 'inline-block' : 'none';
    confirmBtn.onclick=async()=>{
      const fn=modalAction;
      closeModal();
      if(fn) await fn();
    };
  }

  const bd=document.getElementById('modalBackdrop');
  bd.classList.add('show');
  bd.setAttribute('aria-hidden','false');
}
function closeModal(){
  document.getElementById('modalBackdrop').classList.remove('show');
  document.getElementById('modalBackdrop').setAttribute('aria-hidden','true');
  modalAction=null;
  modalSaveAction=null;
}
document.getElementById('modalBackdrop').addEventListener('click',e=>{
  if(e.target.id==='modalBackdrop') closeModal();
});

async function requestCancelTransaction(id){
  const txs=await allTxs();
  const tx=txs.find(x=>x.id===id);
  if(!tx) return;

  const parts=[];
  if(tx.shoyu) parts.push(`しょうゆ ${tx.shoyu}本`);
  if(tx.mitarashi) parts.push(`みたらし ${tx.mitarashi}本`);

  openModal({
    title:'取引詳細',
    message: activeStatus(tx)
      ? 'メモの追加・更新、対応完了の切替、または取引取消ができます。'
      : 'この取引は取消済みです。メモの追加・更新、対応完了の切替はできます。',
    orderText:`${tx.timestamp.slice(0,10)} ${tx.timestamp.slice(11,16)}\nキー ${displayKey(tx) || '----'}\n${parts.join(' / ')}\n${tx.totalQty}本　¥${money(tx.totalPrice)}`,
    noteMode:true,
    note:tx.note || '',
    resolved:Boolean(tx.noteResolved),

    saveAction:async(note)=>{
      const now=isoLocal(new Date());
      tx.note=String(note || '').trim();
      tx.noteUpdatedAt=now;

      if(!tx.note){
        tx.noteResolved=false;
        tx.noteResolvedAt='';
        document.getElementById('modalResolvedCheck').checked=false;
      }

      await storeTx(tx);
      await refresh();
      if(document.getElementById('tab-all-data').classList.contains('active')){
        await renderAllData();
      }
      toast('メモを保存しました');
    },

    resolvedAction:async(resolved)=>{
      if(resolved && !String(tx.note || '').trim()){
        document.getElementById('modalResolvedCheck').checked=false;
        toast('先にメモを保存してください');
        return;
      }

      tx.noteResolved=Boolean(resolved);
      tx.noteResolvedAt=tx.noteResolved ? isoLocal(new Date()) : '';
      await storeTx(tx);
      await refresh();

      if(document.getElementById('tab-all-data').classList.contains('active')){
        await renderAllData();
      }

      toast(tx.noteResolved ? '対応完了にしました' : '未完了に戻しました');
    },

    showConfirm:activeStatus(tx),
    confirmLabel:'取引取消',
    action:activeStatus(tx) ? async()=>{
      openModal({
        title:'この取引を取り消しますか？',
        message:'本日集計から除外します。全データ表示とCSVには「取消済」として残ります。',
        orderText:`${tx.timestamp.slice(11,16)}\nキー ${displayKey(tx) || '----'}\n${parts.join(' / ')}\n${tx.totalQty}本　¥${money(tx.totalPrice)}`,
        action:async()=>{
          tx.status='cancelled';
          tx.cancelledAt=isoLocal(new Date());
          await storeTx(tx);
          await refresh();
          toast('取引を取り消しました');
        }
      });
    } : null
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
  div.style.padding='40px 8px';
  div.textContent=message;
  container.appendChild(div);
}
function floorToBucket(d,minutes){
  const x=new Date(d);
  x.setSeconds(0,0);

  if(minutes===60){
    x.setMinutes(0);
  }else{
    x.setMinutes(Math.floor(x.getMinutes()/minutes)*minutes);
  }
  return x;
}
function bucketLabel(d){
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dashboardBucketRange(active,minutes){
  if(!active.length){
    const now=new Date();
    return {
      start:new Date(now.getFullYear(),now.getMonth(),now.getDate(),9,0,0,0),
      end:new Date(now.getFullYear(),now.getMonth(),now.getDate(),15,0,0,0)
    };
  }

  const dates=active.map(txDateObject).filter(Boolean);
  if(!dates.length) return dashboardBucketRange([],minutes);

  return {
    start:floorToBucket(new Date(Math.min(...dates.map(d=>d.getTime()))),minutes),
    end:floorToBucket(new Date(Math.max(...dates.map(d=>d.getTime()))),minutes)
  };
}
function buildTrendRows(active,minutes){
  const {start,end}=dashboardBucketRange(active,minutes);
  const step=minutes*60*1000;
  const rows=[];

  for(let t=start.getTime();t<=end.getTime();t+=step){
    const bucketStart=new Date(t);
    const bucketEnd=new Date(t+step);
    const bucket=active.filter(x=>{
      const d=txDateObject(x);
      return d && d>=bucketStart && d<bucketEnd;
    });

    rows.push({
      label:bucketLabel(bucketStart),
      shoyu:bucket.reduce((s,x)=>s+Number(x.shoyu||0),0),
      mitarashi:bucket.reduce((s,x)=>s+Number(x.mitarashi||0),0),
      txCount:bucket.length
    });
  }
  return rows;
}
function setDashboardBucket(minutes){
  if(minutes!==15 && minutes!==60) return;
  dashboardBucketMinutes=minutes;

  document.getElementById('bucket15Btn').classList.toggle('active',minutes===15);
  document.getElementById('bucket60Btn').classList.toggle('active',minutes===60);

  renderDashboard();
}
function renderStackedBarChart(container,rows,opts={}){
  container.innerHTML='';
  if(!rows.length){emptyChart(container);return;}

  const W=760,H=260,ml=38,mr=10,mt=14,mb=38;
  const cw=W-ml-mr,ch=H-mt-mb;
  const maxVal=Math.max(1,...rows.map(r=>(r.shoyu||0)+(r.mitarashi||0)));
  const svg=svgEl('svg',{
    viewBox:`0 0 ${W} ${H}`,
    class:'chart-svg',
    'aria-label':opts.ariaLabel||'販売本数グラフ'
  });

  const ticks=4;
  for(let i=0;i<=ticks;i++){
    const v=Math.round(maxVal*i/ticks);
    const y=mt+ch-(v/maxVal)*ch;
    svg.appendChild(svgEl('line',{x1:ml,y1:y,x2:W-mr,y2:y,class:'chart-gridline'}));
    svg.appendChild(svgEl('text',{x:ml-5,y:y+4,'text-anchor':'end',class:'chart-label'},String(v)));
  }

  svg.appendChild(svgEl('line',{x1:ml,y1:mt,x2:ml,y2:mt+ch,class:'chart-axis'}));
  svg.appendChild(svgEl('line',{x1:ml,y1:mt+ch,x2:W-mr,y2:mt+ch,class:'chart-axis'}));

  const slot=cw/rows.length;
  const bw=Math.max(5,Math.min(22,slot*.62));
  const labelEvery=rows.length>22 ? 4 : rows.length>14 ? 2 : 1;

  rows.forEach((r,i)=>{
    const x=ml+slot*i+(slot-bw)/2;
    const sh=Number(r.shoyu||0);
    const mi=Number(r.mitarashi||0);
    const shH=(sh/maxVal)*ch;
    const miH=(mi/maxVal)*ch;
    const yBase=mt+ch;

    if(sh>0){
      svg.appendChild(svgEl('rect',{
        x,y:yBase-shH,width:bw,height:shH,class:'bar-shoyu',rx:1
      }));
      if(shH>=18 && bw>=12){
        svg.appendChild(svgEl('text',{
          x:x+bw/2,y:yBase-shH/2+3,'text-anchor':'middle',class:'chart-inner-value'
        },String(sh)));
      }
    }

    if(mi>0){
      svg.appendChild(svgEl('rect',{
        x,y:yBase-shH-miH,width:bw,height:miH,class:'bar-mitarashi',rx:1
      }));
      if(miH>=18 && bw>=12){
        svg.appendChild(svgEl('text',{
          x:x+bw/2,y:yBase-shH-miH/2+3,'text-anchor':'middle',class:'chart-inner-value'
        },String(mi)));
      }
    }

    const total=sh+mi;
    if(total>0){
      svg.appendChild(svgEl('text',{
        x:x+bw/2,y:yBase-shH-miH-4,'text-anchor':'middle',class:'chart-value'
      },String(total)));
    }

    if(i%labelEvery===0 || i===rows.length-1){
      svg.appendChild(svgEl('text',{
        x:x+bw/2,y:H-12,'text-anchor':'middle',class:'chart-label'
      },r.label));
    }
  });

  container.appendChild(svg);
}
function renderLineChart(container,rows){
  container.innerHTML='';
  if(!rows.length){emptyChart(container);return;}

  const W=760,H=260,ml=38,mr=10,mt=14,mb=38;
  const cw=W-ml-mr,ch=H-mt-mb;
  const maxVal=Math.max(1,...rows.map(r=>Number(r.value||0)));

  const svg=svgEl('svg',{
    viewBox:`0 0 ${W} ${H}`,
    class:'chart-svg',
    'aria-label':'15分単位の取引件数推移グラフ'
  });

  const ticks=4;
  for(let i=0;i<=ticks;i++){
    const v=Math.round(maxVal*i/ticks);
    const y=mt+ch-(v/maxVal)*ch;
    svg.appendChild(svgEl('line',{x1:ml,y1:y,x2:W-mr,y2:y,class:'chart-gridline'}));
    svg.appendChild(svgEl('text',{x:ml-5,y:y+4,'text-anchor':'end',class:'chart-label'},String(v)));
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
    const areaPts=[
      `${pts[0].x},${mt+ch}`,
      ...pts.map(p=>`${p.x},${p.y}`),
      `${pts[pts.length-1].x},${mt+ch}`
    ].join(' ');

    svg.appendChild(svgEl('polygon',{points:areaPts,class:'line-area'}));
    svg.appendChild(svgEl('polyline',{
      points:pts.map(p=>`${p.x},${p.y}`).join(' '),
      class:'line-tx'
    }));

    const labelEvery=rows.length>22 ? 4 : rows.length>14 ? 2 : 1;

    pts.forEach((p,i)=>{
      svg.appendChild(svgEl('circle',{
        cx:p.x,cy:p.y,r:3,class:'line-point'
      }));

      if(p.r.value>0){
        svg.appendChild(svgEl('text',{
          x:p.x,y:p.y-7,'text-anchor':'middle',class:'chart-value'
        },String(p.r.value)));
      }

      if(i%labelEvery===0 || i===rows.length-1){
        svg.appendChild(svgEl('text',{
          x:p.x,y:H-12,'text-anchor':'middle',class:'chart-label'
        },p.r.label));
      }
    });
  }

  container.appendChild(svg);
}
function renderProductGauge(container,shoyu,mitarashi){
  container.innerHTML='';
  const total=shoyu+mitarashi;

  if(total===0){
    emptyChart(container,'販売データがありません');
    return;
  }

  const shPct=shoyu/total*100;
  const miPct=100-shPct;

  const svg=svgEl('svg',{
    viewBox:'0 0 460 235',
    class:'gauge-svg',
    'aria-label':'商品別構成比'
  });

  const arc='M 65 190 A 165 165 0 0 1 395 190';

  svg.appendChild(svgEl('path',{
    d:arc,pathLength:100,class:'gauge-base'
  }));

  svg.appendChild(svgEl('path',{
    d:arc,pathLength:100,class:'gauge-shoyu',
    'stroke-dasharray':`${shPct} ${100-shPct}`
  }));

  svg.appendChild(svgEl('path',{
    d:arc,pathLength:100,class:'gauge-mitarashi',
    'stroke-dasharray':`${miPct} ${100-miPct}`,
    'stroke-dashoffset':`${-shPct}`
  }));

  svg.appendChild(svgEl('text',{x:230,y:135,class:'gauge-sub'},'合計'));
  svg.appendChild(svgEl('text',{x:230,y:163,class:'gauge-main'},`${total}本`));

  svg.appendChild(svgEl('text',{
    x:135,y:188,class:'gauge-label gauge-label-shoyu'
  },`しょうゆ ${shoyu}本 (${shPct.toFixed(1)}%)`));

  svg.appendChild(svgEl('text',{
    x:325,y:188,class:'gauge-label gauge-label-mitarashi'
  },`みたらし ${mitarashi}本 (${miPct.toFixed(1)}%)`));

  svg.appendChild(svgEl('text',{x:58,y:225,class:'chart-label'},'0%'));
  svg.appendChild(svgEl('text',{
    x:230,y:225,'text-anchor':'middle',class:'chart-label'
  },'50%'));
  svg.appendChild(svgEl('text',{x:385,y:225,class:'chart-label'},'100%'));

  container.appendChild(svg);
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

  document.getElementById('dashDate').textContent=formatJapaneseDate(today);
  document.getElementById('dashSales').textContent=money(sales);
  document.getElementById('dashQty').textContent=qty;
  document.getElementById('dashShoyu').textContent=shoyu;
  document.getElementById('dashMitarashi').textContent=mita;
  document.getElementById('dashTxCount').textContent=txCount;

  const unitLabel=dashboardBucketMinutes===60 ? '1時間毎' : '15分毎';
  document.getElementById('qtyTrendTitle').textContent=`販売本数の推移（${unitLabel}）`;
  document.getElementById('txTrendTitle').textContent=`取引件数の推移（${unitLabel}）`;
  document.getElementById('bucket15Btn').classList.toggle('active',dashboardBucketMinutes===15);
  document.getElementById('bucket60Btn').classList.toggle('active',dashboardBucketMinutes===60);

  const trendRows=buildTrendRows(active,dashboardBucketMinutes);

  renderStackedBarChart(
    document.getElementById('quarterQtyChart'),
    trendRows,
    {ariaLabel:`${unitLabel}販売本数`}
  );

  renderLineChart(
    document.getElementById('quarterTxChart'),
    trendRows.map(r=>({label:r.label,value:r.txCount}))
  );

  renderProductGauge(
    document.getElementById('productGauge'),
    shoyu,
    mita
  );

  const memoBody=document.getElementById('openMemoBody');
  memoBody.innerHTML='';

  const openMemos=[...active]
    .filter(x=>Boolean((x.note||'').trim()) && !Boolean(x.noteResolved))
    .sort((a,b)=>a.timestamp.localeCompare(b.timestamp));

  if(!openMemos.length){
    memoBody.innerHTML=
      '<tr><td colspan="6" class="memo-empty">未完了のメモ付き取引はありません</td></tr>';
  }else{
    openMemos.forEach(x=>{
      const tr=document.createElement('tr');

      [
        x.timestamp.slice(11,16),
        displayKey(x) || '----',
        `${Number(x.shoyu||0)}本`,
        `${Number(x.mitarashi||0)}本`,
        `${Number(x.totalQty||0)}本`
      ].forEach(v=>{
        const td=document.createElement('td');
        td.textContent=v;
        tr.appendChild(td);
      });

      const noteTd=document.createElement('td');
      noteTd.className='memo-text';
      noteTd.textContent=x.note || '';
      tr.appendChild(noteTd);

      tr.style.cursor='pointer';
      tr.title='タップして取引詳細を開く';
      tr.onclick=()=>requestCancelTransaction(x.id);

      memoBody.appendChild(tr);
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
      const hasOpenNote=Boolean((x.note||'').trim()) && !Boolean(x.noteResolved);
      b.className='recent-item'+(hasOpenNote?' needs-attention':'');
      b.onclick=()=>requestCancelTransaction(x.id);

      const top=document.createElement('div');
      top.className='recent-top';
      const timeSpan=document.createElement('span');
      timeSpan.textContent=x.timestamp.slice(11,16);
      const keySpan=document.createElement('span');
      keySpan.textContent=x.id.slice(-4);
      top.appendChild(timeSpan);
      top.appendChild(keySpan);

      const main=document.createElement('div');
      main.className='recent-main';
      main.textContent=parts.join(' / ');
      if(hasOpenNote){
        const badge=document.createElement('span');
        badge.className='recent-note-badge';
        badge.textContent='📝 要対応';
        main.appendChild(badge);
      }

      const total=document.createElement('div');
      total.className='recent-total';
      total.textContent=`${x.totalQty}本　¥${money(x.totalPrice)}`;

      b.appendChild(top);
      b.appendChild(main);
      b.appendChild(total);
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
      const noteLabel=(x.note||'').trim()
        ? (x.noteResolved ? ' ・ メモ対応完了' : ' ・ 📝要対応')
        : '';
      div.innerHTML=`
        <div class="tx-top"><span>${x.timestamp.slice(11,16)}</span><span>${cancelled?'<span class="cancel-badge">取消済</span>':(displayKey(x) || '----')}</span></div>
        <div class="tx-main">${parts.join(' / ')}${noteLabel}</div>
        <div class="tx-total">${x.totalQty}本　¥${money(x.totalPrice)}</div>`;
      div.style.cursor='pointer';
      div.onclick=()=>requestCancelTransaction(x.id);
      txList.appendChild(div);
    });
  }

  if(document.getElementById('tab-dashboard').classList.contains('active')){
    renderDashboard();
  }
  if(document.getElementById('tab-all-data').classList.contains('active')){
    renderAllData();
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


function noteState(tx){
  const hasNote=Boolean((tx.note||'').trim());
  if(!hasNote) return 'なし';
  return tx.noteResolved ? '対応完了' : '要対応';
}
async function renderAllData(){
  if(!db) return;
  const txs=[...(await allTxs())].reverse();
  const input=document.getElementById('keySearchInput');
  const query=(input ? input.value : '').trim();
  const filtered=query
    ? txs.filter(x=>displayKey(x).includes(query))
    : txs;

  const body=document.getElementById('allDataBody');
  const count=document.getElementById('allDataCount');
  if(!body || !count) return;

  count.textContent=query ? `${filtered.length}件 / 全${txs.length}件` : `${txs.length}件`;
  body.innerHTML='';

  if(!filtered.length){
    body.innerHTML='<tr><td colspan="12" style="padding:28px;color:#6b7785">該当する取引がありません</td></tr>';
    return;
  }

  filtered.forEach(tx=>{
    const tr=document.createElement('tr');
    const hasNote=Boolean((tx.note||'').trim());
    const isResolved=Boolean(tx.noteResolved);
    if(!activeStatus(tx)) tr.classList.add('cancelled');
    else if(hasNote && !isResolved) tr.classList.add('attention');
    else if(hasNote && isResolved) tr.classList.add('resolved-note');

    const status=activeStatus(tx)
      ? '<span class="status-pill status-active">登録済</span>'
      : '<span class="status-pill status-cancelled">取消済</span>';

    let memoStatus='<span class="status-pill status-resolved">なし</span>';
    if(hasNote && !isResolved) memoStatus='<span class="status-pill status-attention">要対応</span>';
    if(hasNote && isResolved) memoStatus='<span class="status-pill status-resolved">対応完了</span>';

    const cells=[
      tx.timestamp.replace('T',' '),
      displayKey(tx) || '----',
      `${Number(tx.shoyu||0)}本`,
      `${Number(tx.mitarashi||0)}本`,
      `${Number(tx.totalQty||0)}本`,
      `${money(txUnitPrice(tx))}円`,
      `¥${money(tx.totalPrice||0)}`
    ];
    cells.forEach(v=>{
      const td=document.createElement('td');
      td.textContent=v;
      tr.appendChild(td);
    });

    const statusTd=document.createElement('td');
    statusTd.innerHTML=status;
    tr.appendChild(statusTd);

    const memoStatusTd=document.createElement('td');
    memoStatusTd.innerHTML=memoStatus;
    tr.appendChild(memoStatusTd);

    const noteTd=document.createElement('td');
    noteTd.className='note-cell';
    noteTd.textContent=tx.note || '';
    tr.appendChild(noteTd);

    const updatedTd=document.createElement('td');
    updatedTd.textContent=tx.noteUpdatedAt ? tx.noteUpdatedAt.replace('T',' ') : '';
    tr.appendChild(updatedTd);

    const resolvedTd=document.createElement('td');
    resolvedTd.textContent=tx.noteResolvedAt ? tx.noteResolvedAt.replace('T',' ') : '';
    tr.appendChild(resolvedTd);

    tr.style.cursor='pointer';
    tr.title='タップして取引詳細を開く';
    tr.onclick=()=>requestCancelTransaction(tx.id);

    body.appendChild(tr);
  });
}
function filterAllData(){
  const input=document.getElementById('keySearchInput');
  if(!input) return;
  input.value=input.value.replace(/\D/g,'').slice(0,4);
  renderAllData();
}
function clearAllDataSearch(){
  const input=document.getElementById('keySearchInput');
  if(input) input.value='';
  renderAllData();
}

function csvEscape(value){
  const s=String(value ?? '');
  if(/[",\r\n]/.test(s)){
    return '"' + s.replace(/"/g,'""') + '"';
  }
  return s;
}
function parseCSV(text){
  const rows=[];
  let row=[],field='',inQuotes=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inQuotes){
      if(ch==='"'){
        if(text[i+1]==='"'){
          field+='"';
          i++;
        }else{
          inQuotes=false;
        }
      }else{
        field+=ch;
      }
    }else{
      if(ch==='"'){
        inQuotes=true;
      }else if(ch===','){
        row.push(field);field='';
      }else if(ch==='\n'){
        row.push(field);rows.push(row);row=[];field='';
      }else if(ch==='\r'){
        // Ignore CR; LF will close the row.
      }else{
        field+=ch;
      }
    }
  }
  if(field!=='' || row.length){
    row.push(field);rows.push(row);
  }
  return rows;
}

async function exportCSV(silent=false){
  const txs=await allTxs();
  const headers=[
    'record_type','timestamp','transaction_id','display_key','shoyu_qty','mitarashi_qty','total_qty',
    'unit_price','total_price','status','cancelled_at',
    'note','note_updated_at','note_resolved','note_resolved_at'
  ];
  const lines=[headers.map(csvEscape).join(',')];
  txs.forEach(x=>{
    lines.push([
      'SALE',x.timestamp,x.id,displayKey(x),x.shoyu,x.mitarashi,x.totalQty,txUnitPrice(x),x.totalPrice,
      activeStatus(x)?'active':'cancelled',x.cancelledAt||'',
      x.note||'',x.noteUpdatedAt||'',x.noteResolved?'true':'false',x.noteResolvedAt||''
    ].map(csvEscape).join(','));
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
        const text=(await file.text()).replace(/^\uFEFF/,'');
        const rowsRaw=parseCSV(text).filter(r=>r.some(v=>String(v).trim()!==''));
        if(!rowsRaw.length) throw new Error('CSVが空です');

        const header=rowsRaw[0].map(v=>String(v).trim());
        const index={};
        header.forEach((name,i)=>{ index[name]=i; });

        const required=[
          'record_type','timestamp','transaction_id',
          'shoyu_qty','mitarashi_qty','total_qty','unit_price','total_price'
        ];
        if(required.some(name=>index[name]===undefined)){
          throw new Error('このアプリのCSV形式ではありません');
        }

        const get=(row,name,defaultValue='')=>{
          const i=index[name];
          return i===undefined ? defaultValue : (row[i] ?? defaultValue);
        };

        const imported=[];
        for(let i=1;i<rowsRaw.length;i++){
          const c=rowsRaw[i];
          if(get(c,'record_type')!=='SALE') continue;

          const ts=get(c,'timestamp');
          const id=get(c,'transaction_id');
          const sh=Number(get(c,'shoyu_qty'));
          const mi=Number(get(c,'mitarashi_qty'));
          const tq=Number(get(c,'total_qty'));
          const up=Number(get(c,'unit_price'));
          const tp=Number(get(c,'total_price'));

          if(!ts || !id || [sh,mi,tq,up,tp].some(Number.isNaN)){
            throw new Error(`${i+1}行目の形式が不正です`);
          }

          imported.push({
            id,
            key4:normalizeDisplayKey(get(c,'display_key')),
            timestamp:ts,
            dateKey:ts.slice(0,10),
            shoyu:sh,
            mitarashi:mi,
            totalQty:tq,
            unitPrice:up,
            totalPrice:tp,
            status:get(c,'status','active') || 'active',
            cancelledAt:get(c,'cancelled_at',''),
            note:get(c,'note',''),
            noteUpdatedAt:get(c,'note_updated_at',''),
            noteResolved:String(get(c,'note_resolved','false')).toLowerCase()==='true',
            noteResolvedAt:get(c,'note_resolved_at','')
          });
        }

        await clearTxs();
        for(const r of imported) await storeTx(r);
        await refresh();

        if(document.getElementById('tab-all-data').classList.contains('active')){
          await renderAllData();
        }

        toast(`${imported.length}件の取引を復元しました`);
      }catch(e){
        alert('CSV復元に失敗しました.\n'+e.message);
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

    const savedSound=await getSetting('soundEnabled');
    soundEnabled=(typeof savedSound==='boolean') ? savedSound : true;
    if(typeof savedSound!=='boolean'){
      await setSetting('soundEnabled',true);
    }
    updateSoundSettingUI();

    const cashAudio=document.getElementById('cashRegisterSound');
    if(cashAudio){
      cashAudio.load();
    }

    renderOrder();
    await refresh();
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }
  }catch(e){
    alert('アプリの保存領域を初期化できませんでした。\n'+e.message);
  }
});
