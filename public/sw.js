const CACHE_NAME = 'agroia-pwa-v2.1.0';
const STATIC_CACHE = 'agroia-static-v2.1.0';
const DYNAMIC_CACHE = 'agroia-dynamic-v2.1.0';

// Recursos essenciais para cache
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Recursos da API para cache dinâmico
const API_ENDPOINTS = [
  '/api/plant-info',
  '/api/diagnoses',
  '/api/stats'
];

// Instalação do Service Worker
self.addEventListener('install', event => {
  console.log('🔧 Service Worker: Instalando...');
  
  event.waitUntil(
    Promise.all([
      // Cache estático
      caches.open(STATIC_CACHE).then(cache => {
        console.log('📦 Cache estático: Armazenando recursos essenciais');
        return cache.addAll(STATIC_ASSETS);
      }),
      
      // Cache dinâmico vazio
      caches.open(DYNAMIC_CACHE).then(cache => {
        console.log('📦 Cache dinâmico: Inicializado');
        return Promise.resolve();
      })
    ]).then(() => {
      console.log('✅ Service Worker: Instalação concluída');
      self.skipWaiting();
    }).catch(error => {
      console.error('❌ Erro na instalação do Service Worker:', error);
    })
  );
});

// Ativação do Service Worker
self.addEventListener('activate', event => {
  console.log('🚀 Service Worker: Ativando...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Limpar caches antigos
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
            console.log('🧹 Limpando cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker: Ativação concluída');
      return self.clients.claim();
    })
  );
});

// Interceptação de requisições
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Ignorar requisições não-GET e de outros domínios
  if (request.method !== 'GET') {
    return;
  }
  
  // Estratégia para recursos estáticos
  if (STATIC_ASSETS.some(asset => request.url.includes(asset))) {
    event.respondWith(cacheFirst(request));
    return;
  }
  
  // Estratégia para API
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // Estratégia para outras requisições
  event.respondWith(staleWhileRevalidate(request));
});

// Estratégia Cache First (para recursos estáticos)
async function cacheFirst(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Erro na estratégia cacheFirst:', error);
    
    // Fallback para página offline se disponível
    if (request.destination === 'document') {
      const fallback = await caches.match('/index.html');
      return fallback || new Response('Offline', { status: 503 });
    }
    
    return new Response('Recurso indisponível offline', { status: 503 });
  }
}

// Estratégia Network First (para API)
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok && request.url.includes('/api/plant-info')) {
      // Cache apenas informações das plantas (dados estáticos)
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Erro na rede, tentando cache:', error);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Resposta de fallback para API offline
    if (request.url.includes('/api/plant-info')) {
      return new Response(JSON.stringify({
        classes: ["Apple___healthy", "Tomato___healthy"],
        classes_pt: ["Maçã - Saudável", "Tomate - Saudável"],
        plant_emojis: { "Apple": "🍎", "Tomato": "🍅" },
        health_status: {
          "healthy": { "pt": "Saudável", "emoji": "✅", "color": "green" },
          "diseased": { "pt": "Doente", "emoji": "⚠️", "color": "red" }
        },
        accuracy: 94.92,
        offline_mode: true
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      });
    }
    
    return new Response(JSON.stringify({
      error: 'Sem conexão com a internet',
      offline: true
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503
    });
  }
}

// Estratégia Stale While Revalidate (para recursos dinâmicos)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cachedResponse = await cache.match(request);
  
  const networkResponsePromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(error => {
    console.error('Erro na rede para staleWhileRevalidate:', error);
    return null;
  });
  
  // Retorna cache imediatamente se disponível, senão espera pela rede
  return cachedResponse || await networkResponsePromise || 
    new Response('Recurso indisponível', { status: 503 });
}

// Manipular mensagens do cliente
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(DYNAMIC_CACHE).then(cache => {
        return cache.addAll(event.data.urls);
      })
    );
  }
});

// Sincronização em segundo plano
self.addEventListener('sync', event => {
  console.log('🔄 Background Sync:', event.tag);
  
  if (event.tag === 'sync-diagnoses') {
    event.waitUntil(syncDiagnoses());
  }
});

// Função para sincronizar diagnósticos offline
async function syncDiagnoses() {
  try {
    // Obter dados offline do IndexedDB ou localStorage
    const offlineData = await getOfflineData();
    
    if (offlineData.length === 0) {
      console.log('📋 Nenhum dado offline para sincronizar');
      return;
    }
    
    console.log(`📤 Sincronizando ${offlineData.length} diagnósticos offline`);
    
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ offlineData })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Sincronização concluída:', result);
      
      // Notificar clientes sobre sincronização bem-sucedida
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'SYNC_SUCCESS',
          data: result
        });
      });
      
      // Limpar dados offline sincronizados
      await clearSyncedOfflineData();
    } else {
      throw new Error(`Erro na sincronização: ${response.status}`);
    }
    
  } catch (error) {
    console.error('❌ Erro na sincronização em segundo plano:', error);
    
    // Notificar clientes sobre erro na sincronização
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_ERROR',
        error: error.message
      });
    });
  }
}

// Função auxiliar para obter dados offline (simplificada)
async function getOfflineData() {
  // Em uma implementação real, isso viria do IndexedDB
  // Por simplicidade, retornamos array vazio
  return [];
}

// Função auxiliar para limpar dados offline sincronizados
async function clearSyncedOfflineData() {
  // Em uma implementação real, isso limparia dados do IndexedDB
  console.log('🧹 Dados offline sincronizados limpos');
}

// Notificações push (preparação futura)
self.addEventListener('push', event => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'Nova atualização disponível',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: [
      {
        action: 'open',
        title: 'Abrir AGROIA',
        icon: '/icon-192x192.png'
      },
      {
        action: 'close',
        title: 'Fechar'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'AGROIA', options)
  );
});

// Cliques em notificações
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      self.clients.openWindow('/')
    );
  }
});

console.log('🌱 AGROIA Service Worker carregado - Versão:', CACHE_NAME);