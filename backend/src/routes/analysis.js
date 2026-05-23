const express = require('express');
const db  = require('../db');
const spc = require('../utils/spc');
const { requireAuth } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');

const router = express.Router();
router.use(requireAuth, requireActiveSubscription);

async function getProcessValues(process_id, company_id) {
  const [procResult, measResult] = await Promise.all([
    db.query(
      'SELECT id, name, usl, lsl, nominal, unit, chart_type, n_size FROM processes WHERE id=$1 AND company_id=$2',
      [process_id, company_id]
    ),
    db.query(
      `SELECT value, subgroup_id, sample_size FROM measurements
       WHERE process_id=$1 AND company_id=$2 AND phase = 1
       ORDER BY recorded_at ASC`,
      [process_id, company_id]
    )
  ]);

  return { process: procResult.rows[0], rows: measResult.rows };
}

// GET /api/analysis/capability?process_id=&simulate_n=
router.get('/capability', async (req, res) => {
  const { process_id, simulate_n } = req.query;
  if (!process_id) return res.status(400).json({ error: 'Se requiere process_id.' });

  try {
    const { process, rows } = await getProcessValues(process_id, req.user.company_id);
    if (!process) return res.status(404).json({ error: 'Proceso no encontrado.' });
    if (rows.length < 2) return res.status(400).json({ error: 'Se necesitan al menos 2 mediciones.' });

    const { usl, lsl } = process;
    if (usl == null || lsl == null) {
      return res.status(400).json({ error: 'El proceso requiere USL y LSL definidos.' });
    }

    const values = rows.map(r => parseFloat(r.value));
    const n = simulate_n ? parseInt(simulate_n) : 0;
    let capability;
    let simulated = false;
    let testRows;   // rows with subgroup_id for statistical tests

    if (n >= 2 && n <= 10) {
      const numGroups = Math.floor(values.length / n);
      if (numGroups < 2) {
        return res.status(400).json({
          error: `Datos insuficientes: se necesitan al menos ${n * 2} mediciones para n=${n} (hay ${values.length}).`
        });
      }
      const subgroups = [];
      for (let g = 0; g < numGroups; g++) {
        subgroups.push(values.slice(g * n, (g + 1) * n));
      }
      capability = spc.calculateCapabilityFromSubgroups(subgroups, parseFloat(usl), parseFloat(lsl), process.nominal);
      // Build rows with simulated subgroup IDs for statistical tests
      testRows = values.slice(0, numGroups * n).map((v, i) => ({
        value: v,
        subgroup_id: Math.floor(i / n) + 1
      }));
      simulated = true;
    } else {
      capability = spc.calculateCapability(values, parseFloat(usl), parseFloat(lsl), process.nominal);
      testRows = rows;  // use original rows (may have real subgroup_id or null)
    }

    if (!capability) {
      return res.status(400).json({ error: 'No se pudo calcular la capacidad (σ = 0).' });
    }

    const statisticalTests = testRows.length >= 7
      ? spc.runStatisticalTests(testRows)
      : null;

    res.json({ process, capability, simulated, simulate_n: simulated ? n : null, statisticalTests });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular la capacidad.' });
  }
});

// GET /api/analysis/control-chart?process_id=&type=xbar_r|xbar_s|p|np|c|u[&simulate_n=5&rule_ooc=1&rule_trend=1&rule_shift=1]
router.get('/control-chart', async (req, res) => {
  const {
    process_id, type = 'xbar_r', simulate_n,
    rule_ooc   = '1', rule_trend = '1', rule_shift = '1'
  } = req.query;
  if (!process_id) return res.status(400).json({ error: 'Se requiere process_id.' });

  const validTypes = ['xbar_r', 'xbar_s', 'p', 'np', 'c', 'u'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Tipo de carta inválido. Use: ${validTypes.join(', ')}.` });
  }

  try {
    const { process, rows } = await getProcessValues(process_id, req.user.company_id);
    if (!process) return res.status(404).json({ error: 'Proceso no encontrado.' });
    if (rows.length < 2) return res.status(400).json({ error: 'Se necesitan al menos 2 mediciones.' });

    let chartData;
    let simulated = false;
    let variableN  = false;
    const labels   = [];
    const ruleOpts = {
      detectOutOfControl: rule_ooc   !== '0',
      detectTrend:        rule_trend !== '0',
      detectShift:        rule_shift !== '0'
    };

    // ── X̄-R y X̄-S ─────────────────────────────────────────────────────────
    if (type === 'xbar_r' || type === 'xbar_s') {
      const n = simulate_n ? parseInt(simulate_n) : 0;

      if (n >= 2 && n <= 10) {
        const allValues = rows.map(r => parseFloat(r.value));
        const numGroups = Math.floor(allValues.length / n);
        if (numGroups < 2) {
          return res.status(400).json({
            error: `Insuficiente: se necesitan al menos ${n * 2} mediciones para n=${n} (hay ${allValues.length}).`
          });
        }
        const sgValues = [];
        for (let g = 0; g < numGroups; g++) {
          sgValues.push(allValues.slice(g * n, (g + 1) * n));
          labels.push(`SG ${g + 1}`);
        }
        chartData = type === 'xbar_r' ? spc.calculateXbarR(sgValues) : spc.calculateXbarS(sgValues);
        simulated = true;

      } else {
        const subgroupMap = new Map();
        rows.forEach(row => {
          const key = row.subgroup_id != null ? row.subgroup_id : 'default';
          if (!subgroupMap.has(key)) subgroupMap.set(key, []);
          subgroupMap.get(key).push(parseFloat(row.value));
        });
        const subgroups = [...subgroupMap.entries()]
          .filter(([, sg]) => sg.length >= 2)
          .map(([k, sg]) => ({ key: k, values: sg }));

        if (subgroups.length < 2) {
          return res.status(400).json({
            error: 'Se necesitan al menos 2 subgrupos con ≥ 2 mediciones.'
          });
        }
        subgroups.forEach(sg => labels.push(`SG ${sg.key}`));
        chartData = type === 'xbar_r'
          ? spc.calculateXbarR(subgroups.map(sg => sg.values))
          : spc.calculateXbarS(subgroups.map(sg => sg.values));
      }

    // ── Carta p (proporción) ────────────────────────────────────────────────
    } else if (type === 'p') {
      const sgMap = new Map();
      rows.forEach(row => {
        const key = row.subgroup_id ?? 'default';
        if (!sgMap.has(key)) sgMap.set(key, []);
        sgMap.get(key).push(row);
      });
      const subgroups = [...sgMap.entries()].map(([k, rws]) => {
        const n          = rws.reduce((s, r) => s + (r.sample_size ? parseFloat(r.sample_size) : 1), 0);
        const defectives = rws.reduce((s, r) => s + parseFloat(r.value), 0);
        labels.push(`SG ${k}`);
        return { defectives, n };
      });
      if (subgroups.length < 2) {
        return res.status(400).json({ error: 'Se necesitan al menos 2 subgrupos para la carta p.' });
      }
      chartData = spc.calculatePChart(subgroups);
      variableN = chartData.p.variableN;

    // ── Carta np (número de defectuosos, n fijo) ────────────────────────────
    } else if (type === 'np') {
      let nFixed = parseInt(process.n_size) || 0;

      // Si n_size no está en el proceso, derivarlo del sample_size de las mediciones
      if (nFixed < 2) {
        const sizes = rows
          .filter(r => r.sample_size != null)
          .map(r => parseFloat(r.sample_size));
        const unique = [...new Set(sizes)];
        if (unique.length === 1 && unique[0] >= 2) {
          nFixed = unique[0];
        } else if (unique.length > 1) {
          return res.status(400).json({
            error: `La carta np requiere n fijo, pero las mediciones tienen tamaños distintos (${unique.join(', ')}). Verifica los datos guardados.`
          });
        }
      }

      if (nFixed < 2) {
        return res.status(400).json({
          error: 'No se pudo determinar el tamaño de muestra n. Configura n_size en el proceso o guarda datos con n fijo desde la entrada de datos.'
        });
      }

      const sgMap = new Map();
      rows.forEach(row => {
        const key = row.subgroup_id ?? 'default';
        if (!sgMap.has(key)) sgMap.set(key, []);
        sgMap.get(key).push(row);
      });
      const subgroups = [...sgMap.entries()].map(([k, rws]) => {
        labels.push(`SG ${k}`);
        return { defectives: rws.reduce((s, r) => s + parseFloat(r.value), 0) };
      });
      if (subgroups.length < 2) {
        return res.status(400).json({ error: 'Se necesitan al menos 2 subgrupos para la carta np.' });
      }
      chartData = spc.calculateNPChart(subgroups, nFixed);

    // ── Carta c (defectos por unidad, área constante) ───────────────────────
    } else if (type === 'c') {
      const sgMap = new Map();
      rows.forEach(row => {
        const key = row.subgroup_id ?? 'default';
        if (!sgMap.has(key)) sgMap.set(key, []);
        sgMap.get(key).push(row);
      });
      const subgroups = [...sgMap.entries()].map(([k, rws]) => {
        labels.push(`SG ${k}`);
        return { count: rws.reduce((s, r) => s + parseFloat(r.value), 0) };
      });
      if (subgroups.length < 2) {
        return res.status(400).json({ error: 'Se necesitan al menos 2 subgrupos para la carta c.' });
      }
      chartData = spc.calculateCChart(subgroups);

    // ── Carta u (defectos por unidad de inspección, n variable) ────────────
    } else if (type === 'u') {
      const sgMap = new Map();
      rows.forEach(row => {
        const key = row.subgroup_id ?? 'default';
        if (!sgMap.has(key)) sgMap.set(key, []);
        sgMap.get(key).push(row);
      });
      const subgroups = [...sgMap.entries()].map(([k, rws]) => {
        const n     = rws.reduce((s, r) => s + (r.sample_size ? parseFloat(r.sample_size) : 1), 0);
        const count = rws.reduce((s, r) => s + parseFloat(r.value), 0);
        labels.push(`SG ${k}`);
        return { count, n };
      });
      if (subgroups.length < 2) {
        return res.status(400).json({ error: 'Se necesitan al menos 2 subgrupos para la carta u.' });
      }
      chartData = spc.calculateUChart(subgroups);
      variableN = chartData.u.variableN;
    }

    // ── Aplicar reglas SPC (3 reglas) ──────────────────────────────────────
    const mainKey = { xbar_r: 'xbar', xbar_s: 'xbar', p: 'p', np: 'np', c: 'c', u: 'u' }[type];
    const main    = chartData[mainKey];

    // Para cartas con límites variables por punto, usar límites promedio para reglas
    const ruleUcl = main.ucl;
    const ruleLcl = main.lcl;
    const violations   = spc.applySPCRules(main.points, main.cl, ruleUcl, ruleLcl, ruleOpts);
    const outOfControl = [...new Set(violations.map(v => v.index))];

    res.json({
      process, chartData, violations, outOfControl, type, labels,
      variableN, simulated, simulate_n: simulated ? parseInt(simulate_n) : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular la carta de control.' });
  }
});

// GET /api/analysis/histogram?process_id=&bins=10
router.get('/histogram', async (req, res) => {
  const { process_id, bins = 10 } = req.query;
  if (!process_id) return res.status(400).json({ error: 'Se requiere process_id.' });

  try {
    const { process, rows } = await getProcessValues(process_id, req.user.company_id);
    if (!process) return res.status(404).json({ error: 'Proceso no encontrado.' });
    if (rows.length < 3) return res.status(400).json({ error: 'Se necesitan al menos 3 mediciones.' });

    const values = rows.map(r => parseFloat(r.value));
    const numBins = Math.min(Math.max(parseInt(bins), 5), 30);

    const histogram = spc.generateHistogramData(values, numBins);
    const xbar = spc.mean(values);
    const sigma = spc.stdDev(values);

    const rangeMin = Math.min(...values) - sigma;
    const rangeMax = Math.max(...values) + sigma;
    const normalCurve = spc.normalCurvePoints(xbar, sigma, rangeMin, rangeMax, 100);

    res.json({ process, histogram, normalCurve, xbar, sigma, n: values.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calcular el histograma.' });
  }
});

// GET /api/analysis/dashboard-summary (resumen para el dashboard)
router.get('/dashboard-summary', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.name, p.unit, p.usl, p.lsl, p.nominal,
              COUNT(m.id)::int as n
       FROM processes p
       LEFT JOIN measurements m ON m.process_id = p.id AND m.phase = 1
       WHERE p.company_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.user.company_id]
    );

    const summaries = await Promise.all(
      result.rows.map(async proc => {
        if (!proc.usl || !proc.lsl || proc.n < 2) {
          return { ...proc, cpk: null, status: 'sin_datos' };
        }
        const meas = await db.query(
          'SELECT value FROM measurements WHERE process_id=$1 AND company_id=$2 AND phase = 1 ORDER BY recorded_at DESC LIMIT 100',
          [proc.id, req.user.company_id]
        );
        const values = meas.rows.map(r => parseFloat(r.value));
        const cap = spc.calculateCapability(values, parseFloat(proc.usl), parseFloat(proc.lsl));
        return { ...proc, cpk: cap?.cpk ?? null, status: cap?.status ?? 'sin_datos' };
      })
    );

    res.json(summaries);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el resumen del dashboard.' });
  }
});

// GET /api/analysis/tests?process_id=
router.get('/tests', async (req, res) => {
  const { process_id } = req.query;
  if (!process_id) return res.status(400).json({ error: 'Se requiere process_id.' });

  try {
    const { process, rows } = await getProcessValues(process_id, req.user.company_id);
    if (!process) return res.status(404).json({ error: 'Proceso no encontrado.' });
    if (rows.length < 7) {
      return res.status(400).json({
        error: `Se necesitan al menos 7 mediciones para las pruebas estadísticas (hay ${rows.length}).`
      });
    }

    const results = spc.runStatisticalTests(rows);
    res.json({ process, ...results });
  } catch (err) {
    console.error('Error en pruebas estadísticas:', err);
    res.status(500).json({ error: 'Error al ejecutar las pruebas estadísticas.' });
  }
});

// POST /api/analysis/validate — prueba estadística sobre valores enviados directamente
router.post('/validate', async (req, res) => {
  const { values, subgroup_size } = req.body;

  if (!Array.isArray(values)) {
    return res.status(400).json({ error: 'values debe ser un arreglo.' });
  }
  if (values.length < 7) {
    return res.status(400).json({ error: 'Se necesitan al menos 7 valores para las pruebas estadísticas.' });
  }
  if (values.length > 2000) {
    return res.status(400).json({ error: 'Máximo 2000 valores por solicitud.' });
  }

  const nums = values.map(v => parseFloat(v)).filter(v => !isNaN(v) && isFinite(v));
  if (nums.length < 7) {
    return res.status(400).json({ error: 'Se necesitan al menos 7 valores numéricos válidos.' });
  }

  const n = subgroup_size && parseInt(subgroup_size) >= 2
    ? Math.min(parseInt(subgroup_size), 10)
    : 0;

  const rows = nums.map((v, i) => ({
    value:       v,
    subgroup_id: n ? Math.floor(i / n) + 1 : null
  }));

  try {
    const results = spc.runStatisticalTests(rows);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al ejecutar las pruebas estadísticas.' });
  }
});

module.exports = router;
