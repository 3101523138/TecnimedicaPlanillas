// activos/licencias.js
// ====================
// Módulo independiente para gestionar licencias del empleado
// Usa la tabla employee_leaves y la misma instancia de Supabase del portal.

window.addEventListener('error', (e) =>
  console.error('[LICENCIAS] window.error:', e.message, e.filename, e.lineno)
);
window.addEventListener('unhandledrejection', (e) =>
  console.error('[LICENCIAS] unhandledrejection:', e.reason)
);

// === CONFIG SUPABASE (MISMA QUE EN EL PORTAL) ===
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('AQUI')) {
  alert('⚠️ Falta configurar SUPABASE_URL o SUPABASE_ANON_KEY en activos/licencias.js');
  throw new Error('Missing Supabase config (licencias)');
}
console.log('[LICENCIAS] creando cliente Supabase…');
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === STATE ===
const st = {
  user: null,
  employee: null, // { uid, code, full_name }
};

// === HELPERS UI ===
const $ = (sel) => document.querySelector(sel);

function toast(el, msg) {
  if (!el) return;
  el.textContent = msg || '';
  if (!msg) return;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = '';
  }, 6000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function minToHM(mins) {
  const m = Math.max(0, mins | 0);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const fmt2 = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${fmt2(h)}:${fmt2(mm)}`;
}

// === AUTH / SESIÓN ===
async function loadSession() {
  console.log('[LICENCIAS] loadSession…');
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error('[LICENCIAS] getSession error:', error);
  st.user = data?.session?.user || null;
  console.log('[LICENCIAS] user:', st.user?.email || null);
  return st.user;
}

function clearAuthStorage() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach((k) => {
      if (k.startsWith('sb-') || k.startsWith('supabase.')) {
        localStorage.removeItem(k);
      }
    });
    const skeys = Object.keys(sessionStorage);
    skeys.forEach((k) => {
      if (k.startsWith('sb-') || k.startsWith('supabase.')) {
        sessionStorage.removeItem(k);
      }
    });
  } catch (e) {
    console.warn('[LICENCIAS] clearAuthStorage warn:', e);
  }
}

async function signOut() {
  console.log('[LICENCIAS] signOut…');
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('[LICENCIAS] signOut error:', e?.message || e);
  }
  clearAuthStorage();
  // Volver al portal principal
  window.location.href = './index.html';
}

// === EMPLEADO ===
async function loadEmployeeContext() {
  console.log('[LICENCIAS] loadEmployeeContext…');
  if (!st.user) throw new Error('Sin usuario autenticado.');

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
  }

  if (!data) throw new Error('No se encontró el empleado.');
  if (data.login_enabled === false) throw new Error('Usuario deshabilitado.');

  st.employee = {
    uid: data.employee_uid,
    code: data.employee_code || null,
    full_name: data.full_name || '(sin nombre)',
  };

  const nameEl = $('#empNameLic');
  if (nameEl) nameEl.textContent = st.employee.full_name;

  console.log('[LICENCIAS] employee OK:', st.employee);
  return st.employee;
}

// === LICENCIAS: CARGAR HISTORIAL ===
async function loadLeavesView() {
  console.log('[LICENCIAS] loadLeavesView…');

  const listEl = $('#leaveList');
  if (listEl) listEl.textContent = 'Cargando licencias…';

  if (!st.employee?.uid) {
    console.warn('[LICENCIAS] loadLeavesView: sin employee.uid');
    if (listEl) listEl.textContent = 'No se encontró el empleado.';
    return;
  }

  try {
    const { data, error } = await supabase
      .from('employee_leaves')
      .select(
        'id, leave_type, date_start, date_end, issuer, certificate_no, notes, created_at'
      )
      .eq('employee_uid', st.employee.uid)
      .order('date_start', { ascending: false })
      .limit(50);

    if (error) throw error;

    if (!listEl) return;

    if (!data || data.length === 0) {
      listEl.textContent = 'Sin licencias registradas.';
      return;
    }

    listEl.innerHTML = data
      .map((r) => {
        const ds = r.date_start || '';
        const de = r.date_end || r.date_start || '';
        const rango =
          ds && de && ds !== de ? `${ds} → ${de}` : ds || de || '';
        const issuer = r.issuer ? ` · ${escapeHtml(r.issuer)}` : '';
        const cert = r.certificate_no
          ? ` · ${escapeHtml(r.certificate_no)}`
          : '';
        const notes = r.notes
          ? `<div class="leaveNotes">${escapeHtml(r.notes)}</div>`
          : '';

        const created = r.created_at
          ? new Date(r.created_at).toLocaleString('es-CR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : '';

        return `
          <div class="leaveItem">
            <div class="leaveMain">
              <strong>${escapeHtml(r.leave_type || 'SIN TIPO')}</strong>
              ${
                rango
                  ? `<span class="leaveRange">${escapeHtml(rango)}</span>`
                  : ''
              }
            </div>
            <div class="leaveMeta">
              ${created ? `Creado: ${escapeHtml(created)}` : ''}
              ${issuer}${cert}
            </div>
            ${notes}
          </div>
        `;
      })
      .join('');
  } catch (e) {
    console.error('[LICENCIAS] loadLeavesView error:', e);
    if (listEl) listEl.textContent = 'Error al cargar licencias.';
  }
}

// === LICENCIAS: GUARDAR NUEVA ===
async function onSaveLeave() {
  console.log('[LICENCIAS] onSaveLeave…');
  const msgEl = $('#leaveMsg');

  try {
    if (!st.employee?.uid) throw new Error('Empleado no identificado.');

    const typeEl = $('#leaveType');
    const startEl = $('#leaveStart');
    const endEl = $('#leaveEnd');
    const issuerEl = $('#leaveIssuer');
    const certEl = $('#leaveCert');
    const notesEl = $('#leaveNotes');
    const btn = $('#btnLeaveSave');

    const type = (typeEl?.value || '').trim();
    const ds = (startEl?.value || '').trim();
    const deRaw = (endEl?.value || '').trim();
    const issuer = (issuerEl?.value || '').trim();
    const cert = (certEl?.value || '').trim();
    const notes = (notesEl?.value || '').trim();

    if (!type) {
      toast(msgEl, 'Selecciona el tipo de licencia.');
      typeEl?.focus();
      return;
    }
    if (!ds) {
      toast(msgEl, 'Indica la fecha de inicio.');
      startEl?.focus();
      return;
    }

    const de = deRaw || ds;
    if (de < ds) {
      toast(msgEl, 'La fecha final no puede ser anterior a la de inicio.');
      endEl?.focus();
      return;
    }

    const payload = {
      employee_uid: st.employee.uid,
      leave_type: type,
      date_start: ds,
      date_end: de,
      issuer: issuer || null,
      certificate_no: cert || null,
      notes: notes || null,
    };

    console.log('[LICENCIAS] insert payload:', payload);
    if (btn) btn.disabled = true;

    const { error } = await supabase.from('employee_leaves').insert(payload);
    if (error) throw error;

    toast(msgEl, 'Solicitud registrada. RRHH la revisará.');

    // limpiar formulario
    if (typeEl) typeEl.value = '';
    if (startEl) startEl.value = '';
    if (endEl) endEl.value = '';
    if (issuerEl) issuerEl.value = '';
    if (certEl) certEl.value = '';
    if (notesEl) notesEl.value = '';

    // recargar historial
    await loadLeavesView();
  } catch (e) {
    console.error('[LICENCIAS] onSaveLeave error:', e);
    toast(msgEl, e.message || 'Error al guardar la licencia.');
  } finally {
    const btn = $('#btnLeaveSave');
    if (btn) btn.disabled = false;
  }
}

// === BOOT ===
async function bootLicencias() {
  console.log('[LICENCIAS] BOOT start…');

  // Botones básicos
  $('#btnBack')?.addEventListener('click', () => {
    // volver al portal principal
    window.location.href = './index.html';
  });
  $('#btnLogout')?.addEventListener('click', signOut);
  $('#btnLeaveSave')?.addEventListener('click', onSaveLeave);

  const user = await loadSession();
  if (!user) {
    console.warn('[LICENCIAS] sin sesión → redirigiendo a login');
    window.location.href = './index.html';
    return;
  }

  try {
    await loadEmployeeContext();
    await loadLeavesView();
  } catch (e) {
    console.error('[LICENCIAS] boot error:', e);
    toast($('#leaveMsg'), e.message || 'Error al cargar la página.');
  }
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLicencias);
} else {
  bootLicencias();
}
