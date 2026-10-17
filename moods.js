import { MOODS, moodByCode, catNode } from './mood-cats.js?v=20261016-moods';
const make=(tag,cls='',text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const read=key=>{try{return JSON.parse(sessionStorage.getItem(key));}catch{return null;}};
const persist=(key,value)=>{try{value?sessionStorage.setItem(key,JSON.stringify(value)):sessionStorage.removeItem(key);}catch{}};

export class MoodsPanel {
  constructor(api,namespace,onSessionError) {
    this.api=api;this.namespace=namespace;this.onSessionError=onSessionError;
    this.home=document.getElementById('moodHome');this.root=document.getElementById('moodPanel');
    this.epoch=0;this.user=null;this.routeName=null;this.data=null;
    const wake=()=>{if(this.active&&!document.hidden){this.expire();void this.load();}};
    document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);
  }
  get key(){return `rq-mood-outbox:${this.namespace}:${this.user?.id}`;}
  get active(){return this.user&&['menu','moods'].includes(this.routeName);}
  reset() {
    this.epoch++;clearInterval(this.timer);this.user=null;this.routeName=null;this.data=null;this.loading=null;
    this.pending=null;this.sending=false;this.selected=null;this.fresh=false;this.deadline=0;this.notice='';
    this.home.replaceChildren();this.root.replaceChildren();
  }
  attach(user,partner) {
    if(this.user?.id===user.id){this.partnerName=partner?.name||'Dein Gegenüber';return;}
    this.reset();this.user=user;this.partnerName=partner?.name||'Dein Gegenüber';
    const saved=read(this.key);
    if(saved?.p_id&&moodByCode(saved.p_mood_code)&&typeof saved.p_day==='string'&&Number.isSafeInteger(saved.p_revision))this.pending=saved;
    this.build();this.render();
  }
  route(name) {
    const changed=this.routeName!==name;this.routeName=name;clearInterval(this.timer);
    if(!this.active)return;
    this.expire();if(changed||!this.data)void this.load();
    this.timer=setInterval(()=>{
      if(!this.active)return;
      this.expire();
      if(!document.hidden&&performance.now()>=this.nextCheck)void this.load();
    },1000);
  }
  build() {
    this.partnerCard=make('article','mood-partner panel');this.root.append(this.partnerCard);
    const toolbar=make('div','feature-toolbar');const refresh=make('button','text-btn','Aktualisieren');refresh.type='button';refresh.onclick=()=>void this.load();toolbar.append(refresh);this.root.append(toolbar);
    this.own=make('p','mood-own');this.root.append(this.own);
    this.form=make('form');const fields=make('fieldset');fields.append(make('legend','','Wie fühlst du dich gerade?'));
    this.grid=make('div','mood-grid');this.inputs=[];
    for(const mood of MOODS){
      const label=make('label','mood-choice');const radio=make('input');radio.type='radio';radio.name='mood';radio.value=mood.code;radio.required=true;
      const tile=make('span','mood-choice-tile');tile.append(catNode(mood.code),make('span','mood-choice-name',mood.label));label.append(radio,tile);this.grid.append(label);this.inputs.push(radio);
      radio.onchange=()=>{this.selected=mood.code;this.notice='';this.renderControls();};
    }
    fields.append(this.grid);this.send=make('button','primary','Gefühl teilen');this.send.type='submit';
    this.status=make('p','status');this.status.setAttribute('role','status');
    this.form.append(fields,this.send,this.status);this.root.append(this.form);
    this.form.onsubmit=e=>{e.preventDefault();void this.save();};
    this.homeTitle=make('span','eyebrow','So geht’s mir');this.homeImage=make('span','mood-home-image');
    const copy=make('span','mood-home-copy');this.homeName=make('strong');this.homeLabel=make('span','mood-home-label');this.homeTime=make('span','mood-stamp');
    copy.append(this.homeTitle,this.homeName,this.homeLabel,this.homeTime,make('span','mood-home-link','Dein Gefühl wählen ›'));
    this.home.append(this.homeImage,copy);
  }
  apply(data) {
    const newDay=this.data&&this.data.today!==data.today;
    this.data=data;this.fresh=true;this.deadline=performance.now()+Math.max(0,Date.parse(data.day_ends_at)-Date.parse(data.server_now));
    if(newDay)this.selected=null;
    if(this.pending&&this.pending.p_day!==data.today){persist(this.key,null);this.pending=null;this.notice='Ein neuer Tag. Wähle dein Gefühl für heute.';}
    if(this.selected===null)this.selected=data.me?.code||null;
    this.render();
  }
  expire() {
    if(this.fresh&&performance.now()>=this.deadline){
      this.fresh=false;this.selected=null;this.notice='Ein neuer Tag. Die aktuelle Stimmung wird geladen.';this.nextCheck=0;this.render();
    }
  }
  render() {
    if(!this.user||!this.partnerCard)return;
    const partner=this.data?.partner;const mood=this.fresh?moodByCode(partner?.mood?.code):null;
    const name=partner?.name||this.partnerName;
    const label=this.fresh?(mood?.label||'Heute noch keine Stimmung geteilt'):(this.data?'Neue Tagesstimmung noch nicht geladen':'Stimmung wird geladen …');
    const stamp=mood?`Geteilt um ${new Date(partner.mood.updated_at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'})} Uhr · deutsche Zeit`:'';
    const picture=()=>mood?catNode(mood.code):make('span','mood-placeholder','♡');
    this.partnerCard.replaceChildren(make('p','eyebrow',`${name} heute`),picture(),make('h2','mood-partner-label',label),make('p','mood-stamp',stamp));
    this.homeImage.replaceChildren(picture());this.homeName.textContent=`${name} heute`;this.homeLabel.textContent=label;this.homeTime.textContent=stamp;
    const own=this.fresh?moodByCode(this.data?.me?.code):null;
    this.own.textContent=own?`Dein geteiltes Gefühl: ${own.label}`:'Du kannst jeden Tag neu wählen und dein Gefühl tagsüber ändern.';
    this.renderControls();
  }
  renderControls() {
    if(!this.user||!this.send)return;
    const code=this.pending?.p_mood_code||this.selected;
    for(const input of this.inputs){input.checked=input.value===code;input.disabled=this.sending||!this.fresh||Boolean(this.pending);}
    this.send.textContent=this.sending?'Wird geteilt …':this.pending?'Übertragung prüfen':'Gefühl teilen';
    this.send.disabled=this.sending||!this.fresh||(!this.pending&&(!this.selected||this.selected===this.data?.me?.code));
    this.status.textContent=this.notice||(this.pending?'Die Bestätigung fehlt noch. Prüfe die Übertragung, bevor du ein anderes Gefühl teilst.':'');
  }
  async load() {
    if(!this.user||this.loading||this.sending)return;
    const ticket=this.epoch;const operation={};this.loading=operation;this.nextCheck=performance.now()+20000;
    try{
      const data=await this.api.rpc('rq_mood_state');
      if(ticket!==this.epoch)return;
      this.notice='';this.apply(data);
    }catch(error){
      if(ticket!==this.epoch)return;
      this.notice=error.message;this.renderControls();
      this.homeTime.textContent='Aktualisierung nicht möglich. Bitte erneut laden.';
      if(!this.api.session)this.onSessionError(error);
    }finally{if(this.loading===operation)this.loading=null;}
  }
  async save() {
    if(!this.user||this.sending)return;
    this.expire();if(!this.fresh||(!this.pending&&!moodByCode(this.selected)))return;
    // Leseanfragen abwarten, damit keine alte Antwort die frisch gespeicherte Auswahl überlagert.
    if(this.loading){this.notice='Die aktuelle Stimmung wird noch geladen. Bitte gleich erneut teilen.';this.renderControls();return;}
    const ticket=this.epoch;
    this.pending??={p_id:crypto.randomUUID(),p_day:this.data.today,p_mood_code:this.selected,p_revision:Number(this.data.revision)};
    persist(this.key,this.pending);this.sending=true;this.notice='';this.renderControls();
    let reload=false;
    try{
      const result=await this.api.rpc('rq_mood_save',this.pending);
      if(ticket!==this.epoch)return;
      persist(this.key,null);this.pending=null;this.notice='Dein Gefühl ist geteilt.';this.apply(result);
    }catch(error){
      if(ticket!==this.epoch)return;
      if([400,403,404,409,422].includes(error.status)){
        persist(this.key,null);this.pending=null;this.selected=null;reload=true;
      }
      this.notice=error.message;if(!this.api.session)this.onSessionError(error);
    }finally{
      if(ticket===this.epoch){this.sending=false;this.renderControls();if(reload){const notice=this.notice;await this.load();if(ticket===this.epoch){this.notice=notice;this.renderControls();}}}
    }
  }
}
