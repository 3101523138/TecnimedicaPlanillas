// === CONFIG SUPABASE ===
const SUPABASE_URL  = 'https://xducrljbdyneyihjcjvo.supabase.co'; // tu URL
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';  // tu anon key
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// === STATE ===
let currentUser   = null;
let currentEmp    = null; // {employee_uid, full_name, email}
let openSession   = null; // row de work_sessions con status OPEN (si existe)
let allProjects   = [];   // [{project_code, client_name, project_number, description}, ...]
let allocRows     = [];   // estado de filas UI [{project_code, minutes}]
let requiredMins  = 0;    // minutos requeridos = duración de sesión
let refreshTimer  = null; // para refrescar horas

// === DOM ===
const $ = (sel) => document.querySelector(sel);

// Cards
const authCard   = $('#authCard');
const resetCard  = $('#resetCard');
const homeCard   = $('#homeCard');
const punchCard  = $('#punchCard');

// Login/reset
$('#btnLogin')?.addEventListener('click', login);
$('#btnForgot')?.addEventListener('click', sendReset);
$('#btnSetNew')?.addEventListener('click', setNewPassword);
$('#btnCancelReset')?.addEventListener('click', () => go('/auth'));

// Home
$('#btnLogout')?.addEventListener('click', logout);
$('#btnLogout2')?.addEventListener('click', logout);

// Navegación tiles
document.querySelectorAll('[data-nav]').forEach(el => {
  el.addEventListener('click', () => go(el.getAttribute('data-nav')));
});

// Marcas
$('#btnIn')?.addEventListener('click', () => doPunch('IN'));
$('#btnOut')?.addEventListener('click', handleSalida);

// Asignación proyectos
$('#btnAddAlloc')?.addEventListener('click', addAllocRow);
$('#btnSaveAlloc')?.addEventListener('click', saveAllocations);

// --- ROUTER ---
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user || null;

  // ¿/reset? (enlace de recuperación)
  const p = new URLSearchParams(location.hash.replace('#',''));
  if (p.get('type') === 'recovery') return go('/reset');

  if (!currentUser) return go('/auth');

  // Cargar empleado
  const emp = await loadEmployeeForUser(currentUser);
  if (!emp) {
    showMsg('#msg', 'No estás habilitado para ingresar (consulta RRHH).');
    await supabase.auth.signOut();
    return go('/auth');
  }
  currentEmp = emp;

  // Ir a home
  go('/app');
}
window.addEventListener('load', boot);

// --- NAV ---
function show(card) {
  [authCard, resetCard, homeCard, punchCard].forEach(c => c.style.display='none');
  card.style.display = 'block';
}
function go(path) {
  if (path==='/auth') {
    show(authCard);
  } else if (path==='/reset') {
    show(resetCard);
  } else if (path==='/app') {
    show(homeCard);
    paintHome();
  } else if (path==='/marcas') {
    show(punchCard);
    paintPunch();
  } else {
    show(homeCard);
  }
}

// --- AUTH ---
async function login() {
  const email = $('#email').value.trim();
  const password = $('#password').value;
  showMsg('#msg', '');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return showMsg('#msg', error.message || 'Error de inicio de sesión');
  boot();
}
async function sendReset() {
  const email = $('#email').value.trim();
  showMsg('#msg', '');
  if (!email) return showMsg('#msg', 'Escribe tu correo y vuelve a presionar “¿Olvidaste tu contraseña?”.');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + '/#/type=recovery'
  });
  showMsg('#msg', error ? error.message : 'Te enviamos un correo con el enlace de recuperación.');
}
async function setNewPassword() {
  const newPassword = $('#newPassword').value;
  const { data: { session }, error } = await supabase.auth.updateUser({ password: newPassword });
  showMsg('#msg2', error ? error.message : 'Contraseña actualizada. Ya puedes iniciar sesión.');
  if (!error) setTimeout(()=>go('/auth'), 1500);
}
async function logout() {
  await supabase.auth.signOut();
  currentUser = null;
  currentEmp  = null;
  clearInterval(refreshTimer);
  showMsg('#msg', '');
  go('/auth');
}

// --- HELPERS ---
function showMsg(sel, txt) {
  const el = $(sel);
  if (el) el.textContent = txt || '';
}
function fmtHM(mins) {
  const h = Math.floor(mins/60);
  const m = Math.max(0, mins%60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function nowTz() { return new Date(); } // usamos hora del dispositivo

// --- DATA LOADERS ---
async function loadEmployeeForUser(user) {
  // Buscamos por email (tu flujo actual)
  const { data, error } = await supabase
    .from('employees')
    .select('employee_uid, full_name, email, login_enabled')
    .eq('email', user.email)
    .maybeSingle();
  if (error) return null;
  if (!data || data.login_enabled === false) return null;
  return { employee_uid: data.employee_uid, full_name: data.full_name, email: data.email };
}

async function loadOpenSession() {
  const { data, error } = await supabase
    .from('work_sessions')
    .select('*')
    .eq('employee_uid', currentEmp.employee_uid)
    .eq('status', 'OPEN')
    .order('start_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function loadLastPunches(limit=5) {
  const { data } = await supabase
    .from('time_punches')
    .select('punch_at, direction, latitude, longitude')
    .eq('employee_uid', currentEmp.employee_uid)
    .order('punch_at', { ascending: false })
    .limit(limit);
  return data || [];
}

async function loadProjects() {
  // Traemos catálogo general. Puedes añadir filtros por cliente más adelante.
  const { data, error } = await supabase
    .from('projects')
    .select('project_code, client_name, project_number, description')
    .order('client_name', { ascending: true });
  if (error) return [];
  return data || [];
}

async function loadAllocations(sessionId) {
  const { data } = await supabase
    .from('work_session_allocations')
    .select('id, project_code, minutes_alloc')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  return data || [];
}

// --- HOME ---
function paintHome() {
  $('#empName').textContent = currentEmp.full_name;
  $('#empUid').textContent  = `employee_uid: ${currentEmp.employee_uid}`;
}

// --- MARCAS + PROYECTOS ---
async function paintPunch() {
  // Pintar encabezado
  $('#empName2').textContent = currentEmp.full_name;
  $('#empUid2').textContent  = `employee_uid: ${currentEmp.employee_uid}`;

  // Cargar sesión abierta
  openSession = await loadOpenSession();

  // Estado / horas
  if (refreshTimer) clearInterval(refreshTimer);
  refreshPunchState();           // calcula requiredMins y actualiza UI
  refreshTimer = setInterval(refreshPunchState, 30_000); // cada 30s

  // Últimas marcas
  paintLastPunches();

  // Proyectos (catálogo) + asignaciones existentes
  allProjects = await loadProjects();
  await loadAndPaintAllocations();
  updateSalidaEnabled();
}

async function paintLastPunches() {
  const rows = await loadLastPunches();
  const box  = $('#recentPunches');
  if (!rows.length) { box.textContent = 'Sin marcas aún.'; return; }
  box.innerHTML = rows.map(r => {
    const d = new Date(r.punch_at);
    const pos = (r.latitude!=null && r.longitude!=null) ? ` (${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)})` : '';
    return `<div><strong>${r.direction}</strong> – ${d.toLocaleString()}${pos}</div>`;
  }).join('');
}

function refreshPunchState() {
  if (!openSession) {
    $('#punchMsg').textContent = 'Estado actual: Fuera';
    requiredMins = 0;
    $('#allocRequired').textContent = '0';
    $('#allocInfo').textContent = 'Asigna minutos cuando tengas una sesión abierta.';
    disableEntrada(false);
    disableSalida(true);
    return;
  }
  const start = new Date(openSession.start_at);
  const mins  = Math.max(0, Math.floor((nowTz() - start) / 60000));
  requiredMins = mins;
  $('#punchMsg').innerHTML = `Estado actual: <strong>Dentro</strong><br>Horas de hoy: ${fmtHM(mins)}`;
  $('#allocRequired').textContent = String(requiredMins);
  disableEntrada(true);  // si hay OPEN, ENTRADA deshabilitada
  // salida se habilita sólo si asignación >= requiredMins (updateSalidaEnabled)
}

function disableEntrada(disabled) {
  const b = $('#btnIn'); if (b) { b.disabled = disabled; b.classList.toggle('light', disabled); }
}
function disableSalida(disabled) {
  const b = $('#btnOut'); if (b) { b.disabled = disabled; b.classList.toggle('light', disabled); }
}

async function getGeo() {
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 5000 })
    );
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return { latitude: null, longitude: null };
  }
}

async function doPunch(direction) {
  if (!currentEmp) return;
  const geo = await getGeo();
  const payload = {
    employee_uid: currentEmp.employee_uid,
    direction,
    punch_at: new Date().toISOString(),
    latitude: geo.latitude,
    longitude: geo.longitude
  };
  const { error } = await supabase.from('time_punches').insert(payload).single();

  if (error) {
    // Mensaje especial si faltan asignaciones (regla de BD)
    if (error?.hint === 'ALLOCATIONS_MISSING') {
      showMsg('#punchMsg', error.message);
    } else {
      showMsg('#punchMsg', `Error al marcar: ${error.message || 'Desconocido'}`);
    }
  } else {
    // Refrescar todo
    openSession = await loadOpenSession();
    refreshPunchState();
    paintLastPunches();
  }
}

// --- SALIDA con validación previa ---
async function handleSalida() {
  if (!openSession) {
    showMsg('#punchMsg','No existe una jornada abierta. Marca ENTRADA primero.');
    return;
  }
  // Comprobar que los minutos estén cubiertos
  const total = sumAllocUI();
  if (total < requiredMins) {
    showMsg('#punchMsg', `Aún faltan minutos por asignar: ${requiredMins - total} min.`);
    return;
  }
  // Guardar y luego marcar OUT
  const ok = await saveAllocations();
  if (!ok) return;
  await doPunch('OUT');
  // Tras OUT correctamente, recargar estado/ UI
  openSession = await loadOpenSession();
  refreshPunchState();
  updateSalidaEnabled();
}

// --- ASIGNACIONES: UI ---
async function loadAndPaintAllocations() {
  // Si no hay sesión abierta, vaciamos UI
  if (!openSession) {
    allocRows = [];
    renderAllocRows();
    updateSalidaEnabled();
    return;
  }
  // Cargar de DB
  const rows = await loadAllocations(openSession.id);
  allocRows = (rows.length ? rows.map(r => ({ project_code: r.project_code, minutes: r.minutes_alloc })) : []);
  // Si no hay filas, añadimos una vacía para animar al usuario
  if (allocRows.length === 0) allocRows.push({ project_code: '', minutes: 0 });
  renderAllocRows();
  updateSalidaEnabled();
}

function renderAllocRows() {
  const cont = $('#allocContainer');
  if (!cont) return;

  cont.innerHTML = allocRows.map((row, idx) => {
    const minutes = row.minutes ?? 0;
    const opts = allProjects.map(p => {
      const label = `${p.client_name || ''} ${p.project_number ? ('· ' + p.project_number) : ''} — ${p.description || p.project_code}`;
      const sel   = (p.project_code === row.project_code) ? 'selected' : '';
      return `<option value="${p.project_code}" ${sel}>${label}</option>`;
    }).join('');
    return `
      <div class="row m-b-sm alloc-row" data-idx="${idx}">
        <select class="alloc-project" style="flex:1; min-width:240px;">
          <option value="">— Selecciona proyecto —</option>
          ${opts}
        </select>
        <input class="alloc-min" type="number" min="0" step="5" value="${minutes}" style="width:110px; margin-left:8px;">
        <button class="btn light alloc-del" style="margin-left:8px;">Quitar</button>
      </div>
    `;
  }).join('');

  // Eventos por fila
  cont.querySelectorAll('.alloc-row').forEach(rowEl => {
    const idx = Number(rowEl.getAttribute('data-idx'));
    rowEl.querySelector('.alloc-project').addEventListener('change', (e) => {
      allocRows[idx].project_code = e.target.value;
      updateSalidaEnabled();
    });
    rowEl.querySelector('.alloc-min').addEventListener('input', (e) => {
      allocRows[idx].minutes = Math.max(0, Number(e.target.value||0));
      updateSalidaEnabled();
    });
    rowEl.querySelector('.alloc-del').addEventListener('click', () => {
      allocRows.splice(idx,1);
      if (allocRows.length===0) allocRows.push({ project_code:'', minutes:0 });
      renderAllocRows();
      updateSalidaEnabled();
    });
  });

  // Totales
  $('#allocTotal').textContent = String(sumAllocUI());
}

function sumAllocUI() {
  return allocRows.reduce((acc, r) => acc + (Number(r.minutes)||0), 0);
}
function addAllocRow() {
  allocRows.push({ project_code:'', minutes:0 });
  renderAllocRows();
  updateSalidaEnabled();
}
function updateSalidaEnabled() {
  $('#allocTotal').textContent = String(sumAllocUI());
  const canClose = (sumAllocUI() >= requiredMins) && requiredMins > 0;
  disableSalida(!canClose);
}

// Guardar en DB: borramos asignaciones existentes y reinsertamos las visibles
async function saveAllocations() {
  if (!openSession) return false;

  // Filas válidas (con proyecto y minutos > 0)
  const rows = allocRows
    .filter(r => r.project_code && Number(r.minutes) > 0)
    .map(r => ({ session_id: openSession.id, project_code: r.project_code, minutes_alloc: Number(r.minutes) }));

  try {
    // Limpia actuales
    await supabase.from('work_session_allocations').delete().eq('session_id', openSession.id);
    if (rows.length) {
      const { error } = await supabase.from('work_session_allocations').insert(rows);
      if (error) throw error;
    }
    showMsg('#punchMsg', 'Asignación guardada.');
    return true;
  } catch (e) {
    showMsg('#punchMsg', `Error guardando asignación: ${e.message || e}`);
    return false;
  }
}

