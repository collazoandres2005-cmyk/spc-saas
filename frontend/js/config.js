/*
 * Configuración de la URL del backend.
 *
 * DESARROLLO LOCAL (por defecto):
 *   Deja backendUrl vacío. Se detecta automáticamente http://localhost:4000
 *
 * PRODUCCIÓN (Vercel + Render):
 *   Deja backendUrl vacío Y pon suppressConfigWarning: true
 *   Las peticiones /api/* se redirigen automáticamente al backend via vercel.json
 *
 * USO CON NGROK:
 *   1. Expón el backend:  ngrok http 4000
 *   2. Copia la URL (ej. https://abc123.ngrok-free.app)
 *   3. Pégala en backendUrl y recarga
 */
window.SPC_CONFIG = {
  backendUrl: '', // ← vacío en producción (Vercel reescribe /api/* a Render vía vercel.json)
  suppressConfigWarning: true // ← true en producción (Vercel + Render)
};
