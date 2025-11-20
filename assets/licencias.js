// activos/licencias.js
// --------------------
// Módulo de licencias del Portal TMI

'use strict';

// ===== CONFIG SUPABASE (MISMA QUE app.js) ======================
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[LICENCIAS] Falta supabase-js o config');
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== ESTADO SIMPLE ==========================================
const st = {
  user: null,
  employee: null, // { uid, full_name }
  leaves: []
};

// ===== HELPERS =================================================
const $ = (sel) => document.querySelector(sel);

function setFormMsg(msg, type = 'muted') {
  const el = $('#formMsg');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.remove('error', 'ok');
  if (type === 'error') el.classList.add('error');
  if (type === 'ok') el.classList.add('ok');
}

function mapUITypeToDB(ui) {
  switch (ui) {
    case 'vacaciones':
      return { db: 'VACACIONES', label: 'Vacaciones' };
    case 'incapacidad_ccss':
    case 'incapacidad_ins':
      return { db: 'INCAPACIDAD', label: ui === 'incapacidad_ccss' ? 'Incapacidad CCSS' : 'Incapacidad INS' };
    case 'permiso_con_goce':
      return { db: 'OTRO', label: 'Permiso con goce' };
    case 'permiso_sin_goce':
      return { db: 'OTRO', label: 'Permiso sin goce' };
    case 'otro':
    default:
      return { db: 'OTRO', label: 'Otro' };
  }
}

function formatDateRange(start, end) {
  if (!start || !end) return '—';
  if (start === end) return start;
  return `${start} → ${end}`;
}

function formatDateTime(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  return d.toLocaleString('es-CR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ===== AUTH + EMPLEADO ========================================
async function loadSession() {
  console.log('[LICENCIAS] loadSession…');
  const { data, error } = await sb.auth.getSession();
  if (error) {
    console.error('[LICENCIAS] getSession error:', error);
    return null;
  }
  st.user = data?.session?.user || null;
  console.log('[LICENCIAS] user:', st.user?.email || null);
  return st.user;
}

async function loadEmployee() {
  if (!st.user) throw new Error('Sin usuario autenticado');

  console.log('[LICENCIAS] loadEmployee…');
  let { data, error } = await sb
    .from('employees')
    .select('employee_uid, full_name, login_enabled')
    .eq('user_id', st.user.id)
    .single();

  if (error || !data) {
    console.warn('[LICENCIAS] empleado por user_id no encontrado, probando email…', error);
    const r = await sb
      .from('employees')
      .select('employee_uid, full_name, login_enabled')
      .eq('email', st.user.email)
      .single();
    data = r.data || null;
    error = r.error || null;
  }

  if (error || !data) {
    console.error('[LICENCIAS] No se encontró empleado para este usuario:', error);
    throw new Error('No se encontró tu ficha de empleado.');
  }

  if (data.login_enabled === false) {
    throw new Error('Tu usuario está deshabilitado.');
  }

  st.employee = {
    uid: data.employee_uid,
    full_name: data.full_name || '(sin nombre)'
  };

  const empNameEl = $('#empName');
  if (empNameEl) empNameEl.textContent = st.employee.full_name;

  console.log('[LICENCIAS] employee OK:', st.employee);
}

// ===== HISTORIAL ==============================================
async function loadHistory() {
  const cont = $('#historyContainer');
  const summary = $('#historySummary');

  if (cont) cont.textContent = 'Cargando licencias…';
  if (summary) summary.textContent = '';

  if (!st.employee?.uid) {
    if (cont) cont.textContent = 'No se pudo cargar el empleado.';
    return;
  }

  console.log('[LICENCIAS] loadHistory para empleado:', st.employee.uid);

  const { data, error } = await sb
    .from('employee_leaves')
    .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, created_at')
    .eq('employee_uid', st.employee.uid)
    .order('date_start', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[LICENCIAS] error cargando historial:', error);
    if (cont) cont.textContent = 'Error al cargar historial.';
    return;
  }

  st.leaves = data || [];

  if (!st.leaves.length) {
    if (cont) cont.textContent = 'No tienes licencias registradas aún.';
    if (summary) summary.textContent = '';
    return;
  }

  if (summary) summary.textContent = `${st.leaves.length} registro(s)`;

  const rowsHtml = st.leaves
    .map((r) => {
      const range = formatDateRange(r.date_start, r.date_end);
      const created = formatDateTime(r.created_at);
      const type = r.leave_type || 'OTRO';
      const issuer = r.issuer || '—';
      const cert = r.certificate_no || '—';
      const notes = r.notes ? r.notes : '—';

      return `
        <tr>
          <td>${range}</td>
          <td><span class="badge ${type}">${type}</span></td>
          <td>${issuer}</td>
          <td>${cert}</td>
          <td>${notes}</td>
          <td>${created}</td>
        </tr>
      `;
    })
    .join('');

  const tableHtml = `
    <table class="history-table">
      <thead>
        <tr>
          <th>Rango</th>
          <th>Tipo</th>
          <th>Emisor</th>
          <th>Boleta</th>
          <th>Notas</th>
          <th>Creada</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  if (cont) cont.innerHTML = tableHtml;
}

// ===== GUARDAR LICENCIA =======================================
async function handleSubmit() {
  try {
    console.log('[LICENCIAS] handleSubmit click');
    setFormMsg('');

    if (!st.employee?.uid) {
      throw new Error('No se pudo identificar tu empleado.');
    }

    const typeSel = $('#leaveType');
    const fromEl = $('#leaveFrom');
    const toEl = $('#leaveTo');
    const issuerEl = $('#leaveIssuer');
    const certEl = $('#leaveCert');
    const notesEl = $('#leaveNotes');

    const uiType = typeSel?.value || '';
    const dateStart = fromEl?.value || '';
    const dateEnd = toEl?.value || '';
    const issuer = issuerEl?.value || '';
    const certificate = (certEl?.value || '').trim();
    const notesBase = (notesEl?.value || '').trim();

    if (!uiType) {
      throw new Error('Selecciona el tipo de licencia.');
    }
    if (!dateStart || !dateEnd) {
      throw new Error('Debes indicar las fechas Desde y Hasta.');
    }
    if (dateEnd < dateStart) {
      throw new Error('La fecha Hasta no puede ser anterior a Desde.');
    }

    const mapped = mapUITypeToDB(uiType);
    const fullNotes =
      notesBase ||
      (mapped.label ? `Tipo: ${mapped.label}` : '');

    const payload = {
      employee_uid: st.employee.uid,
      leave_type: mapped.db,        // VACACIONES / INCAPACIDAD / MATERNIDAD / OTRO
      date_start: dateStart,
      date_end: dateEnd,
      issuer: issuer || null,
      certificate_no: certificate || null,
      notes: fullNotes || null
      // employer_pct_day1_3 / pay_hours_per_day se pueden dejar nulos
    };

    console.log('[LICENCIAS] insert payload:', payload);

    const btn = $('#btnSubmit');
    if (btn) btn.disabled = true;

    const { data, error } = await sb
      .from('employee_leaves')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[LICENCIAS] insert error:', error);
      throw new Error(error.message || 'No se pudo guardar la licencia.');
    }

    console.log('[LICENCIAS] insert OK:', data);

    // limpiar formulario
    if (typeSel) typeSel.value = '';
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    if (issuerEl) issuerEl.value = '';
    if (certEl) certEl.value = '';
    if (notesEl) notesEl.value = '';

    setFormMsg('Solicitud registrada correctamente.', 'ok');

    // recargar historial
    await loadHistory();
  } catch (e) {
    console.error('[LICENCIAS] handleSubmit error:', e);
    setFormMsg(e.message || 'Error al enviar la solicitud.', 'error');
  } finally {
    const btn = $('#btnSubmit');
    if (btn) btn.disabled = false;
  }
}

// ===== NAV / LOGOUT ===========================================
async function handleLogout() {
  try {
    console.log('[LICENCIAS] Logout');
    await sb.auth.signOut();
  } catch (e) {
    console.warn('[LICENCIAS] signOut warn:', e);
  } finally {
    window.location.href = 'index.html';
  }
}

function handleMenu() {
  console.log('[LICENCIAS] Ir a menú');
  window.location.href = 'index.html';
}

// ===== BOOT ===================================================
async function bootLicencias() {
  console.log('[LICENCIAS] BOOT…');

  // wires UI
  $('#btnSubmit')?.addEventListener('click', handleSubmit);
  $('#btnLogout')?.addEventListener('click', handleLogout);
  $('#btnMenu')?.addEventListener('click', handleMenu);

  try {
    const user = await loadSession();
    if (!user) {
      console.warn('[LICENCIAS] Sin sesión, redirigiendo a login…');
      window.location.href = 'index.html';
      return;
    }
    await loadEmployee();
    await loadHistory();
  } catch (e) {
    console.error('[LICENCIAS] boot error:', e);
    setFormMsg(e.message || 'Error al iniciar módulo de licencias.', 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
