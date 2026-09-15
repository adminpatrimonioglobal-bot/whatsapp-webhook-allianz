import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  default as makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

dotenv.config();

const app = express();
const logger = pino();

// Middleware
app.use(express.json());
app.use(cors());

let sock;
let qrCode = null;
let isConnected = false;

// ============================================
// FUNCIÓN: Conectar a WhatsApp con Baileys
// ============================================
async function connectWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      syncFullHistory: false,
    });

    // Evento: QR generado
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = qr;
        console.log('✅ QR CODE GENERADO - Escanea en /qr');
      }

      if (connection === 'open') {
        isConnected = true;
        console.log('🟢 WhatsApp Conectado Exitosamente');
      }

      if (connection === 'close') {
        isConnected = false;
        console.log('🔴 WhatsApp Desconectado');
        if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
          setTimeout(() => connectWhatsApp(), 3000);
        }
      }
    });

    // Evento: Credenciales actualizadas
    sock.ev.on('creds.update', saveCreds);

    console.log('📱 Intentando conectar a WhatsApp...');
  } catch (error) {
    console.error('❌ Error conectando WhatsApp:', error);
    setTimeout(() => connectWhatsApp(), 3000);
  }
}

// ============================================
// RUTA: Ver QR en navegador
// ============================================
app.get('/qr', (req, res) => {
  if (!qrCode) {
    return res.send(
      '<h1>QR no disponible aún</h1><p>Abre esta página en unos segundos...</p>'
    );
  }

  qrcode.generate(qrCode, { small: true }, (qr_ascii) => {
    res.send(`
      <html>
        <head>
          <title>WhatsApp QR - Allianz</title>
          <style>
            body { font-family: Arial; text-align: center; padding: 20px; background: #f5f5f5; }
            pre { background: white; padding: 20px; border-radius: 8px; display: inline-block; }
            h1 { color: #25D366; }
          </style>
        </head>
        <body>
          <h1>📱 Escanea este QR con WhatsApp</h1>
          <p>Abre WhatsApp en tu teléfono y apunta la cámara aquí</p>
          <pre>${qr_ascii}</pre>
          <p><a href="/status">Ver estado</a></p>
        </body>
      </html>
    `);
  });
});

// ============================================
// RUTA: Estado de conexión
// ============================================
app.get('/status', (req, res) => {
  const status = isConnected ? 'Conectado ✅' : 'Desconectado ❌';
  res.json({
    conectado: isConnected,
    estado: status,
    url_qr: 'https://' + (process.env.RENDER_EXTERNAL_URL || 'localhost:3000') + '/qr',
  });
});

// ============================================
// RUTA PRINCIPAL: Recibe webhook de Make
// ============================================
app.post('/webhook', async (req, res) => {
  try {
    const {
      nombre,
      telefono,
      ingresos,
      aportacion,
      edad,
      email,
      razon,
      vision,
      proyeccion,
      regimen,
    } = req.body;

    if (!telefono || !nombre) {
      return res.status(400).json({
        error: 'Faltan datos: nombre y telefono son requeridos',
      });
    }

    if (!isConnected) {
      return res.status(503).json({
        error: 'WhatsApp no está conectado',
        qr_url: '/qr',
      });
    }

    // Formatear número
    let numeroFormato = telefono.replace(/\D/g, '');
    if (!numeroFormato.startsWith('52')) {
      numeroFormato = '52' + numeroFormato;
    }

    const idChat = numeroFormato + '@s.whatsapp.net';

    // Mensaje personalizado
    const mensaje = `¡Hola ${nombre}! 👋

Acabo de procesar tu registro para la estrategia *OptiMaxx Plus* 🎯

📊 *Resumen de tu perfil:*
• Edad: ${edad} años
• Ingresos mensuales: $${ingresos}
• Aportación mensual: $${aportacion}
• Régimen: ${regimen}

${proyeccion ? `💰 *Tu proyección a 25 años:*\n$${proyeccion} MXN\n\n` : ''}📅 *Próximos pasos:*
1. Revisa tu email para la proyección completa
2. Agenda una llamada conmigo para personalizar tu plan
3. Comienza a blindar tu patrimonio hoy

¿Tienes dudas? Responde aquí o escribe a ${email}

*Diseña tu retiro, no lo dejes al azar* 🚀`;

    // Enviar mensaje
    await sock.sendMessage(idChat, { text: mensaje });

    console.log(`✅ Mensaje enviado a ${nombre} (${telefono})`);

    res.json({
      success: true,
      mensaje: `Mensaje enviado a ${nombre}`,
      telefono: numeroFormato,
    });
  } catch (error) {
    console.error('Error en webhook:', error);
    res.status(500).json({
      error: 'Error al enviar mensaje',
      detalles: error.message,
    });
  }
});

// ============================================
// RUTA: Enviar mensaje manual (testing)
// ============================================
app.post('/enviar-mensaje', async (req, res) => {
  try {
    const { telefono, mensaje } = req.body;

    if (!telefono || !mensaje) {
      return res.status(400).json({ error: 'Faltan telefono o mensaje' });
    }

    if (!isConnected) {
      return res.status(503).json({ error: 'WhatsApp no está conectado' });
    }

    let numeroFormato = telefono.replace(/\D/g, '');
    if (!numeroFormato.startsWith('52')) {
      numeroFormato = '52' + numeroFormato;
    }

    const idChat = numeroFormato + '@s.whatsapp.net';
    await sock.sendMessage(idChat, { text: mensaje });

    res.json({ success: true, mensaje: 'Mensaje enviado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// RUTA: Health check
// ============================================
app.get('/', (req, res) => {
  res.json({
    servidor: 'WhatsApp Webhook activo ✅',
    version: '1.0.0',
    conectado: isConnected,
    endpoints: {
      status: 'GET /status',
      qr: 'GET /qr',
      webhook: 'POST /webhook',
      test: 'POST /enviar-mensaje',
    },
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000;

connectWhatsApp();

app.listen(PORT, () => {
  console.log(`🚀 Servidor WhatsApp corriendo en puerto ${PORT}`);
  console.log(`📱 Escanea QR en: http://localhost:${PORT}/qr`);
  console.log(`✅ Webhook listo en: http://localhost:${PORT}/webhook`);
});
