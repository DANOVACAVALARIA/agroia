const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Inicializar banco de dados
const db = new sqlite3.Database('./database/plants.db');

// Criar tabelas
db.serialize(() => {
  // Tabela de diagnósticos - GLOBAIS (todos os usuários compartilham)
  db.run(`CREATE TABLE IF NOT EXISTS diagnoses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    plant_type TEXT NOT NULL,
    disease TEXT NOT NULL,
    confidence REAL NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced BOOLEAN DEFAULT 1,
    image_hash TEXT,
    user_location TEXT DEFAULT 'Não informado'
  )`);

  // Tabela de plantas offline (para sincronização)
  db.run(`CREATE TABLE IF NOT EXISTS offline_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Inserir alguns dados de exemplo se a tabela estiver vazia
  db.get("SELECT COUNT(*) as count FROM diagnoses", [], (err, row) => {
    if (!err && row.count === 0) {
      console.log('📊 Inserindo dados de exemplo...');
      const sampleData = [
        ['demo_user_1', 'Tomato', 'Early_blight', 0.89, -15.7942, -47.8822, 'Brasília - DF'],
        ['demo_user_2', 'Apple', 'Apple_scab', 0.92, -15.7850, -47.8950, 'Brasília - DF'],
        ['demo_user_3', 'Potato', 'Late_blight', 0.87, -15.8100, -47.8600, 'Brasília - DF'],
        ['demo_user_4', 'Grape', 'healthy', 0.95, -15.7700, -47.9100, 'Brasília - DF'],
        ['demo_user_5', 'Corn', 'Common_rust_', 0.84, -15.7600, -47.8700, 'Brasília - DF']
      ];
      
      const stmt = db.prepare(`
        INSERT INTO diagnoses (user_id, plant_type, disease, confidence, latitude, longitude, user_location)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      sampleData.forEach(data => {
        stmt.run(data);
      });
      
      stmt.finalize();
      console.log('✅ Dados de exemplo inseridos');
    }
  });
});

// Carregar informações das plantas do JSON
let plantInfo = {};
try {
  plantInfo = require('./data/model_info.json');
} catch (error) {
  console.error('Erro ao carregar informações das plantas:', error);
}

// Função para simular detecção de doenças (em produção, usar modelo de ML real)
function simulatePlantDiseaseDetection(imageData) {
  const classes = plantInfo.classes || [];
  const classespt = plantInfo.classes_pt || [];
  
  if (classes.length === 0) return null;
  
  // Simular resultado aleatório para demonstração
  const randomIndex = Math.floor(Math.random() * classes.length);
  const confidence = 0.7 + Math.random() * 0.25; // 70-95% de confiança
  
  const englishClass = classes[randomIndex];
  const portugueseClass = classespt[randomIndex] || englishClass;
  
  // Extrair tipo de planta e doença
  const parts = englishClass.split('___');
  const plantType = parts[0];
  const disease = parts[1] === 'healthy' ? 'Saudável' : parts[1];
  
  return {
    plant_type: plantType,
    disease: disease,
    portuguese_name: portugueseClass,
    confidence: confidence,
    accuracy: plantInfo.accuracy || 94.93
  };
}

// Rotas da API

// Rota para análise de plantas
app.post('/api/analyze-plant', async (req, res) => {
  try {
    const { image, latitude, longitude, userId = 'anonymous', userLocation = 'Não informado' } = req.body;
    
    if (!image || !latitude || !longitude) {
      return res.status(400).json({ 
        error: 'Dados incompletos: imagem, latitude e longitude são obrigatórios' 
      });
    }

    // Simular análise da imagem
    const analysis = simulatePlantDiseaseDetection(image);
    
    if (!analysis) {
      return res.status(500).json({ 
        error: 'Erro na análise da planta' 
      });
    }

    // Criar hash da imagem (não armazenar a imagem)
    const crypto = require('crypto');
    const imageHash = crypto.createHash('md5').update(image).digest('hex');

    // Salvar no banco de dados GLOBAL
    const stmt = db.prepare(`
      INSERT INTO diagnoses (user_id, plant_type, disease, confidence, latitude, longitude, image_hash, user_location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      userId,
      analysis.plant_type,
      analysis.disease,
      analysis.confidence,
      latitude,
      longitude,
      imageHash,
      userLocation
    ], function(err) {
      if (err) {
        console.error('Erro ao salvar diagnóstico:', err);
        return res.status(500).json({ error: 'Erro ao salvar diagnóstico' });
      }

      // Obter emoji da planta
      const plantEmoji = plantInfo.plant_emojis?.[analysis.plant_type] || '🌱';
      const healthStatus = analysis.disease === 'Saudável' || analysis.disease === 'healthy' ? 
        plantInfo.health_status?.healthy : plantInfo.health_status?.diseased;

      const result = {
        id: this.lastID,
        plant_type: analysis.plant_type,
        disease: analysis.disease,
        portuguese_name: analysis.portuguese_name,
        confidence: Math.round(analysis.confidence * 100),
        accuracy: Math.round(analysis.accuracy),
        plant_emoji: plantEmoji,
        health_emoji: healthStatus?.emoji || '❓',
        health_color: healthStatus?.color || 'gray',
        latitude,
        longitude,
        user_location: userLocation,
        timestamp: new Date().toISOString(),
        plant_wiki_url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(analysis.plant_type)}`,
        disease_info_url: analysis.disease !== 'Saudável' ? 
          `https://www.embrapa.br/busca-de-noticias/-/noticia/buscar?q=${encodeURIComponent(analysis.disease)}` : null
      };

      res.json(result);
    });

    stmt.finalize();

  } catch (error) {
    console.error('Erro na análise:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rota para obter todos os diagnósticos (GLOBAIS - todos os usuários)
app.get('/api/diagnoses', (req, res) => {
  const { limit = 100 } = req.query;
  
  db.all(`
    SELECT * FROM diagnoses 
    ORDER BY timestamp DESC 
    LIMIT ?
  `, [limit], (err, rows) => {
    if (err) {
      console.error('Erro ao buscar diagnósticos:', err);
      return res.status(500).json({ error: 'Erro ao buscar diagnósticos' });
    }

    // Adicionar informações extras para cada diagnóstico
    const enrichedRows = rows.map(row => {
      const plantEmoji = plantInfo.plant_emojis?.[row.plant_type] || '🌱';
      const healthStatus = row.disease === 'Saudável' || row.disease === 'healthy' ? 
        plantInfo.health_status?.healthy : plantInfo.health_status?.diseased;

      return {
        ...row,
        confidence: Math.round(row.confidence * 100),
        plant_emoji: plantEmoji,
        health_emoji: healthStatus?.emoji || '❓',
        health_color: healthStatus?.color || 'gray',
        plant_wiki_url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(row.plant_type)}`,
        disease_info_url: row.disease !== 'Saudável' ? 
          `https://www.embrapa.br/busca-de-noticias/-/noticia/buscar?q=${encodeURIComponent(row.disease)}` : null
      };
    });

    res.json(enrichedRows);
  });
});

// Rota para sincronização offline
app.post('/api/sync', async (req, res) => {
  try {
    const { offlineData } = req.body;
    
    if (!offlineData || !Array.isArray(offlineData)) {
      return res.status(400).json({ error: 'Dados de sincronização inválidos' });
    }

    const results = [];
    
    for (const item of offlineData) {
      try {
        // Processar cada item offline
        const analysis = simulatePlantDiseaseDetection(item.image);
        
        if (analysis) {
          const crypto = require('crypto');
          const imageHash = crypto.createHash('md5').update(item.image).digest('hex');

          const stmt = db.prepare(`
            INSERT INTO diagnoses (user_id, plant_type, disease, confidence, latitude, longitude, image_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          
          await new Promise((resolve, reject) => {
            stmt.run([
              item.userId || 'anonymous',
              analysis.plant_type,
              analysis.disease,
              analysis.confidence,
              item.latitude,
              item.longitude,
              imageHash
            ], function(err) {
              if (err) reject(err);
              else resolve(this.lastID);
            });
          });

          stmt.finalize();
          results.push({ success: true, id: item.localId });
        }
      } catch (error) {
        console.error('Erro ao sincronizar item:', error);
        results.push({ success: false, id: item.localId, error: error.message });
      }
    }

    res.json({ 
      message: 'Sincronização concluída',
      results,
      total: offlineData.length,
      success: results.filter(r => r.success).length
    });

  } catch (error) {
    console.error('Erro na sincronização:', error);
    res.status(500).json({ error: 'Erro na sincronização' });
  }
});

// Rota para obter estatísticas (GLOBAIS - todos os usuários)
app.get('/api/stats', (req, res) => {
  db.all(`
    SELECT 
      plant_type,
      disease,
      COUNT(*) as count,
      AVG(confidence) as avg_confidence
    FROM diagnoses 
    GROUP BY plant_type, disease
    ORDER BY count DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao buscar estatísticas:', err);
      return res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }

    const stats = {
      total_diagnoses: rows.reduce((sum, row) => sum + row.count, 0),
      plant_types: [...new Set(rows.map(row => row.plant_type))].length,
      diseases_found: rows.filter(row => row.disease !== 'Saudável').length,
      healthy_plants: rows.filter(row => row.disease === 'Saudável').reduce((sum, row) => sum + row.count, 0),
      by_plant: rows
    };

    res.json(stats);
  });
});

// Rota para servir informações das plantas
app.get('/api/plant-info', (req, res) => {
  res.json(plantInfo);
});

// Servir frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializar servidor
app.listen(PORT, () => {
  console.log(`🌱 Servidor AGROIA rodando na porta ${PORT}`);
  console.log(`📍 Acesse: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Encerrando servidor...');
  db.close((err) => {
    if (err) {
      console.error('Erro ao fechar banco de dados:', err);
    } else {
      console.log('✅ Banco de dados fechado.');
    }
    process.exit(0);
  });
});