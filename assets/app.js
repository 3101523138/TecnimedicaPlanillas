// === CONFIG SUPABASE ===
const SUPABASE_URL  = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === STATE ===
let currentUser = null;
let currentEmployee = null; // { employee_uid, full_name, ... }
let openSession = null;     // work_sessions OPEN row or null
let sessionMinutes = 0;     // duración en minutos de la sesión abierta
let statusTimer = null;

// Projects cache
let allProjects = [];       // [{project_code, client, description, number, label}]
let clientsList = [];       // ['Cliente A', 'Cliente B', ...]

// === HELPERS UI ===
const qs  = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const fmt2 = (n) => n < 10 ? '0'+n : ''+n;
const show = (el) => el.style.display = '';
const hide = (el) => el.style.display = 'none';
const setText = (sel, txt) => { qs(sel).textContent = txt; };

// Location helper
async function getCoords() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res({ latitude: null, longitude: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => res({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => res({ latitude: null, longitude: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

// Minutes between two dates (rounded)
function diffMinutes(d1, d2) {
  const ms = Math.max(0, d2 - d1);
  return Math.round(ms / 60000);
}

// === NAV ===
function gotoCard(id) {
  ['authCard','resetCard','homeCard','punchCard','projectsCard','leaveCard','payslipsCard']
    .forEach(cid => hide(qs('#'+cid)));
  show(qs('#'+id));
}

function route() {
  const p = location.pathname;
  if (p.startsWith('/reset')) return gotoCard('resetCard');
  if (p.startsWith('/marcas')) return gotoCard('punchCard');
  if (p.startsWith('/proyectos')) return gotoCard('projectsCard');
  if (p.startsWith('/licencias')) return gotoCard('leaveCard');
  if (p.startsWith('/comprobantes')) return gotoCard('payslipsCard');
  return gotoCard('homeCard');
}

window.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    e.preventDefault();
    history.pushState({}, '', nav.dataset.nav);
    route();
    // cargar datos contextuales
    if (nav.dataset.nav === '/marcas') onEnterPunch();
  }
});
window.addEventListener('popstate', route);

// === AUTH ===
async function loadSession() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user ?? null;
  return currentUser;
}

async function fetchEmployeeByEmail(email) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// === STATUS & PUNCHES ===
async function refreshStatusAndPunches() {
  if (!currentEmployee) return;

  // Datos generales en cabecera
  setText('#empName',  currentEmployee.full_name || '');
  setText('#empUid',   currentEmployee.employee_uid || '');
  setText('#empName2', currentEmployee.full_name || '');
  setText('#empUid2',  currentEmployee.employee_uid || '');

  // 1) Estado: sesión abierta?
  const { data: ws } = await supabase
    .from('work_sessions')
    .select('*')
    .eq('employee_uid', currentEmployee.employee_uid)
    .order('start_at', { ascending: false })
    .limit(1);

  openSession = null;
  if (ws && ws.length && ws[0].status === 'OPEN') {
    openSession = ws[0];
  }

  if (openSession) {
    setText('#statusTxt', 'Dentro');
    const start = new Date(openSession.start_at);
    const now   = new Date();
    sessionMinutes = Math.max(1, diffMinutes(start, now));
    setText('#hoursToday', `${fmt2(Math.floor(sessionMinutes/60))}:${fmt2(sessionMinutes%60)}`);
    // Actualiza cada minuto
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(() => {
      const now2 = new Date();
      sessionMinutes = Math.max(1, diffMinutes(start, now2));
      setText('#hoursToday', `${fmt2(Math.floor(sessionMinutes/60))}:${fmt2(sessionMinutes%60)}`);
    }, 60000);
  } else {
    setText('#statusTxt', 'Fuera');
    setText('#hoursToday', '00:00');
    if (statusTimer) clearInterval(statusTimer);
  }

  // 2) Habilitar/deshabilitar botones visualmente
  qs('#btnIn').disabled  = !!openSession;    // si está dentro, no puede IN
  qs('#btnOut').disabled = !openSession;     // si está fuera, no puede OUT

  // 3) Ocultar panel de asignación siempre al refrescar
  hide(qs('#allocPanel'));
  qs('#allocRows').innerHTML = '';
  setText('#allocMsg', '');
  setText('#allocRemaining', '0 min');

  // 4) Últimas marcas
  const { data: punches } = await supabase
    .from('time_punches')
    .select('direction,punch_at,latitude,longitude')
    .eq('employee_uid', currentEmployee.employee_uid)
    .order('punch_at', { ascending: false })
    .limit(10);

  const cont = qs('#recentPunches');
  if (!punches || punches.length === 0) {
    cont.textContent = 'Sin marcas aún.';
  } else {
    cont.innerHTML = punches.map(p => {
      const d = new Date(p.punch_at);
      const loc = (p.latitude && p.longitude) ? ` (${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})` : '';
      return `<div><b>${p.direction}</b> – ${d.toLocaleString()}${loc}</div>`;
    }).join('');
  }
}

// === PROYECTOS (catálogo) ===
async function loadProjectsCatalog() {
  // Traemos '*' para adaptarnos a tu tabla real
  const { data, error } = await supabase.from('projects').select('*').order('project_code', { ascending: true });
  if (error) {
    console.error(error);
    allProjects = [];
    clientsList = [];
    return;
  }

  allProjects = (data || []).map(p => {
    const code = p.project_code ?? p.code ?? p.number ?? p.id ?? p.pk ?? null;
    const client = p.client_name ?? p.client ?? p.customer ?? '';
    const number = p.project_number ?? p.number ?? p.code ?? code ?? '';
    const desc   = p.description ?? p.name ?? '';
    const label  = [number, desc].filter(Boolean).join(' — ');
    return { project_code: code, client, description: desc, number, label };
  }).filter(x => !!x.project_code);

  const setClients = new Set(allProjects.map(p => p.client || '').filter(Boolean));
  clientsList = ['(Todos)'].concat(Array.from(setClients).sort());

  // pinta el filtro
  const cf = qs('#clientFilter');
  cf.innerHTML = clientsList.map(c => `<option value="${c}">${c}</option>`).join('');
  cf.value = '(Todos)';
}

function filteredProjectsByClient() {
  const cf = qs('#clientFilter').value;
  if (!cf || cf === '(Todos)') return allProjects;
  return allProjects.filter(p => (p.client || '') === cf);
}

// === UI asignación proyectos ===
function renderAllocRows() {
  const rows = qsa('.alloc-row');
  rows.forEach(row => row.remove());

  const projects = filteredProjectsByClient();
  const container = qs('#allocRows');

  // Si no hay ninguna fila, crea 1 por defecto
  if (container.children.length === 0) {
    addAllocRow();
    return;
  }
}

function addAllocRow() {
  const projects = filteredProjectsByClient();
  const container = qs('#allocRows');

  // Máximo 5 filas para no complicar
  if (container.children.length >= 5) return;

  const row = document.createElement('div');
  row.className = 'alloc-row row gap';
  row.style.alignItems = 'center';

  const sel = document.createElement('select');
  sel.className = 'alloc-project';
  sel.innerHTML = `<option value="">— Selecciona proyecto —</option>` +
    projects.map(p => `<option value="${p.project_code}">${p.label}${p.client ? ' · '+p.client : ''}</option>`).join('');

  const inp = document.createElement('input');
  inp.className = 'alloc-mins';
  inp.type = 'number';
  inp.min = '1';
  inp.step = '1';
  inp.placeholder = 'min';

  const btnDel = document.createElement('button');
  btnDel.className = 'link';
  btnDel.textContent = 'Quitar';
  btnDel.addEventListener('click', () => {
    row.remove();
    updateAllocRemaining();
  });

  sel.addEventListener('change', updateAllocRemaining);
  inp.addEventListener('input', updateAllocRemaining);

  row.appendChild(sel);
  row.appendChild(inp);
  row.appendChild(btnDel);
  container.appendChild(row);

  updateAllocRemaining();
}

function updateAllocRemaining() {
  const mins = qsa('.alloc-mins').map(i => parseInt(i.value || '0', 10)).reduce((a,b)=>a+b,0);
  const remain = Math.max(0, sessionMinutes - mins);
  setText('#allocRemaining', `${remain} min`);
}

// === PUNCH ACTIONS ===
async function doPunch(direction) {
  const coords = await getCoords();
  const { error } = await supabase.from('time_punches').insert({
    employee_uid: currentEmployee.employee_uid,
    direction,
    latitude: coords.latitude,
    longitude: coords.longitude,
    // punch_at lo rellena default now(); punch_date/time lo rellenan triggers si los tienes
  });
  if (error) throw error;
}

async function handleIn() {
  try {
    qs('#punchMsg').textContent = 'Marcando ENTRADA...';
    await doPunch('IN');
    qs('#punchMsg').textContent = 'Entrada registrada.';
    await refreshStatusAndPunches();
  } catch (e) {
    console.error(e);
    qs('#punchMsg').textContent = `Error al marcar: ${e.message}`;
  }
}

// Flujo SALIDA con asignación obligatoria
async function handleOutStart() {
  if (!openSession) return; // no debería pasar
  // Mostrar panel con filas de asignación
  await loadProjectsCatalog();
  qs('#allocRows').innerHTML = '';
  addAllocRow();
  setText('#allocMsg', 'Distribuye el tiempo de la jornada en uno o varios proyectos.');
  updateAllocRemaining();
  show(qs('#allocPanel'));
}

// Confirmar SALIDA: valida asignación, inserta OUT, agrega allocations
async function handleOutConfirm() {
  try {
    // Validación
    const rows = qsa('#allocRows .alloc-row');
    if (rows.length === 0) {
      setText('#allocMsg', 'Agrega al menos un proyecto.');
      return;
    }
    let total = 0;
    const allocs = [];
    for (const r of rows) {
      const proj = r.querySelector('.alloc-project').value;
      const mins = parseInt(r.querySelector('.alloc-mins').value || '0', 10);
      if (!proj) {
        setText('#allocMsg', 'Hay una fila sin proyecto seleccionado.');
        return;
      }
      if (!mins || mins <= 0) {
        setText('#allocMsg', 'Hay una fila con minutos inválidos.');
        return;
      }
      allocs.push({ project_code: proj, minutes_alloc: mins });
      total += mins;
    }
    if (total !== sessionMinutes) {
      const diff = sessionMinutes - total;
      setText('#allocMsg', `La suma de minutos debe ser igual a la duración de la jornada (${sessionMinutes} min). Te ${diff>0?'faltan':'sobran'} ${Math.abs(diff)} min.`);
      return;
    }

    // 1) Inserta OUT (cerrará la sesión por trigger)
    qs('#punchMsg').textContent = 'Registrando SALIDA...';
    await doPunch('OUT');

    // 2) Busca la sesión recién cerrada
    const { data: wsList, error: e1 } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('employee_uid', currentEmployee.employee_uid)
      .order('end_at', { ascending: false })
      .limit(1);
    if (e1) throw e1;
    const closed = (wsList && wsList[0]) ? wsList[0] : null;
    if (!closed || closed.status !== 'CLOSED') {
      // Si no quedó cerrada aún, reintenta una vez tras breve espera
      await new Promise(r => setTimeout(r, 800));
      const { data: wsList2 } = await supabase
        .from('work_sessions')
        .select('*')
        .eq('employee_uid', currentEmployee.employee_uid)
        .order('end_at', { ascending: false })
        .limit(1);
      if (wsList2 && wsList2[0] && wsList2[0].status === 'CLOSED') {
        // ok
      } else {
        throw new Error('No fue posible identificar la jornada cerrada para asignar proyectos.');
      }
    }
    const sessionId = (closed && closed.id) || (wsList2 && wsList2[0].id);

    // 3) Inserta allocations
    const payload = allocs.map(a => ({
      session_id: sessionId,
      project_code: a.project_code,
      minutes_alloc: a.minutes_alloc
    }));
    const { error: e2 } = await supabase
      .from('work_session_allocations')
      .insert(payload);
    if (e2) throw e2;

    qs('#punchMsg').textContent = 'Salida registrada y proyectos asignados.';
    hide(qs('#allocPanel'));
    await refreshStatusAndPunches();
  } catch (e) {
    console.error(e);
    setText('#allocMsg', `Error al confirmar: ${e.message}`);
  }
}

// === FLOW ===
async function onEnterPunch() {
  await ensureUserAndEmployee();
  await refreshStatusAndPunches();
  // precargar catálogo de proyectos una vez
  await loadProjectsCatalog();
}

// asegura login & empleado vinculado
async function ensureUserAndEmployee() {
  await loadSession();
  if (!currentUser) {
    history.pushState({}, '', '/');
    route();
    return;
  }
  // Empleado por email del usuario
  if (!currentEmployee) {
    const emp = await fetchEmployeeByEmail(currentUser.email);
    currentEmployee = emp;
    // pinta nombres
    setText('#empName', emp?.full_name || '');
    setText('#empUid',  emp?.employee_uid || '');
    setText('#empName2', emp?.full_name || '');
    setText('#empUid2',  emp?.employee_uid || '');
  }
}

// === EVENTOS ===
qs('#btnLogin').addEventListener('click', async () => {
  setText('#msg', 'Verificando...');
  const email = qs('#email').value.trim();
  const pass  = qs('#password').value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) {
    setText('#msg', error.message);
    return;
  }
  // Vincula empleado por email
  currentUser = data.user;
  currentEmployee = await fetchEmployeeByEmail(email);
  setText('#empName', currentEmployee?.full_name || '');
  setText('#empUid',  currentEmployee?.employee_uid || '');
  history.pushState({}, '', '/app');
  route();
});

qs('#btnForgot').addEventListener('click', async () => {
  const email = qs('#email').value.trim();
  if (!email) { setText('#msg', 'Escribe tu correo.'); return; }
  const url = location.origin + '/reset';
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: url });
  setText('#msg', error ? error.message : 'Te enviamos un correo para restablecer tu contraseña.');
});

// Reset password page
qs('#btnSetNew').addEventListener('click', async () => {
  const pass = qs('#newPassword').value;
  const { error } = await supabase.auth.updateUser({ password: pass });
  setText('#msg2', error ? error.message : 'Contraseña actualizada. Ya puedes iniciar sesión.');
});
qs('#btnCancelReset').addEventListener('click', () => { history.pushState({}, '', '/'); route(); });

// Top-level logout
qs('#btnLogout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  currentUser = null; currentEmployee = null;
  history.pushState({}, '', '/');
  route();
});
qs('#btnLogout2').addEventListener('click', async () => {
 
