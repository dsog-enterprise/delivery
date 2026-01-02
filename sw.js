// delivery-service-worker.js
// Service Worker for DSOG Delivery Platform v2.1.0

const CACHE_NAME = 'dsog-delivery-v2.1.0';
const OFFLINE_URL = '/delivery/offline.html';
const API_CACHE_NAME = 'dsog-api-cache-v1.0';

// URLs to cache on install
const PRECACHE_URLS = [
  '/delivery/',
  '/delivery/index.html',
  '/delivery/offline.html',
  'https://i.postimg.cc/kMZ1jTww/Untitled-design-4-removebg-preview.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Segoe+UI:wght@300;400;500;600;700&display=swap'
];

// Cache strategies
const STRATEGIES = {
  CACHE_FIRST: 'cache-first',
  NETWORK_FIRST: 'network-first',
  NETWORK_ONLY: 'network-only',
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate'
};

// Install event - precache static assets
self.addEventListener('install', (event) => {
  console.log('📦 Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Service Worker: Caching app shell');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => {
        console.log('✅ Service Worker: Installation complete');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('❌ Service Worker: Installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker: Activating...');
  
  const cacheWhitelist = [CACHE_NAME, API_CACHE_NAME];
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!cacheWhitelist.includes(cacheName)) {
            console.log(`🗑️ Service Worker: Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      console.log('✅ Service Worker: Activation complete');
      return self.clients.claim();
    })
  );
});

// Fetch event - handle network requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests and browser extensions
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') {
    return;
  }
  
  // Google Maps API - Network First
  if (url.href.includes('maps.googleapis.com/maps/api')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
  
  // Google Sign-in API - Network Only
  if (url.href.includes('accounts.google.com/gsi/')) {
    event.respondWith(networkOnlyStrategy(request));
    return;
  }
  
  // App Script API - Network First with caching
  if (url.href.includes('script.google.com/macros/s/')) {
    event.respondWith(networkFirstWithApiCache(request));
    return;
  }
  
  // Font Awesome - Cache First
  if (url.href.includes('cdnjs.cloudflare.com/ajax/libs/font-awesome')) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }
  
  // Same-origin requests
  if (url.origin === self.location.origin) {
    // HTML pages - Network First
    if (request.headers.get('Accept')?.includes('text/html')) {
      event.respondWith(networkFirstWithOfflineFallback(request));
      return;
    }
    
    // Static assets - Cache First
    event.respondWith(cacheFirstStrategy(request));
    return;
  }
  
  // External resources - Network First
  event.respondWith(networkFirstStrategy(request));
});

// Cache First Strategy
async function cacheFirstStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    // Try cache first
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log(`📂 Cache First: Serving from cache: ${request.url}`);
      return cachedResponse;
    }
    
    // If not in cache, fetch from network
    console.log(`🌐 Cache First: Fetching from network: ${request.url}`);
    const networkResponse = await fetch(request);
    
    // Cache the response for future use
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error(`❌ Cache First failed for ${request.url}:`, error);
    
    // If offline and request is for HTML, return offline page
    if (request.headers.get('Accept')?.includes('text/html')) {
      const offlineResponse = await cache.match(OFFLINE_URL);
      if (offlineResponse) {
        return offlineResponse;
      }
    }
    
    // Return a generic offline response
    return new Response('Network error', {
      status: 408,
      statusText: 'Network error'
    });
  }
}

// Network First Strategy
async function networkFirstStrategy(request) {
  try {
    console.log(`🌐 Network First: Attempting network: ${request.url}`);
    const networkResponse = await fetch(request);
    
    // Update cache with fresh response
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, networkResponse.clone());
    
    return networkResponse;
  } catch (error) {
    console.log(`📂 Network First: Network failed, trying cache: ${request.url}`);
    
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If offline and request is for HTML, return offline page
    if (request.headers.get('Accept')?.includes('text/html')) {
      const offlineResponse = await cache.match(OFFLINE_URL);
      if (offlineResponse) {
        return offlineResponse;
      }
    }
    
    throw error;
  }
}

// Network First with API Cache
async function networkFirstWithApiCache(request) {
  const cache = await caches.open(API_CACHE_NAME);
  const cacheKey = generateCacheKey(request);
  
  try {
    console.log(`🌐 API Cache: Attempting network: ${request.url}`);
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful API responses
      const responseClone = networkResponse.clone();
      const responseData = await responseClone.json();
      
      // Only cache successful delivery data
      if (responseData.success !== false) {
        const cacheData = {
          data: responseData,
          timestamp: Date.now(),
          url: request.url
        };
        
        await cache.put(cacheKey, new Response(JSON.stringify(cacheData), {
          headers: { 'Content-Type': 'application/json' }
        }));
        
        console.log(`💾 API Cache: Cached response for: ${request.url}`);
      }
      
      return networkResponse;
    }
    
    throw new Error(`API request failed with status: ${networkResponse.status}`);
  } catch (error) {
    console.log(`📂 API Cache: Network failed, trying cache: ${request.url}`);
    
    // Try to get from cache
    const cachedResponse = await cache.match(cacheKey);
    
    if (cachedResponse) {
      const cacheData = await cachedResponse.json();
      
      // Check if cache is still valid (1 hour max)
      const cacheAge = Date.now() - cacheData.timestamp;
      const MAX_CACHE_AGE = 60 * 60 * 1000; // 1 hour
      
      if (cacheAge < MAX_CACHE_AGE) {
        console.log(`📂 API Cache: Serving cached data (${Math.round(cacheAge/1000)}s old)`);
        return new Response(JSON.stringify(cacheData.data), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        console.log(`🗑️ API Cache: Cache expired for: ${request.url}`);
        await cache.delete(cacheKey);
      }
    }
    
    // Return error response
    return new Response(JSON.stringify({
      success: false,
      error: 'Network error',
      message: 'Unable to connect. Please check your internet connection.',
      data: []
    }), {
      status: 408,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Network First with Offline Fallback
async function networkFirstWithOfflineFallback(request) {
  try {
    const networkResponse = await fetch(request);
    
    // Update cache with fresh HTML
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, networkResponse.clone());
    
    return networkResponse;
  } catch (error) {
    console.log('📂 Serving offline page');
    
    const cache = await caches.open(CACHE_NAME);
    const offlineResponse = await cache.match(OFFLINE_URL);
    
    if (offlineResponse) {
      return offlineResponse;
    }
    
    // Return a simple offline message
    return new Response(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DSOG Delivery - Offline</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #25D366, #128C7E);
            color: white;
            text-align: center;
            padding: 20px;
          }
          .container {
            max-width: 500px;
            background: rgba(0,0,0,0.8);
            padding: 40px;
            border-radius: 15px;
            border: 3px solid #D4AF37;
          }
          h1 {
            color: #25D366;
            margin-bottom: 20px;
          }
          p {
            font-size: 1.1rem;
            line-height: 1.6;
            margin-bottom: 30px;
          }
          .icon {
            font-size: 4rem;
            color: #25D366;
            margin-bottom: 20px;
          }
          button {
            background: #25D366;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 25px;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.3s;
            font-weight: 600;
          }
          button:hover {
            background: #128C7E;
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">📶</div>
          <h1>You're Offline</h1>
          <p>Please check your internet connection and try again.</p>
          <p>You can still view previously loaded content.</p>
          <button onclick="window.location.reload()">Try Again</button>
        </div>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// Network Only Strategy
async function networkOnlyStrategy(request) {
  try {
    return await fetch(request);
  } catch (error) {
    console.error('❌ Network Only failed:', error);
    return new Response('Network error', {
      status: 408,
      statusText: 'Network error'
    });
  }
}

// Generate cache key for API requests
function generateCacheKey(request) {
  const url = new URL(request.url);
  
  // Remove timestamp parameters for consistent caching
  const params = new URLSearchParams(url.search);
  params.delete('timestamp');
  params.delete('_');
  params.delete('cacheBuster');
  
  url.search = params.toString();
  return new Request(url.toString(), request);
}

// Background sync for failed requests
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync:', event.tag);
  
  if (event.tag === 'sync-delivery-requests') {
    event.waitUntil(syncDeliveryRequests());
  }
});

// Sync delivery requests when back online
async function syncDeliveryRequests() {
  console.log('🔄 Syncing delivery requests...');
  
  try {
    const db = await openDeliveryDB();
    const pendingRequests = await getAllPendingRequests(db);
    
    for (const request of pendingRequests) {
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body
        });
        
        if (response.ok) {
          await deletePendingRequest(db, request.id);
          console.log(`✅ Synced request: ${request.id}`);
        }
      } catch (error) {
        console.error(`❌ Failed to sync request ${request.id}:`, error);
      }
    }
    
    await db.close();
  } catch (error) {
    console.error('❌ Sync failed:', error);
  }
}

// IndexedDB for offline delivery requests
function openDeliveryDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dsog-delivery-offline', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('pending-requests')) {
        const store = db.createObjectStore('pending-requests', {
          keyPath: 'id',
          autoIncrement: true
        });
        
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

function getAllPendingRequests(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pending-requests'], 'readonly');
    const store = transaction.objectStore('pending-requests');
    const index = store.index('timestamp');
    const request = index.getAll();
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function deletePendingRequest(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pending-requests'], 'readwrite');
    const store = transaction.objectStore('pending-requests');
    const request = store.delete(id);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Push notifications for delivery updates
self.addEventListener('push', (event) => {
  console.log('📱 Push notification received:', event);
  
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options = {
    body: data.body || 'New delivery update',
    icon: 'https://i.postimg.cc/kMZ1jTww/Untitled-design-4-removebg-preview.png',
    badge: 'https://i.postimg.cc/kMZ1jTww/Untitled-design-4-removebg-preview.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/delivery/',
      timestamp: Date.now()
    },
    actions: [
      {
        action: 'view',
        title: 'View Details'
      },
      {
        action: 'close',
        title: 'Close'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'DSOG Delivery', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('🔔 Notification clicked:', event);
  
  event.notification.close();
  
  if (event.action === 'close') {
    return;
  }
  
  // Navigate to the relevant URL
  const urlToOpen = event.notification.data.url || '/delivery/';
  
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((windowClients) => {
      // Check if there's already a window/tab open
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      
      // If not, open a new window/tab
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Periodic sync for background updates
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-delivery-data') {
    console.log('🔄 Periodic sync for delivery data');
    event.waitUntil(updateDeliveryData());
  }
});

async function updateDeliveryData() {
  try {
    // Update cached delivery data
    console.log('🔄 Updating delivery data in background');
    
    // You can add specific background update logic here
    // For example, update assistant availability, delivery status, etc.
    
  } catch (error) {
    console.error('❌ Periodic sync failed:', error);
  }
}

// Message handling from main thread
self.addEventListener('message', (event) => {
  console.log('📨 Service Worker received message:', event.data);
  
  if (event.data.type === 'CACHE_DELIVERY_DATA') {
    cacheDeliveryData(event.data.payload);
  }
  
  if (event.data.type === 'CLEAR_CACHE') {
    clearOldCaches();
  }
  
  if (event.data.type === 'GET_CACHE_INFO') {
    sendCacheInfo(event.ports[0]);
  }
});

async function cacheDeliveryData(data) {
  try {
    const cache = await caches.open(API_CACHE_NAME);
    const cacheKey = `delivery-data-${Date.now()}`;
    
    await cache.put(cacheKey, new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    }));
    
    console.log('💾 Delivery data cached successfully');
  } catch (error) {
    console.error('❌ Failed to cache delivery data:', error);
  }
}

async function clearOldCaches() {
  try {
    const cacheNames = await caches.keys();
    
    for (const cacheName of cacheNames) {
      if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
        await caches.delete(cacheName);
        console.log(`🗑️ Deleted old cache: ${cacheName}`);
      }
    }
  } catch (error) {
    console.error('❌ Failed to clear old caches:', error);
  }
}

async function sendCacheInfo(port) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const apiCache = await caches.open(API_CACHE_NAME);
    
    const cacheKeys = await cache.keys();
    const apiCacheKeys = await apiCache.keys();
    
    const info = {
      cacheSize: cacheKeys.length,
      apiCacheSize: apiCacheKeys.length,
      cacheNames: await caches.keys(),
      storageEstimate: await navigator.storage.estimate()
    };
    
    port.postMessage({ type: 'CACHE_INFO', data: info });
  } catch (error) {
    port.postMessage({ type: 'CACHE_INFO_ERROR', error: error.message });
  }
}

// Utility function to check if we're online
function isOnline() {
  return self.navigator.onLine;
}

// Utility function to log cache status
async function logCacheStatus() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  
  console.log(`📊 Cache Status: ${keys.length} items in cache`);
  
  keys.forEach((key, index) => {
    console.log(`  ${index + 1}. ${key.url}`);
  });
}

// Export for testing (optional)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CACHE_NAME,
    STRATEGIES,
    cacheFirstStrategy,
    networkFirstStrategy,
    networkFirstWithApiCache
  };
}
