// licencias.js · Portal TMI · Licencias v1
// ========================================

// Logs globales para detectar errores en consola
window.addEventListener('error', (e) => {
  console.error('[LIC] window.error:', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[LIC] unhandledrejection:', e.reason);
});

// ==== CONFIG SUPABASE (MISMA QUE app.js) ==========================
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!window.supabase) {
  alert('No se cargó la librería de Supabase (CDN). Revisa licencias.html');
  throw new Error('Supabase JS missing');
}
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  alert('Falta configurar SUPABASE_URL o SUPABASE_ANON_KEY en licencias.js');
  throw new Error('Missing Supabase config');
}

console.log('[LIC] creando cliente Supabase…');
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==== STATE =======================================================
const stLic = {
  user: null,        // usuario supabase.auth
  employee: null,    // fila de employees
  leaves: [],        // historial de employee_leaves
};

// ==== HELPERS UI ==================================================
const $ = (s) => document.querySelector(s);

function toast(el, msg) {
  if (!el) return;
  el.textContent = msg || '';
  if (!msg) return;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = '';
  }, 6000);
}

// Modal simple reutilizable (mismo estilo que usas en app.js)
function ensureModalCSS() {
  if (document.getElementById('lic-modal-css')) return;
  const css = document.createElement('style');
  css.id = 'lic-modal-css';
  css.textContent = `
    .licModalBack{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2000}
    .licModal{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.28);max-width:460px;width:92vw;padding:18px}
    .licModal h3{margin:0 0 10px;font-size:18px;font-weight:800;color:#111827}
    .licModal .body{margin:0 0 14px;color:#374151;line-height:1.45}
    .licRow{display:flex;gap:10px;justify-content:flex-end}
    .licBtn{padding:10px 14px;border-radius:12px;border:0;font-weight:700;cursor:pointer}
    .licOk{background:#1e88e5;color:#fff}
  `;
  document.head.appendChild(css);
}
function showInfoModal({ title = 'Información', html = '', okText = 'Entendido' } = {}) {
  ensureModalCSS();
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'licModalBack';
    back.innerHTML = `
      <div class="licModal" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        <div class="body">${html}</div>
        <div class="licRow">
          <button class="licBtn licOk">${okText}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const finish = () => { back.remove(); resolve(true); };
    back.querySelector('.licOk').onclick = finish;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finish();
    }, { once: true });
  });
}

// ==== AUTH / CONTEXTO EMPLEADO ====================================
async function loadSession() {
  console.log('[LIC] loadSession…');
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[LIC] getSession error:', error);
    return null;
  }
  stLic.user = data?.session?.user || null;
  console.log('[LIC] user:', stLic.user?.email || null);
  return stLic.user;
}

async function loadEmployeeContext() {
  console.log('[LIC] loadEmployeeContext');
  if (!stLic.user) throw new Error('No hay sesión activa.');

  let { data, error } = await supabase.from('employees')
    .select('employee_uid, employee_code, full_name, login_enabled')
    .eq('user_id', stLic.user.id)
    .single();

  if (error || !data) {
    console.warn('[LIC] employee por user_id no encontrado; probando por email…', error);
    const r = await supabase.from('employees')
      .select('employee_uid, employee_code, full_name, login_enabled')
      .eq('email', stLic.user.email)
      .single();
    data = r.data || null;
  }
  if (!data) throw new Error('No se encontró el empleado para este usuario.');
  if (data.login_enabled === false) throw new Error('Usuario deshabilitado.');

  stLic.employee = {
    uid: data.employee_uid,
    code: data.employee_code || null,
    full_name: data.full_name || '(sin nombre)',
  };

  console.log('[LIC] employee OK:', stLic.employee);

  const nameSpan = $('#licUserName');
  if (nameSpan) nameSpan.textContent = stLic.employee.full_name;

  return stLic.employee;
}

// ==== CRUD LICENCIAS ==============================================

// Carga historial de licencias del empleado en employee_leaves
async function loadLeaves() {
  if (!stLic.employee?.uid) return;
  console.log('[LIC] loadLeaves para', stLic.employee.uid);

  const histEl = $('#leaveHistory');
  if (histEl) histEl.textContent = 'Cargando licencias…';

  const { data, error } = await supabase
    .from('employee_leaves')
    .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, created_at')
    .eq('employee_uid', stLic.employee.uid)
    .order('date_start', { ascending: false });

  if (error) {
    console.error('[LIC] loadLeaves error:', error);
    if (histEl) histEl.textContent = 'Error al cargar licencias.';
    return;
  }

  stLic.leaves = data || [];
  renderLeaves();
}

// Pinta el historial en el contenedor #leaveHistory
function renderLeaves() {
  const histEl = $('#leaveHistory');
  if (!histEl) return;

  if (!stLic.leaves.length) {
    histEl.textContent = 'Sin licencias registradas todavía.';
    return;
  }

  const rows = stLic.leaves.map((r) => {
    const ds = r.date_start || '';
    const de = r.date_end || '';
    const tipo = r.leave_type || '';
    const issuer = r.issuer || '';
    const cert = r.certificate_no || '';
    const notes = r.notes || '';
    const created = r.created_at
      ? new Date(r.created_at).toLocaleString()
      : '';

    return `
      <div class="leaveItem">
        <div class="row between">
          <div><strong>${tipo}</strong></div>
          <div class="muted">${ds} → ${de}</div>
        </div>
        ${issuer || cert ? `
          <div class="muted">
            ${issuer ? `Emisor: ${issuer}` : ''}${issuer && cert ? ' · ' : ''}${cert ? `Boleta: ${cert}` : ''}
          </div>` : ''}
        ${notes ? `<div>${notes}</div>` : ''}
        ${created ? `<div class="muted" style="font-size:11px;margin-top:2px">Creado: ${created}</div>` : ''}
      </div>
    `;
  }).join('');

  histEl.innerHTML = rows;
}

// Envía una nueva licencia a employee_leaves
async function submitLeave() {
  try {
    console.log('[LIC] submitLeave click');
    const msgEl = $('#leaveMsg');
    toast(msgEl, '');

    if (!stLic.employee?.uid) throw new Error('No se encontró el empleado.');

    const leaveTypeSel = $('#leaveType');
    const startInput   = $('#leaveStart');
    const endInput     = $('#leaveEnd');
    const issuerSel    = $('#leaveIssuer');
    const certInput    = $('#leaveCert');
    const notesInput   = $('#leaveNotes');

    const leave_type = (leaveTypeSel?.value || '').trim();
    const date_start = (startInput?.value || '').trim();
    const date_end   = (endInput?.value || '').trim();
    const issuer     = (issuerSel?.value || '').trim();
    const certificate_no = (certInput?.value || '').trim();
    const notes      = (notesInput?.value || '').trim();

    console.log('[LIC] payload preliminar:', {
      leave_type, date_start, date_end, issuer, certificate_no, notes
    });

    // Validaciones básicas
    if (!leave_type) throw new Error('Selecciona un tipo de licencia.');
    if (!date_start) throw new Error('Selecciona la fecha "Desde".');
    if (!date_end) throw new Error('Selecciona la fecha "Hasta".');

    const d1 = new Date(date_start);
    const d2 = new Date(date_end);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      throw new Error('Las fechas no son válidas.');
    }
    if (d2 < d1) throw new Error('La fecha "Hasta" no puede ser antes que "Desde".');

    const btn = $('#btnSendLeave');
    if (btn) btn.disabled = true;

    const payload = {
      employee_uid: stLic.employee.uid,
      leave_type,
      date_start,
      date_end,
      issuer: issuer || null,
      certificate_no: certificate_no || null,
      notes: notes || null,
      // El resto de columnas se dejan en NULL / default:
      // employer_pct_day1_3, employer_pct_after3, insurer_pct_after3, pay_hours_per_day
    };

    console.log('[LIC] insert employee_leaves payload:', payload);

    const { error } = await supabase
      .from('employee_leaves')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[LIC] insert error:', error);
      throw new Error(error.message || 'No se pudo guardar la licencia.');
    }

    // Limpia formulario
    if (leaveTypeSel) leaveTypeSel.value = '';
    if (startInput)   startInput.value = '';
    if (endInput)     endInput.value = '';
    if (issuerSel)    issuerSel.value = '';
    if (certInput)    certInput.value = '';
    if (notesInput)   notesInput.value = '';

    await showInfoModal({
      title: 'Licencia registrada',
      html: 'Tu solicitud de licencia se guardó correctamente.',
      okText: 'Perfecto'
    });

    toast(msgEl, 'Licencia registrada.');
    await loadLeaves();
  } catch (e) {
    console.error('[LIC] submitLeave error:', e);
    toast($('#leaveMsg'), e.message || 'Error al registrar la licencia.');
  } finally {
    const btn = $('#btnSendLeave');
    if (btn) btn.disabled = false;
  }
}

// ==== BOTONES MENÚ / SALIR ========================================
async function signOutLic() {
  try {
    console.log('[LIC] signOut');
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('[LIC] signOut warn:', e);
  } finally {
    // Limpia y devuelve al login principal
    window.location.href = 'index.html';
  }
}

// ==== BOOT ========================================================
async function bootLicencias() {
  try {
    console.log('[LIC] BOOT licencias…');

    // Botones flotantes si existen
    const btnSalir = $('#btnLogout2') || $('#btnSalirLic');
    if (btnSalir) {
      btnSalir.addEventListener('click', signOutLic);
    }

    const btnMenu = $('#btnMenu');
    if (btnMenu) {
      btnMenu.addEventListener('click', () => {
        // Volver al portal principal
        window.location.href = 'index.html';
      });
    }

    const btnSend = $('#btnSendLeave');
    if (btnSend) {
      btnSend.addEventListener('click', submitLeave);
    }

    // Fecha mínima = hoy (opcional)
    const todayStr = new Date().toISOString().slice(0, 10);
    const startInput = $('#leaveStart');
    const endInput   = $('#leaveEnd');
    if (startInput) startInput.min = todayStr;
    if (endInput)   endInput.min = todayStr;

    const user = await loadSession();
    if (!user) {
      console.log('[LIC] sin sesión → ir al login');
      window.location.href = 'index.html';
      return;
    }

    await loadEmployeeContext();
    await loadLeaves();
  } catch (e) {
    console.error('[LIC] bootLicencias error:', e);
    await showInfoModal({
      title: 'Error al iniciar Licencias',
      html: (e && e.message) ? e.message : 'Ocurrió un problema al cargar la página de licencias.',
      okText: 'Cerrar'
    });
  }
}

// === START ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
