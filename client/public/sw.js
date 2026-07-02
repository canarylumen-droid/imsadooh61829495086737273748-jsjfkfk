
const CACHE_NAME = 'audnix-v1';
const urlsToCache = [
  '/',
  '/favicon-white.png',
  '/notification.mp3'
];

// Install service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

// Fetch from cache, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});

// Handle push notifications
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  
  const options = {
    body: data.message || 'You have a new notification',
    icon: '/favicon-white.png',
    badge: '/favicon-white.png',
    vibrate: [200, 100, 200],
    tag: data.type || 'notification',
    sound: '/notification.mp3',
    data: {
      url: data.url || '/dashboard',
      timestamp: Date.now()
    },
    actions: [
      {
        action: 'open',
        title: 'Open'
      },
      {
        action: 'close',
        title: 'Dismiss'
      }
    ],
    requireInteraction: data.requireInteraction || false
  };

  // Play notification sound immediately (most browsers support this)
  try {
    const audio = new Audio('/notification.mp3');
    audio.volume = 0.6;
    audio.play().catch(() => {
      console.log('Notification sound play deferred (browser may be muted)');
    });
  } catch (error) {
    console.log('Sound notification not available');
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'audnixai.com', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    const urlToOpen = event.notification.data?.url || '/dashboard';
    
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Check if app is already open
          for (let client of clientList) {
            if (client.url.includes(urlToOpen) && 'focus' in client) {
              return client.focus();
            }
          }
          // Open new window
          if (clients.openWindow) {
            return clients.openWindow(urlToOpen);
          }
        })
    );
  }
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

async function syncMessages() {
  // Sync offline messages when back online
  const cache = await caches.open('audnix-offline-messages');
  const requests = await cache.keys();
  
  for (let request of requests) {
    try {
      await fetch(request);
      await cache.delete(request);
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }
}
