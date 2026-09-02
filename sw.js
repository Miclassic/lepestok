self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>self.clients.claim());
self.addEventListener('push',e=>{
  let data={title:'Лепесток',body:'У вас обновление',icon:'',tag:'lepestok'};
  try{if(e.data)data={...data,...e.data.json()};}catch(_){}
  e.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:data.icon,tag:data.tag,vibrate:[100,50,100]}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{
    for(const w of ws){if('focus' in w)return w.focus();}
    if(clients.openWindow)return clients.openWindow('./');
  }));
});
