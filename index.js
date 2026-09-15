const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

let isConnected = false;
let qrCode = null;
let sock = null;

async function tryConnectBaileys() {
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default;
    const { useMultiFileAuthState, fetchLatestBaileysVersion } = baileys;
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: state,
      logger: require('pino')({ level: 'silent' })
    });

    socket.ev.on('connection.update', (update) => {
      const { connection, qr } = update;
      
      if (qr) {
        qrCode = qr;
        console.log('✅ QR Generado');
      }
      
      if (connection === 'open') {
        isConnected = true;
        console.log('✅ WhatsApp conectado');
      }
      
      if (connection === 'close') {
        isConnected = false;
        console.log('❌ Desconectado');
      }
    });

    socket.ev.on('creds.update', saveCreds);
    
    return socket;
  } catch (error) {
    console.error('Error Baileys:', error.message);
    setTimeout(tryConnectBaileys, 3000);
    return null;
  }
}

// RUTAS
app.get('/', (req, res) => {
  res.json({
    servidor: 'WhatsApp Webhook Allianz ✅',
    conectado: isConnected
  });
});

app.get('/status', (req, res) => {
  res.json({
    conectado: isConnected,
    estado: isConnected ? 'Conectado ✅' : 'Desconectado ❌'
  });
});

app.get('/qr', (req, res) => {
  if (!qrCode) {
    return res.send('<h1>Generando QR...</h1><p>Recarga en unos segundos</p>');
  }

  const qrcode = require('qrcode-terminal');
  let qrText = '';
  qrcode.generate(qrCode, { small: true }, (qr_ascii) => {
    qrText = qr_ascii;
  });

  res.send(`
    <html>
      <head>
        <title>WhatsApp QR</title>
        <style>
          body { text-align: center; font-family: Arial; padding: 20px; }
          pre { background: #f0f0f0; padding: 20px; display: inline-block; }
          h1 { color: #25D366; }
        </style>
      </head>
      <body>
        <h1>📱 Escanea el QR con WhatsApp</h1>
        <pre>${qrText}</pre>
        <p><a href="/status">Ver estado</a></p>
      </body>
    </html>
  `);
});

app.post('/webhook', async (req, res) => {
  try {
    const { nombre, telefono, proyeccion, aportacion, edad, regimen, email } = req.body;

    if (!telefono || !nombre) {
      return res.status(400).json({ error: 'Faltan nombre y telefono' });
    }

    if (!isConnected) {
      return res.status(503).json({ error: 'WhatsApp no conectado. Escanea QR en /qr' });
    }

    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith('52')) numero = '52' + numero;

    const mensaje = `¡Hola ${nombre}! 👋

Acabo de procesar tu registro OptiMaxx Plus 🎯

📊 Tu perfil:
• Edad: ${edad}
• Aportación: $${aportacion}
• Régimen: ${regimen}

${proyeccion ? `💰 Proyección 25 años: $${proyeccion}` : ''}

📅 Te contactaremos pronto.

*Diseña tu retiro* 🚀`;

    if (sock) {
      await sock.sendMessage(numero + '@s.whatsapp.net', { text: mensaje });
      res.json({ success: true, mensaje: 'Enviado a ' + nombre });
    } else {
      res.status(503).json({ error: 'Socket no disponible' });
    }
  } catch (error) {
    console.error('Error webhook:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// INICIAR
const PORT = process.env.PORT || 3000;

(async () => {
  sock = await tryConnectBaileys();
  
  app.listen(PORT, () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
    console.log(`📱 QR en: http://localhost:${PORT}/qr`);
  });
})();
