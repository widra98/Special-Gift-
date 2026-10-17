const make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
const keyToBytes=key=>Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export class PushSettings {
 constructor(api,onChange,getUser){this.api=api;this.onChange=onChange;this.getUser=getUser;this.generation=0;this.deviceId=crypto.randomUUID();
  try{const key='rq-push-device:'+api.url;this.deviceId=localStorage.getItem(key)||this.deviceId;localStorage.setItem(key,this.deviceId);}catch{}}
 reset(){this.generation++;this.config=null;this.checked=false;this.registered=false;this.busy=false;this.root=null;}
 mount(parent){
  this.root=make('section','panel push-settings');this.root.append(make('h2','','Mitteilungen auf diesem Handy'));
  this.info=make('p');this.message=make('p','status');this.message.role='status';
  this.init=make('button','secondary','Push-Dienst einmalig aktivieren');this.init.type='button';this.init.onclick=()=>void this.initialize();
  this.toggle=make('button','secondary','Mitteilungen einschalten');this.toggle.type='button';this.toggle.onclick=()=>void(this.registered?this.disable():this.enable());
  this.test=make('button','text-btn','Testmitteilung an dieses Handy');this.test.type='button';this.test.onclick=()=>void this.run(async()=>{await this.api.rpc('rq_push_test',{p_id:this.deviceId});return 'Test ist vorgemerkt. Schließe die App kurz. Die Mitteilung sollte auch dann ankommen.';});
  this.root.append(this.info,this.init,this.toggle,this.test,this.message,make('p','field-hint','Bei iPhones die App zuerst zum Home-Bildschirm hinzufügen. Ton, Fokusmodus und Energiesparen werden vom Handy gesteuert. Beim Abmelden werden Mitteilungen für dieses Gerät ausgeschaltet.'));
  parent.append(this.root);
 }
 update(config){
  this.config=config;if(!this.root)return;
  const supported='serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
  this.init.hidden=!!config?.enabled||this.getUser()?.person!=='kira';this.init.disabled=this.busy;
  this.toggle.disabled=this.busy||!supported||!config?.enabled;
  this.toggle.textContent=this.registered?'Mitteilungen ausschalten':'Mitteilungen einschalten';
  this.test.hidden=!this.registered;this.test.disabled=this.busy;
  this.info.textContent=!supported?'Dieser Browser unterstützt hier keine Push-Mitteilungen.':!config?.enabled?
   'Der gemeinsame Push-Dienst muss noch eingerichtet werden. Die Schritte stehen in der Update-Anleitung.':this.registered?
   'Dieses Handy ist angemeldet. Nutze einmal den Test bei geschlossener App.':'Erlaube Mitteilungen, damit Hinweise auch bei geschlossener App ankommen können.';
  if(config?.enabled&&!this.checked){this.checked=true;void this.inspect();}
 }
 async inspect(){const ticket=this.generation;try{const registration=await navigator.serviceWorker?.getRegistration('./');
  const sub=await registration?.pushManager.getSubscription();const state=sub?await this.api.rpc('rq_push_device',{p_action:'status',p_id:this.deviceId}):null;
  if(ticket===this.generation){this.registered=!!state?.registered;this.update(this.config);}}catch{}}
 async run(action){
  if(this.busy||!this.root)return;const ticket=this.generation;this.busy=true;this.message.textContent='Bitte warten …';this.update(this.config);
  const operation=Promise.resolve().then(action);this.operation=operation;
  try{const text=await operation;if(ticket===this.generation){this.message.textContent=text;this.onChange();}}
  catch(e){if(ticket===this.generation)this.message.textContent=e.message||'Die Mitteilungen konnten nicht eingerichtet werden.';}
  finally{if(this.operation===operation)this.operation=null;if(ticket===this.generation){this.busy=false;this.update(this.config);}}
 }
 async initialize(){return this.run(async()=>{
  await this.api.refreshSession();const result=await this.api.request('/functions/v1/rq-push',{action:'init'},this.api.session.access_token);
  this.config={...this.config,...result};return 'Der Push-Dienst ist bereit. Jetzt auf beiden Handys Mitteilungen einschalten.';
 });}
 async enable(){
  // Die Berechtigungsabfrage beginnt unmittelbar in der bewussten Klickaktion.
  const permission=Notification.requestPermission();const ticket=this.generation;
  return this.run(async()=>{
   if(await permission!=='granted')throw Error('Mitteilungen wurden nicht erlaubt. Du kannst das in den Website-Einstellungen ändern.');
   if(ticket!==this.generation)throw Error('Anmeldung gewechselt.');
   const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
   await navigator.serviceWorker.ready;
   let sub=await registration.pushManager.getSubscription();
   const publicKey=keyToBytes(this.config.public_key);
   if(sub&&sub.options.applicationServerKey&&Array.from(new Uint8Array(sub.options.applicationServerKey)).join()!==Array.from(publicKey).join()){await sub.unsubscribe();sub=null;}
   sub??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
   if(ticket!==this.generation){await sub.unsubscribe();throw Error('Anmeldung gewechselt.');}
   await this.api.rpc('rq_push_device',{p_action:'save',p_id:this.deviceId,p_subscription:sub.toJSON()});
   this.registered=true;return 'Dieses Handy empfängt jetzt Mitteilungen. Bitte einmal testen.';
  });
 }
 async disable(silent=false){
  if(silent&&this.operation){try{await this.operation;}catch{}}
  const action=async()=>{
   const registration=await navigator.serviceWorker?.getRegistration('./');const sub=await registration?.pushManager.getSubscription();
   if(sub)await sub.unsubscribe();this.registered=false;
   if(this.config?.enabled)await this.api.rpc('rq_push_device',{p_action:'remove',p_id:this.deviceId});
   this.registered=false;return 'Mitteilungen auf diesem Handy sind ausgeschaltet.';
  };
  if(silent){try{await action();}catch{}return;}
  return this.run(action);
 }
}
