import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import makeWASocket, {
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
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    syncFullHistory: false,
  });

  // Evento: QR generado (mostrar para que user escanee)
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = qr;
      console.log('QR CODE GENERADO - Escanea en https://tuservidor.com/qr');
    }

    if (connection === 'open') {
      isConnected = true;
      console.log('✅ WhatsApp Conectado Exitosamente');
    }

    if (connection === 'close') {
      isConnected = false;
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        connectWhatsApp(); // Reconectar si se desconectó sin logout
      }
    }
  });

  // Evento: Credenciales actualizadas
  sock.ev.on('creds.update', saveCreds);
}

// ============================================
// RUTA: Ver QR en navegador
// ============================================
app.get('/qr', (req, res) => {
  if (!qrCode) {
    return res.json({ mensaje: 'Escanea el QR que aparecerá aquí cuando se desconecte' });
  }

  qrcode.generate(qrCode, { small: true }, (qr_ascii) => {
    res.send(`<pre>${qr_ascii}</pre>`);
  });
});

// ============================================
// RUTA: Estado de conexión
// ============================================
app.get('/status', (req, res) => {
  res.json({
    conectado: isConnected,
    estado: isConnected ? 'WhatsApp Conectado ✅' : 'WhatsApp Desconectado ❌',
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

    // Validar datos
    if (!telefono || !nombre) {
      return res.status(400).json({
        error: 'Faltan datos: nombre y telefono son requeridos',
      });
    }

    if (!isConnected) {
      return res.status(503).json({
        error: 'WhatsApp no está conectado. Escanea el QR en /qr',
      });
    }

    // Formatear número de teléfono (agregar código de país si no lo tiene)
    let numeroFormato = telefono.replace(/\D/g, '');
    if (!numeroFormato.startsWith('52')) {
      numeroFormato = '52' + numeroFormato;
    }

    const idChat = numeroFormato + '@s.whatsapp.net';

    // Construir mensaje personalizado
    const mensaje = `¡Hola ${nombre}! 👋

Acabo de procesar tu registro para la estrategia *OptiMaxx Plus* 🎯

📊 *Resumen de tu perfil:*
• Edad: ${edad} años
• Ingresos mensuales: $${ingresos}
• Aportación mensual: $${aportacion}
• Régimen: ${regimen}

${proyeccion ? `💰 *Tu proyección a 25 años:* $${proyeccion} MXN\n\n` : ''}
📅 *Próximos pasos:*
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
// RUTA: Enviar mensaje manual (para testing)
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
