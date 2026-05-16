const express = require('express');
const multer  = require('multer');
const { parse } = require('csv-parse');
const XLSX    = require('xlsx');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth, requireActiveSubscription);

// GET /api/measurements?process_id=&limit=&offset=&phase=1
// phase: 1 = Fase 1 (default), 2 = Fase 2 (monitoreo), all = ambas
router.get('/', async (req, res) => {
  const { process_id, limit = 500, offset = 0, phase = '1' } = req.query;
  if (!process_id) {
    return res.status(400).json({ error: 'Se requiere process_id.' });
  }

  try {
    const proc = await db.query(
      'SELECT id FROM processes WHERE id=$1 AND company_id=$2',
      [process_id, req.user.company_id]
    );
    if (!proc.rows.length) {
      return res.status(404).json({ error: 'Proceso no encontrado.' });
    }

    const phaseFilter = phase === 'all' ? '' : `AND m.phase = ${phase === '2' ? 2 : 1}`;

    const result = await db.query(
      `SELECT m.id, m.value, m.subgroup_id, m.phase, m.recorded_at, u.name as recorded_by_name
       FROM measurements m
       LEFT JOIN users u ON m.recorded_by = u.id
       WHERE m.process_id=$1 AND m.company_id=$2 ${phaseFilter}
       ORDER BY m.recorded_at DESC
       LIMIT $3 OFFSET $4`,
      [process_id, req.user.company_id, parseInt(limit), parseInt(offset)]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM measurements WHERE process_id=$1 AND company_id=$2 ${phaseFilter}`,
      [process_id, req.user.company_id]
    );

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las mediciones.' });
  }
});

// POST /api/measurements (una o varias — acepta objeto o array)
router.post('/', async (req, res) => {
  const body = req.body;
  const items = Array.isArray(body) ? body : [body];

  if (!items.length || !items[0].process_id) {
    return res.status(400).json({ error: 'Se requiere process_id y value.' });
  }

  const process_id = items[0].process_id;

  try {
    // Verificar propiedad del proceso
    const proc = await db.query(
      'SELECT id FROM processes WHERE id=$1 AND company_id=$2',
      [process_id, req.user.company_id]
    );
    if (!proc.rows.length) {
      return res.status(404).json({ error: 'Proceso no encontrado.' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = [];

      for (const item of items) {
        const { value, subgroup_id, recorded_at, phase } = item;
        if (value === undefined || value === null || value === '') {
          continue;
        }
        const numVal = parseFloat(value);
        if (isNaN(numVal)) continue;
        const phaseVal = phase === 2 || phase === '2' ? 2 : 1;

        const r = await client.query(
          `INSERT INTO measurements (process_id, company_id, value, subgroup_id, phase, recorded_at, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, value, subgroup_id, phase, recorded_at`,
          [process_id, req.user.company_id, numVal,
           subgroup_id || null,
           phaseVal,
           recorded_at || new Date(),
           req.user.user_id]
        );
        inserted.push(r.rows[0]);
      }

      await client.query('COMMIT');
      res.status(201).json({ inserted: inserted.length, data: inserted });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al insertar mediciones.' });
  }
});

// POST /api/measurements/import (CSV o Excel)
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Se requiere un archivo CSV o Excel.' });
  }
  const { process_id } = req.body;
  if (!process_id) {
    return res.status(400).json({ error: 'Se requiere process_id.' });
  }

  try {
    const proc = await db.query(
      'SELECT id FROM processes WHERE id=$1 AND company_id=$2',
      [process_id, req.user.company_id]
    );
    if (!proc.rows.length) {
      return res.status(404).json({ error: 'Proceso no encontrado.' });
    }

    // ── Parsear según tipo de archivo ────────────────────────────────────
    let records;
    const filename = (req.file.originalname || '').toLowerCase();
    const isExcel  = filename.endsWith('.xlsx') || filename.endsWith('.xls');

    if (isExcel) {
      const wb    = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      const ws    = wb.Sheets[wb.SheetNames[0]];
      records     = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else {
      // CSV / TXT
      const csvText = req.file.buffer.toString('utf-8');
      records = await new Promise((resolve, reject) => {
        parse(csvText, { columns: true, skip_empty_lines: true, trim: true },
          (err, data) => (err ? reject(err) : resolve(data))
        );
      });
    }

    if (!records.length) {
      return res.status(400).json({ error: 'El archivo está vacío o sin datos reconocibles.' });
    }

    // ── Insertar en transacción ───────────────────────────────────────────
    const client = await db.pool.connect();
    let inserted = 0;
    const errors = [];

    try {
      await client.query('BEGIN');

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        // Buscar la columna de valor con varios nombres posibles
        const rawValue = row.value      ?? row.Value      ??
                         row.VALOR      ?? row.valor      ??
                         row.Valor      ?? row.medicion   ??
                         row.Medicion   ?? Object.values(row)[0];
        const subgroup = row.subgroup_id ?? row.subgrupo  ??
                         row.Subgrupo   ?? row.grupo      ?? null;

        const numVal = parseFloat(String(rawValue).replace(',', '.'));
        if (isNaN(numVal)) {
          errors.push(`Fila ${i + 2}: valor inválido "${rawValue}"`);
          continue;
        }

        await client.query(
          `INSERT INTO measurements (process_id, company_id, value, subgroup_id, recorded_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [process_id, req.user.company_id, numVal,
           subgroup !== null && subgroup !== '' ? parseInt(subgroup) : null,
           req.user.user_id]
        );
        inserted++;
      }

      await client.query('COMMIT');
      res.json({
        inserted,
        errors,
        total_rows: records.length,
        file_type: isExcel ? 'excel' : 'csv'
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error importando archivo:', err);
    res.status(500).json({ error: 'Error al importar el archivo.' });
  }
});

// DELETE /api/measurements/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM measurements WHERE id=$1 AND company_id=$2 RETURNING id',
      [req.params.id, req.user.company_id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Medición no encontrada.' });
    }
    res.json({ message: 'Medición eliminada.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la medición.' });
  }
});

module.exports = router;
