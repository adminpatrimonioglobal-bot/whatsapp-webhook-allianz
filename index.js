const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());
app.use(cors());

let sock = null;
let qrCode = null;
let isConnected = false;

// Importar Baileys
let Baileys;
let makeWASocket;
let DisconnectReason;
let useMultiFileAuthState;
let fetchLatestBaileysVersion;

async function initBaileys() {
  try {
    const baileysModule = await import('@whiskeysockets/baileys');
    makeWASocket = baileysModule.default;
    DisconnectReason = baileysModule.DisconnectReason;
    useMultiFileAuthState = baileysModule.useMultiFileAuthState;
    fetchLatestBaileysVersion = baileysModule.fetchLatestBaileysVersion;
    return true;
  } catch (error) {
    console.error('Error importando Baileys:', error);
    return false;
  }
}

async function connectWhatsApp() {
  try {
    if (!makeWASocket) {
      console.log('Baileys no está cargado aún...');
      setTimeout(connectWhatsApp, 2000);
      return;
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = qr;
        console.log('✅ QR GENERADO');
      }

      if (connection === 'open') {
        isConnected = true;
        console.log('🟢 WhatsApp Conectado');
      }

      if (connection === 'close') {
        isConnected = false;
        console.log('🔴 Desconectado');
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('❌ Error conectando:', error.message);
    setTimeout(connectWhatsApp, 3000);
  }
}

// RUTAS
app.get('/', (req, res) => {
  res.json({
    servidor: 'WhatsApp Webhook Allianz ✅',
    conectado: isConnected,
  });
});

app.get('/status', (req, res) => {
  res.json({
    conectado: isConnected,
    estado: isConnected ? 'Conectado ✅' : 'Desconectado ❌',
  });
});

app.get('/qr', (req, res) => {
  if (!qrCode) {
    return res.send(
      '<h1>Esperando QR...</h1><p>Recarga la página en unos segundos</p>'
    );
  }

  qrcode.generate(qrCode, { small: true }, (qr_ascii) => {
    res.send(`
      <html>
        <body style="text-align:center; font-family: Arial;">
          <h1>📱 Escanea el QR</h1>
          <pre>${qr_ascii}</pre>
        </body>
      </html>
    `);
  });
});

app.post('/webhook', async (req, res) => {
  try {
    const { nombre, telefono, proyeccion, aportacion, edad, regimen, email } = req.body;

    if (!telefono || !nombre) {
      return res.status(400).json({ error: 'Faltan nombre y telefono' });
    }

    if (!isConnected) {
      return res.status(503).json({ error: 'WhatsApp desconectado' });
    }

    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith('52')) numero = '52' + numero;

    const mensaje = `¡Hola ${nombre}! 👋\n\nTu registro está procesado.\n\n💰 Proyección: $${proyeccion || 'calculando'}\n\n📅 Te contactaremos pronto.\n\n*OptiMaxx Plus - Allianz* 🚀`;

    await sock.sendMessage(numero + '@s.whatsapp.net', { text: mensaje });

    res.json({ success: true, mensaje: `Enviado a ${nombre}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// INICIAR
const PORT = process.env.PORT || 3000;

(async () => {
  await initBaileys();
  connectWhatsApp();

  app.listen(PORT, () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
  });
})();
