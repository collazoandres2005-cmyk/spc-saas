'use strict';

// ── Factores d₂ (estimación σ desde R̄ dentro de subgrupos) ──────────────
const D2 = { 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078 };

// ── Constantes para cartas X̄-R ────────────────────────────────────────────
const XBAR_R = {
  2:  { A2: 1.880, D3: 0,     D4: 3.267 },
  3:  { A2: 1.023, D3: 0,     D4: 2.574 },
  4:  { A2: 0.729, D3: 0,     D4: 2.282 },
  5:  { A2: 0.577, D3: 0,     D4: 2.114 },
  6:  { A2: 0.483, D3: 0,     D4: 2.004 },
  7:  { A2: 0.419, D3: 0.076, D4: 1.924 },
  8:  { A2: 0.373, D3: 0.136, D4: 1.864 },
  9:  { A2: 0.337, D3: 0.184, D4: 1.816 },
  10: { A2: 0.308, D3: 0.223, D4: 1.777 }
};

// ── Constantes para cartas X̄-S ────────────────────────────────────────────
const XBAR_S = {
  2:  { A3: 2.659, B3: 0,     B4: 3.267 },
  3:  { A3: 1.954, B3: 0,     B4: 2.568 },
  4:  { A3: 1.628, B3: 0,     B4: 2.266 },
  5:  { A3: 1.427, B3: 0,     B4: 2.089 },
  6:  { A3: 1.287, B3: 0.030, B4: 1.970 },
  7:  { A3: 1.182, B3: 0.118, B4: 1.882 },
  8:  { A3: 1.099, B3: 0.185, B4: 1.815 },
  9:  { A3: 1.032, B3: 0.239, B4: 1.761 },
  10: { A3: 0.975, B3: 0.284, B4: 1.716 }
};

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// Aproximación polinómica de la CDF normal estándar (Abramowitz & Stegun)
function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-(z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z > 0 ? 1 - p : p;
}

// ── Indicadores de capacidad ───────────────────────────────────────────────
function calculateCapability(values, usl, lsl, nominal) {
  const xbar = mean(values);
  const sigma = stdDev(values);

  if (sigma === 0) return null;

  const cp  = (usl - lsl) / (6 * sigma);
  const cpu = (usl - xbar) / (3 * sigma);
  const cpl = (xbar - lsl) / (3 * sigma);
  const cpk = Math.min(cpu, cpl);

  const zUpper = (usl - xbar) / sigma;
  const zLower = (xbar - lsl) / sigma;
  const ppmUpper = normalCDF(-zUpper) * 1_000_000;
  const ppmLower = normalCDF(-zLower) * 1_000_000;
  const ppmTotal = ppmUpper + ppmLower;

  let status;
  if (cpk < 1.0)       status = 'no_capaz';
  else if (cpk < 1.33) status = 'marginal';
  else                  status = 'capaz';

  const nom = (nominal != null && !isNaN(parseFloat(nominal))) ? parseFloat(nominal) : null;

  return {
    xbar:  round(xbar,  4),
    sigma: round(sigma, 4),
    cp:    round(cp,    3),
    cpu:   round(cpu,   3),
    cpl:   round(cpl,   3),
    cpk:   round(cpk,   3),
    ppmUpper: round(ppmUpper, 2),
    ppmLower: round(ppmLower, 2),
    ppmTotal: round(ppmTotal, 2),
    status,
    n:            values.length,
    tolerance:    round(usl - lsl, 4),
    distToUsl:    round(usl - xbar, 4),
    distToLsl:    round(xbar - lsl, 4),
    distToNominal: nom != null ? round(Math.abs(xbar - nom), 4) : null
  };
}

// ── Capacidad desde subgrupos (σ̂_w = R̄/d₂) ───────────────────────────────
function calculateCapabilityFromSubgroups(subgroups, usl, lsl, nominal) {
  const n = subgroups[0].length;
  const allValues = subgroups.flat();
  const xbar   = mean(allValues);
  const ranges = subgroups.map(sg => Math.max(...sg) - Math.min(...sg));
  const rBar   = mean(ranges);
  const d2     = D2[n] || D2[5];
  const sigmaW = rBar / d2;
  if (sigmaW === 0) return null;

  const sigmaTotal = stdDev(allValues);
  const cp  = (usl - lsl) / (6 * sigmaW);
  const cpu = (usl - xbar) / (3 * sigmaW);
  const cpl = (xbar - lsl) / (3 * sigmaW);
  const cpk = Math.min(cpu, cpl);

  const zUpper   = (usl - xbar) / sigmaW;
  const zLower   = (xbar - lsl) / sigmaW;
  const ppmUpper = normalCDF(-zUpper) * 1_000_000;
  const ppmLower = normalCDF(-zLower) * 1_000_000;
  const ppmTotal = ppmUpper + ppmLower;

  let status;
  if (cpk < 1.0)       status = 'no_capaz';
  else if (cpk < 1.33) status = 'marginal';
  else                  status = 'capaz';

  const nom = (nominal != null && !isNaN(parseFloat(nominal))) ? parseFloat(nominal) : null;

  return {
    xbar:          round(xbar,       4),
    sigma:         round(sigmaW,     4),
    sigmaTotal:    round(sigmaTotal, 4),
    sigmaMethod:   'within',
    cp:            round(cp,  3),
    cpu:           round(cpu, 3),
    cpl:           round(cpl, 3),
    cpk:           round(cpk, 3),
    ppmUpper:      round(ppmUpper, 2),
    ppmLower:      round(ppmLower, 2),
    ppmTotal:      round(ppmTotal, 2),
    status,
    n:             allValues.length,
    n_subgroups:   subgroups.length,
    subgroup_size: n,
    tolerance:     round(usl - lsl, 4),
    distToUsl:     round(usl - xbar, 4),
    distToLsl:     round(xbar - lsl, 4),
    distToNominal: nom != null ? round(Math.abs(xbar - nom), 4) : null
  };
}

// ── Carta X̄-R ──────────────────────────────────────────────────────────────
function calculateXbarR(subgroups) {
  const means  = subgroups.map(sg => mean(sg));
  const ranges = subgroups.map(sg => Math.max(...sg) - Math.min(...sg));

  const xbarBar = mean(means);
  const rBar    = mean(ranges);
  const n = subgroups[0].length;
  const c = XBAR_R[n] || XBAR_R[5];

  return {
    xbar: {
      points: means.map(v => round(v, 4)),
      cl:     round(xbarBar, 4),
      ucl:    round(xbarBar + c.A2 * rBar, 4),
      lcl:    round(xbarBar - c.A2 * rBar, 4)
    },
    r: {
      points: ranges.map(v => round(v, 4)),
      cl:     round(rBar, 4),
      ucl:    round(c.D4 * rBar, 4),
      lcl:    round(c.D3 * rBar, 4)
    }
  };
}

// ── Carta X̄-S ──────────────────────────────────────────────────────────────
function calculateXbarS(subgroups) {
  const means  = subgroups.map(sg => mean(sg));
  const stdevs = subgroups.map(sg => stdDev(sg));

  const xbarBar = mean(means);
  const sBar    = mean(stdevs);
  const n = subgroups[0].length;
  const c = XBAR_S[n] || XBAR_S[5];

  return {
    xbar: {
      points: means.map(v => round(v, 4)),
      cl:     round(xbarBar, 4),
      ucl:    round(xbarBar + c.A3 * sBar, 4),
      lcl:    round(xbarBar - c.A3 * sBar, 4)
    },
    s: {
      points: stdevs.map(v => round(v, 4)),
      cl:     round(sBar, 4),
      ucl:    round(c.B4 * sBar, 4),
      lcl:    round(c.B3 * sBar, 4)
    }
  };
}

// ── Carta I-MR ─────────────────────────────────────────────────────────────
function calculateIMR(values) {
  const xbar = mean(values);
  const mrs  = [];
  for (let i = 1; i < values.length; i++) {
    mrs.push(Math.abs(values[i] - values[i - 1]));
  }
  const mrBar = mean(mrs);

  return {
    i: {
      points: values.map(v => round(v, 4)),
      cl:     round(xbar, 4),
      ucl:    round(xbar + 2.66 * mrBar, 4),
      lcl:    round(xbar - 2.66 * mrBar, 4)
    },
    mr: {
      points: mrs.map(v => round(v, 4)),
      cl:     round(mrBar, 4),
      ucl:    round(3.267 * mrBar, 4),
      lcl:    0
    }
  };
}

// ── Reglas de Nelson ───────────────────────────────────────────────────────
function applyNelsonRules(points, cl, ucl, lcl) {
  const violations = [];
  const seen = new Set();

  const addViolation = (index, rule, desc) => {
    const key = `${index}-${rule}`;
    if (!seen.has(key)) {
      seen.add(key);
      violations.push({ index, rule, description: desc });
    }
  };

  for (let i = 0; i < points.length; i++) {
    // Regla 1: un punto fuera de ±3σ
    if (points[i] > ucl || points[i] < lcl) {
      addViolation(i, 1, 'Punto fuera de ±3σ (límites de control)');
    }

    // Regla 2: 9 puntos consecutivos del mismo lado de LC
    if (i >= 8) {
      const w = points.slice(i - 8, i + 1);
      if (w.every(p => p > cl) || w.every(p => p < cl)) {
        addViolation(i, 2, '9 puntos consecutivos del mismo lado de la línea central');
      }
    }

    // Regla 3: 6 puntos consecutivos en tendencia monótona
    if (i >= 5) {
      const w = points.slice(i - 5, i + 1);
      let asc = true, desc2 = true;
      for (let j = 1; j < w.length; j++) {
        if (w[j] <= w[j - 1]) asc = false;
        if (w[j] >= w[j - 1]) desc2 = false;
      }
      if (asc || desc2) {
        addViolation(i, 3, '6 puntos consecutivos en tendencia monótona');
      }
    }

    // Regla 4: 14 puntos alternando arriba/abajo
    if (i >= 13) {
      const w = points.slice(i - 13, i + 1);
      let alt = true;
      for (let j = 1; j < w.length; j++) {
        const cur  = w[j] - w[j - 1];
        const prev = j > 1 ? w[j - 1] - w[j - 2] : -cur;
        if (cur * prev >= 0) { alt = false; break; }
      }
      if (alt) {
        addViolation(i, 4, '14 puntos alternando hacia arriba y hacia abajo');
      }
    }
  }

  return violations;
}

// ── Histograma ─────────────────────────────────────────────────────────────
function generateHistogramData(values, bins = 10) {
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const w = range / bins;

  const labels = [];
  const midpoints = [];
  const frequencies = Array(bins).fill(0);

  for (let i = 0; i < bins; i++) {
    const lo = minV + i * w;
    const hi = lo + w;
    labels.push(`${lo.toFixed(3)}`);
    midpoints.push(round((lo + hi) / 2, 4));
    frequencies[i] = values.filter(v =>
      i === bins - 1 ? v >= lo && v <= hi : v >= lo && v < hi
    ).length;
  }

  return { labels, midpoints, frequencies, binWidth: round(w, 4), min: minV, max: maxV };
}

// ── Curva normal para superposición ───────────────────────────────────────
function normalCurvePoints(xbar, sigma, min, max, steps = 100) {
  const step = (max - min) / steps;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const x = min + i * step;
    const y = (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - xbar) / sigma) ** 2);
    points.push({ x: round(x, 4), y: round(y, 6) });
  }
  return points;
}

function round(v, d) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

// ══════════════════════════════════════════════════════════════════════════
// PRUEBAS ESTADÍSTICAS
// ══════════════════════════════════════════════════════════════════════════

// ── Helpers matemáticos ───────────────────────────────────────────────────

// Logaritmo de la función gamma (Lanczos g=7)
function _gammaLn(x) {
  const p = [
    0.99999999999980993,  676.5203681218851,  -1259.1392167224028,
    771.32342877765313, -176.61502916214059,    12.507343278686905,
    -0.13857109526572012,  9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - _gammaLn(1 - x);
  x -= 1;
  let a = p[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += p[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Función gamma incompleta regularizada P(a,x) — inferior
// Serie para x < a+1; fracción continua de Lentz para x ≥ a+1
function _gammaRegP(a, x) {
  if (x <= 0) return 0;
  const EPS = 1e-13, FPMIN = 1e-300;
  if (x < a + 1) {
    let term = 1 / a, sum = term;
    for (let n = 1; n < 300; n++) {
      term *= x / (a + n); sum += term;
      if (Math.abs(term) < EPS * Math.abs(sum)) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - _gammaLn(a)));
  }
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let n = 1; n <= 300; n++) {
    const an = -n * (n - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;  if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - _gammaLn(a)) * h);
}

// Función beta incompleta regularizada I_x(a,b) — fracción continua modificada
function _betaRegI(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - _betaRegI(1 - x, b, a);
  const lbeta = _gammaLn(a) + _gammaLn(b) - _gammaLn(a + b);
  const front  = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;
  const EPS = 1e-13, FPMIN = 1e-300;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;  if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;  if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.max(0, Math.min(1, front * h));
}

// p-valor chi-cuadrado: P(χ² > x | df)
function _chiSqP(chi2, df) {
  if (chi2 <= 0) return 1;
  return Math.max(0, 1 - _gammaRegP(df / 2, chi2 / 2));
}

// p-valor F: P(F > f | df1, df2)
function _fP(f, df1, df2) {
  if (f <= 0) return 1;
  return Math.max(0, 1 - _betaRegI(df1 * f / (df1 * f + df2), df1 / 2, df2 / 2));
}

// ── Prueba de normalidad: Anderson-Darling ────────────────────────────────
// H₀: los datos provienen de una distribución normal (parámetros estimados)
// Corrección y p-valor: Stephens (1974)
function andersonDarlingTest(values) {
  const n = values.length;
  if (n < 7) {
    return { available: false, reason: `Se necesitan al menos 7 observaciones (n = ${n}).` };
  }
  const mu = mean(values);
  const s  = stdDev(values);
  if (s === 0) {
    return { available: false, reason: 'Desviación estándar = 0; todos los valores son idénticos.' };
  }

  const sorted = [...values].sort((a, b) => a - b);
  let S = 0;
  for (let i = 0; i < n; i++) {
    const z1 =  (sorted[i]     - mu) / s;
    const z2 =  (sorted[n-1-i] - mu) / s;
    const p1 = Math.max(normalCDF(z1),       1e-15);
    const p2 = Math.max(1 - normalCDF(z2),   1e-15);
    S += (2 * (i + 1) - 1) * (Math.log(p1) + Math.log(p2));
  }

  const A2raw = -n - S / n;
  // Corrección de Stephens (1974) para parámetros estimados de la muestra
  const A2 = A2raw * (1 + 0.75 / n + 2.25 / (n * n));

  let p;
  if      (A2 < 0.200) p = 1 - Math.exp(-13.436 + 101.14 * A2 - 223.73 * A2 * A2);
  else if (A2 < 0.340) p = 1 - Math.exp( -8.318 +  42.796 * A2 -  59.938 * A2 * A2);
  else if (A2 < 0.600) p =     Math.exp(  0.9177 -   4.279 * A2 -   1.38  * A2 * A2);
  else if (A2 < 13)    p =     Math.exp(  1.2937 -   5.709 * A2 +  0.0186 * A2 * A2);
  else                 p = 0;
  p = Math.min(1, Math.max(0, p));

  return {
    available:  true,
    test:       'Anderson-Darling',
    h0:         'Los datos provienen de una distribución normal',
    statistic:  round(A2, 4),
    p_value:    round(p,  4),
    n,
    normal:     p > 0.05,
    result:     p > 0.05 ? 'No se rechaza H₀' : 'Se rechaza H₀',
    interpretation: p > 0.05
      ? `Con p = ${round(p,4)} > 0.05, los datos son consistentes con normalidad.`
      : `Con p = ${round(p,4)} ≤ 0.05, los datos NO siguen una distribución normal.`
  };
}

// ── Prueba de homocedasticidad: Levene (variante Brown-Forsythe) ──────────
// H₀: las varianzas de todos los grupos son iguales
// Usa la mediana como medida de centralidad (más robusta ante no-normalidad)
function levenesTest(groups) {
  const k = groups.length;
  if (k < 2) return { available: false, reason: 'Se necesitan al menos 2 grupos.' };
  if (groups.some(g => g.length < 2)) {
    return { available: false, reason: 'Cada grupo necesita al menos 2 observaciones.' };
  }

  const N = groups.reduce((s, g) => s + g.length, 0);

  const medians = groups.map(g => {
    const sorted = [...g].sort((a, b) => a - b);
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
  });

  const Z      = groups.map((g, i) => g.map(v => Math.abs(v - medians[i])));
  const Zi_bar = Z.map(zg => mean(zg));
  const Z_bar  = mean(Z.flat());

  const num = (N - k) * Z.reduce((s, zg, i) =>
    s + zg.length * (Zi_bar[i] - Z_bar) ** 2, 0);
  const den = (k - 1) * Z.reduce((s, zg, i) =>
    s + zg.reduce((ss, z) => ss + (z - Zi_bar[i]) ** 2, 0), 0);

  if (den === 0) return { available: false, reason: 'Sin varianza suficiente para el cálculo.' };

  const W = num / den;
  const p = _fP(W, k - 1, N - k);

  return {
    available:     true,
    test:          'Levene (Brown-Forsythe)',
    h0:            'Las varianzas de todos los grupos son iguales',
    statistic:     round(W, 4),
    p_value:       round(p, 4),
    df1:           k - 1,
    df2:           N - k,
    n_groups:      k,
    homoscedastic: p > 0.05,
    result:        p > 0.05 ? 'No se rechaza H₀' : 'Se rechaza H₀',
    interpretation: p > 0.05
      ? `Con p = ${round(p,4)} > 0.05, las varianzas son homogéneas en los ${k} grupos.`
      : `Con p = ${round(p,4)} ≤ 0.05, las varianzas NO son homogéneas entre los ${k} grupos.`
  };
}

// ── Prueba de homogeneidad de medias: Kruskal-Wallis ─────────────────────
// H₀: las medianas de todos los grupos son iguales
// Equivalente no paramétrico de ANOVA de una vía; incluye corrección por empates
function kruskalWallisTest(groups) {
  const k = groups.length;
  if (k < 2) return { available: false, reason: 'Se necesitan al menos 2 grupos.' };
  if (groups.some(g => g.length < 2)) {
    return { available: false, reason: 'Cada grupo necesita al menos 2 observaciones.' };
  }

  const N   = groups.reduce((s, g) => s + g.length, 0);
  const all = groups.flatMap((g, gi) => g.map(v => ({ v, gi })));
  all.sort((a, b) => a.v - b.v);

  // Rangos con empates promediados
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j < all.length - 1 && all[j + 1].v === all[j].v) j++;
    const r = (i + j + 2) / 2;
    for (let m = i; m <= j; m++) all[m].r = r;
    i = j + 1;
  }

  const Ri = Array(k).fill(0);
  all.forEach(({ gi, r }) => (Ri[gi] += r));

  const H = (12 / (N * (N + 1))) *
    Ri.reduce((s, r, gi) => s + r * r / groups[gi].length, 0) - 3 * (N + 1);

  // Factor de corrección por empates
  const freq = {};
  all.forEach(({ v }) => { freq[v] = (freq[v] || 0) + 1; });
  const tieC = 1 - Object.values(freq)
    .filter(t => t > 1)
    .reduce((s, t) => s + (t ** 3 - t), 0) / (N ** 3 - N);

  const H_adj = tieC > 0 ? H / tieC : H;
  const p     = _chiSqP(H_adj, k - 1);

  return {
    available:   true,
    test:        'Kruskal-Wallis',
    h0:          'Las medianas de todos los grupos son iguales',
    statistic:   round(H_adj, 4),
    p_value:     round(p,     4),
    df:          k - 1,
    n_groups:    k,
    homogeneous: p > 0.05,
    result:      p > 0.05 ? 'No se rechaza H₀' : 'Se rechaza H₀',
    interpretation: p > 0.05
      ? `Con p = ${round(p,4)} > 0.05, las medianas son homogéneas en los ${k} grupos.`
      : `Con p = ${round(p,4)} ≤ 0.05, existen diferencias significativas entre los ${k} grupos.`
  };
}

// ── Ejecuta todas las pruebas pertinentes según los datos disponibles ──────
function runStatisticalTests(rows) {
  const values = rows.map(r => parseFloat(r.value));
  const normality = andersonDarlingTest(values);

  const sgMap = new Map();
  rows.forEach(r => {
    const key = r.subgroup_id != null ? r.subgroup_id : '__solo__';
    if (!sgMap.has(key)) sgMap.set(key, []);
    sgMap.get(key).push(parseFloat(r.value));
  });

  const hasGroups = !(sgMap.size === 1 && sgMap.has('__solo__'));
  const groups    = hasGroups
    ? [...sgMap.entries()].filter(([k]) => k !== '__solo__').map(([, g]) => g).filter(g => g.length >= 2)
    : [];

  const noGroups = { available: false, reason: 'Se requieren al menos 2 subgrupos con ≥ 2 observaciones cada uno.' };

  return {
    n_total:         values.length,
    n_subgroups:     groups.length,
    normality,
    homoscedasticity: groups.length >= 2 ? levenesTest(groups)       : noGroups,
    homogeneity:      groups.length >= 2 ? kruskalWallisTest(groups) : noGroups
  };
}

// ══════════════════════════════════════════════════════════════════════════
// CARTAS DE ATRIBUTOS
// ══════════════════════════════════════════════════════════════════════════

// ── Carta p — proporción de no conformes (n variable o fijo) ──────────────
// subgroups: [{ defectives: number, n: number }, ...]
function calculatePChart(subgroups) {
  const totalDef = subgroups.reduce((s, sg) => s + sg.defectives, 0);
  const totalN   = subgroups.reduce((s, sg) => s + sg.n,         0);
  const pBar     = totalN > 0 ? totalDef / totalN : 0;

  const pointData = subgroups.map(sg => {
    const p   = sg.n > 0 ? sg.defectives / sg.n : 0;
    const std = Math.sqrt(pBar * (1 - pBar) / sg.n);
    const ucl = Math.min(1, pBar + 3 * std);
    const lcl = Math.max(0, pBar - 3 * std);
    return { value: round(p, 4), n: sg.n, ucl: round(ucl, 4), lcl: round(lcl, 4) };
  });

  const variableN = new Set(subgroups.map(sg => sg.n)).size > 1;

  return {
    p: {
      points:      pointData.map(p => p.value),
      pointLimits: pointData.map(p => ({ ucl: p.ucl, lcl: p.lcl, n: p.n })),
      cl:          round(pBar, 4),
      ucl:         round(mean(pointData.map(p => p.ucl)), 4),
      lcl:         round(mean(pointData.map(p => p.lcl)), 4),
      variableN
    }
  };
}

// ── Carta np — número de no conformes (n fijo) ────────────────────────────
// subgroups: [{ defectives: number }, ...]   nFixed: tamaño de muestra constante
function calculateNPChart(subgroups, nFixed) {
  const counts = subgroups.map(sg => sg.defectives);
  const npBar  = mean(counts);
  const pBar   = npBar / nFixed;
  const std    = Math.sqrt(nFixed * pBar * (1 - pBar));
  const ucl    = Math.min(nFixed, npBar + 3 * std);
  const lcl    = Math.max(0,      npBar - 3 * std);

  return {
    np: {
      points:    counts.map(v => round(v, 0)),
      cl:        round(npBar, 4),
      ucl:       round(ucl,   4),
      lcl:       round(lcl,   4),
      n:         nFixed,
      variableN: false
    }
  };
}

// ── Carta c — número de defectos (área de oportunidad constante) ──────────
// subgroups: [{ count: number }, ...]
function calculateCChart(subgroups) {
  const counts = subgroups.map(sg => sg.count);
  const cBar   = mean(counts);
  const std    = Math.sqrt(cBar);
  const ucl    = cBar + 3 * std;
  const lcl    = Math.max(0, cBar - 3 * std);

  return {
    c: {
      points:    counts.map(v => round(v, 0)),
      cl:        round(cBar, 4),
      ucl:       round(ucl,  4),
      lcl:       round(lcl,  4),
      variableN: false
    }
  };
}

// ── Carta u — defectos por unidad de inspección (n variable) ─────────────
// subgroups: [{ count: number, n: number }, ...]
function calculateUChart(subgroups) {
  const totalDef = subgroups.reduce((s, sg) => s + sg.count, 0);
  const totalN   = subgroups.reduce((s, sg) => s + sg.n,     0);
  const uBar     = totalN > 0 ? totalDef / totalN : 0;

  const pointData = subgroups.map(sg => {
    const u   = sg.n > 0 ? sg.count / sg.n : 0;
    const std = Math.sqrt(uBar / sg.n);
    const ucl = uBar + 3 * std;
    const lcl = Math.max(0, uBar - 3 * std);
    return { value: round(u, 4), n: sg.n, ucl: round(ucl, 4), lcl: round(lcl, 4) };
  });

  const variableN = new Set(subgroups.map(sg => sg.n)).size > 1;

  return {
    u: {
      points:      pointData.map(p => p.value),
      pointLimits: pointData.map(p => ({ ucl: p.ucl, lcl: p.lcl, n: p.n })),
      cl:          round(uBar, 4),
      ucl:         round(mean(pointData.map(p => p.ucl)), 4),
      lcl:         round(mean(pointData.map(p => p.lcl)), 4),
      variableN
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════
// REGLAS SPC SIMPLIFICADAS (3 reglas industriales configurables)
// ══════════════════════════════════════════════════════════════════════════

// options: { detectOutOfControl, detectTrend, detectShift }
// Severity: 'critical' | 'warning'
function applySPCRules(points, cl, ucl, lcl, options = {}) {
  const {
    detectOutOfControl = true,
    detectTrend        = true,
    detectShift        = true
  } = options;

  const violations = [];
  const seen       = new Set();

  const add = (index, rule, desc, severity) => {
    const key = `${index}-${rule}`;
    if (!seen.has(key)) {
      seen.add(key);
      violations.push({ index, rule, description: desc, severity });
    }
  };

  for (let i = 0; i < points.length; i++) {
    // Regla 1: punto fuera de límites de control (±3σ)
    if (detectOutOfControl && (points[i] > ucl || points[i] < lcl)) {
      add(i, 'ooc',
        `Punto ${i + 1} fuera de los límites de control estadístico`,
        'critical');
    }

    // Regla 2: tendencia — 6 puntos estrictamente crecientes o decrecientes
    if (detectTrend && i >= 5) {
      const w = points.slice(i - 5, i + 1);
      let asc = true, dec = true;
      for (let j = 1; j < w.length; j++) {
        if (w[j] <= w[j - 1]) asc = false;
        if (w[j] >= w[j - 1]) dec = false;
      }
      if (asc || dec) {
        add(i, 'trend',
          `Tendencia de 6 puntos consecutivos ${asc ? 'ascendente' : 'descendente'} (obs. ${i - 4}–${i + 1})`,
          'warning');
      }
    }

    // Regla 3: corrimiento — 8 puntos consecutivos al mismo lado de la LC
    if (detectShift && i >= 7) {
      const w = points.slice(i - 7, i + 1);
      const above = w.every(p => p > cl);
      const below = w.every(p => p < cl);
      if (above || below) {
        add(i, 'shift',
          `8 puntos consecutivos ${above ? 'sobre' : 'bajo'} la línea central (obs. ${i - 6}–${i + 1})`,
          'warning');
      }
    }
  }

  return violations;
}

module.exports = {
  mean,
  stdDev,
  normalCDF,
  calculateCapability,
  calculateCapabilityFromSubgroups,
  calculateXbarR,
  calculateXbarS,
  calculateIMR,
  calculatePChart,
  calculateNPChart,
  calculateCChart,
  calculateUChart,
  applyNelsonRules,
  applySPCRules,
  generateHistogramData,
  normalCurvePoints,
  andersonDarlingTest,
  levenesTest,
  kruskalWallisTest,
  runStatisticalTests
};
