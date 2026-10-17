// Nur Push: Keine privaten API-Antworten oder Fotos offline zwischenspeichern.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 const kinds={signal:['Ich brauche dich','In eurer App wartet ein Hilfesignal. Bitte schau nach.','care'],
  ack:['Dein Signal wurde bestätigt','Öffne eure App für den aktuellen Stand.','care'],
  mantra:['Ein Mantra für dich','In eurer App wartet ein neuer liebevoller Satz.','mantra'],
  test:['Die Testmitteilung ist da','Mitteilungen auf diesem Handy funktionieren gerade.','care']};
 const [title,body,route]=kinds[data.kind]||['Für uns','In eurer App wartet eine Mitteilung.','menu'];
 const tag=typeof data.id==='string'?data.kind+':'+data.id:'rq-update';
 event.waitUntil((async()=>{
  await self.registration.showNotification(title,{body,icon:new URL('icons/icon-192.png',self.registration.scope).href,
   tag,renotify:false,requireInteraction:data.kind==='signal',data:{route},...(data.kind==='signal'?{vibrate:[200,100,200]}:{})});
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'rq-care-update'});
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const route=['care','mantra','menu'].includes(event.notification.data?.route)?event.notification.data.route:'menu';
 const target=new URL('./#'+route,self.registration.scope).href;
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of clients){if(client.url.startsWith(self.registration.scope)){await client.navigate(target);await client.focus();return;}}
  await self.clients.openWindow(target);
 })());
});
