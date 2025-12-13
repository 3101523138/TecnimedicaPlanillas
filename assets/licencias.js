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

function setSummaryVisible(visible) {
  const card = $('#summaryCard');
  if (!card) return;
  card.style.display = visible ? '' : 'none';
}

function setSummaryHtml(html) {
  const box = $('#summaryBox');
  if (!box) return;
  box.innerHTML = html || '';
}

function showIssuerCertIfNeeded() {
  const typeEl = $('#leaveType');
  const wrapIssuer = $('#issuerWrap');
  const wrapCert = $('#certWrap');
  if (!typeEl || !wrapIssuer || !wrapCert) return;

  const v = (typeEl.value || '').trim();
  const isIncap = v === 'incapacidad_ccss' || v === 'incapacidad_ins';

  wrapIssuer.style.display = isIncap ? '' : 'none';
  wrapCert.style.display = isIncap ? '' : 'none';

  console.log('[LICENCIAS] showIssuerCertIfNeeded:', { v, isIncap });
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

// ===== ESTADOS (portal empleado) =====
// No invento enum: uso lo que venga en la fila. Si no existe, fallback.
function normalizeStatus(s) {
  const raw = (s || '').toString().trim().toLowerCase();
  if (!raw) return { key: 'OTRO', label: 'Sin estado' };

  // mapeos comunes (ajusta si tu BD usa otros)
  if (raw === 'pendiente') return { key: 'PENDIENTE', label: 'Pendiente' };
  if (raw === 'aprobada' || raw === 'aprobado') return { key: 'APROBADA', label: 'Aprobada' };
  if (raw === 'denegada' || raw === 'rechazada') return { key: 'DENEGADA', label: 'Denegada' };
  if (raw === 'cancelada') return { key: 'CANCELADA', label: 'Cancelada' };
  if (raw === 'reabierta') return { key: 'REABIERTA', label: 'Reabierta' };

  // otros estados: conservar texto
  return { key: 'OTRO', label: s };
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

// ==== RESUMEN (informativo) ====
// Reglas:
// - Se muestra SI hay tipo + desde + hasta.
// - Si el tipo es vacaciones, hace cálculo básico informativo: días naturales.
// - Si tu backend ya guarda natural_days/workdays/vacation_days_to_deduct, también los muestra si existe un registro reciente.
//   (Aquí NO invento funciones RPC; solo uso lo que ya está en employee_leaves.)
function calcNaturalDays(dateStart, dateEnd) {
  try {
    const d1 = new Date(dateStart + 'T00:00:00');
    const d2 = new Date(dateEnd + 'T00:00:00');
    const ms = d2.getTime() - d1.getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  } catch (e) {
    return null;
  }
}

function renderSummaryDraft() {
  const typeEl = $('#leaveType');
  const fromEl = $('#leaveFrom');
  const toEl = $('#leaveTo');
  const notesEl = $('#leaveNotes');

  const uiType = (typeEl?.value || '').trim();
  const dateStart = (fromEl?.value || '').trim();
  const dateEnd = (toEl?.value || '').trim();
  const notes = (notesEl?.value || '').trim();

  if (!uiType || !dateStart || !dateEnd) {
    setSummaryVisible(false);
    return;
  }

  const dbType = mapUiTypeToDb(uiType);
  const typeLabel = prettyType(dbType, uiType);

  const naturalDays = calcNaturalDays(dateStart, dateEnd);

  // Estado: mientras no se guarda, siempre "BORRADOR"
  const statusHtml = `<span class="statusBadge BORRADOR">Borrador (sin enviar)</span>`;

  setSummaryVisible(true);
  setSummaryHtml(`
    <div class="summaryTitle">
      <div>
        <div class="big">Resumen</div>
        <div class="muted">Este resumen es informativo para tu solicitud.</div>
      </div>
      ${statusHtml}
    </div>

    <div class="summaryGrid">
      <div class="kv"><span>Tipo:</span><b>${typeLabel}</b></div>
      <div class="kv"><span>Rango:</span><b>${dateStart} → ${dateEnd}</b></div>
      <div class="kv"><span>Días naturales:</span><b>${naturalDays ?? '—'}</b></div>
      <div class="kv"><span>Notas:</span><b>${notes ? escapeHtml(notes) : '—'}</b></div>
    </div>

    <div class="muted m-t">
      Nota: administración calculará el rebajo exacto (laborables, feriados, etc.) al procesar tu solicitud.
    </div>
  `);
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

    // issuer/cert solo si incapacidad
    const isIncap = uiType === 'incapacidad_ccss' || uiType === 'incapacidad_ins';
    const issuer = isIncap ? (issuerEl?.value || '').trim() : '';
    const cert = isIncap ? (certEl?.value || '').trim() : '';

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

    // Validación extra para incapacidad (si aplica)
    if (isIncap && !issuer) {
      setFormMsg('Selecciona el emisor de la incapacidad (CCSS/INS).', true);
      issuerEl?.focus();
      return;
    }

    const dbType = mapUiTypeToDb(uiType);

    const payload = {
      employee_uid: st.employee.uid,
      leave_type: dbType,
      date_start: dateStart,
      date_end: dateEnd,
      issuer: isIncap ? (issuer || null) : null,
      certificate_no: isIncap ? (cert || null) : null,
      notes: notes || null,

      // status lo define tu backend/policy; si existe columna, dejamos que default mande
    };

    console.log('[LICENCIAS] Insert payload:', payload);

    setFormMsg('Enviando solicitud…');
    const btn = $('#btnSubmit');
    if (btn) btn.disabled = true;

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
    if (issuerEl) issuerEl.value = '';
    if (certEl) certEl.value = '';
    notesEl.value = '';

    showIssuerCertIfNeeded();
    renderSummaryDraft(); // ocultará el resumen

    // Recargar historial (y resumen basado en el último registro)
    await loadHistory();
  } catch (err) {
    console.error('[LICENCIAS] submitLeave catch:', err);
    setFormMsg('Error inesperado al guardar la licencia.', true);
  } finally {
    const btn = $('#btnSubmit');
    if (btn) btn.disabled = false;
  }
}

// ==== CARGAR HISTORIAL + RESUMEN DESDE ÚLTIMO REGISTRO ====
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
    // Incluimos status y (si existen) campos calculados por tu backend
    const { data, error } = await supabase
      .from('employee_leaves')
      .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, status, created_at, natural_days, workdays_in_range, vacation_days_to_deduct')
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
      setSummaryVisible(false);
      return;
    }

    console.log('[LICENCIAS] Historial cargado:', data.length, 'registros');

    // ===== RESUMEN basado en el registro más reciente =====
    const last = data[0];
    const stNorm = normalizeStatus(last.status);
    const lastTypeLabel = prettyType(last.leave_type, null);

    // para vacaciones, si backend guardó los campos, los mostramos (sin inventar)
    const isVac = (last.leave_type || '') === 'VACACIONES';

    const natural = (last.natural_days != null) ? last.natural_days : calcNaturalDays(last.date_start, last.date_end);
    const workdays = (last.workdays_in_range != null) ? last.workdays_in_range : null;
    const toDeduct = (last.vacation_days_to_deduct != null) ? last.vacation_days_to_deduct : null;

    setSummaryVisible(true);
    setSummaryHtml(`
      <div class="summaryTitle">
        <div>
          <div class="big">Resumen</div>
          <div class="muted">Este resumen es informativo para tu solicitud más reciente.</div>
        </div>
        <span class="statusBadge ${stNorm.key}">${escapeHtml(stNorm.label)}</span>
      </div>

      <div class="summaryGrid">
        <div class="kv"><span>Tipo:</span><b>${escapeHtml(lastTypeLabel)}</b></div>
        <div class="kv"><span>Rango:</span><b>${escapeHtml(last.date_start)} → ${escapeHtml(last.date_end)}</b></div>
        <div class="kv"><span>Días naturales:</span><b>${natural ?? '—'}</b></div>
        ${isVac ? `
          <div class="kv"><span>Días laborables:</span><b>${(workdays ?? '—')}</b></div>
          <div class="kv"><span>A rebajar:</span><b>${(toDeduct ?? '—')}</b></div>
        ` : `
          <div class="kv"><span>Emisor:</span><b>${escapeHtml(last.issuer || '—')}</b></div>
          <div class="kv"><span>Certificado:</span><b>${escapeHtml(last.certificate_no || '—')}</b></div>
        `}
        <div class="kv" style="grid-column:1/-1"><span>Notas:</span><b>${escapeHtml(last.notes || '—')}</b></div>
      </div>

      <div class="muted m-t">
        El estado puede cambiar cuando administración apruebe o deniegue la solicitud.
      </div>
    `);

    // ===== Tabla historial =====
    const rowsHtml = data
      .map((r) => {
        const d1 = r.date_start || '';
        const d2 = r.date_end || '';
        const issuer = r.issuer || '—';
        const cert = r.certificate_no || '—';
        const notes = r.notes || '—';
        const badgeClass = r.leave_type || 'OTRO';
        const label = prettyType(r.leave_type, null);

        const s = normalizeStatus(r.status);
        const statusMini = `<span class="statusMini ${s.key}">${escapeHtml(s.label)}</span>`;

        return `
          <tr>
            <td>
              <div style="display:flex;flex-direction:column;gap:6px">
                <span class="badge ${badgeClass}">${escapeHtml(label)}</span>
                ${statusMini}
              </div>
            </td>
            <td>${escapeHtml(d1)}</td>
            <td>${escapeHtml(d2)}</td>
            <td class="hide-sm">${escapeHtml(issuer)}</td>
            <td class="hide-sm">${escapeHtml(cert)}</td>
            <td>${escapeHtml(notes)}</td>
          </tr>
        `;
      })
      .join('');

    cont.innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>Tipo / Estado</th>
            <th>Desde</th>
            <th>Hasta</th>
            <th class="hide-sm">Emisor</th>
            <th class="hide-sm">Boleta / cert.</th>
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

// ==== LISTENERS PARA RESUMEN DRAFT + OCULTAR CAMPOS ====
function bindFormLivePreview() {
  const typeEl = $('#leaveType');
  const fromEl = $('#leaveFrom');
  const toEl = $('#leaveTo');
  const notesEl = $('#leaveNotes');

  const onChange = () => {
    showIssuerCertIfNeeded();
    renderSummaryDraft();
  };

  if (typeEl) typeEl.addEventListener('change', onChange);
  if (fromEl) fromEl.addEventListener('change', onChange);
  if (toEl) toEl.addEventListener('change', onChange);
  if (notesEl) notesEl.addEventListener('input', onChange);

  // estado inicial
  showIssuerCertIfNeeded();
  renderSummaryDraft();
}

// ==== BOOT ====
async function bootLicencias() {
  console.log('[LICENCIAS] BOOT start');

  bindNavButtons();
  bindFormLivePreview();

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

  // Cargar historial inicial + resumen del último registro
  await loadHistory();
}

// Iniciar al cargar DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
