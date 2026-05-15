/* ── Configuración ───────────────────────────────────────── */
const API_BASE = (() => {
  const cfg = window.SPC_CONFIG || {};

  // Configuración explícita: siempre tiene prioridad
  if (cfg.backendUrl) return cfg.backendUrl.replace(/\/$/, '') + '/api';

  // Localhost: autodetección
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:4000/api';

  // Acceso remoto sin backendUrl → mostrar advertencia clara y usar same-origin como fallback
  // (solo funciona si frontend y backend comparten el mismo servidor/puerto)
  const msg =
    'SPC Config: acceso remoto detectado pero backendUrl no está configurado en js/config.js.\n' +
    'Edita el archivo y añade la URL de tu backend:\n' +
    '  backendUrl: "https://TU-BACKEND.ngrok-free.app"\n' +
    `  (host actual del frontend: ${location.origin})`;
  console.warn(msg);
  return location.origin + '/api';
})();

/* ── Alerta visible si estamos en remoto sin backendUrl configurado ── */
(function _checkRemoteConfig() {
  const cfg = window.SPC_CONFIG || {};
  const h = location.hostname;
  // Suprimir en: localhost, dominios Vercel (usan rewrites) o si está marcado explícitamente
  const isLocalhost = h === 'localhost' || h === '127.0.0.1';
  const isVercel    = /\.vercel\.app$/.test(h);
  if (isLocalhost || isVercel || cfg.suppressConfigWarning || cfg.backendUrl) return;
  {
    // Muestra un banner en cuanto el DOM esté listo
    const show = () => {
      const el = document.createElement('div');
      el.id = 'spc-config-warn';
      el.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;' +
        'padding:10px 16px;font-size:13px;font-family:monospace;line-height:1.5;';
      el.innerHTML =
        '<strong>Configuración incompleta:</strong> Estás accediendo desde una URL remota ' +
        '(<code>' + location.hostname + '</code>) pero <code>backendUrl</code> está vacío en ' +
        '<code>js/config.js</code>.<br>' +
        'Expón el backend con <code>ngrok http 4000</code>, copia la URL y pégala como ' +
        '<code>backendUrl</code> en <code>js/config.js</code>.';
      document.body ? document.body.prepend(el) : document.addEventListener('DOMContentLoaded', () => document.body.prepend(el));
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
  }
})();

/* ── Gestión de tokens ───────────────────────────────────── */
const Auth = {
  getToken()  { return localStorage.getItem('spc_token'); },
  setToken(t) { localStorage.setItem('spc_token', t); },
  getUser()   {
    try { return JSON.parse(localStorage.getItem('spc_user')); } catch { return null; }
  },
  setUser(u)  { localStorage.setItem('spc_user', JSON.stringify(u)); },
  getCompany() {
    try { return JSON.parse(localStorage.getItem('spc_company')); } catch { return null; }
  },
  setCompany(c) { localStorage.setItem('spc_company', JSON.stringify(c)); },
  clear() {
    localStorage.removeItem('spc_token');
    localStorage.removeItem('spc_user');
    localStorage.removeItem('spc_company');
  },
  isLoggedIn() { return !!this.getToken(); }
};

/* ── Fetch con JWT ───────────────────────────────────────── */
async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const headers = { ...options.headers };

  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  // Evita que ngrok devuelva su página de advertencia HTML en lugar de la respuesta JSON
  headers['ngrok-skip-browser-warning'] = 'true';

  const fullUrl = `${API_BASE}${path}`;
  let res;
  try {
    res = await fetch(fullUrl, { ...options, headers });
  } catch (netErr) {
    throw new Error(
      `Sin conexión al backend.\n` +
      `URL: ${fullUrl}\n` +
      `Verifica que el backend esté en ejecución y que backendUrl en js/config.js apunte al backend (no al frontend).`
    );
  }

  // Si la respuesta no es JSON (ej: página HTML de npx-serve, ngrok o proxy), lanzar error claro
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !res.ok) {
    throw new Error(
      `Respuesta inesperada del servidor (HTTP ${res.status}, tipo: ${contentType || 'desconocido'}).\n` +
      `URL llamada: ${fullUrl}\n` +
      `Si esa URL apunta al servidor del frontend en lugar del backend, configura backendUrl en js/config.js.`
    );
  }

  if (res.status === 401) {
    Auth.clear();
    window.location.href = '/index.html?session=expired';
    throw new Error('Sesión expirada');
  }

  if (res.status === 402) {
    const data = await res.json().catch(() => ({}));
    window.location.href = `/index.html?subscription=${data.subscription_status || 'inactive'}`;
    throw new Error('Suscripción inactiva');
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }

  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });

  return data;
}

/* ── Auth API ─────────────────────────────────────────────── */
const authApi = {
  async register(payload) {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    Auth.setCompany(data.company);
    return data;
  },

  async login(email, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    Auth.setCompany(data.company);
    return data;
  },

  async me() {
    return apiFetch('/auth/me');
  },

  logout() {
    Auth.clear();
    window.location.href = '/index.html';
  }
};

/* ── Billing API ─────────────────────────────────────────── */
const billingApi = {
  async checkout()     { return apiFetch('/billing/checkout', { method: 'POST' }); },
  async status()       { return apiFetch('/billing/status'); },
  async portal()       { return apiFetch('/billing/portal', { method: 'POST' }); },
  async activateDev()  { return apiFetch('/billing/activate-dev', { method: 'POST' }); }
};

/* ── Processes API ───────────────────────────────────────── */
const processesApi = {
  list()       { return apiFetch('/processes'); },
  get(id)      { return apiFetch(`/processes/${id}`); },
  create(data) { return apiFetch('/processes', { method: 'POST', body: JSON.stringify(data) }); },
  update(id, data) { return apiFetch(`/processes/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  delete(id)   { return apiFetch(`/processes/${id}`, { method: 'DELETE' }); }
};

/* ── Measurements API ────────────────────────────────────── */
const measurementsApi = {
  list(process_id, limit = 500, offset = 0) {
    return apiFetch(`/measurements?process_id=${process_id}&limit=${limit}&offset=${offset}`);
  },
  create(data) {
    return apiFetch('/measurements', { method: 'POST', body: JSON.stringify(data) });
  },
  createBatch(items) {
    return apiFetch('/measurements', { method: 'POST', body: JSON.stringify(items) });
  },
  importCSV(process_id, file) {
    const fd = new FormData();
    fd.append('process_id', process_id);
    fd.append('file', file);
    return apiFetch('/measurements/import', { method: 'POST', body: fd, headers: {} });
  },
  delete(id) {
    return apiFetch(`/measurements/${id}`, { method: 'DELETE' });
  }
};

/* ── Analysis API ────────────────────────────────────────── */
const analysisApi = {
  capability(process_id, simulate_n = null) {
    const p = new URLSearchParams({ process_id });
    if (simulate_n != null) p.set('simulate_n', simulate_n);
    return apiFetch(`/analysis/capability?${p}`);
  },
  controlChart(process_id, type = 'imr', simulate_n = null) {
    const p = new URLSearchParams({ process_id, type });
    if (simulate_n != null) p.set('simulate_n', simulate_n);
    return apiFetch(`/analysis/control-chart?${p}`);
  },
  histogram(process_id, bins = 10) {
    return apiFetch(`/analysis/histogram?process_id=${process_id}&bins=${bins}`);
  },
  statisticalTests(process_id) {
    return apiFetch(`/analysis/tests?process_id=${process_id}`);
  },
  validateData(values, subgroup_size = null) {
    return apiFetch('/analysis/validate', {
      method: 'POST',
      body: JSON.stringify({ values, subgroup_size })
    });
  },
  dashboardSummary() {
    return apiFetch('/analysis/dashboard-summary');
  }
};

/* ── Users API ───────────────────────────────────────────── */
const usersApi = {
  list()         { return apiFetch('/users'); },
  invite(data)   { return apiFetch('/users/invite', { method: 'POST', body: JSON.stringify(data) }); },
  delete(id)     { return apiFetch(`/users/${id}`, { method: 'DELETE' }); }
};

/* ── Guard de autenticación ──────────────────────────────── */
function requireLogin() {
  if (!Auth.isLoggedIn()) {
    window.location.href = '/index.html';
    return false;
  }
  return true;
}

/* ── Utilidades UI ───────────────────────────────────────── */
function showAlert(container, message, type = 'error') {
  container.innerHTML = `
    <div class="alert alert-${type}">
      <span>${escHtml(message)}</span>
    </div>`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatNum(v, d = 3) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(d);
}

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function cpkColor(cpk) {
  if (cpk == null) return 'sin_datos';
  if (cpk >= 1.33) return 'capaz';
  if (cpk >= 1.0)  return 'marginal';
  return 'no_capaz';
}

function cpkLabel(cpk) {
  if (cpk == null) return 'Sin datos';
  if (cpk >= 1.33) return 'Capaz';
  if (cpk >= 1.0)  return 'Marginalmente capaz';
  return 'No capaz';
}

function statusLabel(s) {
  const map = { active: 'Activa', inactive: 'Inactiva', past_due: 'Pago vencido', canceled: 'Cancelada' };
  return map[s] || s;
}

/* ── Decimal flexible (acepta coma o punto como separador) ── */
function parseDecimal(raw) {
  const s = String(raw).trim().replace(/\s/g, '');
  if (!s) return NaN;
  const nCommas = (s.match(/,/g) || []).length;
  const nDots   = (s.match(/\./g) || []).length;
  if (nCommas === 0 && nDots <= 1) return parseFloat(s);
  if (nCommas > 0 && nDots > 0) {
    return s.lastIndexOf(',') > s.lastIndexOf('.')
      ? parseFloat(s.replace(/\./g, '').replace(',', '.'))   // "1.234,56"
      : parseFloat(s.replace(/,/g, ''));                     // "1,234.56"
  }
  if (nCommas > 0) {
    return nCommas === 1
      ? parseFloat(s.replace(',', '.'))   // "499,2" → decimal
      : parseFloat(s.replace(/,/g, ''));  // "1,234,567" → thousands
  }
  return parseFloat(s.replace(/\./g, '')); // "1.234.567" → thousands
}

/* ── Renderizar sidebar con usuario ──────────────────────── */
function initSidebar(activePage) {
  const user    = Auth.getUser();
  const company = Auth.getCompany();

  const topPages = [
    { id: 'dashboard',    href: '/dashboard.html',    label: 'Panel de Control'   },
    { id: 'measurements', href: '/measurements.html', label: 'Historial de datos' },
  ];

  const fase1Pages = [
    { id: 'processes',     href: '/processes.html',      label: 'Procesos'          },
    { id: 'data-entry',    href: '/data-entry.html',     label: 'Entrada de Datos'  },
    { id: 'control-chart', href: '/control-chart.html',  label: 'Cartas de Control' },
    { id: 'capability',    href: '/capability.html',     label: 'Capacidad'         },
  ];

  const fase2Pages = [
    { id: 'monitoring', href: '/monitoring.html', label: 'Monitoreo en Tiempo Real' },
  ];

  const adminPages = [
    { id: 'admin', href: '/admin.html', label: 'Administración' }
  ];

  const makeNavItem = (p) => `
    <a href="${p.href}" class="nav-item ${activePage === p.id ? 'active' : ''}">
      ${escHtml(p.label)}
    </a>`;

  const topHtml   = topPages.map(makeNavItem).join('');
  const fase1Html = fase1Pages.map(makeNavItem).join('');
  const fase2Html = fase2Pages.map(makeNavItem).join('');

  const adminHtml = user?.role === 'admin' ? `
    <div class="nav-section">Admin</div>
    ${adminPages.map(makeNavItem).join('')}` : '';

  const initials = user?.name?.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase() || '??';

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-mark">
        <div class="logo-icon">SPC</div>
        <div>
          <span>${escHtml(company?.name || 'SPC SaaS')}</span>
          <span class="logo-sub">Control Estadístico</span>
        </div>
      </div>
    </div>
    <nav class="sidebar-nav">
      ${topHtml}
      <div class="nav-section">Fase 1</div>
      ${fase1Html}
      <div class="nav-section">Fase 2</div>
      ${fase2Html}
      ${adminHtml}
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <div class="user-name">${escHtml(user?.name || '')}</div>
          <div class="user-role">${user?.role === 'admin' ? 'Administrador' : 'Analista'}</div>
        </div>
      </div>
      <button onclick="authApi.logout()" class="btn btn-secondary btn-sm" style="width:100%;margin-top:10px">Cerrar sesión</button>
    </div>`;
}

async function initTopBar(titleText) {
  const statusData = await billingApi.status().catch(() => null);
  const status     = statusData?.subscription_status || 'inactive';

  document.getElementById('top-bar-title').textContent = titleText;
  const badge = document.getElementById('sub-status-badge');
  if (badge) {
    badge.className = `sub-badge ${status}`;
    badge.textContent = statusLabel(status);
  }
}
