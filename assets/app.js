// === CONFIG SUPABASE (usa tus valores reales) ===============================
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('AQUI')) {
  alert('⚠️ Falta configurar SUPABASE_URL o SUPABASE_ANON_KEY en assets/app.js');
  throw new Error('Missing Supabase config');
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// === STATE ==================================================================
const st = {
  user: null,
  employee: null,         // { uid, code, full_name }
  sessionOpen: null,      // work_sessions fila OPEN (o null)
  requiredMinutes: 0,     // minutos a asignar para cerrar
  allocRows: [],          // [{ project_code, minutes }]
  clients: [],            // ['Cliente A', ...]
  projects: [],           // [{ project_code, name, client_name }]
  clientFilter: '',       // cliente seleccionado en el filtro
};

// === HELPERS ================================================================
const $ = (s) => document.querySelector(s);
const hide = (el) => el && (el.style.display = 'none');
const show = (el) => el && (el.style.display = '');
const fmt2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const fmtHM = (mins) => `${fmt2(Math.floor(mins/60))}:${fmt2(mins%60)}`;
const todayStr = () => new Date().toISOString().slice(0,10);

function routeTo(path) {
  history.replaceState({}, '', path);
  ['#authCard','#resetCard','#homeCard','#punchCard','#projectsCard','#leaveCard','#payslipsCard']
    .forEach(id => (id===path ? show($(id)) : hide($(id))));
}

function toast(el, msg) {
  if (!el) return;
  el.textContent = msg || '';
  if (!msg) return;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 6000);
}

async function getGPS() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      _ => res(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
    );
  });
}

// === AUTH ===================================================================
async function loadSession() {
  const { data: { session } } = await supabase.auth.getSession();
  st.user = session?.user || null;
  return st.user;
}

async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function sendReset(email) {
  const redirectTo = `${location.origin}/reset`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

async function signOut() {
  await supabase.auth.signOut();
  st.user = null; st.employee = null; st.sessionOpen = null;
  routeTo('/');
}

// === EMPLEADO ==============================================================
// Busca por user_id y si no, por email
async function loadEmployeeContext() {
  let q = supabase.from('employees')
    .select('employee_uid, employee_code, full_name, login_enabled')
    .eq('user_id', st.user.id)
    .single();
  let { data, error } = await q;

  if (error || !data) {
    const r = await supabase.from('employees')
      .select('employee_uid, employee_code, full_name, login_enabled')
      .eq('email', st.user.email)
      .single();
    data = r.data || null;
  }
  if (!data) throw new Error('No se encontró el empleado');
  if (data.login_enabled === false) throw new Error('Usuario deshabilitado');

  st.employee = {
    uid: data.employee_uid,
    code: data.employee_code || null,
    full_name: data.full_name || '(sin nombre)',
  };

  // Pintar en Home y Punch
  $('#empName') .textContent = st.employee.full_name;
  $('#empUid')  .textContent = `employee_uid: ${st.employee.uid}`;
  $('#empName2').textContent = st.employee.full_name;
  $('#empUid2') .textContent = `employee_uid: ${st.employee.uid}`;
}

// === ESTADO / ÚLTIMAS MARCAS ===============================================
async function loadStatusAndRecent() {
  let estado = 'Fuera';
  let minsHoy = 0;

  // 1) Sesión reciente
  {
    const { data } = await supabase
      .from('work_sessions')
      .select('id, start_at, end_at, status')
      .eq('employee_uid', st.employee.uid)
      .order('start_at', { ascending: false })
      .limit(1);

    const ws = data?.[0] || null;
    st.sessionOpen = (ws && ws.status === 'OPEN') ? ws : null;
    if (st.sessionOpen) estado = 'Dentro';
  }

  // 2) Minutos de hoy (suma de sesiones del día)
  {
    const { data } = await supabase
      .from('work_sessions')
      .select('start_at, end_at')
      .eq('employee_uid', st.employee.uid)
      .eq('session_date', todayStr());
    if (data?.length) {
      const now = Date.now();
      minsHoy = data.reduce((acc, r) => {
        const s = new Date(r.start_at).getTime();
        const e = r.end_at ? new Date(r.end_at).getTime() : now;
        return acc + Math.max(0, Math.round((e - s)/60000));
      }, 0);
    }
  }

  // Header estado
  $('#punchCard .statusHdr')?.remove();
  const hdr = document.createElement('div');
  hdr.className = 'card inner statusHdr';
  hdr.innerHTML = `<div><strong>Estado actual:</strong> ${estado}</div>
                   <div class="muted">Horas de hoy: ${fmtHM(minsHoy)}</div>`;
  $('#punchCard').insertBefore(hdr, $('#punchCard .row.gap.m-t'));

  // Botones
  $('#btnIn').disabled  = (estado === 'Dentro');
  $('#btnOut').disabled = (estado !== 'Dentro');
  toast($('#punchMsg'), '');

  // 3) Últimas marcas de hoy
  const { data: tps } = await supabase
    .from('time_punches')
    .select('direction, punch_at, latitude, longitude')
    .eq('employee_uid', st.employee.uid)
    .eq('punch_date', todayStr())
    .order('punch_at', { ascending: false })
    .limit(10);

  $('#recentPunches').innerHTML = (!tps?.length)
    ? 'Sin marcas aún.'
    : tps.map(tp => {
        const d = new Date(tp.punch_at);
        const loc = (tp.latitude && tp.longitude) ? ` (${tp.latitude.toFixed(5)}, ${tp.longitude.toFixed(5)})` : '';
        return `<div><strong>${tp.direction}</strong> — ${d.toLocaleString()}${loc}</div>`;
      }).join('');

  // 4) Minutos requeridos (si hay OPEN)
  if (st.sessionOpen) {
    const diffMin = Math.max(0, Math.round((Date.now() - new Date(st.sessionOpen.start_at).getTime()) / 60000));
    st.requiredMinutes = diffMin;
  } else {
    st.requiredMinutes = 0;
  }
  $('#allocRequired').textContent = `${st.requiredMinutes}`;

  // 5) UI de asignaciones (clientes + proyectos)
  await prepareAllocUI();
}

// === PROYECTOS / CLIENTES ===================================================
async function loadClients() {
  const { data, error } = await supabase
    .from('projects')
    .select('client_name')
    .eq('is_active', true)
    .order('client_name', { ascending: true });
  if (error) { console.error(error); return []; }
  // unique
  return [...new Set((data || []).map(r => r.client_name).filter(Boolean))];
}

async function loadProjects(client=null) {
  let q = supabase
    .from('projects')
    .select('project_code, name, client_name')
    .eq('is_active', true)
    .order('client_name', { ascending: true })
    .order('project_code', { ascending: true });
  if (client) q = q.eq('client_name', client);
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return data || [];
}

function bindClientFilter() {
  const sel = $('#clientFilter');
  if (!sel) return; // si no existe en el HTML, no pasa nada
  sel.innerHTML = `<option value="">— Todos los clientes —</option>`
    + st.clients.map(c => `<option value="${c}">${c}</option>`).join('');
  sel.value = st.clientFilter || '';
  sel.onchange = async () => {
    st.clientFilter = sel.value || '';
    st.projects = await loadProjects(st.clientFilter || null);
    renderAllocContainer();
    updateAllocTotals();
  };
}

function renderAllocContainer() {
  const cont = $('#allocContainer');
  cont.innerHTML = '';
  const visible = st.clientFilter
    ? st.projects.filter(p => p.client_name === st.clientFilter)
    : st.projects;

  st.allocRows.forEach((row, idx) => {
    const line = document.createElement('div');
    line.className = 'allocRow';

    // SELECT proyecto
    const sel = document.createElement('select');
    sel.className = 'allocSelect';
    sel.innerHTML = `<option value="">— Selecciona proyecto —</option>`
      + visible.map(p => {
          const label = `${p.project_code} — ${p.name}`;
          const selAttr = (p.project_code === row.project_code) ? 'selected' : '';
          return `<option value="${p.project_code}" ${selAttr}>${label}</option>`;
        }).join('');
    sel.onchange = () => { row.project_code = sel.value; };

    // INPUT minutos
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '0'; inp.step = '1';
    inp.placeholder = 'min';
    inp.value = row.minutes || '';
    inp.className = 'allocMinutes';
    inp.oninput = () => { row.minutes = parseInt(inp.value || '0', 10) || 0; updateAllocTotals(); };

    // Quitar fila
    const del = document.createElement('button');
    del.type='button'; del.className='btn light small'; del.textContent='Quitar';
    del.onclick = () => {
      st.allocRows.splice(idx, 1);
      if (!st.allocRows.length) st.allocRows.push({ project_code:'', minutes:0 });
      renderAllocContainer(); updateAllocTotals();
    };

    line.appendChild(sel); line.appendChild(inp); line.appendChild(del);
    cont.appendChild(line);
  });
}

function updateAllocTotals() {
  const tot = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes||0,10) || 0), 0);
  $('#allocTotal').textContent = `${tot}`;
  $('#btnOut').disabled = !(st.sessionOpen && tot >= st.requiredMinutes);
}

async function prepareAllocUI() {
  st.clients  = await loadClients();
  st.projects = await loadProjects(st.clientFilter || null);
  bindClientFilter();

  if (st.sessionOpen) {
    if (!st.allocRows.length) st.allocRows = [{ project_code:'', minutes:0 }];
  } else {
    st.allocRows = [];
  }
  renderAllocContainer();
  updateAllocTotals();
}

// === MARCAR ENTRADA / SALIDA ===============================================
async function mark(direction) {
  const gps = await getGPS();
  const payload = {
    employee_uid: st.employee.uid,
    direction, // 'IN' | 'OUT'
    latitude: gps?.lat ?? null,
    longitude: gps?.lon ?? null,
  };
  if (st.employee.code) payload.employee_code = st.employee.code;

  const { error } = await supabase.from('time_punches').insert(payload).select().single();
  if (error) throw error;
}

async function onMarkIn() {
  try {
    $('#btnIn').disabled = true;
    await mark('IN');
    toast($('#punchMsg'), 'Entrada registrada.');
  } catch (e) {
    toast($('#punchMsg'), `Error al marcar: ${e.message}`);
  } finally {
    await loadStatusAndRecent();
  }
}

async function onMarkOut() {
  try {
    const total = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes||0,10) || 0), 0);
    if (total < st.requiredMinutes) throw new Error(`Faltan minutos por asignar: ${st.requiredMinutes - total}`);

    if (st.sessionOpen) {
      const sid = st.sessionOpen.id;
      await supabase.from('work_session_allocations').delete().eq('session_id', sid);
      const rows = st.allocRows
        .filter(r => r.project_code && (parseInt(r.minutes,10) > 0))
        .map(r => ({ session_id: sid, project_code: r.project_code, minutes_alloc: parseInt(r.minutes,10) }));
      if (!rows.length) throw new Error('No hay proyectos válidos.');
      const { error } = await supabase.from('work_session_allocations').insert(rows);
      if (error) throw error;
    }

    $('#btnOut').disabled = true;
    await mark('OUT');
    toast($('#punchMsg'), 'Salida registrada.');
  } catch (e) {
    toast($('#punchMsg'), `Error al marcar: ${e.message}`);
  } finally {
    await loadStatusAndRecent();
  }
}

// === NAV + BOOT =============================================================
function setNavListeners() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', async () => {
      const to = el.getAttribute('data-nav');
      routeTo(to);
      if (to === '/marcas') await loadStatusAndRecent();
    });
  });
  $('#btnLogout')?.addEventListener('click', signOut);
  $('#btnLogout2')?.addEventListener('click', signOut);
  $('#btnIn')?.addEventListener('click', onMarkIn);
  $('#btnOut')?.addEventListener('click', onMarkOut);

  // Guardar asignación manual
  $('#btnSaveAlloc')?.addEventListener('click', async () => {
    try {
      if (!st.sessionOpen) throw new Error('No hay jornada abierta.');
      const total = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes||0,10) || 0), 0);
      if (total < st.requiredMinutes) throw new Error(`Faltan minutos por asignar: ${st.requiredMinutes - total}`);

      const sid = st.sessionOpen.id;
      await supabase.from('work_session_allocations').delete().eq('session_id', sid);
      const rows = st.allocRows
        .filter(r => r.project_code && (parseInt(r.minutes,10) > 0))
        .map(r => ({ session_id: sid, project_code: r.project_code, minutes_alloc: parseInt(r.minutes,10) }));
      if (!rows.length) throw new Error('No hay proyectos válidos.');
      const { error } = await supabase.from('work_session_allocations').insert(rows);
      if (error) throw error;

      toast($('#punchMsg'), 'Asignación guardada.');
      updateAllocTotals();
    } catch (e) {
      toast($('#punchMsg'), `Error al guardar: ${e.message}`);
    }
  });
}

async function handleRecoveryFromHash() {
  const hash = location.hash?.slice(1) || '';
  const params = new URLSearchParams(hash);
  const type = params.get('type');
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (type === 'recovery' && access_token && refresh_token) {
    await supabase.auth.setSession({ access_token, refresh_token });
    routeTo('/reset');
  }
}

async function boot() {
  console.log('APP JS v5 — compacto con filtro por cliente');

  await handleRecoveryFromHash();
  setNavListeners();

  const user = await loadSession();
  if (!user) {
    routeTo('/');
    $('#btnLogin')?.addEventListener('click', async () => {
      try {
        const email = $('#email').value.trim();
        const password = $('#password').value;
        $('#btnLogin').disabled = true;
        await signIn(email, password);
        await loadSession();
        await loadEmployeeContext();
        routeTo('/app');
      } catch (e) {
        toast($('#msg'), e.message);
      } finally { $('#btnLogin').disabled = false; }
    });
    $('#btnForgot')?.addEventListener('click', async () => {
      try {
        const email = $('#email').value.trim();
        if (!email) throw new Error('Escribe tu correo y vuelve a intentar.');
        await sendReset(email);
        toast($('#msg'), 'Te enviamos un correo con el enlace para restablecer.');
      } catch (e) { toast($('#msg'), e.message); }
    });
    $('#btnSetNew')?.addEventListener('click', async () => {
      try {
        const pw = $('#newPassword').value;
        if (!pw || pw.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) throw error;
        toast($('#msg2'), 'Contraseña actualizada. Ya puedes iniciar sesión.');
        setTimeout(() => routeTo('/'), 700);
      } catch (e) { toast($('#msg2'), e.message); }
    });
    $('#btnCancelReset')?.addEventListener('click', () => routeTo('/'));
    return;
  }

  try {
    await loadEmployeeContext();
    routeTo('/app');
  } catch (e) {
    toast($('#msg'), e.message);
    await signOut();
  }
}

boot();
