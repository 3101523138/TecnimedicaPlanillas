// activos/licencias.js
// Licencias · Tecnomédica
// Logs activados para depurar

console.log('[LICENCIAS] Cargando script licencias.js…');

// === CONFIG SUPABASE ===
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!window.supabase) {
  console.error('[LICENCIAS] supabase-js no está cargado.');
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === ESTADO SIMPLE ===
const st = {
  user: null,
  employee: null, // { uid, full_name }
};

// === HELPERS DOM ===
const $ = (s) => document.querySelector(s);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CR', { year:'numeric', month:'2-digit', day:'2-digit' });
};

function setFormMsg(msg, isError = false) {
  const el = $('#formMsg');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

// === MAPEO TIPOS UI -> BD ===
// Tabla employee_leaves.leave_type acepta: VACACIONES, INCAPACIDAD, MATERNIDAD, OTRO
const TYPE_MAP = {
  vacaciones:        { dbType: 'VACACIONES', label: 'Vacaciones' },
  incapacidad_ccss:  { dbType: 'INCAPACIDAD', label: 'Incapacidad CCSS', defaultIssuer: 'CCSS' },
  incapacidad_ins:   { dbType: 'INCAPACIDAD', label: 'Incapacidad INS',  defaultIssuer: 'INS' },
  permiso_con_goce:  { dbType: 'OTRO',       label: 'Permiso con goce' },
  permiso_sin_goce:  { dbType: 'OTRO',       label: 'Permiso sin goce' },
  otro:              { dbType: 'OTRO',       label: 'Otro' },
};

// Traducción inversa para el historial
function prettyType(row) {
  const t = row.leave_type;
  if (t === 'VACACIONES') return 'Vacaciones';
  if (t === 'INCAPACIDAD') {
    if (row.issuer === 'CCSS') return 'Incapacidad CCSS';
    if (row.issuer === 'INS')  return 'Incapacidad INS';
    return 'Incapacidad';
  }
  if (t === 'MATERNIDAD') return 'Maternidad';
  return 'Otro';
}

// === AUTH / EMPLEADO ===
async function loadSession() {
  console.log('[LICENCIAS] loadSession…');
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[LICENCIAS] getSession error:', error);
    return null;
  }
  st.user = data?.session?.user || null;
  console.log('[LICENCIAS] session user:', st.user?.email || null);
  return st.user;
}

async function loadEmployeeContext() {
  if (!st.user) throw new Error('Sin sesión de usuario');

  console.log('[LICENCIAS] loadEmployeeContext…');
  let { data, error } = await supabase.from('employees')
    .select('employee_uid, full_name, login_enabled')
    .eq('user_id', st.user.id)
    .single();

  if (error || !data) {
    console.warn('[LICENCIAS] empleado por user_id no encontrado; probando por email…', error);
    const r = await supabase.from('employees')
      .select('employee_uid, full_name, login_enabled')
      .eq('email', st.user.email)
      .single();
    data = r.data || null;
    error = r.error || null;
  }

  if (error || !data) throw new Error('No se encontró el empleado asociado.');
  if (data.login_enabled === false) throw new Error('Usuario deshabilitado.');

  st.employee = {
    uid: data.employee_uid,
    full_name: data.full_name || '(sin nombre)',
  };

  const nameEl = $('#empName');
  if (nameEl) nameEl.textContent = st.employee.full_name;

  console.log('[LICENCIAS] employee OK:', st.employee);
}

// === HISTORIAL ===
async function loadHistory() {
  const container = $('#historyContainer');
  const summary = $('#historySummary');
  if (!st.employee) {
    if (container) container.textContent = 'No se pudo cargar el empleado.';
    return;
  }

  try {
    if (container) container.textContent = 'Cargando licencias…';

    const { data, error } = await supabase
      .from('employee_leaves')
      .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, created_at')
      .eq('employee_uid', st.employee.uid)
      .order('date_start', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      if (container) container.textContent = 'Todavía no tienes licencias registradas.';
      if (summary) summary.textContent = '';
      console.log('[LICENCIAS] historial vacío');
      return;
    }

    // Resumen
    if (summary) {
      const total = data.length;
      const first = data[data.length - 1];
      const last  = data[0];
      summary.textContent = `${total} licencia(s) · ${fmtDate(first.date_start)} – ${fmtDate(last.date_end)}`;
    }

    // Tabla
    let html = '<table class="history-table"><thead><tr>' +
      '<th>Tipo</th><th>Desde</th><th>Hasta</th><th>Emisor</th><th>Boleta</th><th>Notas</th>' +
      '</tr></thead><tbody>';

    data.forEach(row => {
      const badgeClass = row.leave_type || 'OTRO';
      html += `<tr>
        <td><span class="badge ${badgeClass}">${prettyType(row)}</span></td>
        <td>${fmtDate(row.date_start)}</td>
        <td>${fmtDate(row.date_end)}</td>
        <td>${row.issuer || '—'}</td>
        <td>${row.certificate_no || '—'}</td>
        <td>${row.notes ? row.notes : '—'}</td>
      </tr>`;
    });

    html += '</tbody></table>';

    if (container) container.innerHTML = html;
    console.log('[LICENCIAS] historial cargado:', data.length, 'fila(s)');
  } catch (e) {
    console.error('[LICENCIAS] loadHistory error:', e);
    if (container) container.textContent = 'Error al cargar el historial.';
    if (summary) summary.textContent = '';
  }
}

// === GUARDAR LICENCIA ===
async function handleSubmit() {
  console.log('[LICENCIAS] handleSubmit click');

  if (!st.employee) {
    setFormMsg('No se encontró el empleado.', true);
    return;
  }

  const typeVal   = $('#leaveType')?.value || '';
  const fromVal   = $('#leaveFrom')?.value || '';
  const toVal     = $('#leaveTo')?.value || '';
  const issuerSel = $('#leaveIssuer')?.value || '';
  const certVal   = $('#leaveCert')?.value?.trim() || '';
  const notesVal  = $('#leaveNotes')?.value?.trim() || '';

  const typeConf = TYPE_MAP[typeVal];
  if (!typeConf) {
    setFormMsg('Selecciona un tipo de licencia.', true);
    return;
  }

  if (!fromVal || !toVal) {
    setFormMsg('Completa las fechas Desde y Hasta.', true);
    return;
  }

  if (toVal < fromVal) {
    setFormMsg('La fecha Hasta no puede ser anterior a Desde.', true);
    return;
  }

  const payload = {
    employee_uid: st.employee.uid,
    leave_type: typeConf.dbType,  // VACACIONES / INCAPACIDAD / MATERNIDAD / OTRO
    date_start: fromVal,
    date_end: toVal,
    issuer: issuerSel || typeConf.defaultIssuer || null,
    certificate_no: certVal || null,
    notes: notesVal || null,
  };

  console.log('[LICENCIAS] insert payload:', payload);

  try {
    setFormMsg('Guardando licencia…');
    $('#btnSubmit').disabled = true;

    const { data, error } = await supabase
      .from('employee_leaves')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    console.log('[LICENCIAS] licencia insertada:', data);
    setFormMsg('Licencia registrada correctamente.');

    // Limpiar solo campos no críticos
    $('#leaveType').value = '';
    $('#leaveFrom').value = '';
    $('#leaveTo').value = '';
    $('#leaveIssuer').value = '';
    $('#leaveCert').value = '';
    $('#leaveNotes').value = '';

    // Recargar historial
    await loadHistory();
  } catch (e) {
    console.error('[LICENCIAS] error al insertar licencia:', e);
    setFormMsg(`Error al guardar: ${e.message || e}`, true);
  } finally {
    $('#btnSubmit').disabled = false;
  }
}

// === NAV ===
async function handleLogout() {
  console.log('[LICENCIAS] Logout');
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('[LICENCIAS] signOut error:', e);
  } finally {
    window.location.href = '/';
  }
}

function handleMenu() {
  console.log('[LICENCIAS] Volver a menú');
  window.location.href = '/';
}

// === BOOT ===
async function bootLicencias() {
  console.log('[LICENCIAS] bootLicencias…');

  // Navegación
  $('#btnLogout')?.addEventListener('click', handleLogout);
  $('#btnMenu')?.addEventListener('click', handleMenu);
  $('#btnSubmit')?.addEventListener('click', handleSubmit);

  // Auth + empleado
  const user = await loadSession();
  if (!user) {
    console.warn('[LICENCIAS] sin sesión, redirigiendo a inicio…');
    window.location.href = '/';
    return;
  }

  try {
    await loadEmployeeContext();
  } catch (e) {
    console.error('[LICENCIAS] error cargando empleado:', e);
    setFormMsg(e.message || 'No se pudo cargar tu información.', true);
    return;
  }

  // Historial inicial
  await loadHistory();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
