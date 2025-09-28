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

  // añadidos recientes
  workedMinutes: 0,
  todaySessions: [],
  sessionTickId: null,
  _midnightTs: null,
  selectorDirty: false,
  outReady: false,       // ← NUEVO: indica si ya se puede marcar SALIDA
};

// === REGLAS / UTILIDADES TIEMPO ===
const GRACE_MINUTES = 10; // margen para poder cerrar (±10 min)
const fmt2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const minToHM = (mins) => `${fmt2(Math.floor((mins || 0) / 60))}:${fmt2(Math.abs(mins || 0) % 60)}`;
const hmToMin = (hhmm) => { if (!hhmm) return 0; const [h, m] = hhmm.split(':').map(v => parseInt(v || '0', 10)); return (h * 60 + (m || 0)) | 0; };
const todayStr = () => new Date().toISOString().slice(0, 10);

// Verificar si ya existe una jornada cerrada hoy (solo para ADVERTIR al IN)
// ¿Ya hubo alguna jornada hoy? (OPEN o CLOSED)
// Verificar si ya existe una jornada hoy (OPEN o CLOSED)
async function hasSessionToday() {
  try {
    // Evita consultar si aún no hay empleado cargado
    if (!st.employee?.uid) return false;

    const midnightLocal = new Date();
    midnightLocal.setHours(0, 0, 0, 0);
    const midnightISO = midnightLocal.toISOString();

    const { data, error } = await supabase
      .from('work_sessions')
      .select('id')
      .eq('employee_uid', st.employee.uid)
      .gte('start_at', midnightISO)
      .limit(1);

    if (error) {
      console.error('[APP] hasSessionToday error:', error);
      return false;
    }
    return !!(data && data.length);
  } catch (e) {
    console.error('[APP] hasSessionToday catch:', e);
    return false;
  }
}



// === HELPERS UI ===
const $ = (s) => document.querySelector(s);
const show = (el) => el && (el.style.display = '');
const hide = (el) => el && (el.style.display = 'none');
function toast(el, msg){ if(!el) return; el.textContent = msg || ''; if(!msg) return; setTimeout(()=>{ if(el.textContent===msg) el.textContent=''; },6000); }

// ── Helpers visuales para selects y títulos ─────────
function updateSelectStateClass(sel){
  sel.classList.toggle('pending', !sel.value);
  sel.classList.toggle('ready',  !!sel.value);
}

// Select de horas 0..24
function buildHourSelect(val = 0){
  const h = document.createElement('select');
  h.className = 'allocH';
  for(let i=0;i<=24;i++){
    const o = document.createElement('option');
    o.value = i; o.textContent = fmt2(i);
    if(i===val) o.selected = true;
    h.appendChild(o);
  }
  return h;
}

// Select de minutos 0..55 paso 5
function buildMinuteSelect(val = 0, step = 5){
  const m = document.createElement('select');
  m.className = 'allocM';
  for(let i=0;i<60;i+=step){
    const o = document.createElement('option');
    o.value = i; o.textContent = fmt2(i);
    if(i===val) o.selected = true;
    m.appendChild(o);
  }
  return m;
}


// ───────────────── Modales reutilizables ─────────────────
function ensureModalCSS() {
  if (document.getElementById('tmi-modal-css')) return;
  const css = document.createElement('style');
  css.id = 'tmi-modal-css';
  css.textContent = `
    .tmiModalBack{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2000}
    .tmiModal{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.28);max-width:460px;width:92vw;padding:18px}
    .tmiModal h3{margin:0 0 10px;font-size:18px;font-weight:800;color:#111827}
    .tmiModal .body{margin:0 0 14px;color:#374151;line-height:1.45}
    .tmiRow{display:flex;gap:10px;justify-content:flex-end}
    .tmiBtn{padding:10px 14px;border-radius:12px;border:0;font-weight:700;cursor:pointer}
    .tmiCancel{background:#e5e7eb;color:#111}
    .tmiOk{background:#1e88e5;color:#fff}
  `;
  document.head.appendChild(css);
}

// Modal de confirmación (Sí/No)
function showConfirmModal({ title='Confirmar', html='', confirmText='Aceptar', cancelText='Cancelar' } = {}) {
  ensureModalCSS();
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'tmiModalBack';
    back.innerHTML = `
      <div class="tmiModal" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        <div class="body">${html}</div>
        <div class="tmiRow">
          <button class="tmiBtn tmiCancel">${cancelText}</button>
          <button class="tmiBtn tmiOk">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const finish = v => { back.remove(); resolve(v); };
    back.querySelector('.tmiCancel').onclick = () => finish(false);
    back.querySelector('.tmiOk').onclick     = () => finish(true);
    const onKey = e => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey, { once:true });
  });
}

// Modal informativo (1 botón)
function showInfoModal({ title='Información', html='', okText='Entendido' } = {}) {
  ensureModalCSS();
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'tmiModalBack';
    back.innerHTML = `
      <div class="tmiModal" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        <div class="body">${html}</div>
        <div class="tmiRow">
          <button class="tmiBtn tmiOk">${okText}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const finish = () => { back.remove(); resolve(true); };
    back.querySelector('.tmiOk').onclick = finish;
    const onKey = e => { if (e.key === 'Escape') finish(); };
    document.addEventListener('keydown', onKey, { once:true });
  });
}

// Utilidad para hora “am/pm” legible
function fmtTime(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}


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

  // Si no estamos en /marcas, apagamos el ticker
  if (path !== '/marcas') stopSessionTicker();
}

function startSessionTicker() {
  stopSessionTicker();
  if (!st.sessionOpen) return;
  // primer tick inmediato + cada 60 s (puedes bajar a 10 s)
  tickSessionClock(true);
  st.sessionTickId = setInterval(() => tickSessionClock(false), 60 * 1000);
}

function stopSessionTicker() {
  if (st.sessionTickId) {
    clearInterval(st.sessionTickId);
    st.sessionTickId = null;
  }
}

function tickSessionClock(firstRun = false) {
  if (!st.sessionOpen) { stopSessionTicker(); return; }

  const nowTs = Date.now();

  // --- Actualiza TRABAJADO (UI derecha / precarga)
  const startTs = new Date(st.sessionOpen.start_at).getTime();
  const effStart = Math.max(startTs, st._midnightTs || 0);
  const diffMin = Math.max(0, Math.floor((nowTs - effStart) / 60000)); // real
  st.workedMinutes   = diffMin;
  st.requiredMinutes = Math.max(0, diffMin - GRACE_MINUTES);

  const rightEl = $('#allocRequiredHM');
  if (rightEl) rightEl.textContent = minToHM(st.workedMinutes);

  // --- Actualiza “Horas de hoy” = sesiones de hoy (cerradas) + abierta hasta ahora
  if (Array.isArray(st.todaySessions)) {
    const minsHoyLive = st.todaySessions.reduce((acc, r) => {
      const s = new Date(r.start_at).getTime();
      const e = r.end_at ? new Date(r.end_at).getTime() : nowTs;
      const effS = Math.max(s, st._midnightTs || 0);
      const dMin = Math.max(0, Math.floor((e - effS) / 60000));
      return acc + dMin;
    }, 0);
    const hoursTodayEl = $('#hoursTodayText');
    if (hoursTodayEl) hoursTodayEl.textContent = minToHM(minsHoyLive);
  }

  // --- Si el usuario no tocó HH/MM, mantenemos precarga con el restante
  if (!st.selectorDirty && st.allocRows && st.allocRows.length > 0) {
    const tot = validAllocRows().reduce((a, r) => a + (r.minutes || 0), 0);
    const restante = Math.max(0, st.workedMinutes - tot);

    const rowsEls = [...document.querySelectorAll('#allocContainer .allocRow')];
    if (rowsEls.length) {
      const firstRow = rowsEls[0];
      const h = firstRow.querySelector('.allocH');
      const m = firstRow.querySelector('.allocM');
      if (h && m) {
        const curH = parseInt(h.value || '0', 10);
        const curM = parseInt(m.value || '0', 10);
        if (curH === 0 && curM === 0) {
          const hh = Math.floor(restante / 60);
          const mm = restante % 60;
          h.value = hh; m.value = mm;
          syncAllocFromInputs(); // actualiza estado
        }
      }
    }
  }

  updateAllocTotals();
  if (firstRun) console.log('[APP] session ticker iniciado');
}

// === Helpers UX para SALIDA ===
function scrollToAlloc() {
  const el = document.querySelector('#allocContainer') || document.querySelector('#punchCard');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Pulso visual para llamar atención
  const card = el.closest('.card') || el;
  card.classList.add('pulse-ring');
  setTimeout(() => card.classList.remove('pulse-ring'), 1200);
}

// Si el usuario pulsa SALIDA pero aún no puede cerrar, explicamos el porqué
function handleOutClick() {
  if (!st.sessionOpen) {
    toast($('#punchMsg'), 'No hay jornada abierta.');
    return;
  }
  if (!st.outReady) {
    const tot = validAllocRows().reduce((a, r) => a + (r.minutes || 0), 0);
    const falta = Math.max(0, st.workedMinutes - tot);
    if (falta > 0) {
      toast($('#punchMsg'), `Para marcar SALIDA debes asignar ${minToHM(falta)} más en proyectos.`);
    } else {
      const exceso = Math.max(0, tot - (st.workedMinutes + GRACE_MINUTES));
      toast($('#punchMsg'), `Asignaste ${minToHM(exceso)} de más. Ajusta los proyectos para cerrar.`);
    }
    scrollToAlloc();
    return;
  }
  // Está listo → proceso normal
  onMarkOut();
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

// Envío del correo de reseteo con redirect correcto (hash)
// Envío del correo de reseteo con redirect correcto (hash)
// === AUTH RESET ===
// Envío del correo de reseteo con redirect correcto (SIN hash)
async function sendReset(email) {
  console.log('[APP] sendReset', email);
  // Redirige a la raíz de la app o a /reset, pero nunca con #
  const redirectTo = 'https://nominatmi.netlify.app';
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}



// Limpia cualquier rastro de sesión en el storage (por si el logout global falla)
function clearLocalSupabaseSession() {
  try {
    // Claves que usa supabase-js v2: "sb-<ref>-auth-token"
    Object.keys(localStorage).forEach((k) => {
      if (/^sb-.*-auth-token$/.test(k)) localStorage.removeItem(k);
    });
    // También en sessionStorage por si acaso
    Object.keys(sessionStorage).forEach((k) => {
      if (/^sb-.*-auth-token$/.test(k)) sessionStorage.removeItem(k);
    });
  } catch (e) {
    console.warn('[APP] clearLocalSupabaseSession warn:', e);
  }
}

// Limpia tokens locales de Supabase (localStorage + cookies sb-*)
function clearAuthStorage() {
  try {
    // 1) localStorage: elimina todas las claves que usa Supabase
    const keys = Object.keys(localStorage);
    keys.forEach(k => {
      if (k.startsWith('sb-') || k.startsWith('supabase.')) {
        localStorage.removeItem(k);
      }
    });

    // 2) sessionStorage por si acaso
    const skeys = Object.keys(sessionStorage);
    skeys.forEach(k => {
      if (k.startsWith('sb-') || k.startsWith('supabase.')) {
        sessionStorage.removeItem(k);
      }
    });

    // 3) Cookies sb-* (algunas libs guardan refrescos aquí)
    const cookieStr = document.cookie || '';
    cookieStr.split(';').forEach(c => {
      const name = c.split('=')[0]?.trim();
      if (!name) return;
      if (name.startsWith('sb-') || name.startsWith('supabase.')) {
        // Expira la cookie en el pasado (ruta raíz)
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        // Intenta también borrar con el dominio actual (cuando aplica)
        const host = location.hostname.replace(/^www\./, '');
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${host}`;
      }
    });
  } catch (e) {
    console.warn('[APP] clearAuthStorage warn:', e);
  }
}

// Cierre de sesión robusto: intenta signOut, limpia credenciales y resetea UI
async function signOut() {
  console.log('[APP] signOut (robusto)');

  try {
    // Intenta cerrar sesión con Supabase (invalidar sesión actual)
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('[APP] supabase.auth.signOut error/skip:', e?.message || e);
    // Si falla, continuamos limpiando de todas formas
  }

  // Limpia tokens locales que puedan quedar colgados
  clearAuthStorage();

  // Resetea estado en memoria
  st.user = null;
  st.employee = null;
  st.sessionOpen = null;
  st.todaySessions = [];
  st.workedMinutes = 0;
  st.requiredMinutes = 0;
  st.allocRows = [];

  // Limpia hash y query (por si veníamos de un flujo de recovery)
  try { history.replaceState({}, '', '/'); } catch (_) {}
  location.hash = '';
  // Si tienes SPA bajo subruta, ajusta la línea anterior a la base correcta

  // Vuelve a login y asegura que el ticker se detenga
  try { routeTo('/'); } catch (_) {}

  // Mensaje amable
  const msgEl = document.getElementById('msg'); // label del login
  if (msgEl) msgEl.textContent = 'Sesión cerrada.';
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

  // Solo mostramos el nombre (ocultamos el UID)
  const n1 = $('#empName');  if (n1) n1.textContent = st.employee.full_name;
  const n2 = $('#empName2'); if (n2) n2.textContent = st.employee.full_name;

  // Si existen los elementos del UID, los limpiamos por si el CSS no cargó aún
  const u1 = $('#empUid');  if (u1) u1.textContent = '';
  const u2 = $('#empUid2'); if (u2) u2.textContent = '';

  console.log('[APP] employee OK:', st.employee);
}

// === STATUS + RECIENTES ===
// === STATUS + RECIENTES ===
async function loadStatusAndRecent() {
  console.log('[APP] loadStatusAndRecent');

  // Estado por defecto
  let estado = 'Fuera';
  let minsHoy = 0;

  // ⏰ Medianoche local de HOY
  const midnightLocal = new Date();
  midnightLocal.setHours(0, 0, 0, 0);
  const midnightTs  = midnightLocal.getTime();
  const midnightISO = midnightLocal.toISOString();
  const nowTs = Date.now();

  // 1) Última sesión (para saber si está OPEN)
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
    estado = st.sessionOpen ? 'Dentro' : 'Fuera';
    console.log('[APP] sessionOpen:', st.sessionOpen);
  }

  // 2) Sesiones de HOY → guardamos para el ticker y calculamos “Horas de hoy”
  {
    const { data, error } = await supabase
      .from('work_sessions')
      .select('start_at, end_at, status')
      .eq('employee_uid', st.employee.uid)
      .or(`start_at.gte.${midnightISO},end_at.gte.${midnightISO},end_at.is.null`);
    st.todaySessions = error ? [] : (data || []);
    minsHoy = st.todaySessions.reduce((acc, r) => {
      const s = new Date(r.start_at).getTime();
      const e = r.end_at ? new Date(r.end_at).getTime() : nowTs;
      const effStart = Math.max(s, midnightTs);
      const deltaMin = Math.max(0, Math.floor((e - effStart) / 60000));
      return acc + deltaMin;
    }, 0);
  }

  // 3) Header “Estado actual / Horas de hoy” —> debajo del LOGO
  {
    const punch = $('#punchCard');
    const anchor = $('#logoHero') || punch;
    // elimina header anterior si existiera
    const old = punch.querySelector('.card.inner.statusHdr');
    if (old) old.remove();

    const hdr = document.createElement('div');
    hdr.className = 'card inner statusHdr';
    hdr.innerHTML = `
      <div><strong>Estado actual:</strong> ${estado}</div>
      <div><strong>Horas de hoy:</strong> <span id="hoursTodayText">${minToHM(minsHoy)}</span></div>
    `;
    if (anchor && anchor.insertAdjacentElement) {
      anchor.insertAdjacentElement('afterend', hdr);
    } else {
      punch.prepend(hdr);
    }
  }

  // 4) Botones IN/OUT (SALIDA siempre clicable para explicar; ENTRADA sí se bloquea)
  {
    const btnIn  = $('#btnIn');
    const btnOut = $('#btnOut');
    if (btnIn)  btnIn.disabled  = (estado === 'Dentro');  // ENTRADA bloquea si ya está dentro
    if (btnOut) {
      btnOut.disabled = false;            // SALIDA no se deshabilita (solo estilo visual luego)
      btnOut.classList.remove('light');
      btnOut.classList.add('success');    // verde
    }
    toast($('#punchMsg'), '');
  }

  // 5) Últimas marcas (centradas: línea 1 dir, línea 2 fecha/hora, línea 3 coords)
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
            const dt = d.toLocaleString();
            const coords = (tp.latitude && tp.longitude)
              ? `${tp.latitude.toFixed(5)}, ${tp.longitude.toFixed(5)}`
              : '';
            return `
              <div class="punchItem">
                <div class="dir">${tp.direction}</div>
                <div class="dt">${dt}</div>
                ${coords ? `<div class="coords">(${coords})</div>` : ``}
              </div>`;
          }).join('');
    }
  }

  // 6) Trabajado (UI) y Requerido (validación de OUT)
  if (st.sessionOpen) {
    const start = new Date(st.sessionOpen.start_at).getTime();
    const effStart = (start < midnightTs) ? midnightTs : start;
    const diffMin = Math.max(0, Math.floor((Date.now() - effStart) / 60000));
    st.workedMinutes   = diffMin;                         // real trabajado para UI/precarga
    st.requiredMinutes = Math.max(0, diffMin - GRACE_MINUTES); // usado para validar OUT
  } else {
    st.workedMinutes = 0;
    st.requiredMinutes = 0;
  }
  const reqEl = $('#allocRequiredHM'); // mostramos TRABAJADO a la derecha
  if (reqEl) reqEl.textContent = minToHM(st.workedMinutes);

  // 7) UI asignaciones
  await prepareAllocUI();

  // 8) Ticker en vivo
  st._midnightTs = midnightTs;
  if (st.sessionOpen) {
    startSessionTicker();
  } else {
    stopSessionTicker();
  }
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
// === UI ASIGNACIONES ===
function renderAllocContainer() {
  const cont = $('#allocContainer');
  if (!cont) return; // ← guard: evita errores si no existe el contenedor
  cont.innerHTML = '';
  const filter = st.clientFilter || '';
  const totalRows = st.allocRows.length;

  st.allocRows.forEach((row, idx) => {
    if (idx > 0) {
      const hr = document.createElement('hr');
      hr.className = 'allocDivider';
      cont.appendChild(hr);
    }

    const hdr = document.createElement('div');
    hdr.className = 'allocRowHeader';
    hdr.textContent = (totalRows === 1) ? 'Proyecto' : `Proyecto ${idx+1}`;
    cont.appendChild(hdr);

    const line = document.createElement('div');
    line.className = 'allocRow';

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
    updateSelectStateClass(sel);

    sel.addEventListener('change', () => {
      row.project_code = sel.value || '';
      updateSelectStateClass(sel);
      renderAllocContainer();
      updateAllocTotals();
    });

    const curMin = parseInt(row.minutes || 0, 10) || 0;
    const h = buildHourSelect(Math.floor(curMin / 60));
    const m = buildMinuteSelect(curMin % 60, 5);

    const onDurChange = () => {
      st.selectorDirty = true;
      const hv = parseInt(h.value || '0', 10) || 0;
      const mv = parseInt(m.value || '0', 10) || 0;
      row.minutes = hv * 60 + mv;
      rebalanceFrom(idx); // no borra otras filas
    };
    h.addEventListener('change', onDurChange);
    m.addEventListener('change', onDurChange);

    const dur = document.createElement('div');
    dur.className = 'allocDuration';
    const sep = document.createElement('span');
    sep.textContent = ':'; sep.className = 'allocSep';
    dur.appendChild(h); dur.appendChild(sep); dur.appendChild(m);

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn light small'; del.textContent = 'Quitar';
    del.addEventListener('click', () => {
      st.allocRows.splice(idx, 1);
      renderAllocContainer();
      updateAllocTotals();
    });

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
  // Disponible para asignar = trabajado real - ya asignado
  return Math.max(0, st.workedMinutes - tot);
}

function updateAllocTotals() {
  const tot = validAllocRows().reduce((a, r) => a + (parseInt(r.minutes || 0, 10) || 0), 0);
  const worked = st.workedMinutes;

  // UI: totales
  const totalEl = $('#allocTotalHM'); if (totalEl) totalEl.textContent = minToHM(tot);
  const rightEl = $('#allocRequiredHM'); if (rightEl) rightEl.textContent = minToHM(worked);

  const lower = Math.max(0, worked - GRACE_MINUTES);
  const upper = worked + GRACE_MINUTES;

  const info = $('#allocInfo');

  // Mensaje base (objetivo exacto, sin restar gracia)
  const baseMsg = `Debes asignar ${minToHM(worked)} ± ${GRACE_MINUTES} minutos.`;

  // 🔒 Bloqueo inicial: primeros 10 minutos no se permite salir
  const graceLock = !!(st.sessionOpen && worked < GRACE_MINUTES);

  let detailMsg = '';
  if (graceLock) {
    const wait = Math.max(0, GRACE_MINUTES - worked);
    detailMsg = ` Podrás marcar SALIDA en ${minToHM(wait)}.`;
  } else {
    if (tot < lower) {
      detailMsg = ` Faltan ${minToHM(lower - tot)}.`;
    } else if (tot > upper) {
      detailMsg = ` Te pasaste ${minToHM(tot - upper)}.`;
    } else {
      detailMsg = ' Listo: la jornada está cubierta.';
    }
  }

  info && (info.textContent = baseMsg + detailMsg);

  // Validación para habilitar SALIDA
  const withinWindow = (tot >= lower && tot <= upper);
  st.outReady = !!(st.sessionOpen && withinWindow && !graceLock);

  // Botón SALIDA
  const outBtn = $('#btnOut');
  if (outBtn) {
    outBtn.disabled = !st.outReady;                        // bloqueo real de clic
    outBtn.classList.remove('light');
    outBtn.classList.add('success');
    outBtn.classList.toggle('is-disabled', !st.outReady);
    outBtn.setAttribute('aria-disabled', String(!st.outReady));
  }
}


async function prepareAllocUI() {
  // Al entrar a la vista, el selector aún no ha sido tocado
  st.selectorDirty = false;

  // Cargar catálogo una vez
  if (!st.projects.length) {
    const { data, error } = await supabase
      .from('projects')
      .select('project_code, client_name, name, description')
      .order('client_name', { ascending: true })
      .order('project_code', { ascending: true });
    if (error) {
      console.error('[APP] load projects error:', error);
      st.projects = [];
    } else {
      st.projects = data || [];
    }

    // Filtro de clientes
    const clients = [...new Set(st.projects.map(p => p.client_name).filter(Boolean))].sort();
    const selClient = $('#allocClient');
    if (selClient && selClient.options.length === 1) {
      clients.forEach(c => {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c;
        selClient.appendChild(o);
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
      const sumPrev = prev.reduce((a, r) => a + (r.minutes || 0), 0);
      const restante = Math.max(0, st.workedMinutes - sumPrev);
      st.allocRows = prev.length ? prev : [{ project_code: '', minutes: restante }];
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

// ───────── Marcar ENTRADA con emergente si ya hubo jornada ─────────
// ───────── ENTRADA con confirm previo (si ya hubo jornada) y emergente de bienvenida ─────────
// ───────── ENTRADA con advertencia si ya hubo jornada hoy + bienvenida ─────────
async function onMarkIn() {
  try {
    console.log('[APP] CLICK ENTRADA]');

    // Si ya hubo una jornada HOY (open o closed), pide confirmación
    const alreadyToday = await hasSessionToday();
    if (alreadyToday) {
      const ok = await showConfirmModal({
        title: 'Segunda jornada hoy',
        html: 'Ya registraste una jornada hoy.<br>Iniciar otra puede afectar cálculos de planilla y generar reclamos.<br><br><strong>¿Deseas iniciar otra jornada?</strong>',
        confirmText: 'Sí, iniciar',
        cancelText: 'No, cancelar'
      });
      if (!ok) return; // usuario canceló
    }

    const bi = $('#btnIn'); if (bi) bi.disabled = true;

    // Marca entrada
    await mark('IN');

    // Modal de bienvenida SIEMPRE después de marcar con éxito
    const nombre = st.employee?.full_name || 'Usuario';
    await showInfoModal({
      title: '¡Bienvenido!',
      html: `Hola <strong>${nombre}</strong>. Iniciaste jornada a las <strong>${fmtTime()}</strong>.`,
      okText: 'Continuar'
    });

    toast($('#punchMsg'), 'Entrada registrada.');
  } catch (e) {
    console.error('[APP] onMarkIn error:', e);
    toast($('#punchMsg'), `Error al marcar: ${e.message}`);
  } finally {
    await loadStatusAndRecent();
  }
}

// ───────── SALIDA con emergente de agradecimiento ─────────
async function onMarkOut() {
  try {
    console.log('[APP] CLICK SALIDA');

    // Validar y guardar asignación (para cerrar)
    const ok = await onSaveAlloc(true);
    if (!ok) return;

    const bo = $('#btnOut'); if (bo) bo.disabled = true;
    await mark('OUT');

    const nombre = st.employee?.full_name || 'Usuario';
    await showInfoModal({
      title: '¡Gracias por tu labor!',
      html: `Gracias, <strong>${nombre}</strong>. Marcaste salida a las <strong>${fmtTime()}</strong>.`,
      okText: 'Listo'
    });

    toast($('#punchMsg'), 'Salida registrada.');
  } catch (e) {
    console.error('[APP] onMarkOut error:', e);
    toast($('#punchMsg'), `Error al marcar: ${e.message}`);
  } finally {
    await loadStatusAndRecent();
  }
}

// + Proyecto (precarga con tiempo restante)
// + Proyecto (con reparto automático del restante)
function onAddAlloc() {
  if (!st.sessionOpen) return;
  if (st.allocRows.length >= 3) { toast($('#punchMsg'), 'Máximo 3 proyectos por jornada.'); return; }

  // Asegura estado desde inputs
  syncAllocFromInputs();

  const tot = validAllocRows().reduce((a, r) => a + (r.minutes || 0), 0);
  const rem = Math.max(0, st.workedMinutes - tot);

  if (rem <= 0) { toast($('#punchMsg'), 'No hay tiempo restante por asignar.'); return; }

  // Nueva fila con TODO el restante
  st.allocRows.push({ project_code: '', minutes: rem });
  renderAllocContainer();
  updateAllocTotals();
}

// Reparte automáticamente el tiempo restante a partir de la fila modificada.
// - Mantiene tal cual las filas anteriores.
// - La fila modificada se "clampa" al máximo disponible.
// - La fila siguiente recibe TODO el restante.
// - Las filas posteriores quedan en 00:00 (y se limpian si no tienen proyecto).
function rebalanceFrom(changedIdx) {
  if (!st.sessionOpen) return;
  syncAllocFromInputs();

  const maxTotal = st.workedMinutes + GRACE_MINUTES; // permitir +10'
  const rows = st.allocRows;

  const sumOthers = rows.reduce((acc, r, i) => i === changedIdx ? acc : acc + (parseInt(r.minutes || 0, 10) || 0), 0);
  const maxForThis = Math.max(0, maxTotal - sumOthers);

  rows[changedIdx].minutes = Math.min(maxForThis, parseInt(rows[changedIdx].minutes || 0, 10) || 0);

  renderAllocContainer();
  updateAllocTotals();
}



// Guardar asignación (parcial o para cerrar)
// Guardar asignación (parcial o para cerrar)
async function onSaveAlloc(forClosing = false) {
  try {
    if (!st.sessionOpen) throw new Error('No hay jornada abierta.');

    // 1) Asegura estado desde inputs
    syncAllocFromInputs();

    // 2) Limpieza: quita filas 00:00 sin proyecto
    st.allocRows = st.allocRows.filter(r => (parseInt(r.minutes || 0, 10) > 0) || r.project_code);

    // 2.1) Unifica proyectos duplicados sumando minutos
    const byCode = new Map();
    for (const r of st.allocRows) {
      const code = r.project_code || '';
      const mins = parseInt(r.minutes || 0, 10) || 0;
      if (!code) continue; // ignora filas sin proyecto
      byCode.set(code, (byCode.get(code) || 0) + mins);
    }
    st.allocRows = [
      ...Array.from(byCode.entries()).map(([project_code, minutes]) => ({ project_code, minutes }))
    ];

    // 3) Totales y ventana de tolerancia ±GRACE_MINUTES
    const tot   = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes || 0, 10) || 0), 0);
    const lower = Math.max(0, st.workedMinutes - GRACE_MINUTES);
    const upper = st.workedMinutes + GRACE_MINUTES;

    // 4) Si es para cerrar, exige que esté dentro de la ventana
    if (forClosing) {
      if (tot < lower) throw new Error(`Faltan ${minToHM(lower - tot)}.`);
      if (tot > upper) throw new Error(`Te pasaste ${minToHM(tot - upper)}.`);
    }

    // 5) Persiste (replace)
    const sid = st.sessionOpen.id;
    await supabase.from('work_session_allocations').delete().eq('session_id', sid);

    const rows = st.allocRows
      .filter(r => r.project_code && (parseInt(r.minutes, 10) > 0))
      .map(r => ({ session_id: sid, project_code: r.project_code, minutes_alloc: parseInt(r.minutes, 10) }));

    if (rows.length) {
      const { error } = await supabase.from('work_session_allocations').insert(rows);
      if (error) throw error;
    }

    // 6) Feedback
    if (forClosing) {
      toast($('#punchMsg'), 'Asignación válida. Puedes marcar salida.');
    } else {
      if (tot < lower) {
        await showInfoModal({
          title: 'Asignación incompleta',
          html: `Recuerda asignar <strong>${minToHM(lower - tot)}</strong> más a proyectos para poder cerrar la jornada.`,
          okText: 'Entendido'
        });
      } else if (tot > upper) {
        await showInfoModal({
          title: 'Asignación excedida',
          html: `Has asignado <strong>${minToHM(tot - upper)}</strong> de más. Reduce tiempo en algún proyecto para poder cerrar.`,
          okText: 'Ok'
        });
      } else {
        const resumen = (st.allocRows || [])
          .filter(r => r.project_code && r.minutes > 0)
          .map(r => `• <strong>${r.project_code}</strong> — ${minToHM(r.minutes)}`)
          .join('<br>') || 'Sin proyectos asignados.';
        await showInfoModal({
          title: 'Asignación guardada',
          html: `Quedó así:<br><br>${resumen}`,
          okText: 'Perfecto'
        });
        toast($('#punchMsg'), 'Asignación guardada.');
      }
    }

    return true;
  } catch (e) {
    console.error('[APP] onSaveAlloc error:', e);
    toast($('#punchMsg'), `Error al guardar: ${e.message}`);
    return false;
  } finally {
    renderAllocContainer();
    updateAllocTotals();
  }
}

// === NAV ===
// === NAV ===
let listenersBound = false; // ← evita duplicar listeners

function setNavListeners() {
  if (listenersBound) return;
  listenersBound = true;

  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const to = el.getAttribute('data-nav');

      // 👉 Si piden Proyectos, redirige a la página aparte
      if (to === '/proyectos') {
        window.location.href = 'proyectos.html';
        return;
      }

      // resto de rutas internas (SPA dentro de index.html)
      routeTo(to);

      if (to === '/marcas') {
        loadStatusAndRecent();
      }
    });
  });

  // Botones globales
  $('#btnLogout')?.addEventListener('click', signOut);
  $('#btnLogout2')?.addEventListener('click', signOut);
  $('#btnIn')?.addEventListener('click', onMarkIn);
  $('#btnOut')?.addEventListener('click', handleOutClick);
  $('#btnAddAlloc')?.addEventListener('click', onAddAlloc);
  $('#btnSaveAlloc')?.addEventListener('click', () => onSaveAlloc(false));
}



// === POLISH VISUAL MOVIL ===
function applyMobilePolish() {
  // 1) Cambiar subtítulo de la tarjeta "Marcar IN/OUT"
  const all = document.querySelectorAll('#homeCard *');
  all.forEach(el => {
    if (el.childNodes && el.childNodes.length === 1) {
      const t = (el.textContent || '').trim();
      if (t === 'Registrar entrada o salida con GPS') {
        el.textContent = 'Registrar entrada o salida';
      }
    }
  });

  // 2) Ocultar cualquier rastro de UID de empleado
  const uidEls = [document.getElementById('empUid'), document.getElementById('empUid2')];
  uidEls.forEach(el => { if (el) el.textContent = ''; });
}

// ───────────────── Auth error → modal amigable ─────────────────
// ───────────────── Auth error → modal amigable ─────────────────
function parseAuthError(err, ctx = '') {
  const raw = (err && (err.message || err.error_description || err.error || String(err))) || 'Error desconocido';
  const low = raw.toLowerCase();

  if (low.includes('invalid login') || low.includes('invalid_grant') || low.includes('email or password')) {
    return { title: 'Credenciales inválidas', html: 'El correo o la contraseña no son correctos. Verifica e inténtalo de nuevo.' };
  }
  if (low.includes('email not confirmed') || low.includes('email not verified')) {
    return { title: 'Correo sin confirmar', html: 'Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja o solicita un nuevo enlace.' };
  }
  if (low.includes('auth session missing') || low.includes('no current user')) {
    return { title: 'Sesión de recuperación no activa', html: 'Abre el enlace del correo nuevamente. Si expiró, solicita otro desde “¿Olvidaste tu contraseña?”.' };
  }
  if (low.includes('password should be at least') || low.includes('password is too short')) {
    return { title: 'Contraseña demasiado corta', html: 'La contraseña debe tener al menos <strong>6 caracteres</strong>.' };
  }
  if (low.includes('same as the previous') || low.includes('must be different')) {
    return { title: 'Usa una contraseña distinta', html: 'La nueva contraseña <strong>no puede ser igual</strong> a la anterior.' };
  }
  if (low.includes('user disabled') || low.includes('deshabilitado') || low.includes('login_enabled')) {
    return { title: 'Usuario deshabilitado', html: 'Tu acceso está deshabilitado por administración. Contacta a RRHH o al administrador.' };
  }
  if (ctx === 'reset' && low.includes('rate limit')) {
    return { title: 'Demasiados intentos', html: 'Has solicitado varios cambios en poco tiempo. Espera unos minutos e inténtalo de nuevo.' };
  }
  return { title: 'Algo salió mal', html: `${raw}` };
}

async function showAuthError(err, ctx = '') {
  const msg = parseAuthError(err, ctx);
  await showInfoModal({ title: msg.title, html: msg.html, okText: 'Entendido' });
}

// === BOOT ===
// === BOOT ===
async function boot() {
  console.log('[APP] BOOT start…');

  // Enlaza navegación una sola vez
  setNavListeners();

  // --- Detectar flujo de recuperación desde el email ---
  const rawHash = (location.hash || '').replace(/^#/, '');
  const hashParams = new URLSearchParams(rawHash);
  const queryParams = new URLSearchParams(location.search || '');

  // v2 (hash tokens)
  const access_token  = hashParams.get('access_token');
  const refresh_token = hashParams.get('refresh_token');
  const typeFromHash  = hashParams.get('type');

  // v2 con PKCE (query ?code=...)
  const code = queryParams.get('code');
  const typeFromQuery = queryParams.get('type');

  const isRecoveryFlow =
    (typeFromHash === 'recovery') ||
    (typeFromQuery === 'recovery') ||
    (!!access_token && !!refresh_token) ||
    !!code;

  if (isRecoveryFlow) {
    try {
      // 1) Establecer sesión a partir de tokens o code
      if (access_token && refresh_token) {
        const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
        if (setErr) console.warn('[APP] setSession error:', setErr.message);
      } else if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) console.warn('[APP] exchangeCodeForSession error:', exErr.message);
      }
    } catch (e) {
      console.warn('[APP] recovery session warn:', e);
    }

    // 2) Mostrar pantalla de reset
    routeTo('/reset');

    // 3) Guardar nueva contraseña (EMERGENTES)
    $('#btnSetNew')?.addEventListener('click', async () => {
      const btn = $('#btnSetNew');
      try {
        console.log('[APP] CLICK SetNew (recovery)');
        const pw = ($('#newPassword')?.value || '').trim();
        if (!pw || pw.length < 6) {
          await showInfoModal({ title: 'Contraseña muy corta', html: 'Debe tener <strong>6 o más</strong> caracteres.', okText: 'Entendido' });
          $('#newPassword')?.focus(); return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          await showAuthError(new Error('Auth session missing'), 'reset');
          return;
        }

        btn && (btn.disabled = true);

        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) throw error;

        await showInfoModal({
          title: 'Contraseña actualizada',
          html: 'Ya puedes iniciar sesión con tu nueva contraseña.',
          okText: 'Ir al inicio'
        });

        // Limpia hash y query para evitar reentradas y vuelve al login
        history.replaceState({}, '', '/');
        location.hash = '';
        routeTo('/');
      } catch (e) {
        console.error('[APP] update password error:', e);
        await showAuthError(e, 'reset');
      } finally {
        btn && (btn.disabled = false);
      }
    });

    // 4) Cancelar
    $('#btnCancelReset')?.addEventListener('click', () => routeTo('/'));

    return; // no sigas al login normal
  }

  // --- Flujo normal ---
  const user = await loadSession();

  // Si NO hay sesión → ir a login y wirear acciones
  if (!user) {
    console.log('[APP] Sin sesión → login');
    routeTo('/');

    // Entrar (EMERGENTES)
    $('#btnLogin')?.addEventListener('click', async () => {
      const btn = $('#btnLogin');
      try {
        console.log('[APP] CLICK Entrar');
        const email = ($('#email')?.value || '').trim();
        const password = $('#password')?.value || '';

        // Validaciones rápidas de UX
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await showInfoModal({ title: 'Correo inválido', html: 'Escribe un <strong>correo válido</strong> para continuar.', okText: 'Entendido' });
          $('#email')?.focus(); return;
        }
        if (!password) {
          await showInfoModal({ title: 'Contraseña requerida', html: 'Escribe tu <strong>contraseña</strong> para iniciar sesión.', okText: 'Entendido' });
          $('#password')?.focus(); return;
        }

        btn && (btn.disabled = true);

        await signIn(email, password);
        await loadSession();
        await loadEmployeeContext(); // puede lanzar "Usuario deshabilitado"
        routeTo('/app');
        applyMobilePolish();
      } catch (e) {
        console.error('[APP] signIn error:', e);
        await showAuthError(e, 'login');    // emergente amigable
      } finally {
        btn && (btn.disabled = false);
      }
    });

    // ¿Olvidaste tu contraseña? (EMERGENTES)
    $('#btnForgot')?.addEventListener('click', async () => {
      const btn = $('#btnForgot');
      try {
        const emailInput = $('#email');
        const email = (emailInput?.value || '').trim();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await showInfoModal({
            title: 'Necesitamos tu correo',
            html: 'Escribe un <strong>correo válido</strong> y vuelve a pulsar “¿Olvidaste tu contraseña?”.',
            okText: 'Entendido'
          });
          emailInput?.focus(); return;
        }

        btn && (btn.disabled = true);

        await sendReset(email);

        await showInfoModal({
          title: 'Revisa tu correo',
          html: 'Si la dirección existe, te enviamos el <strong>enlace para restablecer</strong> la contraseña. Revisa también <em>Spam</em> o <em>Promociones</em>.',
          okText: 'Listo'
        });

        $('#password')?.focus();
      } catch (e) {
        console.error('[APP] reset error:', e);
        await showAuthError(e, 'recovery'); // emergente amigable
      } finally {
        btn && (btn.disabled = false);
      }
    });

    return; // fin rama sin sesión
  }

  // Con "sesión" → cargar contexto empleado
  try {
    console.log('[APP] Sesión activa → cargar contexto empleado');
    await loadEmployeeContext();
    routeTo('/app');
    applyMobilePolish();
  } catch (e) {
    console.warn('[APP] sesión/tokens corruptos, limpiando…', e?.message);
    try {
      clearAuthStorage();
      await supabase.auth.signOut({ scope: 'local' });
    } catch (_) {}
    st.user = null; st.employee = null;
    routeTo('/');
    await showAuthError(e, 'login');       // emergente adicional
    toast($('#msg'), 'Tu sesión caducó. Vuelve a iniciar sesión.');
  }
}

// === START APP ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
