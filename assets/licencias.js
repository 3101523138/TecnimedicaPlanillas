// licencias.js  ·  Portal TMI
// =====================================================
// Usa el mismo Supabase que el portal de marcas (app.js)

// Logs globales
window.addEventListener('error', (e) => {
  console.error('[LICENCIAS] window.error:', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[LICENCIAS] unhandledrejection:', e.reason);
});

// === CONFIG SUPABASE (MISMA DEL PORTAL) ===
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  alert('Falta configurar Supabase en licencias.js');
  throw new Error('Supabase config missing');
}

console.log('[LICENCIAS] creando cliente Supabase…');
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === STATE ===
const st = {
  user: null,
  employee: null, // { uid, code, full_name }
};

// === HELPERS ===
const $ = (s) => document.querySelector(s);

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('es-CR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

const TYPE_LABELS = {
  incapacidad_ccss: 'Incapacidad CCSS',
  incapacidad_ins: 'Incapacidad INS',
  vacaciones: 'Vacaciones',
  permiso_con_goce: 'Permiso con goce',
  permiso_sin_goce: 'Permiso sin goce',
  otro: 'Otro',
};

const STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

const STATUS_CLASS = {
  pending: 'badge pending',
  approved: 'badge approved',
  rejected: 'badge rejected',
};

function setFormMsg(msg, isError = false) {
  const el = $('#formMsg');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

// === AUTH / EMPLEADO ===
async function loadSession() {
  console.log('[LICENCIAS] loadSession…');
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[LICENCIAS] getSession error:', error);
  }
  st.user = data?.session?.user || null;
  console.log('[LICENCIAS] session user:', st.user?.email || null);
  return st.user;
}

async function loadEmployeeContext() {
  console.log('[LICENCIAS] loadEmployeeContext…');
  if (!st.user) throw new Error('Sin usuario autenticado');

  let { data, error } = await supabase
    .from('employees')
    .select('employee_uid, employee_code, full_name, login_enabled')
    .eq('user_id', st.user.id)
    .single();

  if (error || !data) {
    console.warn(
      '[LICENCIAS] employee por user_id no encontrado; probando por email…',
      error
    );
    const r = await supabase
      .from('employees')
      .select('employee_uid, employee_code, full_name, login_enabled')
      .eq('email', st.user.email)
      .single();
    data = r.data || null;
    error = r.error;
  }

  if (error || !data) {
    console.error('[LICENCIAS] no se encontró empleado', error);
    throw new Error('No se encontró el empleado vinculado a este usuario.');
  }
  if (data.login_enabled === false) {
    throw new Error('Usuario deshabilitado para iniciar sesión.');
  }

  st.employee = {
    uid: data.employee_uid,
    code: data.employee_code || null,
    full_name: data.full_name || '(sin nombre)',
  };

  const nameEl = $('#empName');
  if (nameEl) nameEl.textContent = st.employee.full_name;

  console.log('[LICENCIAS] empleado:', st.employee);
}

// === SIGN OUT / MENÚ ===
async function signOut() {
  console.log('[LICENCIAS] signOut…');
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('[LICENCIAS] signOut error:', e);
  }

  try {
    // Limpia tokens locales por si quedan
    const lsKeys = Object.keys(localStorage);
    lsKeys.forEach((k) => {
      if (k.startsWith('sb-') || k.startsWith('supabase.')) {
        localStorage.removeItem(k);
      }
    });
    const ssKeys = Object.keys(sessionStorage);
    ssKeys.forEach((k) => {
      if (k.startsWith('sb-') || k.startsWith('supabase.')) {
        sessionStorage.removeItem(k);
      }
    });
  } catch (e) {
    console.warn('[LICENCIAS] clear storage error:', e);
  }

  // Vuelve al login del portal
  window.location.href = 'index.html';
}

function goMenu() {
  console.log('[LICENCIAS] Ir a menú…');
  window.location.href = 'index.html';
}

// === CRUD LICENCIAS ===
async function loadLeaves() {
  console.log('[LICENCIAS] loadLeaves…');
  const container = $('#historyContainer');
  const summary = $('#historySummary');
  if (container) container.textContent = 'Cargando licencias…';
  if (summary) summary.textContent = '';

  if (!st.employee?.uid) {
    if (container) container.textContent = 'No se pudo cargar el empleado.';
    return;
  }

  const { data, error } = await supabase
    .from('employee_leaves')
    .select(
      'id, leave_type, date_from, date_to, issuer, cert_number, notes, status, created_at'
    )
    .eq('employee_uid', st.employee.uid)
    .order('date_from', { ascending: false });

  if (error) {
    console.error('[LICENCIAS] loadLeaves error:', error);
    if (container)
      container.textContent = 'Error al cargar el historial de licencias.';
    return;
  }

  const rows = data || [];
  console.log('[LICENCIAS] leaves rows:', rows.length);

  if (!rows.length) {
    if (container) container.textContent = 'Sin registros de licencias.';
    if (summary) summary.textContent = '';
    return;
  }

  if (summary) {
    summary.textContent = `${rows.length} licencia${
      rows.length === 1 ? '' : 's'
    } registradas`;
  }

  // Render como tabla
  const html = [
    '<table class="history-table">',
    '<thead><tr>',
    '<th>Fecha</th>',
    '<th>Tipo</th>',
    '<th>Rango</th>',
    '<th>Emisor</th>',
    '<th>N.º boleta</th>',
    '<th>Estado</th>',
    '<th>Notas</th>',
    '</tr></thead>',
    '<tbody>',
    ...rows.map((r) => {
      const tipo = TYPE_LABELS[r.leave_type] || r.leave_type || '—';
      const rango = `${fmtDate(r.date_from)} → ${fmtDate(r.date_to)}`;
      const issuer = r.issuer || '—';
      const cert = r.cert_number || '—';
      const stKey = r.status || 'pending';
      const stLbl = STATUS_LABELS[stKey] || stKey;
      const stCls = STATUS_CLASS[stKey] || 'badge pending';
      const notas = r.notes || '';

      return `<tr>
        <td>${fmtDate(r.created_at || r.date_from)}</td>
        <td>${tipo}</td>
        <td>${rango}</td>
        <td>${issuer}</td>
        <td>${cert}</td>
        <td><span class="${stCls}">${stLbl}</span></td>
        <td>${notas.replace(/\n/g, '<br>')}</td>
      </tr>`;
    }),
    '</tbody></table>',
  ].join('');

  if (container) {
    container.innerHTML = html;
  }
}

async function submitLeave() {
  console.log('[LICENCIAS] submitLeave()');
  setFormMsg('');

  if (!st.employee?.uid) {
    setFormMsg('No se encontró el empleado.', true);
    return;
  }

  const typeEl = $('#leaveType');
  const fromEl = $('#leaveFrom');
  const toEl = $('#leaveTo');
  const issuerEl = $('#leaveIssuer');
  const certEl = $('#leaveCert');
  const notesEl = $('#leaveNotes');

  const leave_type = (typeEl?.value || '').trim();
  const date_from = (fromEl?.value || '').trim();
  const date_to = (toEl?.value || '').trim();
  const issuer = (issuerEl?.value || '').trim() || null;
  const cert_number = (certEl?.value || '').trim() || null;
  const notes = (notesEl?.value || '').trim() || null;

  if (!leave_type) {
    setFormMsg('Selecciona el tipo de licencia.', true);
    typeEl?.focus();
    return;
  }
  if (!date_from) {
    setFormMsg('Indica la fecha de inicio.', true);
    fromEl?.focus();
    return;
  }
  if (!date_to) {
    setFormMsg('Indica la fecha de fin.', true);
    toEl?.focus();
    return;
  }
  if (date_to < date_from) {
    setFormMsg('La fecha "Hasta" no puede ser anterior a "Desde".', true);
    toEl?.focus();
    return;
  }

  const btn = $('#btnSubmit');
  if (btn) btn.disabled = true;

  try {
    const payload = {
      employee_uid: st.employee.uid,
      leave_type,
      date_from,
      date_to,
      issuer,
      cert_number,
      notes,
      status: 'pending',
    };

    console.log('[LICENCIAS] insert payload:', payload);

    const { data, error } = await supabase
      .from('employee_leaves')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    console.log('[LICENCIAS] insert OK:', data);

    // Limpia campos manteniendo tipo si quieres
    fromEl.value = '';
    toEl.value = '';
    if (issuerEl) issuerEl.value = '';
    if (certEl) certEl.value = '';
    if (notesEl) notesEl.value = '';

    setFormMsg('Solicitud enviada correctamente. Estado: pendiente.', false);

    // Recarga historial
    await loadLeaves();
  } catch (e) {
    console.error('[LICENCIAS] submitLeave error:', e);
    setFormMsg('Error al registrar la licencia: ' + (e.message || e), true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// === BOOT ===
async function bootLicencias() {
  console.log('[LICENCIAS] BOOT…');

  // Botones Menú / Salir
  $('#btnMenu')?.addEventListener('click', goMenu);
  $('#btnLogout')?.addEventListener('click', signOut);

  // Enviar solicitud
  $('#btnSubmit')?.addEventListener('click', submitLeave);

  try {
    const user = await loadSession();
    if (!user) {
      alert('Tu sesión ha caducado. Vuelve a iniciar sesión.');
      window.location.href = 'index.html';
      return;
    }

    await loadEmployeeContext();
    await loadLeaves();
  } catch (e) {
    console.error('[LICENCIAS] boot error:', e);
    alert(
      'Hubo un problema cargando tus datos: ' +
        (e.message || e) +
        '\nVuelve a entrar desde el portal.'
    );
  }
}

// Inicio
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
