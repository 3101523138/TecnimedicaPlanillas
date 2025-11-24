// assets/licencias.js
// Licencias · Tecnomédica
// Todos los logs van con [LICENCIAS] para rastreo

console.log('[LICENCIAS] Cargando script licencias.js…');

// ==== CONFIGURAR SUPABASE ====
const URL_SUPABASE = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!window.supabase) {
  console.error('[LICENCIAS] supabase-js no está cargado.');
}

const supabase = window.supabase.createClient(URL_SUPABASE, SUPABASE_ANON_KEY);

// ==== ESTADO SIMPLE ====
const st = {
  user: null,
  employee: null, // { uid, full_name }
};

// ==== AYUDANTES DOM ====
const $ = (s) => document.querySelector(s);

function setFormMsg(msg, isError = false) {
  const el = $('#formMsg');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

function setHistoryMsg(msg) {
  const el = $('#historyContainer');
  if (!el) return;
  el.textContent = msg || '';
}

// Mapea los tipos del select a los valores permitidos por la tabla
// CHECK: 'VACACIONES', 'INCAPACIDAD', 'MATERNIDAD', 'OTRO'
function mapUiTypeToDb(value) {
  switch (value) {
    case 'vacaciones':
      return 'VACACIONES';
    case 'incapacidad_ccss':
    case 'incapacidad_ins':
      return 'INCAPACIDAD';
    case 'permiso_con_goce':
    case 'permiso_sin_goce':
    case 'otro':
    default:
      return 'OTRO';
  }
}

function prettyType(dbValue, uiValue) {
  // uiValue conserva la distinción “con goce / sin goce”
  switch (uiValue) {
    case 'vacaciones':
      return 'Vacaciones';
    case 'incapacidad_ccss':
      return 'Incapacidad CCSS';
    case 'incapacidad_ins':
      return 'Incapacidad INS';
    case 'permiso_con_goce':
      return 'Permiso con goce';
    case 'permiso_sin_goce':
      return 'Permiso sin goce';
    case 'otro':
      return 'Otro';
    default:
      // fallback por si ya habían registros previos
      switch (dbValue) {
        case 'VACACIONES':
          return 'Vacaciones';
        case 'INCAPACIDAD':
          return 'Incapacidad';
        case 'MATERNIDAD':
          return 'Maternidad';
        case 'OTRO':
        default:
          return 'Otro';
      }
  }
}

// ==== CARGAR SESIÓN Y EMPLEADO ====
async function loadSessionAndEmployee() {
  console.log('[LICENCIAS] loadSessionAndEmployee…');
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('[LICENCIAS] getSession error:', error);
      throw error;
    }

    const session = data?.session || null;
    if (!session?.user) {
      console.warn('[LICENCIAS] Sin sesión activa.');
      setFormMsg('No hay sesión activa. Abre primero el portal y vuelve a intentar.', true);
      return false;
    }

    st.user = session.user;
    console.log('[LICENCIAS] Usuario:', st.user.email);

    // Buscar empleado por user_id (igual que en portal)
    let { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('employee_uid, full_name')
      .eq('user_id', st.user.id)
      .single();

    if (empErr || !emp) {
      console.warn('[LICENCIAS] Empleado por user_id no encontrado. Probando por email…', empErr);
      const r = await supabase
        .from('employees')
        .select('employee_uid, full_name')
        .eq('email', st.user.email)
        .single();
      emp = r.data || null;
      empErr = r.error || null;
    }

    if (empErr || !emp) {
      console.error('[LICENCIAS] No se encontró empleado para este usuario:', empErr);
      setFormMsg('No se encontró tu ficha de empleado. Contacta a administración.', true);
      return false;
    }

    st.employee = {
      uid: emp.employee_uid,
      full_name: emp.full_name || '(sin nombre)',
    };

    const n = $('#empName');
    if (n) n.textContent = st.employee.full_name;

    console.log('[LICENCIAS] Empleado OK:', st.employee);
    return true;
  } catch (err) {
    console.error('[LICENCIAS] loadSessionAndEmployee catch:', err);
    setFormMsg('Error cargando datos de usuario. Intenta recargar la página.', true);
    return false;
  }
}

// ==== INSERTAR NUEVA LICENCIA ====
async function submitLeave() {
  console.log('[LICENCIAS] submitLeave click');
  try {
    if (!st.employee?.uid) {
      setFormMsg('No se encontró el empleado. Vuelve a entrar desde el portal.', true);
      return;
    }

    const typeEl = $('#leaveType');
    const fromEl = $('#leaveFrom');
    const toEl = $('#leaveTo');
    const issuerEl = $('#leaveIssuer');
    const certEl = $('#leaveCert');
    const notesEl = $('#leaveNotes');

    const uiType = (typeEl?.value || '').trim();
    const dateStart = (fromEl?.value || '').trim();
    const dateEnd = (toEl?.value || '').trim();
    const issuer = (issuerEl?.value || '').trim();
    const cert = (certEl?.value || '').trim();
    const notes = (notesEl?.value || '').trim();

    if (!uiType) {
      setFormMsg('Selecciona el tipo de licencia.', true);
      typeEl?.focus();
      return;
    }
    if (!dateStart) {
      setFormMsg('Selecciona la fecha de inicio.', true);
      fromEl?.focus();
      return;
    }
    if (!dateEnd) {
      setFormMsg('Selecciona la fecha de fin.', true);
      toEl?.focus();
      return;
    }
    if (dateEnd < dateStart) {
      setFormMsg('La fecha final no puede ser anterior a la inicial.', true);
      toEl?.focus();
      return;
    }

    const dbType = mapUiTypeToDb(uiType);

    const payload = {
      employee_uid: st.employee.uid,
      leave_type: dbType,
      date_start: dateStart,
      date_end: dateEnd,
      issuer: issuer || null,
      certificate_no: cert || null,
      notes: notes || null,
    };

    console.log('[LICENCIAS] Insert payload:', payload);

    setFormMsg('Enviando solicitud…');
    $('#btnSubmit') && ($('#btnSubmit').disabled = true);

    const { data, error } = await supabase
      .from('employee_leaves')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[LICENCIAS] insert error:', error);
      setFormMsg('Error al guardar la licencia. Revisa la consola.', true);
      return;
    }

    console.log('[LICENCIAS] Insert OK:', data);
    setFormMsg('Solicitud registrada correctamente.');

    // Limpiar formulario
    typeEl.value = '';
    fromEl.value = '';
    toEl.value = '';
    issuerEl.value = '';
    certEl.value = '';
    notesEl.value = '';

    // Recargar historial
    await loadHistory();
  } catch (err) {
    console.error('[LICENCIAS] submitLeave catch:', err);
    setFormMsg('Error inesperado al guardar la licencia.', true);
  } finally {
    $('#btnSubmit') && ($('#btnSubmit').disabled = false);
  }
}

// ==== CARGAR HISTORIAL ====
async function loadHistory() {
  console.log('[LICENCIAS] loadHistory…');
  const cont = $('#historyContainer');
  const summary = $('#historySummary');
  if (!cont) return;

  if (!st.employee?.uid) {
    setHistoryMsg('No se pudo cargar el historial (empleado no definido).');
    return;
  }

  setHistoryMsg('Cargando licencias…');

  try {
    const { data, error } = await supabase
      .from('employee_leaves')
      .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, created_at')
      .eq('employee_uid', st.employee.uid)
      .order('date_start', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[LICENCIAS] loadHistory error:', error);
      setHistoryMsg('Error al cargar el historial.');
      return;
    }

    if (!data || !data.length) {
      setHistoryMsg('Aún no tienes licencias registradas.');
      if (summary) summary.textContent = '';
      return;
    }

    console.log('[LICENCIAS] Historial cargado:', data.length, 'registros');

    // Renderizar tabla
    const rowsHtml = data
      .map((r) => {
        const d1 = r.date_start || '';
        const d2 = r.date_end || '';
        const issuer = r.issuer || '—';
        const cert = r.certificate_no || '—';
        const notes = r.notes || '—';
        const badgeClass = r.leave_type || 'OTRO';
        const label = prettyType(r.leave_type, null);

        return `
          <tr>
            <td><span class="badge ${badgeClass}">${label}</span></td>
            <td>${d1}</td>
            <td>${d2}</td>
            <td>${issuer}</td>
            <td>${cert}</td>
            <td>${notes}</td>
          </tr>
        `;
      })
      .join('');

    cont.innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Desde</th>
            <th>Hasta</th>
            <th>Emisor</th>
            <th>Boleta / cert.</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;

    // Resumen
    const total = data.length;
    if (summary) {
      summary.textContent = `${total} licencia${total !== 1 ? 's' : ''} registradas`;
    }
  } catch (err) {
    console.error('[LICENCIAS] loadHistory catch:', err);
    setHistoryMsg('Error inesperado al cargar el historial.');
  }
}

// ==== BOTONES MENÚ / SALIR ====
function bindNavButtons() {
  const btnMenu = $('#btnMenu');
  const btnLogout = $('#btnLogout');

  if (btnMenu) {
    btnMenu.addEventListener('click', () => {
      console.log('[LICENCIAS] Click Menú');
      // El portal principal está en /
      window.location.href = '/';
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      console.log('[LICENCIAS] Click Salir');
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('[LICENCIAS] signOut warn:', e);
      }
      window.location.href = '/';
    });
  }
}

// ==== BOOT ====
async function bootLicencias() {
  console.log('[LICENCIAS] BOOT start');

  bindNavButtons();

  const ok = await loadSessionAndEmployee();
  if (!ok) {
    console.warn('[LICENCIAS] No se pudo cargar sesión/empleado.');
    return;
  }

  // Listeners de formulario
  const btnSubmit = $('#btnSubmit');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', (ev) => {
      ev.preventDefault();
      submitLeave();
    });
  }

  // Cargar historial inicial
  await loadHistory();
}

// Iniciar al cargar DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
