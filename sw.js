var CACHE_NAME = 'casa-v4';
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

// Sent by the notifier (GitHub Actions) even when the app is closed.
self.addEventListener('push', function(event){
  var data = {};
  try{ data = event.data ? event.data.json() : {}; }
  catch(e){ data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Planificator', {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
      for(var i=0;i<list.length;i++){ if('focus' in list[i]) return list[i].focus(); }
      if(self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
