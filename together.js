import { catNode, moodByCode } from './mood-cats.js?v=20261016-moods';
import { PushSettings } from './push-client.js?v=20261016-together';
const $=id=>document.getElementById(id);
const node=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,action,cls='secondary')=>{const b=node('button',cls,text);b.type='button';b.onclick=action;return b;};
const read=k=>{try{return JSON.parse(sessionStorage.getItem(k));}catch{return null;}};
const put=(k,v)=>{try{v?sessionStorage.setItem(k,JSON.stringify(v)):sessionStorage.removeItem(k);}catch{}};
const date=v=>new Date(v).toLocaleString('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const suggestions=['Du kannst immer mit mir reden.','Du musst heute nicht alles schaffen.','Ich bin an deiner Seite.','Du darfst eine Pause machen.','Du bist mir wichtig, auch an schweren Tagen.','Wir gehen einen Schritt nach dem anderen.'];

export class TogetherPanel {
 constructor(api,namespace,onError){
  this.api=api;this.namespace=namespace;this.onError=onError;this.epoch=0;
  this.push=new PushSettings(api,()=>void this.load(),()=>this.user);
  const wake=()=>{if(this.user&&!document.hidden){this.expire();void this.load();}};
  document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);
  navigator.serviceWorker?.addEventListener('message',wake);
 }
 get key(){return `rq-care-outbox:${this.namespace}:${this.user?.id}`;}
 reset(){
  this.epoch++;clearInterval(this.timer);this.push.reset();this.user=null;this.data=null;this.busy=false;this.loading=null;
  this.pending=null;this.logTicket=(this.logTicket||0)+1;this.cursor=null;this.notice='';this.alertSignature='';
  this.seen=new Set();this.fresh=false;this.audio?.close().catch(()=>{});this.audio=null;
  for(const id of ['careAlert','carePanel','mantraPanel','mantraHome','journalPanel'])$(id).replaceChildren();
  $('careAlert').hidden=true;
 }
 attach(user,partner){
  if(this.user?.id===user.id)return;
  this.reset();this.user=user;this.partner=partner?.name||'dein Gegenüber';
  const saved=read(this.key);
  if(saved&&['rq_mantra_send','rq_signal_send','rq_signal_action'].includes(saved.rpc)&&saved.body?.p_id)this.pending=saved;
  this.build();void this.load();
  this.timer=setInterval(()=>{if(!document.hidden&&this.user){this.expire();void this.load();}},5000);
 }
 route(name){this.routeName=name;document.querySelector('.care-shortcut').hidden=name==='care';if(name==='journal')void this.loadJournal();if(['mantra','care'].includes(name))void this.load();}
 build(){
  this.mantraReceived=node('article','panel mantra-received');this.mantraMine=node('p','field-hint');
  this.mantraForm=node('form','panel');const label=node('label','','Dein Mantra für heute');label.htmlFor='mantraText';
  this.mantraText=node('textarea');this.mantraText.id='mantraText';this.mantraText.rows=3;this.mantraText.maxLength=280;this.mantraText.required=true;
  this.mantraText.placeholder='Du kannst immer mit mir reden.';
  const ideas=node('div','mantra-ideas');for(const text of suggestions){const b=button(text,()=>{this.mantraText.value=text;this.mantraText.focus();},'mantra-idea');ideas.append(b);}
  this.mantraIdeas=ideas;
  this.mantraSend=button('Mantra senden',()=>{} ,'primary');this.mantraSend.type='submit';this.mantraStatus=node('p','status');this.mantraStatus.role='status';
  this.mantraForm.append(label,this.mantraText,ideas,this.mantraSend,this.mantraMine,this.mantraStatus);
  this.mantraForm.onsubmit=e=>{e.preventDefault();if(this.pending)return void this.retry();this.expire();if(!this.fresh)return;
   void this.write('rq_mantra_send',{p_id:crypto.randomUUID(),p_day:this.data.today,p_message:this.mantraText.value.trim()});};
  $('mantraPanel').append(this.mantraReceived,this.mantraForm);
  this.signalState=node('article','panel');this.signalForm=node('form','panel');
  const signalLabel=node('label','','Was soll dein Gegenüber wissen?');signalLabel.htmlFor='signalText';
  this.signalText=node('textarea');this.signalText.id='signalText';this.signalText.rows=3;this.signalText.maxLength=280;this.signalText.required=true;
  this.signalText.value='Mir geht es gerade nicht gut. Bitte melde dich bei mir.';
  this.signalSend=button(`Signal an ${this.partner} senden`,()=>{},'primary');this.signalSend.type='submit';
  this.signalStatus=node('p','status');this.signalStatus.role='status';
  this.signalForm.append(signalLabel,this.signalText,this.signalSend,this.signalStatus);
  this.signalForm.onsubmit=e=>{e.preventDefault();if(this.pending)return void this.retry();
   void this.write('rq_signal_send',{p_id:crypto.randomUUID(),p_message:this.signalText.value.trim()});};
  this.soundButton=button('Signalton für diese Sitzung einschalten',()=>this.enableSound());
  this.connection=node('p','field-hint');
  $('carePanel').append(this.signalState,this.signalForm,this.connection,this.soundButton);
  this.push.mount($('carePanel'));
  this.logForm=node('form','journal-filter');
  const dayLabel=node('label','','Tag');this.logDay=node('input');this.logDay.type='date';this.logDay.id='journalDay';dayLabel.htmlFor=this.logDay.id;
  const personLabel=node('label','','Einträge von');this.logPerson=node('select');this.logPerson.id='journalPerson';personLabel.htmlFor=this.logPerson.id;
  for(const [value,labelText] of [['all','Uns beiden'],['me','Mir'],['partner',this.partner]]){const opt=node('option','',labelText);opt.value=value;this.logPerson.append(opt);}
  const dayBox=node('div'),personBox=node('div');dayBox.append(dayLabel,this.logDay);personBox.append(personLabel,this.logPerson);
  const filter=button('Anzeigen',()=>{});filter.type='submit';
  this.logForm.append(dayBox,personBox,filter,button('Alle Tage',()=>{this.logDay.value='';void this.loadJournal();},'text-btn'));
  this.logForm.onsubmit=e=>{e.preventDefault();void this.loadJournal();};
  this.logStatus=node('p','status');this.logStatus.role='status';this.logList=node('div','journal-list');this.logMore=button('Ältere Einträge laden',()=>void this.loadJournal(true));this.logMore.hidden=true;
  $('journalPanel').append(this.logForm,this.logStatus,this.logList,this.logMore);
  this.render();
 }
 expire(){if(this.fresh&&performance.now()>=this.deadline){this.fresh=false;this.render();}}
 apply(data){
  this.data=data;this.fresh=true;this.deadline=performance.now()+Math.max(0,Date.parse(data.day_ends_at)-Date.parse(data.server_now));
  this.lastSync=performance.now();this.render();
  const signal=data.incoming;
  if(signal&&!signal.acknowledged_at&&!this.seen.has(signal.id)){this.seen.add(signal.id);this.playSound();}
 }
 render(){
  if(!this.user)return;
  const data=this.data,received=this.fresh?data?.received:null,mine=this.fresh?data?.mine:null;
  const mantraText=received?.message||(this.fresh?`Heute wartet noch ein Mantra von ${this.partner} auf dich.`:'Das heutige Mantra wird geladen …');
  this.mantraReceived.replaceChildren(node('p','eyebrow',`Von ${this.partner} für dich`),node('blockquote','mantra-quote',mantraText));
  $('mantraHome').replaceChildren(node('span','eyebrow','Dein Mantra heute'),node('blockquote','mantra-quote',mantraText),node('span','mood-home-link','Ein Mantra schicken ›'));
  this.mantraMine.textContent=mine?`Heute gesendet: „${mine.message}“`:'Ein Mantra pro Tag. Gesendete Mantras bleiben im gemeinsamen Logbuch.';
  const minePending=this.pending?.rpc==='rq_mantra_send';
  if(minePending)this.mantraText.value=this.pending.body.p_message;
  this.mantraText.disabled=this.busy||!!mine||!!this.pending||!this.fresh;
  for(const b of this.mantraIdeas.children)b.disabled=this.mantraText.disabled;
  this.mantraSend.textContent=minePending?'Übertragung prüfen':this.busy?'Wird gesendet …':mine?'Heute bereits gesendet':'Mantra senden';
  this.mantraSend.disabled=this.busy||(!minePending&&(!!mine||!!this.pending||!this.fresh));
  this.mantraStatus.textContent=this.notice;
  const sig=data?.outgoing;
  this.signalState.replaceChildren(node('p','eyebrow','Ich brauche dich'));
  if(sig){
   this.signalState.append(node('h2','',sig.acknowledged_at?`${this.partner} hat dein Signal bestätigt.`:'Dein Signal wartet auf Bestätigung.'),node('p','',sig.message),node('p','field-hint',`Gesendet ${date(sig.created_at)} · deutsche Zeit`));
   const close=button('Signal beenden',()=>void this.write('rq_signal_action',{p_id:sig.id,p_action:'close'}));close.disabled=this.busy||!!this.pending;this.signalState.append(close);
  }else this.signalState.append(node('h2','',`Sag ${this.partner}, dass du Unterstützung brauchst.`),node('p','','Das Signal bleibt offen, bis du es beendest. Du siehst hier, sobald es bestätigt wurde.'));
  const signalPending=this.pending?.rpc==='rq_signal_send';if(signalPending)this.signalText.value=this.pending.body.p_message;
  this.signalText.disabled=this.busy||!!sig||!!this.pending;
  this.signalSend.textContent=signalPending?'Übertragung prüfen':`Signal an ${this.partner} senden`;
  this.signalSend.disabled=this.busy||(!signalPending&&(!!sig||!!this.pending));
  this.signalStatus.replaceChildren(node('span','',this.notice));
  if(this.pending&&this.pending.rpc==='rq_signal_action'){const retry=button('Bestätigung erneut prüfen',()=>void this.retry());retry.disabled=this.busy;this.signalStatus.append(retry);}
  const push=data?.push;
  this.connection.textContent=!data?'Verbindung wird geprüft.':!push?.enabled||!push.partner_devices?
   `${this.partner} hat noch keine Push-Mitteilungen eingerichtet. Das Signal wird beim Öffnen der App sichtbar. Bei geöffneter App wird etwa alle 5 Sekunden aktualisiert.`:
   'Push-Mitteilungen sind beim anderen eingerichtet. Erst die persönliche Bestätigung bedeutet, dass dein Signal gesehen wurde.';
  if(this.pending?.rpc==='rq_mantra_send'){
   this.connection.append(' Ein Mantra wartet noch auf Übertragungsprüfung. ');
   const link=node('a','btn-back','Mantra-Übertragung prüfen');link.href='#mantra';this.connection.append(link);
  }
  this.push.update(push);
  this.renderAlert();
 }
 renderAlert(){
  const incoming=this.data?.incoming,signature=JSON.stringify([incoming,this.busy,!!this.pending]);
  if(signature===this.alertSignature)return;this.alertSignature=signature;
  const root=$('careAlert');root.hidden=!incoming;root.replaceChildren();if(!incoming)return;
  root.append(node('p','eyebrow','Ich brauche dich'),node('h2','',`${incoming.name} braucht gerade Unterstützung.`),node('p','',incoming.message),node('p','field-hint',`${date(incoming.created_at)} · deutsche Zeit`));
  if(incoming.acknowledged_at)root.append(node('strong','','Du hast den Empfang bestätigt.'));
  else{const ack=button('Ich habe dein Signal gesehen',()=>void this.write('rq_signal_action',{p_id:incoming.id,p_action:'ack'}),'primary');ack.disabled=this.busy||!!this.pending;root.append(ack);}
  const link=node('a','btn-back','Signal öffnen');link.href='#care';root.append(link);
 }
 async load(){
  if(!this.user||this.loading||this.busy)return;
  const ticket=this.epoch,operation={};this.loading=operation;
  try{const result=await this.api.rpc('rq_care_state');if(ticket!==this.epoch)return;this.apply(result);}
  catch(e){if(ticket!==this.epoch)return;this.connection.textContent='Keine aktuelle Verbindung. Neue Signale können gerade nicht angezeigt werden.';if(!this.api.session)this.onError(e);}
  finally{if(this.loading===operation)this.loading=null;}
 }
 async retry(){if(this.pending)return this.write(this.pending.rpc,this.pending.body);}
 async write(rpc,body){
  if(!this.user||this.busy)return;
  if(this.loading){this.notice='Die App lädt gerade. Bitte gleich noch einmal tippen.';this.render();return;}
  if(this.pending&&(this.pending.rpc!==rpc||this.pending.body.p_id!==body.p_id)){location.hash='#care';return;}
  this.pending??={rpc,body};put(this.key,this.pending);this.busy=true;this.notice='';this.render();const ticket=this.epoch;
  try{const result=await this.api.rpc(rpc,body);if(ticket!==this.epoch)return;
   put(this.key,null);this.pending=null;
   this.notice=rpc==='rq_mantra_send'?'Dein Mantra ist gesendet.':rpc==='rq_signal_send'?'Signal gespeichert. Eine Bestätigung steht noch aus.':body.p_action==='ack'?'Du hast den Empfang bestätigt.':'Dein Signal ist beendet.';
   this.apply(result);
  }catch(e){if(ticket!==this.epoch)return;
   if([400,403,404,409,422].includes(e.status)){put(this.key,null);this.pending=null;}
   this.notice=this.pending?'Die Übertragung ist noch nicht bestätigt. Bitte „Übertragung prüfen“ antippen.':e.message;
   if(!this.api.session)this.onError(e);
  }finally{if(ticket===this.epoch){this.busy=false;this.render();if(!this.pending)void this.load();}}
 }
 async loadJournal(more=false){
  if(!this.user)return;const epoch=this.epoch,ticket=++this.logTicket;
  if(!more){this.cursor=null;this.logList.replaceChildren();}
  this.logMore.disabled=true;this.logStatus.textContent='Logbuch wird geladen …';
  const filter={p_day:this.logDay.value||null,p_person:this.logPerson.value,p_before_time:more?this.cursor?.created_at||null:null,p_before_id:more?this.cursor?.id||null:null};
  try{const result=await this.api.rpc('rq_journal',filter);if(epoch!==this.epoch||ticket!==this.logTicket)return;
   for(const entry of result.entries){
    const item=node('article',`journal-entry ${entry.kind}`),copy=node('div','journal-copy');
    const title=entry.kind==='mood'?moodByCode(entry.code)?.label||entry.code:'Mantra an den anderen';
    item.append(entry.kind==='mood'?catNode(entry.code):node('span','journal-heart','♡'));
    copy.append(node('p','eyebrow',entry.person),node('h2','',title));if(entry.kind==='mantra')copy.append(node('blockquote','',entry.message));
    copy.append(node('p','mood-stamp',`${date(entry.created_at)} · deutsche Zeit`));item.append(copy);this.logList.append(item);
   }
   this.cursor=result.entries.at(-1)||this.cursor;this.logMore.hidden=!result.more;this.logStatus.textContent=this.logList.children.length?'':'Für diese Auswahl gibt es noch keine Einträge.';
  }catch(e){if(epoch===this.epoch&&ticket===this.logTicket){this.logStatus.textContent=e.message;if(!this.api.session)this.onError(e);}}
  finally{if(epoch===this.epoch&&ticket===this.logTicket)this.logMore.disabled=false;}
 }
 async enableSound(){
  try{const Audio=window.AudioContext||window.webkitAudioContext;this.audio??=new Audio();await this.audio.resume();this.soundButton.textContent='Signalton ist für diese Sitzung eingeschaltet';this.playSound();}
  catch{this.soundButton.textContent='Der Browser erlaubt gerade keinen Signalton.';}
 }
 playSound(){
  if(this.audio?.state!=='running')return;
  const start=this.audio.currentTime;for(const delay of [0,.35]){const tone=this.audio.createOscillator(),gain=this.audio.createGain();tone.type='sine';tone.frequency.value=660;
   gain.gain.setValueAtTime(0,start+delay);gain.gain.linearRampToValueAtTime(.12,start+delay+.03);gain.gain.exponentialRampToValueAtTime(.001,start+delay+.25);
   tone.connect(gain);gain.connect(this.audio.destination);tone.start(start+delay);tone.stop(start+delay+.27);}
  navigator.vibrate?.([120,70,120]);
 }
 async beforeLogout(){await this.push.disable(true);}
}
