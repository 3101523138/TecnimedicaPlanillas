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

function clearFormMsg() {
  setFormMsg('');
}

function setHistoryMsg(msg) {
  const el = $('#historyContainer');
  if (!el) return;
  el.textContent = msg || '';
}

function showSummaryCard(show) {
  const card = $('#summaryCard');
  if (!card) return;
  card.style.display = show ? '' : 'none';
}

// ==== TIPOS ====
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

// ==== ESTADOS (lo que venga en BD, normalizado) ====
function normStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'PENDIENTE'; // default si no existe columna
  if (s.includes('pend')) return 'PENDIENTE';
  if (s.includes('aprob')) return 'APROBADA';
  if (s.includes('deneg') || s.includes('rechaz')) return 'DENEGADA';
  if (s.includes('cancel')) return 'CANCELADA';
  if (s.includes('reabr')) return 'REABIERTA';
  // “borrador” solo aplica a UI (sin enviar)
  return 'OTRO';
}

function statusLabel(norm) {
  switch (norm) {
    case 'PENDIENTE': return 'Pendiente';
    case 'APROBADA': return 'Aprobada';
    case 'DENEGADA': return 'Denegada';
    case 'CANCELADA': return 'Cancelada';
    case 'REABIERTA': return 'Reabierta';
    default: return 'Estado';
  }
}

// ==== FECHAS / DÍAS ====
function parseYMD(ymd) {
  // ymd = "YYYY-MM-DD"
  if (!ymd || typeof ymd !== 'string') return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  // Crear en UTC para evitar corrimientos por zona horaria
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function diffDaysInclusive(startYmd, endYmd) {
  const a = parseYMD(startYmd);
  const b = parseYMD(endYmd);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  return days > 0 ? days : 0;
}

function fmtRange(d1, d2) {
  return `${d1 || '—'} → ${d2 || '—'}`;
}

// ==== UI: mostrar/ocultar campos incapacidad ====
function isUiIncapacity(uiType) {
  return uiType === 'incapacidad_ccss' || uiType === 'incapacidad_ins';
}

function applyIssuerCertVisibility() {
  const typeEl = $('#leaveType');
  const issuerWrap = $('#issuerWrap');
  const certWrap = $('#certWrap');
  const issuerEl = $('#leaveIssuer');
  const certEl = $('#leaveCert');

  const uiType = (typeEl?.value || '').trim();
  const show = isUiIncapacity(uiType);

  if (issuerWrap) issuerWrap.style.display = show ? '' : 'none';
  if (certWrap) certWrap.style.display = show ? '' : 'none';

  // si no aplica, limpiamos valores para no enviar basura
  if (!show) {
    if (issuerEl) issuerEl.value = '';
    if (certEl) certEl.value = '';
  }

  console.log('[LICENCIAS] applyIssuerCertVisibility uiType=', uiType, 'show=', show);
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

    // ocultar/mostrar campos (y limpiar si no aplica) antes de construir payload
    applyIssuerCertVisibility();

    const dbType = mapUiTypeToDb(uiType);
    const payload = {
      employee_uid: st.employee.uid,
      leave_type: dbType,
      date_start: dateStart,
      date_end: dateEnd,
      issuer: isUiIncapacity(uiType) ? (issuer || null) : null,
      certificate_no: isUiIncapacity(uiType) ? (cert || null) : null,
      notes: notes || null,

      // Si tu tabla tiene status por defecto, perfecto.
      // Si no, igual dejamos que la BD maneje defaults.
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

    // Limpiar formulario (y limpiar el mensaje al tocar algo luego)
    if (typeEl) typeEl.value = '';
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    if (issuerEl) issuerEl.value = '';
    if (certEl) certEl.value = '';
    if (notesEl) notesEl.value = '';

    applyIssuerCertVisibility();

    // ✅ Recargar resumen e historial (por created_at)
    await loadLatestSummary();
    await loadHistory();
  } catch (err) {
    console.error('[LICENCIAS] submitLeave catch:', err);
    setFormMsg('Error inesperado al guardar la licencia.', true);
  } finally {
    const btn = $('#btnSubmit');
    if (btn) btn.disabled = false;
  }
}

// ==== CARGAR RESUMEN DE LA ÚLTIMA SOLICITUD (POR created_at DESC) ====
async function loadLatestSummary() {
  console.log('[LICENCIAS] loadLatestSummary…');
  const box = $('#summaryBox');
  if (!box) return;

  if (!st.employee?.uid) {
    showSummaryCard(false);
    return;
  }

  showSummaryCard(true);
  box.textContent = 'Cargando resumen…';

  try {
    // Traer la última creación real
    const { data, error } = await supabase
      .from('employee_leaves')
      .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, created_at, status')
      .eq('employee_uid', st.employee.uid)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[LICENCIAS] loadLatestSummary error:', error);
      box.textContent = 'No se pudo cargar el resumen.';
      return;
    }

    const r = (data && data[0]) ? data[0] : null;
    if (!r) {
      showSummaryCard(false);
      return;
    }

    console.log('[LICENCIAS] Última solicitud (created_at desc):', r);

    const daysNatural = diffDaysInclusive(r.date_start, r.date_end);
    const stNorm = normStatus(r.status);
    const typeLabel = prettyType(r.leave_type, null);

    // Para incapacidad: como el pago lo define administración, dejamos un texto informativo
    let payInfo = '';
    if (r.leave_type === 'INCAPACIDAD') {
      payInfo = 'El pago puede dividirse entre patrono y CCSS/INS según aprobación.';
    } else if (r.leave_type === 'VACACIONES') {
      payInfo = 'El rebajo de vacaciones se valida cuando administración revise/apruebe.';
    } else {
      payInfo = 'El detalle de pago se valida cuando administración revise/apruebe.';
    }

    box.innerHTML = `
      <div>
        <div class="summaryTitle">Resumen</div>
        <div class="summarySub">Este resumen es informativo para tu solicitud más reciente.</div>

        <div style="margin:10px 0 14px;">
          <span class="statusBadge ${stNorm}">${statusLabel(stNorm)}</span>
        </div>

        <div class="summaryGrid">
          <div class="summaryRow">
            <div class="summaryKey">Tipo:</div>
            <div class="summaryVal">${typeLabel}</div>
          </div>

          <div class="summaryRow">
            <div class="summaryKey">Rango:</div>
            <div class="summaryVal">${fmtRange(r.date_start, r.date_end)}</div>
          </div>

          <div class="summaryRow">
            <div class="summaryKey">Días naturales:</div>
            <div class="summaryVal">${daysNatural}</div>
          </div>

          ${r.leave_type === 'INCAPACIDAD' ? `
            <div class="summaryRow">
              <div class="summaryKey">Emisor:</div>
              <div class="summaryVal">${r.issuer || '—'}</div>
            </div>
            <div class="summaryRow">
              <div class="summaryKey">Certificado:</div>
              <div class="summaryVal">${r.certificate_no || '—'}</div>
            </div>
          ` : ''}

          <div class="summaryRow">
            <div class="summaryKey">Notas:</div>
            <div class="summaryVal">${(r.notes || '—').toString().replace(/</g,'&lt;')}</div>
          </div>
        </div>

        <div class="summaryHint">
          ${payInfo}<br>
          El estado puede cambiar cuando administración apruebe o deniegue la solicitud.
        </div>
      </div>
    `;
  } catch (err) {
    console.error('[LICENCIAS] loadLatestSummary catch:', err);
    box.textContent = 'Error inesperado al cargar el resumen.';
  }
}

// ==== CARGAR HISTORIAL (POR created_at DESC, NO por date_start) ====
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
      .select('id, leave_type, date_start, date_end, issuer, certificate_no, notes, created_at, status')
      .eq('employee_uid', st.employee.uid)
      .order('created_at', { ascending: false }) // ✅ clave para que concuerde con resumen
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
        const notes = r.notes || '—';
        const badgeClass = r.leave_type || 'OTRO';
        const label = prettyType(r.leave_type, null);

        const stNorm = normStatus(r.status);
        const stLbl = statusLabel(stNorm);

        // ✅ En móvil: compactamos y ocultamos emisor/cert (si quisieras mostrar, lo activamos)
        return `
          <tr>
            <td>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <span class="badge ${badgeClass}">${label}</span>
                <span class="statusMini ${stNorm}">${stLbl}</span>
              </div>
            </td>
            <td>${d1}</td>
            <td>${d2}</td>
            <td>${notes}</td>
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
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
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

// ==== LIMPIAR MENSAJES AL EDITAR (evita “ya fue enviada” pegado) ====
function bindClearMsgOnChange() {
  const ids = ['leaveType','leaveFrom','leaveTo','leaveIssuer','leaveCert','leaveNotes'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ev = (el.tagName === 'SELECT' || el.tagName === 'INPUT') ? 'change' : 'input';
    el.addEventListener(ev, () => {
      console.log('[LICENCIAS] clear msg on change:', id);
      clearFormMsg();
    });
    // para textarea, también input
    if (id === 'leaveNotes') {
      el.addEventListener('input', () => clearFormMsg());
    }
  });

  // tipo -> toggle issuer/cert
  const typeEl = $('#leaveType');
  if (typeEl) {
    typeEl.addEventListener('change', () => {
      applyIssuerCertVisibility();
      clearFormMsg();
    });
  }
}

// ==== BOOT ====
async function bootLicencias() {
  console.log('[LICENCIAS] BOOT start');

  bindNavButtons();
  bindClearMsgOnChange();
  applyIssuerCertVisibility(); // estado inicial (oculto)

  const ok = await loadSessionAndEmployee();
  if (!ok) {
    console.warn('[LICENCIAS] No se pudo cargar sesión/empleado.');
    return;
  }

  // Listener submit
  const btnSubmit = $('#btnSubmit');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', (ev) => {
      ev.preventDefault();
      submitLeave();
    });
  }

  // Cargar resumen + historial al entrar
  await loadLatestSummary();
  await loadHistory();
}

// Iniciar al cargar DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
