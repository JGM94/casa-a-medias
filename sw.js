var CACHE_NAME = 'casa-a-medias-v2';
var SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){ return cache.addAll(SHELL); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k!==CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// Network first so updates show up right away; cache only as offline fallback.
self.addEventListener('fetch', function(event){
  var req = event.request;
  if(req.method!=='GET' || new URL(req.url).origin!==self.location.origin) return;
  event.respondWith(
    fetch(req).then(function(res){
      var copy = res.clone();
      caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
      return res;
    }).catch(function(){
      return caches.match(req).then(function(cached){ return cached || caches.match('./index.html'); });
    })
  );
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type:'window'}).then(function(list){
      for(var i=0;i<list.length;i++){ if('focus' in list[i]) return list[i].focus(); }
      if(self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
