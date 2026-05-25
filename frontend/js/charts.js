/* Funciones de gráficos con Chart.js */

const COLORS = {
  blue:    '#1761b0',
  red:     '#b91c1c',
  green:   '#15803d',
  amber:   '#b45309',
  gray:    '#667085',
  navy:    '#e2e8f0',
  cl:      '#1761b0',
  ucl:     '#b91c1c',
  lcl:     '#b91c1c',
  point:   '#a78bfa',
  outCtrl: '#f87171',
  normal:  'rgba(167,139,250,0.18)'
};

const _FONT_DATA = "'JetBrains Mono', 'Consolas', 'Courier New', monospace";
const _FONT_UI   = "'Inter', 'Segoe UI', system-ui, sans-serif";

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index',
      intersect: false,
      backgroundColor: '#1a1040',
      titleColor: '#e2e8f0',
      bodyColor: '#cbd5e1',
      borderColor: 'rgba(255,255,255,.10)',
      borderWidth: 1,
      padding: 10,
      titleFont: { family: _FONT_UI, size: 11 },
      bodyFont:  { family: _FONT_DATA, size: 11 }
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,.06)' },
      ticks: { color: '#94a3b8', font: { family: _FONT_UI, size: 11 }, maxTicksLimit: 20 }
    },
    y: {
      grid: { color: 'rgba(255,255,255,.06)' },
      ticks: { color: '#94a3b8', font: { family: _FONT_DATA, size: 11 } }
    }
  },
  elements: {
    point: { radius: 4, hoverRadius: 6, borderWidth: 2 },
    line:  { tension: 0.1, borderWidth: 2 }
  }
};

function limitLine(points, value, color, label, dash = [], width = 2) {
  return {
    label,
    data: points.map(() => value),
    borderColor: color,
    borderWidth: width,
    borderDash: dash,
    pointRadius: 0,
    fill: false
  };
}

/* ── Zonas de control (±1σ, ±2σ) como bandas de fondo ── */
function buildControlZones(cl, ucl) {
  const sigma = (ucl - cl) / 3;
  if (!sigma || sigma <= 0) return {};
  return {
    zone2: {
      type: 'box',
      yMin: cl - 2 * sigma, yMax: cl + 2 * sigma,
      backgroundColor: 'rgba(234,179,8,0.05)',
      borderWidth: 0
    },
    zone1: {
      type: 'box',
      yMin: cl - sigma, yMax: cl + sigma,
      backgroundColor: 'rgba(34,197,94,0.08)',
      borderWidth: 0
    }
  };
}

/* ── Carta de control principal (I, X̄) ─────────────────── */
function renderControlChart(canvasId, chartData, outOfControl = [], labels = []) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const mainKey  = chartData.i ? 'i' : 'xbar';
  const mainData = chartData[mainKey];

  const pointColors   = mainData.points.map((_, i) =>
    outOfControl.includes(i) ? COLORS.outCtrl : COLORS.point);
  const pointBgColors = mainData.points.map((_, i) =>
    outOfControl.includes(i) ? 'rgba(248,113,113,0.2)' : 'rgba(167,139,250,0.2)');
  const pointRadii    = mainData.points.map((_, i) =>
    outOfControl.includes(i) ? 8 : 4);
  const pointBorderW  = mainData.points.map((_, i) =>
    outOfControl.includes(i) ? 3 : 2);

  const axisLabels = labels.length ? labels : mainData.points.map((_, i) => `${i + 1}`);

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: axisLabels,
      datasets: [
        limitLine(mainData.points, mainData.ucl, COLORS.ucl, 'LCS', [], 2.5),
        limitLine(mainData.points, mainData.cl,  COLORS.cl,  'LC',  [8, 4], 1.5),
        limitLine(mainData.points, mainData.lcl, COLORS.lcl, 'LCI', [], 2.5),
        {
          label: mainKey === 'i' ? 'Individual' : 'Media (X̄)',
          data: mainData.points,
          borderColor: COLORS.navy,
          borderWidth: 2,
          backgroundColor: pointBgColors,
          pointBackgroundColor: pointBgColors,
          pointBorderColor: pointColors,
          pointRadius: pointRadii,
          pointHoverRadius: pointRadii.map(r => r + 2),
          pointBorderWidth: pointBorderW,
          fill: false
        }
      ]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: {
          display: true,
          position: 'top',
          labels: { usePointStyle: true, boxWidth: 8, font: { family: _FONT_UI, size: 11 }, color: '#e2e8f0' }
        },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(4)}`,
            afterBody: items => {
              const idx = items[0]?.dataIndex;
              return (idx != null && outOfControl.includes(idx))
                ? ['⚠ Punto fuera de control estadístico'] : [];
            }
          }
        },
        annotation: {
          annotations: buildControlZones(mainData.cl, mainData.ucl)
        }
      }
    }
  });
}

/* ── Carta secundaria (MR, R, S) ────────────────────────── */
function renderSecondaryChart(canvasId, chartData, labels = []) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const secKey  = chartData.mr ? 'mr' : chartData.r ? 'r' : 's';
  const secData = chartData[secKey];
  if (!secData) return null;

  const secLabelMap = { mr: 'Rango Móvil', r: 'Rango', s: 'Desv. Estándar' };
  const axisLabels  = labels.length
    ? labels.slice(secKey === 'mr' ? 1 : 0)
    : secData.points.map((_, i) => `${i + 1}`);

  const sigma    = (secData.ucl - secData.cl) / 3;
  const ptColors = secData.points.map(v =>
    v > secData.ucl ? COLORS.red : v > secData.cl + 2 * sigma ? '#c2410c' : COLORS.amber);
  const ptBg     = secData.points.map(v =>
    v > secData.ucl ? '#fee2e2' : 'rgba(180,83,9,0.10)');
  const ptRadii  = secData.points.map(v => v > secData.ucl ? 7 : 4);
  const ptBorderW = secData.points.map(v => v > secData.ucl ? 3 : 2);

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: axisLabels,
      datasets: [
        limitLine(secData.points, secData.ucl, COLORS.ucl, 'LCS', [], 2.5),
        limitLine(secData.points, secData.cl,  COLORS.cl,  'LC',  [8, 4], 1.5),
        ...(secData.lcl > 0
          ? [limitLine(secData.points, secData.lcl, COLORS.lcl, 'LCI', [], 2)]
          : []),
        {
          label: secLabelMap[secKey] || secKey,
          data: secData.points,
          borderColor: COLORS.amber,
          borderWidth: 2,
          backgroundColor: ptBg,
          pointBackgroundColor: ptBg,
          pointBorderColor: ptColors,
          pointRadius: ptRadii,
          pointHoverRadius: ptRadii.map(r => r + 2),
          pointBorderWidth: ptBorderW,
          fill: false
        }
      ]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: {
          display: true,
          position: 'top',
          labels: { usePointStyle: true, boxWidth: 8, font: { family: _FONT_UI, size: 11 }, color: '#e2e8f0' }
        },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(4)}`
          }
        },
        annotation: {
          annotations: buildControlZones(secData.cl, secData.ucl)
        }
      }
    }
  });
}

/* ── Gráfico de capacidad + histograma combinado ─────────
   Muestra las barras del histograma (densidad) con la
   curva normal encima, en el mismo eje Y de densidad.    */
function renderCapabilityChart(canvasId, usl, lsl, nominal, xbar, sigma, histogram = null) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const nomVal = (nominal != null && !isNaN(nominal)) ? nominal : xbar;
  const spread = Math.max(
    usl != null ? Math.abs(usl - nomVal) : 0,
    lsl != null ? Math.abs(lsl - nomVal) : 0,
    4 * sigma
  );
  const xMin = nomVal - spread * 1.35;
  const xMax = nomVal + spread * 1.35;

  // Normal curve (density)
  const pts = [];
  for (let i = 0; i <= 160; i++) {
    const x = xMin + i * (xMax - xMin) / 160;
    const y = (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - xbar) / sigma) ** 2);
    pts.push({ x, y });
  }
  const yMaxCurve = Math.max(...pts.map(p => p.y)) * 1.25;

  const datasets = [];

  // Histogram bars scaled to density (freq / n / binWidth)
  if (histogram) {
    const { midpoints, frequencies, binWidth } = histogram;
    const totalN = frequencies.reduce((a, b) => a + b, 0);

    const barBg  = (midpoints || []).map(x =>
      (lsl != null && x < lsl) || (usl != null && x > usl)
        ? 'rgba(185,28,28,0.35)' : 'rgba(23,97,176,0.25)');
    const barBrd = (midpoints || []).map(x =>
      (lsl != null && x < lsl) || (usl != null && x > usl)
        ? 'rgba(185,28,28,0.70)' : 'rgba(23,97,176,0.55)');

    const densityData = (midpoints || []).map((x, i) => ({
      x,
      y: (totalN > 0 && binWidth > 0) ? frequencies[i] / (totalN * binWidth) : 0
    }));

    datasets.push({
      type: 'bar',
      label: 'Distribución observada',
      data: densityData,
      parsing: false,
      backgroundColor: barBg,
      borderColor: barBrd,
      borderWidth: 1.5,
      borderRadius: 4,
      barPercentage: 1.0,
      categoryPercentage: 1.0,
      order: 2
    });
  }

  // Normal curve on top
  datasets.push({
    type: 'line',
    label: 'Distribución Normal teórica',
    data: pts,
    parsing: false,
    borderColor: '#a78bfa',
    borderWidth: 2.5,
    fill: 'origin',
    pointRadius: 0,
    tension: 0.4,
    order: 1,
    segment: {
      backgroundColor: ctx2 => {
        const x = pts[ctx2.p1DataIndex]?.x ?? 0;
        if ((lsl != null && x < lsl) || (usl != null && x > usl))
          return 'rgba(185,28,28,0.15)';
        return 'rgba(23,97,176,0.09)';
      }
    }
  });

  return new Chart(ctx, {
    type: 'bar',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { usePointStyle: true, boxWidth: 8, font: { family: _FONT_UI, size: 11 }, color: '#e2e8f0' }
        },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => {
              const v = ctx.raw?.y ?? ctx.raw;
              return `${ctx.dataset.label}: ${Number(v).toFixed(4)}`;
            }
          }
        },
        annotation: {
          annotations: buildCapabilityAnnotations(usl, lsl, nominal, xbar, xMin, xMax, yMaxCurve)
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          grid: { color: 'rgba(255,255,255,.06)' },
          ticks: {
            color: '#94a3b8',
            font: { family: _FONT_DATA, size: 10 },
            maxTicksLimit: 10,
            callback: v => Number(v).toFixed(2)
          }
        },
        y: {
          min: 0,
          max: yMaxCurve,
          grid: { color: 'rgba(255,255,255,.06)' },
          ticks: { color: '#94a3b8', font: { family: _FONT_DATA, size: 10 } },
          title: { display: true, text: 'Densidad de probabilidad', color: '#94a3b8', font: { family: _FONT_UI, size: 11 } }
        }
      }
    }
  });
}

function buildHistogramAnnotations(usl, lsl, nominal, midpoints, binWidth) {
  const anns = {};
  if (!midpoints || !midpoints.length || !binWidth) return anns;

  const toIdx  = v => (v - midpoints[0]) / binWidth;
  const lastIdx = midpoints.length - 1;

  if (lsl != null) {
    const idx = toIdx(lsl);
    anns.zoneLeft = {
      type: 'box', xMin: -0.5, xMax: idx,
      backgroundColor: 'rgba(220,38,38,0.07)', borderWidth: 0
    };
    anns.lsl = {
      type: 'line', scaleID: 'x', value: idx,
      borderColor: COLORS.red, borderWidth: 2.5,
      label: {
        content: `LSI: ${Number(lsl).toFixed(3)}`, display: true,
        position: 'end', yAdjust: -8,
        backgroundColor: 'rgba(185,28,28,0.90)', color: '#fff',
        font: { family: _FONT_DATA, size: 11, weight: 'bold' }, padding: { x: 6, y: 3 }, borderRadius: 3
      }
    };
  }

  if (usl != null) {
    const idx = toIdx(usl);
    anns.zoneRight = {
      type: 'box', xMin: idx, xMax: lastIdx + 0.5,
      backgroundColor: 'rgba(220,38,38,0.07)', borderWidth: 0
    };
    anns.usl = {
      type: 'line', scaleID: 'x', value: idx,
      borderColor: COLORS.red, borderWidth: 2.5,
      label: {
        content: `LSE: ${Number(usl).toFixed(3)}`, display: true,
        position: 'end', yAdjust: -8,
        backgroundColor: 'rgba(185,28,28,0.90)', color: '#fff',
        font: { family: _FONT_DATA, size: 11, weight: 'bold' }, padding: { x: 6, y: 3 }, borderRadius: 3
      }
    };
  }

  if (lsl != null && usl != null) {
    anns.zoneGreen = {
      type: 'box', xMin: toIdx(lsl), xMax: toIdx(usl),
      backgroundColor: 'rgba(34,197,94,0.06)', borderWidth: 0
    };
  }

  if (nominal != null && !isNaN(nominal)) {
    anns.nominal = {
      type: 'line', scaleID: 'x', value: toIdx(nominal),
      borderColor: COLORS.green, borderWidth: 2, borderDash: [7, 4],
      label: {
        content: `Nominal: ${Number(nominal).toFixed(3)}`, display: true,
        position: 'start', yAdjust: 8,
        backgroundColor: 'rgba(21,128,61,0.90)', color: '#fff',
        font: { family: _FONT_DATA, size: 11, weight: 'bold' }, padding: { x: 6, y: 3 }, borderRadius: 3
      }
    };
  }

  return anns;
}

function buildCapabilityAnnotations(usl, lsl, nominal, xbar, xMin, xMax, yMax) {
  const anns = {};

  if (lsl != null) {
    anns.zoneLeft = {
      type: 'box', xMin, xMax: lsl, yMin: 0, yMax,
      backgroundColor: 'rgba(220,38,38,0.07)', borderWidth: 0
    };
    anns.lsl = {
      type: 'line', scaleID: 'x', value: lsl,
      borderColor: COLORS.red, borderWidth: 2.5,
      label: {
        content: `LSI: ${Number(lsl).toFixed(3)}`, display: true,
        position: 'end', yAdjust: -8,
        backgroundColor: 'rgba(185,28,28,0.90)', color: '#fff',
        font: { family: _FONT_DATA, size: 11, weight: 'bold' }, padding: { x: 6, y: 3 }, borderRadius: 3
      }
    };
  }

  if (usl != null) {
    anns.zoneRight = {
      type: 'box', xMin: usl, xMax, yMin: 0, yMax,
      backgroundColor: 'rgba(220,38,38,0.07)', borderWidth: 0
    };
    anns.usl = {
      type: 'line', scaleID: 'x', value: usl,
      borderColor: COLORS.red, borderWidth: 2.5,
      label: {
        content: `LSE: ${Number(usl).toFixed(3)}`, display: true,
        position: 'end', yAdjust: -8,
        backgroundColor: 'rgba(185,28,28,0.90)', color: '#fff',
        font: { family: _FONT_DATA, size: 11, weight: 'bold' }, padding: { x: 6, y: 3 }, borderRadius: 3
      }
    };
  }

  if (lsl != null && usl != null) {
    anns.zoneGreen = {
      type: 'box', xMin: lsl, xMax: usl, yMin: 0, yMax,
      backgroundColor: 'rgba(34,197,94,0.06)', borderWidth: 0
    };
  }

  if (nominal != null && !isNaN(nominal)) {
    anns.nominal = {
      type: 'line', scaleID: 'x', value: nominal,
      borderColor: COLORS.green, borderWidth: 2, borderDash: [7, 4],
      label: {
        content: `Nominal: ${Number(nominal).toFixed(3)}`, display: true,
        position: 'start', yAdjust: 8,
        backgroundColor: 'rgba(21,128,61,0.90)', color: '#fff',
        font: { family: _FONT_DATA, size: 11, weight: 'bold' }, padding: { x: 6, y: 3 }, borderRadius: 3
      }
    };
  }

  if (xbar != null) {
    anns.xbar = {
      type: 'line', scaleID: 'x', value: xbar,
      borderColor: COLORS.blue, borderWidth: 2.5,
      label: {
        content: `X̄: ${Number(xbar).toFixed(3)}`, display: true,
        position: 'start', yAdjust: 38,
        backgroundColor: 'rgba(23,97,176,0.90)', color: '#fff',
        font: { family: _FONT_DATA, size: 11, weight: 'bold' }, padding: { x: 6, y: 3 }, borderRadius: 3
      }
    };
  }

  return anns;
}

function buildSpecAnnotations(usl, lsl, nominal, xbar) {
  const anns = {};
  if (usl != null) {
    anns.usl = {
      type: 'line', scaleID: 'x', value: String(Number(usl).toFixed(3)),
      borderColor: COLORS.red, borderWidth: 2, borderDash: [4, 4],
      label: { content: `LSE: ${usl}`, display: true, position: 'start', font: { size: 10 } }
    };
  }
  if (lsl != null) {
    anns.lsl = {
      type: 'line', scaleID: 'x', value: String(Number(lsl).toFixed(3)),
      borderColor: COLORS.red, borderWidth: 2, borderDash: [4, 4],
      label: { content: `LSI: ${lsl}`, display: true, position: 'start', font: { size: 10 } }
    };
  }
  if (nominal != null) {
    anns.nominal = {
      type: 'line', scaleID: 'x', value: String(Number(nominal).toFixed(3)),
      borderColor: COLORS.green, borderWidth: 1.5, borderDash: [6, 3],
      label: { content: `Nominal: ${nominal}`, display: true, position: 'end', font: { size: 10 } }
    };
  }
  if (xbar != null) {
    anns.xbar = {
      type: 'line', scaleID: 'x', value: String(Number(xbar).toFixed(3)),
      borderColor: COLORS.amber, borderWidth: 2,
      label: { content: `X̄: ${Number(xbar).toFixed(3)}`, display: true, position: 'center', font: { size: 10 } }
    };
  }
  return anns;
}

/* ── Carta de atributos (p, np, c, u) con límites adaptativos ──────────
   Soporta pointLimits (límites por punto para n variable).
   specLines: [{ value, label, color }]                                    */
function renderAttributeChart(canvasId, chartKey, chartSeries, outOfControl = [], labels = [], specLines = []) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const { points, cl, ucl, lcl, pointLimits, variableN } = chartSeries;
  const n = points.length;
  const axisLabels = labels.length ? labels : points.map((_, i) => `${i + 1}`);

  const ptColors  = points.map((_, i) => outOfControl.includes(i) ? COLORS.outCtrl : COLORS.point);
  const ptBg      = points.map((_, i) => outOfControl.includes(i) ? 'rgba(248,113,113,0.2)' : 'rgba(167,139,250,0.2)');
  const ptRadii   = points.map((_, i) => outOfControl.includes(i) ? 8 : 4);
  const ptBorderW = points.map((_, i) => outOfControl.includes(i) ? 3 : 2);

  const chartLabelMap = {
    p:  'Proporción (p)', np: 'Núm. defectuosos (np)',
    c:  'Defectos (c)',   u:  'Defectos/unidad (u)'
  };

  const datasets = [];

  if (variableN && pointLimits) {
    // Límites variables: dibujar como líneas punto a punto
    datasets.push({
      label: 'LCS', type: 'line',
      data: pointLimits.map(pl => pl.ucl),
      borderColor: COLORS.ucl, borderWidth: 2.5, pointRadius: 0, fill: false,
      borderDash: []
    });
    datasets.push({
      label: 'LC', type: 'line',
      data: Array(n).fill(cl),
      borderColor: COLORS.cl, borderWidth: 1.5, pointRadius: 0, fill: false,
      borderDash: [8, 4]
    });
    datasets.push({
      label: 'LCI', type: 'line',
      data: pointLimits.map(pl => pl.lcl),
      borderColor: COLORS.lcl, borderWidth: 2.5, pointRadius: 0, fill: false,
      borderDash: []
    });
  } else {
    datasets.push(limitLine(points, ucl, COLORS.ucl, 'LCS', [], 2.5));
    datasets.push(limitLine(points, cl,  COLORS.cl,  'LC',  [8, 4], 1.5));
    if (lcl > 0) datasets.push(limitLine(points, lcl, COLORS.lcl, 'LCI', [], 2.5));
  }

  // Serie de datos principal
  datasets.push({
    label: chartLabelMap[chartKey] || chartKey,
    data:  points,
    borderColor: COLORS.navy,
    borderWidth: 2,
    backgroundColor:      ptBg,
    pointBackgroundColor: ptBg,
    pointBorderColor:     ptColors,
    pointRadius:          ptRadii,
    pointHoverRadius:     ptRadii.map(r => r + 2),
    pointBorderWidth:     ptBorderW,
    fill: false
  });

  // Líneas de especificación (opcionales)
  const annotations = variableN ? {} : buildControlZones(cl, ucl);
  specLines.forEach((sl, i) => {
    annotations[`spec_${i}`] = {
      type: 'line', scaleID: 'y', value: sl.value,
      borderColor: sl.color || COLORS.green, borderWidth: 2, borderDash: [6, 4],
      label: {
        content: sl.label, display: true, position: 'end',
        backgroundColor: sl.color || COLORS.green, color: '#fff',
        font: { size: 10, weight: 'bold' }, padding: { x: 5, y: 2 }, borderRadius: 3
      }
    };
  });

  return new Chart(ctx, {
    type: 'line',
    data: { labels: axisLabels, datasets },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: {
          display: true, position: 'top',
          labels: { usePointStyle: true, boxWidth: 8, font: { family: _FONT_UI, size: 11 }, color: '#e2e8f0' }
        },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => ctx.raw != null ? `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(4)}` : null,
            afterBody: items => {
              const idx = items[0]?.dataIndex;
              const extra = [];
              if (idx != null && outOfControl.includes(idx)) extra.push('⚠ Fuera de control estadístico');
              if (variableN && pointLimits?.[idx]) {
                extra.push(`LCS: ${pointLimits[idx].ucl.toFixed(4)}  LCI: ${pointLimits[idx].lcl.toFixed(4)}`);
                extra.push(`n = ${pointLimits[idx].n}`);
              }
              return extra;
            }
          }
        },
        annotation: { annotations }
      }
    }
  });
}

/* ── Mini sparkline para el dashboard ───────────────────── */
function renderMiniSparkline(canvasId, values) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !values || !values.length) return;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: values.map((_, i) => i + 1),
      datasets: [{
        data: values,
        borderColor: '#1761b0',
        backgroundColor: 'rgba(23,97,176,0.08)',
        fill: true,
        pointRadius: 0,
        tension: 0.3
      }]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
}
