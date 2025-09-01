// ===============================
//  Portal TMI · app.js (v14 LOG)
// ===============================

// Log global
window.addEventListener('error', (e) => console.error('[APP] window.error:', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[APP] unhandledrejection:', e.reason));

// === CONFIG SUPABASE ===
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('AQUI')) {
  alert('⚠️ Falta configurar SUPABASE_URL o SUPABASE_ANON_KEY en assets/app.js');
  throw new Error('Missing Supabase config');
}
console.log('[APP] creando cliente Supabase…');
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === STATE ===
const st = {
  user: null,
  employee: null,        // { uid, code, full_name }
  sessionOpen: null,     // última work_session abierta
  requiredMinutes: 0,    // minutos trabajados (con margen aplicado)
  allocRows: [],         // [{ project_code, minutes }]
  projects: [],          // catálogo de proyectos activos
  clientFilter: '',      // filtro por cliente
  lastOverWarnAt: 0,
};

// === REGLAS / UTILIDADES TIEMPO ===
const GRACE_MINUTES = 10; // margen para poder cerrar (±10 min)
const fmt2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const minToHM = (mins) => `${fmt2(Math.floor((mins || 0) / 60))}:${fmt2(Math.abs(mins || 0) % 60)}`;
const hmToMin = (hhmm) => { if (!hhmm) return 0; const [h, m] = hhmm.split(':').map(v => parseInt(v || '0', 10)); return (h * 60 + (m || 0)) | 0; };
const todayStr = () => new Date().toISOString().slice(0, 10);

// Verificar si ya existe una jornada cerrada hoy (solo para ADVERTIR al IN)
async function hasClosedSessionToday() {
  const { data, error } = await supabase
    .from('work_sessions')
    .select('id')
    .eq('employee_uid', st.employee.uid)
    .eq('session_date', todayStr())
    .eq('status', 'CLOSED')
    .limit(1);

  if (error) {
    console.error('[APP] hasClosedSessionToday error:', error);
    return false;
  }
  return (data && data.length > 0);
}

// === HELPERS UI ===
const $ = (s) => document.querySelector(s);
const show = (el) => el && (el.style.display = '');
const hide = (el) => el && (el.style.display = 'none');
function toast(el, msg){ if(!el) return; el.textContent = msg || ''; if(!msg) return; setTimeout(()=>{ if(el.textContent===msg) el.textContent=''; },6000); }

// === ROUTER ===
function routeTo(path) {
  console.log('[APP] routeTo', path);
  history.replaceState({}, '', path);
  hide($('#authCard')); hide($('#resetCard')); hide($('#homeCard'));
  hide($('#punchCard')); hide($('#projectsCard')); hide($('#leaveCard')); hide($('#payslipsCard'));

  if (path === '/' || path === '/login') show($('#authCard'));
  else if (path === '/reset') show($('#resetCard'));
  else if (path === '/app') show($('#homeCard'));
  else if (path === '/marcas') show($('#punchCard'));
  else if (path === '/proyectos') show($('#projectsCard'));
  else if (path === '/licencias') show($('#leaveCard'));
  else if (path === '/comprobantes') show($('#payslipsCard'));
}

// === GEO ===
async function getGPS() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => res(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
    );
  });
}

// === AUTH ===
async function loadSession() {
  console.log('[APP] loadSession…');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.error('[APP] getSession error:', error);
  st.user = session?.user || null;
  console.log('[APP] session user:', st.user?.email || null);
  return st.user;
}
async function signIn(email, password) {
  console.log('[APP] signIn', email);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
async function sendReset(email) {
  console.log('[APP] sendReset', email);
  const redirectTo = `${location.origin}/reset`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}
async function signOut() {
  console.log('[APP] signOut');
  await supabase.auth.signOut();
  st.user = null; st.employee = null;
  routeTo('/');
}

// === EMPLEADO ===
async function loadEmployeeContext() {
  console.log('[APP] loadEmployeeContext');
  let { data, error } = await supabase.from('employees')
    .select('employee_uid, employee_code, full_name, login_enabled')
    .eq('user_id', st.user.id).single();

  if (error || !data) {
    console.warn('[APP] employee por user_id no encontrado; probando por email…', error);
    const r = await supabase.from('employees')
      .select('employee_uid, employee_code, full_name, login_enabled')
      .eq('email', st.user.email).single();
    data = r.data || null;
  }
  if (!data) throw new Error('No se encontró el empleado');
  if (data.login_enabled === false) throw new Error('Usuario deshabilitado');

  st.employee = {
    uid: data.employee_uid,
    code: data.employee_code || null,
    full_name: data.full_name || '(sin nombre)',
  };

  $('#empName').textContent = st.employee.full_name;
  $('#empUid').textContent = `employee_uid: ${st.employee.uid}`;
  if ($('#empName2')) $('#empName2').textContent = st.employee.full_name;
  if ($('#empUid2'))  $('#empUid2').textContent  = `employee_uid: ${st.employee.uid}`;
  console.log('[APP] employee OK:', st.employee);
}

// === STATUS + RECIENTES ===
async function loadStatusAndRecent() {
  console.log('[APP] loadStatusAndRecent');

  // Estado por defecto
  let estado = 'Fuera';
  let minsHoy = 0;

  // ⏰ Medianoche local de HOY (todo “de hoy” parte de aquí)
  const midnightLocal = new Date();
  midnightLocal.setHours(0, 0, 0, 0);
  const midnightTs  = midnightLocal.getTime();
  const midnightISO = midnightLocal.toISOString();
  const nowTs = Date.now();

  // 1) Última sesión -> saber si hay jornada abierta
  {
    const { data, error } = await supabase
      .from('work_sessions')
      .select('id, start_at, end_at, status')
      .eq('employee_uid', st.employee.uid)
      .order('start_at', { ascending: false })
      .limit(1);
    if (error) console.error('[APP] work_sessions last error:', error);
    const ws = data && data[0];
    st.sessionOpen = (ws && ws.status === 'OPEN') ? ws : null;
    if (st.sessionOpen) estado = 'Dentro';
    console.log('[APP] sessionOpen:', st.sessionOpen);
  }

  // 2) “Horas de hoy”: suma solo lo que cae desde medianoche local.
  //    Incluye sesiones que empezaron ayer pero siguen abiertas o terminaron hoy.
  {
    const { data, error } = await supabase
      .from('work_sessions')
      .select('start_at, end_at')
      .eq('employee_uid', st.employee.uid)
      .or(`start_at.gte.${midnightISO},end_at.gte.${midnightISO},end_at.is.null`);
    if (error) console.error('[APP] minutes today error:', error);

    minsHoy = 0;
    if (data && data.length) {
      minsHoy = data.reduce((acc, r) => {
        const s = new Date(r.start_at).getTime();
        const e = r.end_at ? new Date(r.end_at).getTime() : nowTs;
        const effStart = Math.max(s, midnightTs); // solo desde hoy
        const deltaMin = Math.max(0, Math.round((e - effStart) / 60000));
        return acc + deltaMin;
      }, 0);
    }
  }

  // 3) Header “Estado actual / Horas de hoy”
  const punch = $('#punchCard');
  if (punch) {
    const old = punch.querySelector('.card.inner.statusHdr');
    if (old) old.remove();
    const hdr = document.createElement('div');
    hdr.className = 'card inner statusHdr';
    hdr.innerHTML = `
      <div><strong>Estado actual:</strong> ${estado}</div>
      <div class="muted">Horas de hoy: ${minToHM(minsHoy)}</div>
    `;
    const ref = punch.querySelector('.row.gap.m-t');
    if (ref) punch.insertBefore(hdr, ref);
    else punch.prepend(hdr);
  }

  // 4) Botones IN/OUT
  const btnIn  = $('#btnIn');
  const btnOut = $('#btnOut');
  if (btnIn)  btnIn.disabled  = (estado === 'Dentro');
  if (btnOut) btnOut.disabled = (estado !== 'Dentro');
  toast($('#punchMsg'), '');

  // 5) Últimas marcas (solo desde medianoche local)
  {
    const { data: tps, error: eTP } = await supabase
      .from('time_punches')
      .select('direction, punch_at, latitude, longitude')
      .eq('employee_uid', st.employee.uid)
      .gte('punch_at', midnightISO)
      .order('punch_at', { ascending: false })
      .limit(10);
    if (eTP) console.error('[APP] time_punches error:', eTP);

    const recentEl = $('#recentPunches');
    if (recentEl) {
      recentEl.innerHTML = (!tps || !tps.length)
        ? 'Sin marcas aún.'
        : tps.map(tp => {
            const d = new Date(tp.punch_at);
            const loc = (tp.latitude && tp.longitude)
              ? ` (${tp.latitude.toFixed(5)}, ${tp.longitude.toFixed(5)})`
              : '';
            return `<div><strong>${tp.direction}</strong> — ${d.toLocaleString()}${loc}</div>`;
          }).join('');
    }
  }

  // 6) Minutos REQUERIDOS (con margen)
  if (st.sessionOpen) {
    const start = new Date(st.sessionOpen.start_at).getTime();
    const effectiveStart = (start < midnightTs) ? midnightTs : start; // si empezó ayer, cuenta desde hoy
    const diffMin = Math.max(0, Math.round((nowTs - effectiveStart) / 60000));
    st.requiredMinutes = Math.max(0, diffMin - GRACE_MINUTES);
  } else {
    st.requiredMinutes = 0;
  }
  $('#allocRequiredHM')?.textContent = minToHM(st.requiredMinutes);

  // 7) UI asignaciones
  await prepareAllocUI();
}

// === PROYECTOS ===
async function loadProjects(client = null) {
  let q = supabase.from('projects')
    .select('project_code, name, description, client_name')
    .eq('is_active', true)
    .order('client_name', { ascending: true })
    .order('project_code', { ascending: true });
  if (client) q = q.eq('client_name', client);
  const { data, error } = await q;
  if (error) { console.error('[APP] loadProjects error:', error); return []; }
  return data || [];
}

// === ASIGNACIONES existentes ===
async function loadExistingAllocations() {
  if (!st.sessionOpen) return [];
  const { data, error } = await supabase.from('work_session_allocations')
    .select('project_code, minutes_alloc')
    .eq('session_id', st.sessionOpen.id)
    .order('project_code', { ascending: true });
  if (error) { console.error('[APP] loadExistingAllocations error:', error); return []; }
  return (data || []).map(r => ({ project_code: r.project_code, minutes: r.minutes_alloc || 0 }));
}

// === UI ASIGNACIONES ===
function renderAllocContainer() {
  const cont = $('#allocContainer');
  cont.innerHTML = '';

  const filter = st.clientFilter || '';

  st.allocRows.forEach((row, idx) => {
    const line = document.createElement('div');
    line.className = 'allocRow';

    // SELECT proyectos
    const sel = document.createElement('select');
    sel.className = 'allocSelect';
    const optEmpty = document.createElement('option');
    optEmpty.value = ''; optEmpty.textContent = '— Selecciona proyecto —';
    sel.appendChild(optEmpty);

    st.projects.forEach(p => {
      if (filter && p.client_name !== filter && p.project_code !== row.project_code) return;
      const o = document.createElement('option');
      o.value = p.project_code;
      o.textContent = `${p.project_code} — ${p.name || p.description || ''}`;
      if (p.project_code === row.project_code) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { row.project_code = sel.value; });

    // DURACIÓN HH:MM con dos inputs numéricos
    const h = document.createElement('input');
    h.type = 'number'; h.min = '0'; h.max = '24';
    h.value = Math.floor((row.minutes || 0) / 60);
    h.className = 'allocH';

    const m = document.createElement('input');
    m.type = 'number'; m.min = '0'; m.max = '59'; m.step = '1';
    m.value = Math.abs(row.minutes || 0) % 60;
    m.className = 'allocM';

    const onDurChange = () => {
      let hv = parseInt(h.value || '0', 10); if (hv < 0) hv = 0;
      let mv = parseInt(m.value || '0', 10); if (mv < 0) mv = 0;
      if (mv > 59) { hv += Math.floor(mv / 60); mv = mv % 60; }
      h.value = hv; m.value = mv;
      row.minutes = hv * 60 + mv;
      updateAllocTotals();
    };
    h.addEventListener('input', onDurChange);
    m.addEventListener('input', onDurChange);

    const dur = document.createElement('div');
    dur.className = 'allocDuration';
    const sep = document.createElement('span');
    sep.textContent = ':'; sep.className = 'allocSep';
    dur.appendChild(h); dur.appendChild(sep); dur.appendChild(m);

    // Botón eliminar
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn light small'; del.textContent = 'Quitar';
    del.addEventListener('click', () => { st.allocRows.splice(idx, 1); renderAllocContainer(); updateAllocTotals(); });

    // ENSAMBLE
    line.appendChild(sel);
    line.appendChild(dur);
    line.appendChild(del);
    cont.appendChild(line);
  });
}

// --- Sincroniza minutos desde los inputs al estado antes de guardar ---
function syncAllocFromInputs() {
  const rowsEls = [...document.querySelectorAll('#allocContainer .allocRow')];
  rowsEls.forEach((el, i) => {
    const h = el.querySelector('.allocH');
    const m = el.querySelector('.allocM');
    if (!h || !m || !st.allocRows[i]) return;
    let hv = parseInt(h.value || '0', 10) || 0;
    let mv = parseInt(m.value || '0', 10) || 0;
    if (mv > 59) { hv += Math.floor(mv / 60); mv = mv % 60; }
    st.allocRows[i].minutes = hv * 60 + mv;
  });
}

function validAllocRows() {
  return st.allocRows.filter(r => r.project_code && (parseInt(r.minutes || 0, 10) > 0));
}

function remainingMinutes() {
  const tot = validAllocRows().reduce((a, r) => a + (r.minutes || 0), 0);
  return Math.max(0, st.requiredMinutes - tot);
}

function updateAllocTotals() {
  const tot = validAllocRows().reduce((a, r) => a + (parseInt(r.minutes || 0, 10) || 0), 0);
  const req = st.requiredMinutes;

  $('#allocTotalHM')?.textContent = minToHM(tot);
  $('#allocRequiredHM')?.textContent = minToHM(req);

  const info = $('#allocInfo');
  let ok = false;

  if (tot < req) {
    info && (info.textContent = `Faltan ${minToHM(req - tot)}. Completa la jornada.`);
  } else if (tot > req + GRACE_MINUTES) {
    info && (info.textContent = `Te pasaste ${minToHM(tot - req)}. Reduce algún proyecto.`);
  } else {
    info && (info.textContent = 'Listo: cubre la jornada.');
    ok = true;
  }

  // Solo se bloquea por no cubrir tiempo o no haber sesión abierta.
  const outBtn = $('#btnOut');
  if (outBtn) outBtn.disabled = !(st.sessionOpen && ok);
}

async function prepareAllocUI() {
  // Cargar catálogo una vez
  if (!st.projects.length) {
    const { data } = await supabase.from('projects')
      .select('project_code, client_name, name, description')
      .order('client_name', { ascending: true })
      .order('project_code', { ascending: true });
    st.projects = data || [];

    // Filtro de clientes
    const clients = [...new Set(st.projects.map(p => p.client_name).filter(Boolean))].sort();
    const selClient = $('#allocClient');
    if (selClient && selClient.options.length === 1) {
      clients.forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c; selClient.appendChild(o);
      });
      selClient.addEventListener('change', () => {
        st.clientFilter = selClient.value || '';
        renderAllocContainer();
        updateAllocTotals();
      });
    }
  }

  // Prellenar con lo guardado si existe
  if (st.sessionOpen) {
    if (st.allocRows.length === 0) {
      const prev = await loadExistingAllocations();
      st.allocRows = prev.length ? prev : [{ project_code: '', minutes: st.requiredMinutes }];
    }
  } else {
    st.allocRows = [];
  }

  renderAllocContainer();
  updateAllocTotals();
}

// === MARCAR IN/OUT ===
async function mark(direction) {
  console.log('[APP] mark', direction);
  const gps = await getGPS();
  const payload = {
    employee_uid: st.employee.uid,
    direction,
    latitude: gps?.lat ?? null,
    longitude: gps?.lon ?? null,
  };
  if (st.employee.code) payload.employee_code = st.employee.code;
  const { error } = await supabase.from('time_punches').insert(payload).select().single();
  if (error) throw error;
}

async function onMarkIn() {
  try {
    console.log('[APP] CLICK ENTRADA]');

    // Advertir si ya hubo una jornada cerrada hoy (no bloquea)
    const alreadyClosedToday = await hasClosedSessionToday();
    if (alreadyClosedToday) {
      const ok = window.confirm(
        'Ya registraste una jornada para este día.\n' +
        '¿Quieres iniciar otra? Esto puede afectar cálculos de planilla y generar reclamos posteriores.'
      );
      if (!ok) return; // cancela
    }

    $('#btnIn') && ($('#btnIn').disabled = true);

    await mark('IN');
    toast($('#punchMsg'), 'Entrada registrada.');
  } catch (e) {
    console.error('[APP] onMarkIn error:', e);
    toast($('#punchMsg'), `Error al marcar: ${e.message}`);
  } finally {
    await loadStatusAndRecent();
  }
}

async function onMarkOut() {
  try {
    console.log('[APP] CLICK SALIDA');

    // ⛔ NO refrescar antes (no pisar lo que ajustó el usuario)
    // await loadStatusAndRecent();

    // Validar y guardar asignación
    const ok = await onSaveAlloc(true);
    if (!ok) return;

    // Marcar salida
    $('#btnOut') && ($('#btnOut').disabled = true);
    await mark('OUT');

    toast($('#punchMsg'), 'Salida registrada.');
  } catch (e) {
    console.error('[APP] onMarkOut error:', e);
    toast($('#punchMsg'), `Error al marcar: ${e.message}`);
  } finally {
    // ✅ refrescar después
    await loadStatusAndRecent();
  }
}

// + Proyecto (precarga con tiempo restante)
function onAddAlloc() {
  if (!st.sessionOpen) return;
  if (st.allocRows.length >= 3) { toast($('#punchMsg'), 'Máximo 3 proyectos por jornada.'); return; }
  const rem = remainingMinutes();
  if (rem <= 0) { toast($('#punchMsg'), 'Ya asignaste todo el tiempo trabajado.'); return; }
  st.allocRows.push({ project_code: '', minutes: rem });
  renderAllocContainer(); updateAllocTotals();
}

// Guardar asignación (parcial o para cerrar)
async function onSaveAlloc(forClosing = false) {
  try {
    if (!st.sessionOpen) throw new Error('No hay jornada abierta.');

    // forzar que lo que ves en inputs sea lo que guardamos
    syncAllocFromInputs();

    const tot = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes || 0, 10) || 0), 0);

    if (forClosing) {
      const lower = Math.max(0, st.requiredMinutes - 1); // colchón 1 min
      const upper = st.requiredMinutes + GRACE_MINUTES;  // worked + tolerancia

      if (tot < lower) throw new Error(`Faltan ${minToHM(st.requiredMinutes - tot)}.`);
      if (tot > upper) throw new Error(`Te pasaste ${minToHM(tot - st.requiredMinutes)}.`);
    }

    const sid = st.sessionOpen.id;
    await supabase.from('work_session_allocations').delete().eq('session_id', sid);

    const rows = st.allocRows
      .filter(r => r.project_code && (parseInt(r.minutes, 10) > 0))
      .map(r => ({ session_id: sid, project_code: r.project_code, minutes_alloc: parseInt(r.minutes, 10) }));

    if (rows.length) {
      const { error } = await supabase.from('work_session_allocations').insert(rows);
      if (error) throw error;
    }

    toast($('#punchMsg'), forClosing ? 'Asignación válida. Puedes marcar salida.' : 'Asignación guardada.');
    console.log('[APP] saveAlloc OK:', rows);
    return true;
  } catch (e) {
    console.error('[APP] onSaveAlloc error:', e);
    toast($('#punchMsg'), `Error al guardar: ${e.message}`);
    return false;
  } finally {
    updateAllocTotals();
  }
}

// === NAV ===
function setNavListeners() {
  console.log('[APP] setNavListeners');
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const to = el.getAttribute('data-nav');
      routeTo(to);
      if (to === '/marcas') loadStatusAndRecent();
    });
  });
  $('#btnLogout')?.addEventListener('click', signOut);
  $('#btnLogout2')?.addEventListener('click', signOut);
  $('#btnIn')?.addEventListener('click', onMarkIn);
  $('#btnOut')?.addEventListener('click', onMarkOut);
  $('#btnAddAlloc')?.addEventListener('click', onAddAlloc);
  $('#btnSaveAlloc')?.addEventListener('click', () => onSaveAlloc(false));
}

// === BOOT ===
async function boot() {
  console.log('[APP] BOOT start…');
  const hash = location.pathname;
  const params = new URLSearchParams(location.hash?.split('?')[1] || location.search);
  const type = params.get('type');
  if (hash.startsWith('/reset') || type === 'recovery') routeTo('/reset');

  setNavListeners();

  const user = await loadSession();
  if (!user) {
    console.log('[APP] Sin sesión → login');
    routeTo('/');
    $('#btnLogin')?.addEventListener('click', async () => {
      try {
        console.log('[APP] CLICK Entrar');
        const email = $('#email').value.trim();
        const password = $('#password').value;
        $('#btnLogin').disabled = true;
        await signIn(email, password);
        await loadSession();
        await loadEmployeeContext();
        routeTo('/app');
      } catch (e) {
        console.error('[APP] signIn error:', e);
        toast($('#msg'), e.message);
      } finally {
        $('#btnLogin').disabled = false;
      }
    });
    $('#btnForgot')?.addEventListener('click', async () => {
      try {
        console.log('[APP] CLICK Forgot');
        const email = $('#email').value.trim();
        if (!email) throw new Error('Escribe tu correo y vuelve a pulsar “¿Olvidaste…?”');
        await sendReset(email);
        toast($('#msg'), 'Te enviamos un correo con el enlace para restablecer.');
      } catch (e) {
        console.error('[APP] reset error:', e);
        toast($('#msg'), e.message);
      }
    });
    $('#btnSetNew')?.addEventListener('click', async () => {
      try {
        console.log('[APP] CLICK SetNew');
        const pw = $('#newPassword').value;
        if (!pw || pw.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) throw error;
        toast($('#msg2'), 'Contraseña actualizada. Ya puedes iniciar sesión.');
      } catch (e) {
        console.error('[APP] update password error:', e);
        toast($('#msg2'), e.message);
      }
    });
    $('#btnCancelReset')?.addEventListener('click', () => routeTo('/'));
    return;
  }

  try {
    console.log('[APP] Sesión activa → cargar contexto empleado');
    await loadEmployeeContext();
    routeTo('/app');
  } catch (e) {
    console.error('[APP] loadEmployeeContext error:', e);
    toast($('#msg'), e.message);
    await signOut();
  }
}
boot();
