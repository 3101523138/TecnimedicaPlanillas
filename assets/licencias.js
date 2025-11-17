// licencias.js · Portal TMI · Licencias
// =====================================
console.log('[LICENCIAS] Cargando módulo licencias…');

const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  alert('Falta configurar Supabase en licencias.js');
  throw new Error('Supabase config missing');
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  user: null,
  employee: null, // { uid, full_name }
};

function $(s) { return document.querySelector(s); }

function setMsg(text, isError = false) {
  const el = $('#formMsg');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

async function loadSession() {
  console.log('[LICENCIAS] loadSession…');
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[LICENCIAS] getSession error:', error);
    return null;
  }
  state.user = data.session?.user || null;
  console.log('[LICENCIAS] Sesión de usuario:', state.user?.email || null);
  return state.user;
}

async function loadEmployeeContext() {
  console.log('[LICENCIAS] loadEmployeeContext…');
  if (!state.user) throw new Error('Sin usuario en sesión');

  // Igual lógica que en app.js: primero por user_id, luego por email
  let { data, error } = await supabase.from('employees')
    .select('employee_uid, full_name, login_enabled, email')
    .eq('user_id', state.user.id)
    .single();

  if (error || !data) {
    console.warn('[LICENCIAS] employees por user_id no encontrado, probando por email…', error);
    const r = await supabase.from('employees')
      .select('employee_uid, full_name, login_enabled, email')
      .eq('email', state.user.email)
      .single();
    data = r.data || null;
    error = r.error || null;
  }

  if (error || !data) {
    console.error('[LICENCIAS] No se encontró empleado para este usuario:', error);
    throw new Error('No se encontró el empleado en la base de datos');
  }
  if (data.login_enabled === false) {
    throw new Error('Tu usuario está deshabilitado. Contacta a administración.');
  }

  state.employee = {
    uid: data.employee_uid,
    full_name: data.full_name || '(sin nombre)',
  };

  const empNameEl = $('#empName');
  if (empNameEl) empNameEl.textContent = state.employee.full_name;

  console.log('[LICENCIAS] employee OK:', state.employee);
}

// Navegación Menú / Salir
function setupNav() {
  const btnMenu = $('#btnMenu');
  const btnLogout = $('#btnLogout');

  if (btnMenu) {
    btnMenu.addEventListener('click', () => {
      console.log('[LICENCIAS] click Menú');
      // Vuelve al portal principal
      window.location.href = 'index.html';
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      console.log('[LICENCIAS] click Salir');
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('[LICENCIAS] signOut warn:', e);
      }
      window.location.href = 'index.html';
    });
  }
}

// Enviar la licencia a Supabase
async function submitLeave() {
  try {
    if (!state.employee?.uid) throw new Error('No se ha cargado el empleado.');

    const type = $('#leaveType')?.value || '';
    const from = $('#leaveFrom')?.value || '';
    const to   = $('#leaveTo')?.value || '';
    const issuer = $('#leaveIssuer')?.value || '';
    const cert   = $('#leaveCert')?.value.trim() || '';
    const notes  = $('#leaveNotes')?.value.trim() || '';

    console.log('[LICENCIAS] submitLeave payload (raw):', {
      type, from, to, issuer, cert, notes,
    });

    // Validaciones mínimas
    if (!type) {
      setMsg('Selecciona el tipo de licencia.', true);
      return;
    }
    if (!from || !to) {
      setMsg('Completa la fecha de inicio y fin.', true);
      return;
    }
    if (to < from) {
      setMsg('La fecha "Hasta" no puede ser anterior a "Desde".', true);
      return;
    }

    setMsg('Enviando solicitud…');

    // Insert en employee_leaves
    const payload = {
      employee_uid: state.employee.uid,
      leave_type: type,           // VACACIONES / INCAPACIDAD / MATERNIDAD / OTRO
      date_start: from,
      date_end: to,
      issuer: issuer || null,
      certificate_no: cert || null,
      notes: notes || null,
      // employer_pct_day1_3, employer_pct_after3, insurer_pct_after3,
      // pay_hours_per_day se pueden dejar en NULL por ahora
    };

    console.log('[LICENCIAS] insert payload:', payload);

    const { data, error } = await supabase
      .from('employee_leaves')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[LICENCIAS] Error al insertar licencia:', error);
      throw error;
    }

    console.log('[LICENCIAS] Licencia creada:', data);
    setMsg('Solicitud enviada correctamente.');

    // Limpiar formulario
    if ($('#leaveType'))   $('#leaveType').value = '';
    if ($('#leaveFrom'))   $('#leaveFrom').value = '';
    if ($('#leaveTo'))     $('#leaveTo').value = '';
    if ($('#leaveIssuer')) $('#leaveIssuer').value = '';
    if ($('#leaveCert'))   $('#leaveCert').value = '';
    if ($('#leaveNotes'))  $('#leaveNotes').value = '';

    // Refrescar historial
    await loadHistory();
  } catch (e) {
    console.error('[LICENCIAS] submitLeave error:', e);
    setMsg(e.message || 'Error al enviar la solicitud.', true);
  }
}

// Cargar historial de licencias para el empleado
async function loadHistory() {
  try {
    if (!state.employee?.uid) {
      console.warn('[LICENCIAS] loadHistory sin employee_uid');
      return;
    }

    const cont = $('#historyContainer');
    const summary = $('#historySummary');
    if (cont) cont.textContent = 'Cargando licencias…';
    if (summary) summary.textContent = '';

    const { data, error } = await supabase
      .from('employee_leaves')
      .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, created_at')
      .eq('employee_uid', state.employee.uid)
      .order('date_start', { ascending: false });

    if (error) {
      console.error('[LICENCIAS] loadHistory error:', error);
      if (cont) cont.textContent = 'Error al cargar el historial.';
      return;
    }

    const rows = data || [];
    console.log('[LICENCIAS] Historial cargado, filas:', rows.length);

    if (!rows.length) {
      if (cont) cont.textContent = 'Sin licencias registradas.';
      if (summary) summary.textContent = '';
      return;
    }

    if (summary) {
      summary.textContent = `${rows.length} licencia${rows.length === 1 ? '' : 's'} registradas`;
    }

    const html = [
      '<table class="history-table">',
      '<thead><tr>',
      '<th>Desde</th>',
      '<th>Hasta</th>',
      '<th>Tipo</th>',
      '<th>Emisor</th>',
      '<th>Boleta</th>',
      '<th>Notas</th>',
      '</tr></thead><tbody>',
      ...rows.map(r => {
        const tipo = r.leave_type || '';
        const em   = r.issuer || '—';
        const cert = r.certificate_no && r.certificate_no !== '—'
          ? r.certificate_no
          : '—';
        const notas = r.notes && r.notes !== '—'
          ? r.notes
          : '—';

        return `<tr>
          <td>${r.date_start}</td>
          <td>${r.date_end}</td>
          <td>${tipo}</td>
          <td>${em}</td>
          <td>${cert}</td>
          <td>${notas}</td>
        </tr>`;
      }),
      '</tbody></table>',
    ].join('');

    if (cont) {
      cont.innerHTML = html;
    }
  } catch (e) {
    console.error('[LICENCIAS] loadHistory catch:', e);
    const cont = $('#historyContainer');
    if (cont) cont.textContent = 'Error al cargar el historial.';
  }
}

// Boot
async function bootLicencias() {
  console.log('[LICENCIAS] bootLicencias…');

  setupNav();

  const btnSubmit = $('#btnSubmit');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', (e) => {
      e.preventDefault();
      submitLeave();
    });
  }

  // Sesión
  const user = await loadSession();
  if (!user) {
    console.warn('[LICENCIAS] Sin sesión, redirigiendo a login…');
    window.location.href = 'index.html';
    return;
  }

  try {
    await loadEmployeeContext();
    await loadHistory();
  } catch (e) {
    console.error('[LICENCIAS] Error en bootLicencias:', e);
    setMsg(e.message || 'Error al cargar la página.', true);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
