// Configurações
const API_BASE_URL = window.location.origin;
const USER_ID = 'user_' + Math.random().toString(36).substr(2, 9);

// Estado da aplicação
let map = null;
let currentStream = null;
let offlineData = [];
let isOnline = navigator.onLine;
let plantInfo = {};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  loadOfflineData();
  updateConnectionStatus();
  loadPlantInfo();
});

// Event listeners para conexão
window.addEventListener('online', () => {
  isOnline = true;
  updateConnectionStatus();
  syncData();
});

window.addEventListener('offline', () => {
  isOnline = false;
  updateConnectionStatus();
});

// Inicializar aplicação
function initializeApp() {
  showScreen('home-screen');
  
  // Registrar Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => console.log('SW registrado:', registration))
      .catch(error => console.log('Erro no SW:', error));
  }
}

// Carregar informações das plantas
async function loadPlantInfo() {
  try {
    if (isOnline) {
      const response = await fetch(`${API_BASE_URL}/api/plant-info`);
      if (response.ok) {
        plantInfo = await response.json();
        localStorage.setItem('plantInfo', JSON.stringify(plantInfo));
      }
    } else {
      const savedInfo = localStorage.getItem('plantInfo');
      if (savedInfo) {
        plantInfo = JSON.parse(savedInfo);
      }
    }
  } catch (error) {
    console.error('Erro ao carregar informações das plantas:', error);
    const savedInfo = localStorage.getItem('plantInfo');
    if (savedInfo) {
      plantInfo = JSON.parse(savedInfo);
    }
  }
}

// Gerenciar telas
function showScreen(screenId) {
  // Esconder todas as telas
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.add('hidden');
  });
  
  // Mostrar tela selecionada
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.classList.remove('hidden');
    
    // Ações específicas para cada tela
    switch(screenId) {
      case 'map-screen':
        if (!map) initMap();
        else refreshMap();
        break;
      case 'history-screen':
        loadHistory();
        break;
      case 'stats-screen':
        loadStats();
        break;
      case 'diagnosis-screen':
        resetCamera();
        break;
    }
  }
}

// Status de conexão
function updateConnectionStatus() {
  const statusEl = document.getElementById('connection-status');
  if (!isOnline) {
    statusEl.classList.remove('hidden');
  } else {
    statusEl.classList.add('hidden');
  }
}

// Manipular seleção de arquivo
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // Verificar se é uma imagem
  if (!file.type.startsWith('image/')) {
    alert('Por favor, selecione apenas arquivos de imagem.');
    return;
  }
  
  // Verificar tamanho do arquivo (máximo 10MB)
  if (file.size > 10 * 1024 * 1024) {
    alert('A imagem é muito grande. Por favor, selecione uma imagem menor que 10MB.');
    return;
  }
  
  // Mostrar loading
  document.getElementById('loading-overlay').classList.remove('hidden');
  
  // Ler arquivo como data URL
  const reader = new FileReader();
  reader.onload = function(e) {
    processSelectedImage(e.target.result);
  };
  reader.onerror = function() {
    document.getElementById('loading-overlay').classList.add('hidden');
    alert('Erro ao ler o arquivo. Tente novamente.');
  };
  reader.readAsDataURL(file);
  
  // Limpar input para permitir selecionar o mesmo arquivo novamente
  event.target.value = '';
}

// Processar imagem selecionada
async function processSelectedImage(imageDataUrl) {
  try {
    // Redimensionar imagem se necessário
    const resizedImage = await resizeImage(imageDataUrl, 1280, 720);
    
    // Obter localização
    const coords = await getCurrentLocation();
    
    // Preparar dados para análise
    const analysisData = {
      image: resizedImage,
      latitude: coords.latitude,
      longitude: coords.longitude,
      userId: USER_ID,
      userLocation: 'Usuário da Web',
      timestamp: new Date().toISOString()
    };

    let result;
    
    if (isOnline) {
      // Enviar para servidor
      result = await analyzeOnline(analysisData);
    } else {
      // Armazenar para sincronização posterior
      result = await analyzeOffline(analysisData);
    }
    
    // Parar câmera se estiver ativa
    stopCamera();
    
    displayPlantInfo(result, resizedImage);
    
  } catch (error) {
    console.error('Erro ao processar imagem:', error);
    alert('Erro ao processar a imagem. Tente novamente.');
  } finally {
    document.getElementById('loading-overlay').classList.add('hidden');
  }
}

// Redimensionar imagem mantendo aspect ratio
function resizeImage(dataUrl, maxWidth, maxHeight) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Calcular novo tamanho mantendo proporção
      let { width, height } = img;
      
      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Desenhar imagem redimensionada
      ctx.drawImage(img, 0, 0, width, height);
      
      // Converter para data URL com qualidade otimizada
      const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve(resizedDataUrl);
    };
    img.src = dataUrl;
  });
}
async function startCamera() {
  try {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }
    
    const constraints = {
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = document.getElementById('camera');
    video.srcObject = currentStream;
    
    document.getElementById('camera-error').classList.add('hidden');
    document.getElementById('take-photo-btn').disabled = false;
    document.getElementById('start-camera-btn').textContent = 'Câmera Ativa';
    document.getElementById('start-camera-btn').disabled = true;
    
  } catch (error) {
    console.error('Erro ao acessar câmera:', error);
    const errorEl = document.getElementById('camera-error');
    errorEl.textContent = `Erro ao acessar a câmera: ${error.message}`;
    errorEl.classList.remove('hidden');
  }
}

async function takePhoto() {
  if (!currentStream) {
    alert('Câmera não está ativa');
    return;
  }

  const video = document.getElementById('camera');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  
  const imageData = canvas.toDataURL('image/jpeg', 0.8);
  
  // Mostrar loading
  document.getElementById('loading-overlay').classList.remove('hidden');
  
  try {
    // Obter localização
    const coords = await getCurrentLocation();
    
    // Preparar dados para análise
    const analysisData = {
      image: imageData,
      latitude: coords.latitude,
      longitude: coords.longitude,
      userId: USER_ID,
      userLocation: 'Usuário da Web', // Pode ser melhorado com geolocalização reversa
      timestamp: new Date().toISOString()
    };

    let result;
    
    if (isOnline) {
      // Enviar para servidor
      result = await analyzeOnline(analysisData);
    } else {
      // Armazenar para sincronização posterior
      result = await analyzeOffline(analysisData);
    }
    
    displayPlantInfo(result, imageData);
    
  } catch (error) {
    console.error('Erro na análise:', error);
    alert('Erro ao analisar a planta. Tente novamente.');
  } finally {
    document.getElementById('loading-overlay').classList.add('hidden');
    stopCamera();
  }
}

async function analyzeOnline(data) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/analyze-plant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Erro do servidor: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Erro na análise online:', error);
    throw error;
  }
}

async function analyzeOffline(data) {
  // Simular análise offline usando dados locais
  const localId = 'offline_' + Date.now();
  
  // Adicionar à fila offline
  offlineData.push({
    ...data,
    localId,
    synced: false
  });
  
  saveOfflineData();
  
  // Retornar resultado simulado
  return {
    id: localId,
    plant_type: 'Tomate',
    disease: 'Análise Pendente',
    portuguese_name: 'Tomate - Análise Pendente',
    confidence: 0,
    accuracy: 0,
    plant_emoji: '🍅',
    health_emoji: '⏳',
    health_color: 'yellow',
    latitude: data.latitude,
    longitude: data.longitude,
    timestamp: data.timestamp,
    offline: true,
    plant_wiki_url: null,
    disease_info_url: null
  };
}

function displayPlantInfo(result, imageData) {
  // Mostrar container da foto
  document.getElementById('camera-container').classList.add('hidden');
  document.getElementById('photo-container').classList.remove('hidden');
  
  // Mostrar foto
  document.getElementById('photo').src = imageData;
  
  // Criar HTML das informações
  const plantInfoEl = document.getElementById('plant-info');
  
  const confidenceColor = result.confidence >= 80 ? 'text-green-600' : 
                         result.confidence >= 60 ? 'text-yellow-600' : 'text-red-600';
  
  const accuracyColor = result.accuracy >= 90 ? 'text-green-600' :
                       result.accuracy >= 80 ? 'text-yellow-600' : 'text-red-600';
  
  plantInfoEl.innerHTML = `
    <div class="text-center border-b pb-4 mb-4">
      <div class="text-4xl mb-2">${result.plant_emoji} ${result.health_emoji}</div>
      <h3 class="text-2xl font-bold text-gray-800">${result.plant_type}</h3>
      <p class="text-lg text-gray-600">${result.portuguese_name}</p>
    </div>
    
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-gray-700">
          <i class="fas fa-stethoscope mr-2"></i>Condição:
        </span>
        <span class="font-bold" style="color: ${result.health_color}">${result.disease}</span>
      </div>
      
      ${result.confidence > 0 ? `
      <div class="flex items-center justify-between">
        <span class="font-semibold text-gray-700">
          <i class="fas fa-percentage mr-2"></i>Confiança:
        </span>
        <span class="font-bold ${confidenceColor}">${result.confidence}%</span>
      </div>
      
      <div class="flex items-center justify-between">
        <span class="font-semibold text-gray-700">
          <i class="fas fa-bullseye mr-2"></i>Precisão do Modelo:
        </span>
        <span class="font-bold ${accuracyColor}">${result.accuracy}%</span>
      </div>
      ` : ''}
      
      <div class="flex items-center justify-between">
        <span class="font-semibold text-gray-700">
          <i class="fas fa-map-marker-alt mr-2"></i>Localização:
        </span>
        <span class="text-sm text-gray-600">
          ${result.latitude.toFixed(4)}, ${result.longitude.toFixed(4)}
        </span>
      </div>
      
      <div class="flex items-center justify-between">
        <span class="font-semibold text-gray-700">
          <i class="fas fa-clock mr-2"></i>Data/Hora:
        </span>
        <span class="text-sm text-gray-600">
          ${new Date(result.timestamp).toLocaleString('pt-BR')}
        </span>
      </div>
      
      ${result.offline ? `
      <div class="bg-yellow-100 border border-yellow-400 rounded-lg p-3">
        <div class="flex items-center">
          <i class="fas fa-wifi-slash text-yellow-600 mr-2"></i>
          <span class="text-yellow-800 text-sm font-medium">
            Análise offline - será processada quando conectar
          </span>
        </div>
      </div>
      ` : ''}
    </div>
    
    ${(result.plant_wiki_url || result.disease_info_url) ? `
    <div class="mt-6 pt-4 border-t">
      <h4 class="font-semibold text-gray-700 mb-3">
        <i class="fas fa-external-link-alt mr-2"></i>Saiba Mais:
      </h4>
      <div class="space-y-2">
        ${result.plant_wiki_url ? `
        <a href="${result.plant_wiki_url}" target="_blank" 
           class="block bg-blue-100 text-blue-700 px-4 py-2 rounded hover:bg-blue-200 transition-colors">
          <i class="fab fa-wikipedia-w mr-2"></i>Informações sobre ${result.plant_type}
        </a>
        ` : ''}
        
        ${result.disease_info_url && result.disease !== 'Saudável' ? `
        <a href="${result.disease_info_url}" target="_blank" 
           class="block bg-green-100 text-green-700 px-4 py-2 rounded hover:bg-green-200 transition-colors">
          <i class="fas fa-leaf mr-2"></i>Informações sobre ${result.disease}
        </a>
        ` : ''}
      </div>
    </div>
    ` : ''}
  `;
}

function resetCamera() {
  stopCamera();
  document.getElementById('camera-container').classList.remove('hidden');
  document.getElementById('photo-container').classList.add('hidden');
  document.getElementById('take-photo-btn').disabled = true;
  document.getElementById('start-camera-btn').disabled = false;
  document.getElementById('start-camera-btn').textContent = 'Iniciar Câmera';
  
  // Limpar inputs de arquivo
  const fileInput = document.getElementById('file-input');
  const galleryInput = document.getElementById('gallery-input');
  if (fileInput) fileInput.value = '';
  if (galleryInput) galleryInput.value = '';
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
}

// Localização
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      // Fallback para Brasília se geolocalização não disponível
      resolve({
        latitude: -15.7942 + (Math.random() - 0.5) * 0.01,
        longitude: -47.8822 + (Math.random() - 0.5) * 0.01
      });
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      }),
      error => {
        console.warn('Erro na geolocalização:', error);
        // Fallback para Brasília
        resolve({
          latitude: -15.7942 + (Math.random() - 0.5) * 0.01,
          longitude: -47.8822 + (Math.random() - 0.5) * 0.01
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  });
}

// Mapa
function initMap() {
  map = L.map('map').setView([-15.7942, -47.8822], 12);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18
  }).addTo(map);
  
  refreshMap();
}

async function refreshMap() {
  if (!map) return;
  
  try {
    // Limpar marcadores existentes
    map.eachLayer(layer => {
      if (layer instanceof L.Marker) {
        map.removeLayer(layer);
      }
    });
    
    let diagnoses = [];
    
    if (isOnline) {
      // Buscar TODOS os diagnósticos (globais)
      try {
        const response = await fetch(`${API_BASE_URL}/api/diagnoses?limit=1000`);
        if (response.ok) {
          diagnoses = await response.json();
        }
      } catch (error) {
        console.error('Erro ao buscar diagnósticos online:', error);
      }
    }
    
    // Adicionar dados offline
    const offlineDataStored = getOfflineData();
    offlineDataStored.forEach(item => {
      if (!item.synced) {
        diagnoses.push({
          plant_type: 'Análise Pendente',
          disease: 'Offline',
          plant_emoji: '⏳',
          health_emoji: '📱',
          latitude: item.latitude,
          longitude: item.longitude,
          timestamp: item.timestamp,
          confidence: 0,
          offline: true
        });
      }
    });
    
    // Adicionar marcadores ao mapa
    diagnoses.forEach(diagnosis => {
      const icon = L.divIcon({
        html: `<div style="background: ${diagnosis.offline ? '#fbbf24' : (diagnosis.disease === 'Saudável' ? '#10b981' : '#ef4444')}; 
                      border-radius: 50%; width: 30px; height: 30px; display: flex; 
                      align-items: center; justify-content: center; font-size: 16px; 
                      border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                 ${diagnosis.plant_emoji || '🌱'}
               </div>`,
        className: 'custom-div-icon',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      
      const marker = L.marker([diagnosis.latitude, diagnosis.longitude], { icon })
        .addTo(map);
      
      const popupContent = `
        <div class="p-2">
          <div class="text-center mb-2">
            <span class="text-2xl">${diagnosis.plant_emoji || '🌱'} ${diagnosis.health_emoji || '❓'}</span>
          </div>
          <h4 class="font-bold text-gray-800">${diagnosis.plant_type}</h4>
          <p class="text-sm text-gray-600"><strong>Condição:</strong> ${diagnosis.disease}</p>
          ${diagnosis.confidence > 0 ? `<p class="text-sm text-gray-600"><strong>Confiança:</strong> ${diagnosis.confidence}%</p>` : ''}
          <p class="text-xs text-gray-500"><strong>Usuário:</strong> ${diagnosis.user_location || 'Não informado'}</p>
          <p class="text-xs text-gray-500">${new Date(diagnosis.timestamp).toLocaleString('pt-BR')}</p>
          ${diagnosis.offline ? '<p class="text-xs text-yellow-600 font-medium">📱 Aguardando sincronização</p>' : ''}
        </div>
      `;
      
      marker.bindPopup(popupContent);
    });
    
    // Atualizar info do mapa
    const mapInfo = document.getElementById('map-info');
    if (mapInfo) {
      const total = diagnoses.length;
      const offline = diagnoses.filter(d => d.offline).length;
      const healthy = diagnoses.filter(d => d.disease === 'Saudável' || d.disease === 'healthy').length;
      const diseased = total - healthy - offline;
      
      mapInfo.innerHTML = `
        <i class="fas fa-users mr-1"></i>
        ${total} registro${total !== 1 ? 's' : ''} da comunidade
        ${healthy > 0 ? `(${healthy} 🌱 saudável${healthy !== 1 ? 's' : ''})` : ''}
        ${diseased > 0 ? `(${diseased} ⚠️ doente${diseased !== 1 ? 's' : ''})` : ''}
        ${offline > 0 ? `(${offline} 📱 offline)` : ''}
      `;
    }
    
  } catch (error) {
    console.error('Erro ao carregar dados do mapa:', error);
  }
}

// Histórico
async function loadHistory() {
  const historyList = document.getElementById('history-list');
  
  try {
    let diagnoses = [];
    
    if (isOnline) {
      // Buscar TODOS os diagnósticos (globais)
      try {
        const response = await fetch(`${API_BASE_URL}/api/diagnoses?limit=100`);
        if (response.ok) {
          diagnoses = await response.json();
        }
      } catch (error) {
        console.error('Erro ao buscar histórico online:', error);
      }
    }
    
    // Adicionar dados offline
    const offlineDataStored = getOfflineData();
    offlineDataStored.forEach(item => {
      if (!item.synced) {
        diagnoses.push({
          plant_type: 'Análise Pendente',
          disease: 'Aguardando Sincronização',
          plant_emoji: '⏳',
          health_emoji: '📱',
          latitude: item.latitude,
          longitude: item.longitude,
          timestamp: item.timestamp,
          confidence: 0,
          offline: true
        });
      }
    });
    
    if (diagnoses.length === 0) {
      historyList.innerHTML = `
        <div class="text-center py-8">
          <i class="fas fa-users text-4xl text-gray-300 mb-4"></i>
          <p class="text-gray-500">Nenhum diagnóstico da comunidade ainda</p>
          <p class="text-gray-400 text-sm mt-2">Seja o primeiro a contribuir!</p>
          <button class="mt-4 bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition-colors" onclick="showScreen('diagnosis-screen')">
            <i class="fas fa-camera mr-2"></i>Fazer Primeiro Diagnóstico
          </button>
        </div>
      `;
      return;
    }
    
    // Ordenar por data (mais recente primeiro)
    diagnoses.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    historyList.innerHTML = diagnoses.map(diagnosis => `
      <div class="bg-white rounded-lg shadow p-4 ${diagnosis.offline ? 'border-l-4 border-yellow-400' : ''}">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center">
            <span class="text-2xl mr-3">${diagnosis.plant_emoji || '🌱'} ${diagnosis.health_emoji || '❓'}</span>
            <div>
              <h3 class="font-bold text-gray-800">${diagnosis.plant_type}</h3>
              <p class="text-sm text-gray-600">${diagnosis.disease}</p>
              <p class="text-xs text-gray-500">👤 ${diagnosis.user_location || 'Usuário da comunidade'}</p>
            </div>
          </div>
          ${diagnosis.confidence > 0 ? `
          <div class="text-right">
            <div class="text-sm font-semibold ${diagnosis.confidence >= 80 ? 'text-green-600' : diagnosis.confidence >= 60 ? 'text-yellow-600' : 'text-red-600'}">
              ${diagnosis.confidence}%
            </div>
            <div class="text-xs text-gray-500">confiança</div>
          </div>
          ` : ''}
        </div>
        
        <div class="flex items-center justify-between text-xs text-gray-500">
          <span>
            <i class="fas fa-map-marker-alt mr-1"></i>
            ${diagnosis.latitude.toFixed(4)}, ${diagnosis.longitude.toFixed(4)}
          </span>
          <span>
            <i class="fas fa-clock mr-1"></i>
            ${new Date(diagnosis.timestamp).toLocaleString('pt-BR')}
          </span>
        </div>
        
        ${diagnosis.offline ? `
        <div class="mt-2 flex items-center text-yellow-600 text-xs">
          <i class="fas fa-wifi-slash mr-1"></i>
          Aguardando sincronização
        </div>
        ` : ''}
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Erro ao carregar histórico:', error);
    historyList.innerHTML = `
      <div class="text-center py-8">
        <i class="fas fa-exclamation-triangle text-4xl text-red-300 mb-4"></i>
        <p class="text-red-500">Erro ao carregar histórico</p>
      </div>
    `;
  }
}

// Estatísticas
async function loadStats() {
  const statsContent = document.getElementById('stats-content');
  
  try {
    let stats = null;
    
    if (isOnline) {
      // Buscar estatísticas GLOBAIS (todos os usuários)
      try {
        const response = await fetch(`${API_BASE_URL}/api/stats`);
        if (response.ok) {
          stats = await response.json();
        }
      } catch (error) {
        console.error('Erro ao buscar estatísticas online:', error);
      }
    }
    
    // Adicionar dados offline às estatísticas
    const offlineCount = getOfflineData().filter(item => !item.synced).length;
    
    if (!stats || stats.total_diagnoses === 0) {
      statsContent.innerHTML = `
        <div class="text-center py-8">
          <i class="fas fa-chart-bar text-4xl text-gray-300 mb-4"></i>
          <p class="text-gray-500">Sem dados da comunidade para exibir</p>
          <p class="text-gray-400 text-sm mt-2">As estatísticas aparecerão quando houver diagnósticos</p>
          ${offlineCount > 0 ? `
          <div class="mt-4 bg-yellow-100 border border-yellow-400 rounded-lg p-4">
            <i class="fas fa-wifi-slash text-yellow-600 mr-2"></i>
            <span class="text-yellow-800">${offlineCount} análise${offlineCount !== 1 ? 's' : ''} aguardando sincronização</span>
          </div>
          ` : ''}
        </div>
      `;
      return;
    }
    
    const totalWithOffline = stats.total_diagnoses + offlineCount;
    
    statsContent.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="bg-white rounded-lg shadow p-6 text-center">
          <i class="fas fa-users text-3xl text-green-600 mb-2"></i>
          <div class="text-2xl font-bold text-gray-800">${totalWithOffline}</div>
          <div class="text-sm text-gray-600">Total da Comunidade</div>
        </div>
        
        <div class="bg-white rounded-lg shadow p-6 text-center">
          <i class="fas fa-seedling text-3xl text-blue-600 mb-2"></i>
          <div class="text-2xl font-bold text-gray-800">${stats.plant_types}</div>
          <div class="text-sm text-gray-600">Tipos de Plantas</div>
        </div>
        
        <div class="bg-white rounded-lg shadow p-6 text-center">
          <i class="fas fa-check-circle text-3xl text-green-600 mb-2"></i>
          <div class="text-2xl font-bold text-gray-800">${stats.healthy_plants}</div>
          <div class="text-sm text-gray-600">Plantas Saudáveis</div>
        </div>
        
        <div class="bg-white rounded-lg shadow p-6 text-center">
          <i class="fas fa-exclamation-triangle text-3xl text-red-600 mb-2"></i>
          <div class="text-2xl font-bold text-gray-800">${stats.diseases_found}</div>
          <div class="text-sm text-gray-600">Doenças Detectadas</div>
        </div>
      </div>
      
      ${offlineCount > 0 ? `
      <div class="bg-yellow-100 border border-yellow-400 rounded-lg p-4 mb-6">
        <div class="flex items-center">
          <i class="fas fa-wifi-slash text-yellow-600 mr-2"></i>
          <span class="text-yellow-800 font-medium">${offlineCount} análise${offlineCount !== 1 ? 's' : ''} aguardando sincronização</span>
        </div>
      </div>
      ` : ''}
      
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
          <i class="fas fa-chart-pie mr-2"></i>
          Diagnósticos da Comunidade por Planta
        </h3>
        <div class="space-y-3">
          ${stats.by_plant.map(item => {
            const emoji = plantInfo.plant_emojis?.[item.plant_type] || '🌱';
            const percentage = ((item.count / stats.total_diagnoses) * 100).toFixed(1);
            return `
              <div class="flex items-center justify-between">
                <div class="flex items-center">
                  <span class="text-xl mr-2">${emoji}</span>
                  <span class="text-gray-700">${item.plant_type} - ${item.disease}</span>
                </div>
                <div class="text-right">
                  <div class="text-sm font-semibold text-gray-800">${item.count}</div>
                  <div class="text-xs text-gray-500">${percentage}%</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    
  } catch (error) {
    console.error('Erro ao carregar estatísticas:', error);
    statsContent.innerHTML = `
      <div class="text-center py-8">
        <i class="fas fa-exclamation-triangle text-4xl text-red-300 mb-4"></i>
        <p class="text-red-500">Erro ao carregar estatísticas</p>
      </div>
    `;
  }
}

// Sincronização
async function syncData() {
  const syncStatus = document.getElementById('sync-status');
  
  if (!isOnline) {
    syncStatus.textContent = '📱 Modo offline - aguardando conexão';
    return;
  }
  
  const offlineDataToSync = getOfflineData().filter(item => !item.synced);
  
  if (offlineDataToSync.length === 0) {
    syncStatus.textContent = '✅ Todos os dados sincronizados';
    return;
  }
  
  syncStatus.textContent = `🔄 Sincronizando ${offlineDataToSync.length} item${offlineDataToSync.length !== 1 ? 's' : ''}...`;
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        offlineData: offlineDataToSync
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      
      // Marcar itens como sincronizados
      offlineData = offlineData.map(item => {
        if (offlineDataToSync.find(sync => sync.localId === item.localId)) {
          return { ...item, synced: true };
        }
        return item;
      });
      
      saveOfflineData();
      
      syncStatus.textContent = `✅ ${result.success} de ${result.total} item${result.total !== 1 ? 's' : ''} sincronizado${result.success !== 1 ? 's' : ''}`;
      
      // Atualizar interface se necessário
      const currentScreen = document.querySelector('.screen:not(.hidden)');
      if (currentScreen) {
        const screenId = currentScreen.id;
        if (screenId === 'map-screen') refreshMap();
        if (screenId === 'history-screen') loadHistory();
        if (screenId === 'stats-screen') loadStats();
      }
      
    } else {
      throw new Error(`Erro na sincronização: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Erro na sincronização:', error);
    syncStatus.textContent = '❌ Erro na sincronização';
  }
}

// Gerenciamento de dados offline
function saveOfflineData() {
  localStorage.setItem('offlineData', JSON.stringify(offlineData));
}

function loadOfflineData() {
  const saved = localStorage.getItem('offlineData');
  if (saved) {
    offlineData = JSON.parse(saved);
  }
}

function getOfflineData() {
  return offlineData;
}

function clearAllData() {
  if (confirm('⚠️ Tem certeza que deseja limpar todos os dados?\n\nEsta ação não pode ser desfeita.')) {
    // Limpar localStorage
    localStorage.removeItem('offlineData');
    localStorage.removeItem('plantInfo');
    
    // Limpar dados em memória
    offlineData = [];
    
    // Reinicializar
    if (map) {
      map.eachLayer(layer => {
        if (layer instanceof L.Marker) {
          map.removeLayer(layer);
        }
      });
    }
    
    alert('✅ Dados limpos com sucesso!');
    
    // Voltar para tela inicial
    showScreen('home-screen');
  }
}