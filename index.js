const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

let isConnected = false;

// Intentar conectar Baileys de forma segura
async function tryConnectBaileys() {
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default;
    const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: require('pino')({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, qr } = update;
      if (connection === 'open') {
        isConnected = true;
        console.log('✅ WhatsApp conectado');
      }
      if (connection === 'close') {
        isConnected = false;
      }
    });

    sock.ev.on('creds.update', saveCreds);
    
    return sock;
  } catch (error) {
    console.error('Error Baileys:', error.message);
    return null;
  }
}

let sock = null;

// RUTAS BÁSICAS
app.get('/', (req, res) => {
  res.json({
    status: 'Servidor activo',
    conectado: isConnected
  });
});

app.get('/status', (req, res) => {
  res.json({
    conectado: isConnected,
    mensaje: isConnected ? 'WhatsApp conectado ✅' : 'WhatsApp desconectado ❌'
  });
});

app.post('/webhook', async (req, res) => {
  try {
    const { nombre, telefono, proyeccion } = req.body;

    if (!telefono || !isConnected) {
      return res.status(400).json({ 
        error: isConnected ? 'Faltan datos' : 'WhatsApp no conectado'
      });
    }

    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith('52')) numero = '52' + numero;

    const mensaje = `Hola ${nombre}, tu proyección es: $${proyeccion}. OptiMaxx Plus 🚀`;
    
    if (sock) {
      await sock.sendMessage(numero + '@s.whatsapp.net', { text: mensaje });
      res.json({ success: true });
    } else {
      res.status(503).json({ error: 'WhatsApp no está disponible' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// INICIAR
const PORT = process.env.PORT || 3000;

(async () => {
  sock = await tryConnectBaileys();
  
  app.listen(PORT, () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
    console.log(`Status: http://localhost:${PORT}/status`);
  });
})();
