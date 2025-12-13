// assets/licencias.js
// Licencias · Tecnomédica (Portal Empleado)
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
  lastInserted: null, // última licencia insertada
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

function show(el, visible) {
  if (!el) return;
  el.style.display = visible ? '' : 'none';
}

// ==== HELPERS DE TIPO / ESTADO ====
function mapUiTypeToDb(value) {
  // CHECK en tabla: 'VACACIONES', 'INCAPACIDAD', 'MATERNIDAD', 'OTRO'
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
  // uiValue conserva distinción CCSS/INS y con/sin goce
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

function prettyStatus(v) {
  const s = (v || '').toLowerCase();
  if (!s) return '—';

  // Ajustá aquí si tu BD usa otros valores exactos
  if (s === 'pendiente') return 'Pendiente';
  if (s === 'aprobada' || s === 'aprobado') return 'Aprobada';
  if (s === 'denegada' || s === 'rechazada' || s === 'denegado' || s === 'rechazado') return 'Denegada';
  if (s === 'reabierta' || s === 'reabierto') return 'Reabierta';
  if (s === 'cancelada' || s === 'cancelado') return 'Cancelada';

  // fallback: Capitaliza
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusClass(v) {
  const s = (v || '').toLowerCase();
  if (s === 'pendiente') return 'PENDIENTE';
  if (s === 'aprobada' || s === 'aprobado') return 'APROBADA';
  if (s === 'denegada' || s === 'rechazada' || s === 'denegado' || s === 'rechazado') return 'DENEGADA';
  if (s === 'cancelada' || s === 'cancelado') return 'CANCELADA';
  if (s === 'reabierta' || s === 'reabierto') return 'REABIERTA';
  return 'OTRO';
}

function isIncapacityUiType(uiType) {
  return uiType === 'incapacidad_ccss' || uiType === 'incapacidad_ins';
}

// ==== RESUMEN (arriba del historial) ====
// Nota: aquí NO calculamos rebajos reales (eso lo hace Admin/Backoffice).
// El resumen es informativo para el empleado: tipo, rango, días naturales, estado, etc.
function calcNaturalDays(dateStart, dateEnd) {
  if (!dateStart || !dateEnd) return null;
  const a = new Date(dateStart);
  const b = new Date(dateEnd);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  if (b < a) return null;
  const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return diff;
}

function renderSummary({ uiType, dateStart, dateEnd, issuer, cert, notes, status, createdAt } = {}) {
  const wrap = $('#summaryCard');
  const box = $('#summaryBox');
  if (!wrap || !box) return;

  // mostrar tarjeta siempre (pero con contenido)
  show(wrap, true);

  const labelType = prettyType(mapUiTypeToDb(uiType || ''), uiType || null);
  const natDays = calcNaturalDays(dateStart, dateEnd);

  const showIssuerCert = isIncapacityUiType(uiType);

  // createdAt opcional
  const createdLine = createdAt
    ? `<div class="row"><div class="muted">Creada:</div><div><strong>${String(createdAt).slice(0, 19).replace('T',' ')}</strong></div></div>`
    : '';

  // estado (si no hay, asumimos borrador local)
  const stLabel = status ? prettyStatus(status) : 'Borrador (sin enviar)';
  const stCls = status ? statusClass(status) : 'BORRADOR';

  // Si aún no hay datos suficientes, mostramos un resumen básico
  const hasBasic = !!uiType || !!dateStart || !!dateEnd || !!notes || !!issuer || !!cert;

  if (!hasBasic && !st.lastInserted) {
    box.innerHTML = `
      <div class="muted">Completa el formulario para ver el resumen aquí.</div>
    `;
    return;
  }

  box.innerHTML = `
    <div class="row between gap" style="align-items:flex-start">
      <div>
        <div class="big">Resumen</div>
        <div class="muted">Este resumen es informativo para tu solicitud.</div>
      </div>
      <div>
        <span class="statusBadge ${stCls}">${stLabel}</span>
      </div>
    </div>

    <div class="m-t" style="display:grid; grid-template-columns:1fr; gap:10px">
      <div class="row"><div class="muted">Tipo:</div><div><strong>${labelType}</strong></div></div>
      <div class="row"><div class="muted">Rango:</div><div><strong>${dateStart || '—'} → ${dateEnd || '—'}</strong></div></div>
      <div class="row"><div class="muted">Días naturales:</div><div><strong>${natDays ?? '—'}</strong></div></div>

      ${
        showIssuerCert
          ? `
        <div class="row"><div class="muted">Emisor:</div><div><strong>${issuer || '—'}</strong></div></div>
        <div class="row"><div class="muted">Boleta/Cert:</div><div><strong>${cert || '—'}</strong></div></div>
      `
          : ''
      }

      ${notes ? `<div><div class="muted">Notas:</div><div style="margin-top:4px"><strong>${escapeHtml(notes)}</strong></div></div>` : ''}

      ${createdLine}
    </div>
  `;
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ==== UI: OCULTAR emisor/cert cuando no aplica ====
function updateIssuerVisibility() {
  const uiType = ($('#leaveType')?.value || '').trim();
  const showIt = isIncapacityUiType(uiType);

  show($('#issuerWrap'), showIt);
  show($('#certWrap'), showIt);

  // Si no aplica, limpiamos para no enviar basura
  if (!showIt) {
    const issuerEl = $('#leaveIssuer');
    const certEl = $('#leaveCert');
    if (issuerEl) issuerEl.value = '';
    if (certEl) certEl.value = '';
  }

  console.log('[LICENCIAS] updateIssuerVisibility ->', { uiType, showIt });
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

    // Buscar empleado por user_id
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

    // ✅ Emisor/Cert SOLO si es incapacidad (si no, se manda null)
    const allowIssuer = isIncapacityUiType(uiType);

    const dbType = mapUiTypeToDb(uiType);

    const payload = {
      employee_uid: st.employee.uid,
      leave_type: dbType,
      date_start: dateStart,
      date_end: dateEnd,
      issuer: allowIssuer ? (issuer || null) : null,
      certificate_no: allowIssuer ? (cert || null) : null,
      notes: notes || null,

      // ✅ Estado inicial desde el portal empleado
      status: 'pendiente',
    };

    console.log('[LICENCIAS] Insert payload:', payload);

    setFormMsg('Enviando solicitud…');
    const btn = $('#btnSubmit');
    if (btn) btn.disabled = true;

    const { data, error } = await supabase
      .from('employee_leaves')
      .insert(payload)
      .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, status, created_at')
      .single();

    if (error) {
      console.error('[LICENCIAS] insert error:', error);
      setFormMsg('Error al guardar la licencia. Revisa la consola.', true);
      return;
    }

    console.log('[LICENCIAS] Insert OK:', data);

    // Guardar última insertada para resumen
    st.lastInserted = data;

    // Render resumen con estado real
    renderSummary({
      uiType,
      dateStart,
      dateEnd,
      issuer: data.issuer || '',
      cert: data.certificate_no || '',
      notes,
      status: data.status || 'pendiente',
      createdAt: data.created_at || null,
    });

    setFormMsg('Solicitud enviada. Quedó en estado: Pendiente.');

    // Limpiar formulario
    typeEl.value = '';
    fromEl.value = '';
    toEl.value = '';
    issuerEl.value = '';
    certEl.value = '';
    notesEl.value = '';

    // Reset visibilidad emisor/cert
    updateIssuerVisibility();

    // Recargar historial
    await loadHistory();
  } catch (err) {
    console.error('[LICENCIAS] submitLeave catch:', err);
    setFormMsg('Error inesperado al guardar la licencia.', true);
  } finally {
    const btn = $('#btnSubmit');
    if (btn) btn.disabled = false;
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
      .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, status, created_at, approved_at, approval_notes')
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

    const rowsHtml = data
      .map((r) => {
        const d1 = r.date_start || '';
        const d2 = r.date_end || '';
        const issuer = r.issuer || '—';
        const cert = r.certificate_no || '—';
        const notes = r.notes || '—';

        const typeBadgeClass = r.leave_type || 'OTRO';
        const typeLabel = prettyType(r.leave_type, null);

        const stLabel = prettyStatus(r.status);
        const stBadge = statusClass(r.status);

        // Emisor/cert solo deberían existir en incapacidad, pero si en BD hay valores viejos,
        // los mostramos igual en historial, porque es “lo que quedó guardado”.
        return `
          <tr>
            <td><span class="badge ${typeBadgeClass}">${typeLabel}</span></td>
            <td><span class="statusMini ${stBadge}">${stLabel}</span></td>
            <td>${d1}</td>
            <td>${d2}</td>
            <td class="hide-sm">${issuer}</td>
            <td class="hide-sm">${cert}</td>
            <td class="hide-sm">${escapeHtml(notes)}</td>
          </tr>
        `;
      })
      .join('');

    cont.innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Estado</th>
            <th>Desde</th>
            <th>Hasta</th>
            <th class="hide-sm">Emisor</th>
            <th class="hide-sm">Boleta / cert.</th>
            <th class="hide-sm">Notas</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="muted m-t">
        * En celular se ocultan columnas secundarias (Emisor/Cert/Notas) para que se lea rápido.
      </div>
    `;

    const total = data.length;
    if (summary) summary.textContent = `${total} licencia${total !== 1 ? 's' : ''} registradas`;
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

// ==== LISTENERS PARA RESUMEN EN VIVO ====
function bindLiveSummary() {
  const typeEl = $('#leaveType');
  const fromEl = $('#leaveFrom');
  const toEl = $('#leaveTo');
  const issuerEl = $('#leaveIssuer');
  const certEl = $('#leaveCert');
  const notesEl = $('#leaveNotes');

  const onAnyChange = () => {
    const uiType = (typeEl?.value || '').trim();
    const dateStart = (fromEl?.value || '').trim();
    const dateEnd = (toEl?.value || '').trim();
    const issuer = (issuerEl?.value || '').trim();
    const cert = (certEl?.value || '').trim();
    const notes = (notesEl?.value || '').trim();

    updateIssuerVisibility();

    renderSummary({
      uiType,
      dateStart,
      dateEnd,
      issuer,
      cert,
      notes,
      status: null, // borrador local
      createdAt: null,
    });
  };

  [typeEl, fromEl, toEl, issuerEl, certEl, notesEl].forEach((el) => {
    if (!el) return;
    el.addEventListener('change', onAnyChange);
    el.addEventListener('input', onAnyChange);
  });

  // Primer render
  onAnyChange();
}

// ==== BOOT ====
async function bootLicencias() {
  console.log('[LICENCIAS] BOOT start');

  bindNavButtons();

  // Mostrar resumen vacío inicialmente
  renderSummary({});

  const ok = await loadSessionAndEmployee();
  if (!ok) {
    console.warn('[LICENCIAS] No se pudo cargar sesión/empleado.');
    return;
  }

  // UI inicial: ocultar emisor/cert
  updateIssuerVisibility();

  // Resumen en vivo
  bindLiveSummary();

  // Listener botón enviar
  const btnSubmit = $('#btnSubmit');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', (ev) => {
      ev.preventDefault();
      submitLeave();
    });
  }

  // Cargar historial
  await loadHistory();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
