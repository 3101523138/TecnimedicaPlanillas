// Ruta: assets/meridian-api.js
//
// Wrapper HTTP para llamar al backend de Meridian desde la PWA.
//
// Por qué existe: el módulo "Liquidación de facturas" dejó de hablar con el
// Supabase de TecnimedicaPlanillas y ahora llama al backend Meridian
// (API REST). El JWT del usuario logueado en este Supabase de planillas se
// envía como Authorization: Bearer al backend; ese backend valida el JWT
// dual (Meridian o Planillas), matchea por email contra contacts, y
// devuelve la información del módulo de liquidación.
//
// El resto de los módulos de la PWA (IN/OUT, licencias, comprobante,
// proyectos, work_sessions, etc.) siguen hablando con su Supabase original.
// Este wrapper se aplica SOLO al módulo de facturas.
//
// Configuración: la URL base del backend se lee de
// `window.__TMI_MERIDIAN_API_URL__` (definida en index.html). Si está vacía,
// se usa el fallback de Fly.

//#1 URL base del backend de Meridian
// fallback útil para producción y desarrollo
const MERIDIAN_API_URL_DEFAULT = 'http://localhost:8080';
function getMeridianApiUrl() {
  const cfg = (window.__TMI_MERIDIAN_API_URL__ || '').toString().trim();
  return cfg || MERIDIAN_API_URL_DEFAULT;
}

//#2 tenant del portal
// el backend solo opera para este tenant (TEMPORAL — definido en .env del backend
// como EMPLOYEE_PORTAL_TENANT_ID). La PWA lo manda como header en cada request.
const MERIDIAN_TENANT_ID = 'tmi-tecnomedicacr';

//#3 obtención del JWT activo
// toma el access_token de la sesión vigente del Supabase de planillas.
// Supabase auto-refresca el token, así que siempre devuelve uno válido si
// hay sesión activa.
async function getMeridianBearerToken(supabaseClient) {
  if (!supabaseClient) {
    throw new Error('supabaseClient no disponible al armar token de Meridian');
  }
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    throw new Error('Error obteniendo sesión: ' + error.message);
  }
  const token = data?.session?.access_token;
  if (!token) {
    throw new Error('No hay sesión activa — vuelva a iniciar sesión');
  }
  return token;
}

//#4 fetch genérico con headers
// arma la request con Authorization + X-Tenant-ID y maneja errores
// uniformemente; devuelve JSON parseado o lanza con un mensaje legible.
export async function meridianApi(supabaseClient, method, path, body) {
  const url = getMeridianApiUrl().replace(/\/$/, '') + path;
  const token = await getMeridianBearerToken(supabaseClient);

  const headers = {
    'Authorization': 'Bearer ' + token,
    'X-Tenant-ID':   MERIDIAN_TENANT_ID,
  };
  const init = { method, headers };
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error('No se pudo contactar a Meridian: ' + err.message);
  }

  // 204 No Content
  if (res.status === 204) return null;

  let payload = null;
  const text = await res.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!res.ok) {
    const msg = (payload && typeof payload === 'object' && payload.error)
      ? payload.error
      : (typeof payload === 'string' ? payload : `HTTP ${res.status}`);
    const e = new Error(msg);
    e.status  = res.status;
    e.payload = payload;
    throw e;
  }
  return payload;
}

//#5 mapeo de factura — Meridian → shape esperado por la UI legacy
// La UI ya armada lee campos como issue_date, document_number, supplier_name,
// amount_crc, amount_usd, etc. El backend devuelve el shape "puro" de
// invoice_documents. Esta función traduce para minimizar cambios en la UI.
export function mapInvoiceFromMeridian(it) {
  if (!it || typeof it !== 'object') return null;
  const moneda = String(it.moneda || 'CRC').toUpperCase();
  const total  = Number(it.total_comprobante) || 0;
  return {
    id:                 it.id,
    issue_date:         it.fecha_emision || '',
    document_number:    it.numero || '',
    document_type:      it.tipo_documento || '',
    supplier_name:      it.emisor_nombre || '',
    supplier_id:        it.emisor_ident || '',
    currency_code:      moneda,
    amount_crc:         moneda === 'CRC' ? total : 0,
    amount_usd:         moneda === 'USD' ? total : 0,
    liq_status:         it.liq_status || '',
    liq_assigned_to:    it.liq_reclamada_por || '',
    client_name:        it.cliente_nombre || '',
    project_code:       it.liq_proyecto_codigo || '',
    project_name:       it.liq_proyecto_nombre || '',
    capa:               it.liq_capa || '',
    liq_type:           it.liq_tipo_pago || '',
    liq_comments:       it.liq_notas_reclamo || '',
    google_drive_url:   '',
    google_drive_file_id:'',
    pdf_file_name:      '',
    created_at:         it.liq_reclamada_en || '',
    clave_hacienda:     it.clave || '',
  };
}

//#6 listado de pendientes
// reemplaza la query directa al schema "inv" de FacturasUI
export async function fetchPendientesMeridian(supabaseClient, opts = {}) {
  const params = new URLSearchParams();
  if (opts.search) params.set('q', opts.search);
  if (opts.limit)  params.set('limit', String(opts.limit));
  const qs = params.toString();
  const path = '/api/v1/employee-portal/invoice-claims/pending' + (qs ? '?' + qs : '');
  const resp = await meridianApi(supabaseClient, 'GET', path);
  const list = Array.isArray(resp?.data) ? resp.data : [];
  return list.map(mapInvoiceFromMeridian).filter(Boolean);
}

//#7 listado de mis reclamadas
// reemplaza la query directa al schema "inv" filtrada por liq_assigned_to
export async function fetchReclamadasMiasMeridian(supabaseClient, opts = {}) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.limit)  params.set('limit', String(opts.limit));
  const qs = params.toString();
  const path = '/api/v1/employee-portal/invoice-claims/mine' + (qs ? '?' + qs : '');
  const resp = await meridianApi(supabaseClient, 'GET', path);
  const list = Array.isArray(resp?.data) ? resp.data : [];
  return list.map(mapInvoiceFromMeridian).filter(Boolean);
}

//#8 detalle de una factura
// devuelve el JSON completo del backend (la UI del modal consume estos campos).
export async function fetchInvoiceDetailMeridian(supabaseClient, invoiceId) {
  if (!invoiceId) throw new Error('invoiceId requerido');
  return meridianApi(supabaseClient, 'GET', '/api/v1/employee-portal/invoice-claims/' + encodeURIComponent(invoiceId));
}

//#9 catálogos del paso 2 del reclamo
// proyectos activos, destinos de gasto, métodos de pago.
export async function fetchCatalogProjectsMeridian(supabaseClient) {
  const resp = await meridianApi(supabaseClient, 'GET', '/api/v1/employee-portal/projects/active');
  return Array.isArray(resp?.projects) ? resp.projects : [];
}
export async function fetchCatalogExpenseDestinationsMeridian(supabaseClient) {
  const resp = await meridianApi(supabaseClient, 'GET', '/api/v1/employee-portal/expense-destinations');
  return Array.isArray(resp?.expense_destinations) ? resp.expense_destinations : [];
}
export async function fetchCatalogPaymentMethodsMeridian(supabaseClient) {
  const resp = await meridianApi(supabaseClient, 'GET', '/api/v1/employee-portal/payment-methods');
  return Array.isArray(resp?.payment_methods) ? resp.payment_methods : [];
}

//#10 paso 2 del reclamo — guarda en Meridian
// reemplaza el UPDATE directo a inv.invoice_documents con un POST al endpoint
// /complete-claim del portal. body es un EmployeePortalClaimInput acotado.
export async function completeClaimMeridian(supabaseClient, invoiceId, body) {
  if (!invoiceId) throw new Error('invoiceId requerido');
  const path = '/api/v1/employee-portal/invoice-claims/' + encodeURIComponent(invoiceId) + '/complete-claim';
  return meridianApi(supabaseClient, 'POST', path, body);
}

//#11 perfil del empleado (sanity check)
// la UI lo puede usar para confirmar que el usuario está autorizado en Meridian.
export async function fetchMeMeridian(supabaseClient) {
  return meridianApi(supabaseClient, 'GET', '/api/v1/employee-portal/me');
}

//#12 abrir el PDF de una factura en una nueva pestaña
// El backend devuelve el PDF como application/pdf con auth Bearer. Como
// `<a target=_blank>` no manda Authorization headers, hacemos fetch con el
// JWT y abrimos un Blob URL local. El usuario ve el PDF en una pestaña nueva
// sin que el JWT viaje por la URL.
export async function openInvoicePdfMeridian(supabaseClient, invoiceId) {
  if (!invoiceId) throw new Error('invoiceId requerido');
  const url = getMeridianApiUrl().replace(/\/$/, '') +
    '/api/v1/employee-portal/invoice-claims/' + encodeURIComponent(invoiceId) + '/pdf';
  const token = await getMeridianBearerToken(supabaseClient);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'X-Tenant-ID':   MERIDIAN_TENANT_ID,
    },
  });
  if (!res.ok) {
    let msg = 'No se pudo abrir el PDF';
    try {
      const err = await res.json();
      if (err && err.error) msg = err.error;
    } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  // Abrimos en una nueva pestaña. Si el browser bloquea pop-ups, fallback
  // a download forzado.
  const win = window.open(blobUrl, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'factura-' + invoiceId + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Liberar el Blob URL después de un rato (60s da tiempo a que el browser
  // termine de cargarlo en la otra pestaña).
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}
