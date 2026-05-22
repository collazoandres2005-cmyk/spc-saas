'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const fs         = require('fs');
const path       = require('path');

const authRoutes         = require('./routes/auth');
const billingRoutes      = require('./routes/billing');
const processesRoutes    = require('./routes/processes');
const measurementsRoutes = require('./routes/measurements');
const analysisRoutes     = require('./routes/analysis');
const usersRoutes        = require('./routes/users');

const app = express();

// ── CORS ───────────────────────────────────────────────────────────────────
const _extraOrigins = (process.env.FRONTEND_URL || '')
  .split(',').map(o => o.trim()).filter(Boolean);

// CORS_ALLOW_ALL=true → acepta cualquier origen (útil en fase inicial de Render)
// Una vez funcionando, quita esa variable y configura FRONTEND_URL
const _corsOrigin = process.env.CORS_ALLOW_ALL === 'true'
  ? true
  : function(origin, cb) {
      if (!origin) return cb(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      if (/\.ngrok(-free)?\.app$/.test(origin) || /\.ngrok\.io$/.test(origin)) return cb(null, true);
      if (/\.vercel\.app$/.test(origin)) return cb(null, true);
      if (/\.onrender\.com$/.test(origin)) return cb(null, true);
      if (_extraOrigins.some(o => origin.startsWith(o))) return cb(null, true);
      cb(new Error(`Origen no permitido por CORS: ${origin}`));
    };

app.use(cors({
  origin: _corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'ngrok-skip-browser-warning']
}));

// ── Stripe webhook necesita body raw ──────────────────────────────────────
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// ── Body parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting en autenticación ────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intente de nuevo en un minuto.' }
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ── Rutas ─────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/billing',      billingRoutes);
app.use('/api/processes',    processesRoutes);
app.use('/api/measurements', measurementsRoutes);
app.use('/api/analysis',     analysisRoutes);
app.use('/api/users',        usersRoutes);

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Setup DB (ejecuta schema.sql — protegido por SETUP_TOKEN) ─────────────
// Uso: GET /setup-db?token=<SETUP_TOKEN>
// Después de ejecutarlo, elimina o comenta este endpoint.
app.get('/setup-db', async (req, res) => {
  const expectedToken = process.env.SETUP_TOKEN;
  if (!expectedToken) {
    return res.status(403).json({ error: 'SETUP_TOKEN no configurado en variables de entorno.' });
  }
  if (req.query.token !== expectedToken) {
    return res.status(403).json({ error: 'Token inválido.' });
  }

  try {
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const db = require('./db');
    await db.query(sql);
    res.json({ ok: true, message: 'Schema aplicado correctamente. Ahora elimina SETUP_TOKEN del entorno.' });
  } catch (err) {
    console.error('Error en /setup-db:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 404 para rutas /api no existentes (devuelve JSON, no HTML) ────────────
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// ── Manejador de errores global ───────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Error no manejado:', err);
  // CORS errors
  if (err.message && err.message.startsWith('Origen no permitido')) {
    return res.status(403).json({ error: err.message });
  }
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// ── Inicio ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

async function runMigrations(db) {
  // Idempotente — seguro en cada arranque
  await db.query(`ALTER TABLE measurements ADD COLUMN IF NOT EXISTS phase SMALLINT NOT NULL DEFAULT 1`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_measurements_phase ON measurements(process_id, phase)`);

  // sample_size: tamaño de muestra por subgrupo (p, u charts) o unidades inspeccionadas
  await db.query(`ALTER TABLE measurements ADD COLUMN IF NOT EXISTS sample_size NUMERIC`);

  // chart_type: tipo de carta SPC asociada al proceso
  await db.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS chart_type VARCHAR(20) DEFAULT 'xbar_r'`);

  // n_size: tamaño de subgrupo fijo (np chart, Industrial mode)
  await db.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS n_size SMALLINT`);

  // spc_events: historial de señales detectadas
  await db.query(`
    CREATE TABLE IF NOT EXISTS spc_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      process_id  UUID REFERENCES processes(id) ON DELETE CASCADE,
      company_id  UUID REFERENCES companies(id),
      chart_type  VARCHAR(20),
      rule        VARCHAR(20),
      severity    VARCHAR(20),
      sg_index    INTEGER,
      description TEXT,
      acknowledged BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_spc_events_process ON spc_events(process_id, created_at DESC)`);
}

(async () => {
  const db = require('./db');
  try {
    await runMigrations(db);
    console.log('  Migración DB: OK (columna phase lista)');
  } catch (e) {
    console.error('  Migración DB: ADVERTENCIA —', e.message);
  }

  app.listen(PORT, () => {
    console.log('=== Servidor SPC SaaS iniciado ===');
    console.log(`  Puerto:    ${PORT}`);
    console.log(`  Entorno:   ${process.env.NODE_ENV || 'development'}`);
    console.log(`  CORS:      ${process.env.CORS_ALLOW_ALL === 'true' ? 'ABIERTO (todos los origenes)' : 'restringido por whitelist'}`);
    console.log(`  DB:        ${process.env.DATABASE_URL ? 'variable configurada' : 'DATABASE_URL no definida'}`);
    console.log(`  JWT:       ${process.env.JWT_SECRET   ? 'variable configurada' : 'JWT_SECRET no definida'}`);
    console.log(`  Health:    http://localhost:${PORT}/health`);
    console.log('==================================');
  });
})();

module.exports = app;
