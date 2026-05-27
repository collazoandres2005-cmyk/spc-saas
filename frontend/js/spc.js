/* Cálculos SPC en el cliente (para previsualizaciones en tiempo real) */

const SPC = (() => {
  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  function stdDev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  }

  function normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-(z * z) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    return z > 0 ? 1 - p : p;
  }

  function capability(values, usl, lsl) {
    if (values.length < 2) return null;
    const xbar  = mean(values);
    const sigma = stdDev(values);
    if (!sigma) return null;

    const cp  = (usl - lsl) / (6 * sigma);
    const cpu = (usl - xbar) / (3 * sigma);
    const cpl = (xbar - lsl) / (3 * sigma);
    const cpk = Math.min(cpu, cpl);

    let status = 'no_capaz';
    if (cpk >= 1.33) status = 'capaz';
    else if (cpk >= 1.0) status = 'marginal';

    return { xbar, sigma, cp, cpu, cpl, cpk, status };
  }

  function histogramData(values, bins = 10) {
    if (!values.length) return null;
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const w = (maxV - minV) / bins || 1;

    const freqs = Array(bins).fill(0);
    const labels = [];

    for (let i = 0; i < bins; i++) {
      const lo = minV + i * w;
      labels.push(lo.toFixed(3));
      freqs[i] = values.filter(v => i === bins - 1 ? v >= lo && v <= lo + w : v >= lo && v < lo + w).length;
    }

    return { labels, freqs, binWidth: w, min: minV, max: maxV };
  }

  function normalCurve(xbar, sigma, min, max, steps = 80) {
    const step = (max - min) / steps;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const x = min + i * step;
      const y = (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - xbar) / sigma) ** 2);
      pts.push({ x, y });
    }
    return pts;
  }

  return { mean, stdDev, normalCDF, capability, histogramData, normalCurve };
})();
