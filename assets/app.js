// === CONFIG SUPABASE ===
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
// Usa tu anon key real; dejé el formato listo. Si ya la tenías, déjala igual.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === STATE ===
const st = {
  user: null,
  employee: null,           // { uid, code, full_name }
  sessionOpen: null,        // work_sessions row con status OPEN (o null)
  requiredMinutes: 0,       // minutos a asignar (según sesión abierta)
  allocRows: [],            // [{project_code, minutes}]
  projects: [],             // catálogo de proyectos
};

// === HELPERS UI ===
const $ = (s) => document.querySelector(s);
const show = (el) => el.style.display = '';
const hide = (el) => el.style.display = 'none';
const fmt2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const fmtHM = (mins) => `${fmt2(Math.floor(mins/60))}:${fmt2(mins%60)}`;
const todayStr = () => new Date().toISOString().slice(0,10);

function routeTo(path) {
  history.replaceState({}, '', path);
  // cards
  hide($('#authCard'));
  hide($('#resetCard'));
  hide($('#homeCard'));
  hide($('#punchCard'));
  hide($('#projectsCard'));
  hide($('#leaveCard'));
  hide($('#payslipsCard'));

  if (path === '/' || path === '/login') show($('#authCard'));
  else if (path === '/reset') show($('#resetCard'));
  else if (path === '/app') show($('#homeCard'));
  else if (path === '/marcas') show($('#punchCard'));
  else if (path === '/proyectos') show($('#projectsCard'));
  else if (path === '/licencias') show($('#leaveCard'));
  else if (path === '/comprobantes') show($('#payslipsCard'));
}

function toast(el, msg) {
  el.textContent = msg || '';
  if (!msg) return;
  // auto clear
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

// === AUTH ===
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
  // Reemplaza la URL por tu /reset publicado en Netlify si usas subpath
  const redirectTo = `${location.origin}/reset`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

async function signOut() {
  await supabase.auth.signOut();
  st.user = null;
  st.employee = null;
  routeTo('/');
}

// === EMPLEADO ===
async function loadEmployeeContext() {
  // Primero intentamos por user_id
  let q = supabase.from('employees')
    .select('employee_uid, employee_code, full_name, login_enabled')
    .eq('user_id', st.user.id)
    .single();
  let { data, error } = await q;

  // fallback por email si no existiera user_id
  if (error || !data) {
    const { data: e2 } = await supabase.from('employees')
      .select('employee_uid, employee_code, full_name, login_enabled')
      .eq('email', st.user.email)
      .single();
    data = e2 || null;
  }

  if (!data) throw new Error('No se encontró el empleado');
  if (data.login_enabled === false) throw new Error('Usuario deshabilitado');

  st.employee = {
    uid: data.employee_uid,
    code: data.employee_code || null,
    full_name: data.full_name || '(sin nombre)',
  };

  // Pintar Home
  $('#empName').textContent = st.employee.full_name;
  $('#empUid').textContent = `employee_uid: ${st.employee.uid}`;
}

// === MARCAS: estado, últimos, etc. ===
async function loadStatusAndRecent() {
  // Estado actual y minutos de hoy
  let estado = 'Fuera';
  let minsHoy = 0;

  // 1) Sesión abierta
  {
    const { data } = await supabase
      .from('work_sessions')
      .select('id, start_at, end_at, status')
      .eq('employee_uid', st.employee.uid)
      .order('start_at', { ascending: false })
      .limit(1);

    const ws = data && data[0];
    st.sessionOpen = (ws && ws.status === 'OPEN') ? ws : null;

    if (st.sessionOpen) {
      estado = 'Dentro';
    }
  }

  // 2) Minutos de hoy: sumar diferencias (coprocesado rápido)
  {
    const { data } = await supabase
      .from('work_sessions')
      .select('start_at, end_at')
      .eq('employee_uid', st.employee.uid)
      .eq('session_date', todayStr());

    if (data?.length) {
      const now = Date.now();
      minsHoy = data.reduce((acc, r) => {
        const start = new Date(r.start_at).getTime();
        const end = r.end_at ? new Date(r.end_at).getTime() : now;
        const diff = Math.max(0, Math.round((end - start) / 60000));
        return acc + diff;
      }, 0);
    }
  }

  // Pintar header de marcas
  const hdr = document.createElement('div');
  hdr.className = 'card inner';
  hdr.innerHTML = `
    <div><strong>Estado actual:</strong> ${estado}</div>
    <div class="muted">Horas de hoy: ${fmtHM(minsHoy)}</div>
  `;
  // Insertarlo encima del bloque de botones (primer inner después del topbar)
  const punchCard = $('#punchCard');
  const oldHdr = punchCard.querySelector('.card.inner.statusHdr');
  if (oldHdr) oldHdr.remove();
  hdr.classList.add('statusHdr');
  punchCard.insertBefore(hdr, punchCard.querySelector('.row.gap.m-t'));

  // Botones ENTRADA/SALIDA según estado
  $('#btnIn').disabled  = (estado === 'Dentro');
  $('#btnOut').disabled = (estado !== 'Dentro'); // SALIDA sólo si está dentro
  $('#punchMsg').textContent = '';

  // 3) Últimas marcas (de hoy)
  const { data: tps } = await supabase
    .from('time_punches')
    .select('direction, punch_at, latitude, longitude')
    .eq('employee_uid', st.employee.uid)
    .eq('punch_date', todayStr())
    .order('punch_at', { ascending: false })
    .limit(10);

  const rp = $('#recentPunches');
  if (!tps?.length) rp.textContent = 'Sin marcas aún.';
  else {
    rp.innerHTML = tps.map(tp => {
      const d = new Date(tp.punch_at);
      const hh = d.toLocaleString();
      const loc = (tp.latitude && tp.longitude) ? ` (${tp.latitude.toFixed(5)}, ${tp.longitude.toFixed(5)})` : '';
      return `<div><strong>${tp.direction}</strong> — ${hh}${loc}</div>`;
    }).join('');
  }

  // 4) Minutos requeridos para asignación (si hay sesión abierta)
  if (st.sessionOpen) {
    const diffMin = Math.max(0, Math.round((Date.now() - new Date(st.sessionOpen.start_at).getTime()) / 60000));
    st.requiredMinutes = diffMin;
    $('#allocRequired').textContent = `${st.requiredMinutes}`;
  } else {
    st.requiredMinutes = 0;
    $('#allocRequired').textContent = '0';
  }

  // 5) Preparar UI de asignaciones
  await prepareAllocUI();
}

// === MARCAR ENTRADA / SALIDA ===
async function mark(direction) {
  const gps = await getGPS();
  const payload = {
    employee_uid: st.employee.uid,
    direction,                       // 'IN' | 'OUT'
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
    // Validar que cubrimos los minutos requeridos
    const total = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes||0, 10) || 0), 0);
    if (total < st.requiredMinutes) {
      throw new Error(`Faltan minutos por asignar: ${st.requiredMinutes - total}`);
    }

    // Guardar asignación (limpiamos anteriores y subimos las nuevas)
    if (st.sessionOpen) {
      const sid = st.sessionOpen.id;
      await supabase.from('work_session_allocations').delete().eq('session_id', sid);

      const rows = st.allocRows
        .filter(r => r.project_code && (parseInt(r.minutes, 10) > 0))
        .map(r => ({ session_id: sid, project_code: r.project_code, minutes_alloc: parseInt(r.minutes, 10) }));

      if (!rows.length) throw new Error('No hay proyectos válidos.');
      const { error } = await supabase.from('work_session_allocations').insert(rows);
      if (error) throw error;
    }

    // Ahora sí OUT
    $('#btnOut').disabled = true;
    await mark('OUT');
    toast($('#punchMsg'), 'Salida registrada.');

  } catch (e) {
    toast($('#punchMsg'), `Error al marcar: ${e.message}`);
  } finally {
    await loadStatusAndRecent();
  }
}

// === ASIGNACIONES ===
function renderAllocContainer() {
  const cont = $('#allocContainer');
  cont.innerHTML = '';
  st.allocRows.forEach((row, idx) => {
    const line = document.createElement('div');
    line.className = 'allocRow';

    // SELECT de proyectos
    const sel = document.createElement('select');
    sel.className = 'allocSelect';
    const optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = '— Selecciona proyecto —';
    sel.appendChild(optEmpty);

    st.projects.forEach(p => {
      const o = document.createElement('option');
      o.value = p.project_code;
      o.textContent = `${p.client_name ?? ''} • ${p.project_number ?? ''} • ${p.description ?? p.project_code}`;
      if (p.project_code === row.project_code) o.selected = true;
      sel.appendChild(o);
    });

    sel.addEventListener('change', () => {
      row.project_code = sel.value;
    });

    // INPUT minutos
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.step = '1';
    inp.placeholder = 'min';
    inp.value = row.minutes || '';
    inp.className = 'allocMinutes';
    inp.addEventListener('input', () => {
      row.minutes = parseInt(inp.value || '0', 10) || 0;
      updateAllocTotals();
    });

    // Botón eliminar fila
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn light small';
    del.textContent = 'Quitar';
    del.addEventListener('click', () => {
      st.allocRows.splice(idx, 1);
      renderAllocContainer();
      updateAllocTotals();
    });

    line.appendChild(sel);
    line.appendChild(inp);
    line.appendChild(del);

    cont.appendChild(line);
  });
}

function updateAllocTotals() {
  const tot = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes||0, 10) || 0), 0);
  $('#allocTotal').textContent = `${tot}`;

  // Habilitar SALIDA sólo si tot >= requeridos y hay sesión abierta
  $('#btnOut').disabled = !(st.sessionOpen && tot >= st.requiredMinutes);
}

async function prepareAllocUI() {
  // Catálogo de proyectos
  if (!st.projects.length) {
    const { data } = await supabase
      .from('projects')
      .select('project_code, client_name, project_number, description')
      .order('client_name', { ascending: true })
      .order('project_number', { ascending: true });
    st.projects = data || [];
  }

  // Si hay sesión abierta, arrancamos con 1 fila; si no, dejamos vacío y deshabilitado
  if (st.sessionOpen) {
    if (st.allocRows.length === 0) {
      st.allocRows = [{ project_code: '', minutes: 0 }];
    }
  } else {
    st.allocRows = [];
  }

  renderAllocContainer();
  updateAllocTotals();
}

// Añadir una fila de asignación (máx 3)
function onAddAlloc() {
  if (!st.sessionOpen) return;
  if (st.allocRows.length >= 3) {
    toast($('#punchMsg'), 'Máximo 3 proyectos por jornada.');
    return;
  }
  st.allocRows.push({ project_code: '', minutes: 0 });
  renderAllocContainer();
  updateAllocTotals();
}

// Guardar asignación (manual, sin salir)
async function onSaveAlloc() {
  try {
    if (!st.sessionOpen) throw new Error('No hay jornada abierta.');
    const total = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes||0, 10) || 0), 0);
    if (total < st.requiredMinutes) {
      throw new Error(`Faltan minutos por asignar: ${st.requiredMinutes - total}`);
    }

    const sid = st.sessionOpen.id;
    await supabase.from('work_session_allocations').delete().eq('session_id', sid);

    const rows = st.allocRows
      .filter(r => r.project_code && (parseInt(r.minutes, 10) > 0))
      .map(r => ({ session_id: sid, project_code: r.project_code, minutes_alloc: parseInt(r.minutes, 10) }));

    if (!rows.length) throw new Error('No hay proyectos válidos.');
    const { error } = await supabase.from('work_session_allocations').insert(rows);
    if (error) throw error;

    toast($('#punchMsg'), 'Asignación guardada.');
    updateAllocTotals();
  } catch (e) {
    toast($('#punchMsg'), `Error al guardar: ${e.message}`);
  }
}

// === NAV ===
function setNavListeners() {
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
  $('#btnSaveAlloc')?.addEventListener('click', onSaveAlloc);
}

// === ARRANQUE ===
async function boot() {
  console.log('APP JS v3 – asignaciones activas');

  // Rutas por query (recovery)
  const hash = location.pathname;
  const params = new URLSearchParams(location.hash?.split('?')[1] || location.search);
  const type = params.get('type');
  if (hash.startsWith('/reset') || type === 'recovery') routeTo('/reset');

  setNavListeners();

  const user = await loadSession();
  if (!user) {
    routeTo('/');
    // Login
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
      } finally {
        $('#btnLogin').disabled = false;
      }
    });

    $('#btnForgot')?.addEventListener('click', async () => {
      try {
        const email = $('#email').value.trim();
        if (!email) throw new Error('Escribe tu correo y vuelve a pulsar “¿Olvidaste…?”');
        await sendReset(email);
        toast($('#msg'), 'Te enviamos un correo con el enlace para restablecer.');
      } catch (e) {
        toast($('#msg'), e.message);
      }
    });

    // Reset screen
    $('#btnSetNew')?.addEventListener('click', async () => {
      try {
        const pw = $('#newPassword').value;
        if (!pw || pw.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) throw error;
        toast($('#msg2'), 'Contraseña actualizada. Ya puedes iniciar sesión.');
      } catch (e) {
        toast($('#msg2'), e.message);
      }
    });

    $('#btnCancelReset')?.addEventListener('click', () => routeTo('/'));

    return;
  }

  // Ya hay sesión
  try {
    await loadEmployeeContext();
    routeTo('/app');
    $('#empName2').textContent = st.employee.full_name;
    $('#empUid2').textContent  = `employee_uid: ${st.employee.uid}`;
  } catch (e) {
    toast($('#msg'), e.message);
    await signOut();
    return;
  }

  // Si vamos a marcas, cargar
  document.querySelector('[data-nav="/marcas"]')?.addEventListener('click', async () => {
    $('#empName2').textContent = st.employee.full_name;
    $('#empUid2').textContent  = `employee_uid: ${st.employee.uid}`;
    await loadStatusAndRecent();
  });
}

boot();
