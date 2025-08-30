// === CONFIG SUPABASE ===
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('AQUI')) {
  alert('⚠️ Falta configurar SUPABASE_URL o SUPABASE_ANON_KEY en assets/app.js');
  throw new Error('Missing Supabase config');
}
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === STATE ===
const st = {
  user: null,
  employee: null,           // { uid, code, full_name }
  sessionOpen: null,        // work_sessions con status OPEN
  requiredMinutes: 0,       // minutos trabajados a asignar (con margen aplicado)
  allocRows: [],            // [{project_code, minutes}]
  projects: [],             // catálogo (activos)
  clientFilter: '',         // filtro de cliente para el select
  lastOverWarnAt: 0,        // anti-spam aviso “te pasaste”
};

// === REGLAS Y UTILIDADES DE TIEMPO ===
const GRACE_MINUTES = 10; // margen para poder cerrar (±10 min)
const fmt2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const minToHM = (mins) => `${fmt2(Math.floor((mins||0)/60))}:${fmt2(Math.abs(mins||0)%60)}`; // 90 -> 01:30
const hmToMin = (hhmm) => { if(!hhmm) return 0; const [h,m]=hhmm.split(':').map(v=>parseInt(v||'0',10)); return (h*60+(m||0))|0; };

// === HELPERS UI ===
const $ = (s) => document.querySelector(s);
const show = (el)=> el && (el.style.display = '');
const hide = (el)=> el && (el.style.display = 'none');
const todayStr = () => new Date().toISOString().slice(0,10);
function toast(el, msg){ if(!el) return; el.textContent = msg||''; if(!msg) return; setTimeout(()=>{ if(el.textContent===msg) el.textContent=''; },6000); }

// Texto libre “8” => 480, “8:30” => 510 (si lo llegaras a usar en algún input de texto)
function parseHM(str){
  if(!str) return null;
  const s = String(str).trim();
  if(/^\d+$/.test(s)){ const h = +s; return (isFinite(h)&&h>=0) ? h*60 : null; }
  const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if(!m) return null;
  const h = +m[1], mm = +m[2];
  return (isFinite(h)&&isFinite(mm)) ? h*60+mm : null;
}

// === ROUTER ===
function routeTo(path){
  history.replaceState({},'',path);
  hide($('#authCard')); hide($('#resetCard')); hide($('#homeCard'));
  hide($('#punchCard')); hide($('#projectsCard')); hide($('#leaveCard')); hide($('#payslipsCard'));
  if(path==='/'||path==='/login') show($('#authCard'));
  else if(path==='/reset') show($('#resetCard'));
  else if(path==='/app') show($('#homeCard'));
  else if(path==='/marcas') show($('#punchCard'));
  else if(path==='/proyectos') show($('#projectsCard'));
  else if(path==='/licencias') show($('#leaveCard'));
  else if(path==='/comprobantes') show($('#payslipsCard'));
}

// === GEO ===
async function getGPS(){
  return new Promise((res)=>{
    if(!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p=>res({lat:p.coords.latitude, lon:p.coords.longitude}),
      _=>res(null),
      {enableHighAccuracy:true, timeout:5000, maximumAge:0}
    );
  });
}

// === AUTH ===
async function loadSession(){ const {data:{session}}=await supabase.auth.getSession(); st.user=session?.user||null; return st.user; }
async function signIn(email,password){ const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) throw error; }
async function sendReset(email){ const redirectTo = `${location.origin}/reset`; const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo}); if(error) throw error; }
async function signOut(){ await supabase.auth.signOut(); st.user=null; st.employee=null; routeTo('/'); }

// === EMPLEADO ===
async function loadEmployeeContext(){
  let {data,error} = await supabase.from('employees')
    .select('employee_uid, employee_code, full_name, login_enabled')
    .eq('user_id', st.user.id).single();

  if(error || !data){
    const r = await supabase.from('employees')
      .select('employee_uid, employee_code, full_name, login_enabled')
      .eq('email', st.user.email).single();
    data = r.data || null;
  }
  if(!data) throw new Error('No se encontró el empleado');
  if(data.login_enabled===false) throw new Error('Usuario deshabilitado');

  st.employee = { uid:data.employee_uid, code:data.employee_code||null, full_name:data.full_name||'(sin nombre)' };
  $('#empName').textContent = st.employee.full_name;
  $('#empUid').textContent  = `employee_uid: ${st.employee.uid}`;
  $('#empName2') && ($('#empName2').textContent = st.employee.full_name);
  $('#empUid2')  && ($('#empUid2').textContent  = `employee_uid: ${st.employee.uid}`);
}

// === STATUS + RECIENTES ===
async function loadStatusAndRecent(){
  let estado='Fuera', minsHoy=0;

  // última sesión
  {
    const {data} = await supabase.from('work_sessions')
      .select('id, start_at, end_at, status')
      .eq('employee_uid', st.employee.uid)
      .order('start_at',{ascending:false}).limit(1);
    const ws = data && data[0];
    st.sessionOpen = (ws && ws.status==='OPEN') ? ws : null;
    if(st.sessionOpen) estado='Dentro';
  }

  // minutos de hoy
  {
    const {data} = await supabase.from('work_sessions')
      .select('start_at, end_at')
      .eq('employee_uid', st.employee.uid)
      .eq('session_date', todayStr());
    if(data?.length){
      const now = Date.now();
      minsHoy = data.reduce((acc,r)=>{
        const s=new Date(r.start_at).getTime();
        const e=r.end_at?new Date(r.end_at).getTime():now;
        return acc + Math.max(0, Math.round((e-s)/60000));
      },0);
    }
  }

  // pintar header
  const punch = $('#punchCard');
  const old = punch?.querySelector('.card.inner.statusHdr'); if(old) old.remove();
  const hdr = document.createElement('div');
  hdr.className='card inner statusHdr';
  hdr.innerHTML = `<div><strong>Estado actual:</strong> ${estado}</div><div class="muted">Horas de hoy: ${minToHM(minsHoy)}</div>`;
  punch && punch.insertBefore(hdr, punch.querySelector('.row.gap.m-t'));

  // botones
  $('#btnIn').disabled  = (estado==='Dentro');
  $('#btnOut').disabled = (estado!=='Dentro');
  toast($('#punchMsg'),'');

  // últimas marcas
  const {data:tps} = await supabase.from('time_punches')
    .select('direction, punch_at, latitude, longitude')
    .eq('employee_uid', st.employee.uid)
    .eq('punch_date', todayStr())
    .order('punch_at',{ascending:false}).limit(10);
  $('#recentPunches').innerHTML = (!tps?.length) ? 'Sin marcas aún.' :
    tps.map(tp=>{
      const d=new Date(tp.punch_at),
            loc=(tp.latitude&&tp.longitude)?` (${tp.latitude.toFixed(5)}, ${tp.longitude.toFixed(5)})`:'';
      return `<div><strong>${tp.direction}</strong> — ${d.toLocaleString()}${loc}</div>`;
    }).join('');

  // requeridos (aplicando margen de gracia)
  if (st.sessionOpen) {
    const diffMin = Math.max(
      0,
      Math.round((Date.now() - new Date(st.sessionOpen.start_at).getTime()) / 60000)
    );
    st.requiredMinutes = Math.max(0, diffMin - GRACE_MINUTES);
  } else {
    st.requiredMinutes = 0;
  }
  $('#allocRequiredHM')?.textContent = minToHM(st.requiredMinutes);

  // UI asignaciones
  await prepareAllocUI();
}

// === PROYECTOS ===
async function loadProjects(client=null){
  let q = supabase.from('projects')
    .select('project_code, name, description, client_name')
    .eq('is_active',true)
    .order('client_name',{ascending:true})
    .order('project_code',{ascending:true});
  if(client) q=q.eq('client_name',client);
  const {data,error}=await q;
  return error ? [] : (data||[]);
}

// === ASIGNACIONES existentes ===
async function loadExistingAllocations(){
  if(!st.sessionOpen) return [];
  const {data,error}=await supabase.from('work_session_allocations')
    .select('project_code, minutes_alloc').eq('session_id', st.sessionOpen.id).order('project_code',{ascending:true});
  if(error) return [];
  return (data||[]).map(r=>({project_code:r.project_code, minutes:r.minutes_alloc||0}));
}

// === UI ASIGNACIONES (HH:MM) ===
function bindMinutesInput(inp,row){
  // si usas input text; con type="time" no es necesario
  inp.addEventListener('blur', ()=>{
    if(!inp.value.trim()){ row.minutes=0; inp.value=''; updateAllocTotals(); return; }
    const mins = parseHM(inp.value);
    if(mins===null){ row.minutes=0; inp.value=''; }
    else { row.minutes=mins; inp.value=minToHM(mins); }
    updateAllocTotals();
  });
  inp.addEventListener('input', ()=>{
    const mins = parseHM(inp.value);
    row.minutes = (mins ?? 0);
    updateAllocTotals();
  });
}

function renderAllocContainer() {
  const cont = $('#allocContainer');
  cont.innerHTML = '';

  const filter = st.clientFilter || '';

  st.allocRows.forEach((row, idx) => {
    const line = document.createElement('div');
    line.className = 'allocRow';

    // SELECT de proyectos (filtrado por cliente, pero conservamos el seleccionado)
    const sel = document.createElement('select');
    sel.className = 'allocSelect';

    // Opción vacía
    const optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = '— Selecciona proyecto —';
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

    // INPUT HH:MM (step=60)
    const inp = document.createElement('input');
    inp.type = 'time';
    inp.step = 60;
    inp.value = minToHM(row.minutes || 0);
    inp.className = 'allocMinutes';
    inp.addEventListener('input', () => { row.minutes = hmToMin(inp.value); updateAllocTotals(); });

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

function remainingMinutes(){
  const tot = st.allocRows.reduce((a,r)=>a+(r.minutes||0),0);
  return Math.max(0, st.requiredMinutes - tot);
}

function updateAllocTotals() {
  const tot = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes||0, 10) || 0), 0);
  const req = st.requiredMinutes;

  $('#allocTotalHM')?.textContent    = minToHM(tot);
  $('#allocRequiredHM')?.textContent = minToHM(req);

  const info = $('#allocInfo');
  let ok = false;

  if (tot < req) {
    info.textContent = `Faltan ${minToHM(req - tot)}. Completa la jornada.`;
  } else if (tot > req + GRACE_MINUTES) {
    info.textContent = `Te pasaste ${minToHM(tot - req)}. Reduce algún proyecto.`;
  } else {
    info.textContent = 'Listo: cubre la jornada.';
    ok = true;
  }

  $('#btnOut').disabled = !(st.sessionOpen && ok);
}

async function prepareAllocUI() {
  // Catálogo de proyectos una vez
  if (!st.projects.length) {
    const { data } = await supabase
      .from('projects')
      .select('project_code, client_name, project_number, description')
      .order('client_name', { ascending: true })
      .order('project_number', { ascending: true });
    st.projects = data || [];

    // Poblar filtro de clientes (select #allocClient)
    const clients = [...new Set(st.projects.map(p => p.client_name).filter(Boolean))].sort();
    const selClient = $('#allocClient');
    if (selClient && selClient.options.length === 1) {
      clients.forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c; selClient.appendChild(o);
      });
      selClient.addEventListener('change', () => {
        st.clientFilter = selClient.value || '';
        renderAllocContainer(); // solo cambia el listado de opciones, NO borra filas existentes
        updateAllocTotals();
      });
    }
  }

  // Si hay sesión abierta, intenta prellenar con lo ya guardado
  if (st.sessionOpen) {
    if (st.allocRows.length === 0) {
      const prev = await loadExistingAllocations();
      if (prev.length) {
        st.allocRows = prev; // respeta lo guardado
      } else {
        st.allocRows = [{ project_code: '', minutes: st.requiredMinutes }]; // precarga una fila con todo
      }
    }
  } else {
    st.allocRows = [];
  }

  renderAllocContainer();
  updateAllocTotals();
}

// === MARCAR IN/OUT ===
async function mark(direction){
  const gps = await getGPS();
  const payload = { employee_uid: st.employee.uid, direction,
                    latitude: gps?.lat ?? null, longitude: gps?.lon ?? null };
  if(st.employee.code) payload.employee_code = st.employee.code;
  const {error} = await supabase.from('time_punches').insert(payload).select().single();
  if(error) throw error;
}

async function onMarkIn(){
  try{ $('#btnIn').disabled=true; await mark('IN'); toast($('#punchMsg'),'Entrada registrada.'); }
  catch(e){ toast($('#punchMsg'),`Error al marcar: ${e.message}`); }
  finally{ await loadStatusAndRecent(); }
}

async function onMarkOut() {
  try {
    // 1) Guarda asignación en silencio (validará tolerancia)
    const ok = await onSaveAlloc(true);
    if (!ok) return;

    // 2) OUT
    $('#btnOut').disabled = true;
    await mark('OUT');
    toast($('#punchMsg'), 'Salida registrada.');
  } catch (e) {
    toast($('#punchMsg'), `Error al marcar: ${e.message}`);
  } finally {
    await loadStatusAndRecent();
  }
}

// + Proyecto: precarga con el tiempo restante
function onAddAlloc(){
  if(!st.sessionOpen) return;
  if(st.allocRows.length>=3){ toast($('#punchMsg'),'Máximo 3 proyectos por jornada.'); return; }
  const rem = remainingMinutes();
  if(rem<=0){ toast($('#punchMsg'),'Ya asignaste todo el tiempo trabajado.'); return; }
  st.allocRows.push({ project_code:'', minutes: rem });
  renderAllocContainer(); updateAllocTotals();
}

// Guardar sin salir
async function onSaveAlloc(silent = false) {
  try {
    if (!st.sessionOpen) throw new Error('No hay jornada abierta.');
    const tot = st.allocRows.reduce((a, r) => a + (parseInt(r.minutes||0, 10) || 0), 0);

    // Aceptamos [req .. req+GRACE]
    if (tot < st.requiredMinutes) throw new Error(`Faltan ${minToHM(st.requiredMinutes - tot)}.`);
    if (tot > st.requiredMinutes + GRACE_MINUTES) throw new Error(`Te pasaste ${minToHM(tot - st.requiredMinutes)}.`);

    const sid = st.sessionOpen.id;

    // Limpia y sube
    await supabase.from('work_session_allocations').delete().eq('session_id', sid);

    const rows = st.allocRows
      .filter(r => r.project_code && (parseInt(r.minutes, 10) > 0))
      .map(r => ({ session_id: sid, project_code: r.project_code, minutes_alloc: parseInt(r.minutes, 10) }));

    if (!rows.length) throw new Error('No hay proyectos válidos.');
    const { error } = await supabase.from('work_session_allocations').insert(rows);
    if (error) throw error;

    if (!silent) toast($('#punchMsg'), 'Asignación guardada.');
    return true;
  } catch (e) {
    if (!silent) toast($('#punchMsg'), `Error al guardar: ${e.message}`);
    return false;
  } finally {
    updateAllocTotals();
  }
}

// === NAV ===
function setNavListeners(){
  document.querySelectorAll('[data-nav]').forEach(el=>{
    el.addEventListener('click',()=>{ const to=el.getAttribute('data-nav'); routeTo(to); if(to==='/marcas') loadStatusAndRecent(); });
  });
  $('#btnLogout')?.addEventListener('click',signOut);
  $('#btnLogout2')?.addEventListener('click',signOut);
  $('#btnIn')?.addEventListener('click',onMarkIn);
  $('#btnOut')?.addEventListener('click',onMarkOut);
  $('#btnAddAlloc')?.addEventListener('click',onAddAlloc);
  $('#btnSaveAlloc')?.addEventListener('click', () => onSaveAlloc(false)); // mensajes visibles
}

// === BOOT ===
async function boot(){
  console.log('APP JS v10 – HH:MM con margen y precarga');
  const hash=location.pathname;
  const params=new URLSearchParams(location.hash?.split('?')[1]||location.search);
  const type=params.get('type');
  if(hash.startsWith('/reset')||type==='recovery') routeTo('/reset');

  setNavListeners();

  const user=await loadSession();
  if(!user){
    routeTo('/');
    $('#btnLogin')?.addEventListener('click',async()=>{
      try{
        const email=$('#email').value.trim();
        const password=$('#password').value;
        $('#btnLogin').disabled=true;
        await signIn(email,password); await loadSession(); await loadEmployeeContext(); routeTo('/app');
      }catch(e){ toast($('#msg'),e.message); }
      finally{ $('#btnLogin').disabled=false; }
    });
    $('#btnForgot')?.addEventListener('click',async()=>{
      try{
        const email=$('#email').value.trim();
        if(!email) throw new Error('Escribe tu correo y vuelve a pulsar “¿Olvidaste…?”');
        await sendReset(email); toast($('#msg'),'Te enviamos un correo con el enlace para restablecer.');
      }catch(e){ toast($('#msg'),e.message); }
    });
    $('#btnSetNew')?.addEventListener('click',async()=>{
      try{
        const pw=$('#newPassword').value;
        if(!pw || pw.length<6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
        const {error}=await supabase.auth.updateUser({password:pw});
        if(error) throw error; toast($('#msg2'),'Contraseña actualizada. Ya puedes iniciar sesión.');
      }catch(e){ toast($('#msg2'),e.message); }
    });
    $('#btnCancelReset')?.addEventListener('click',()=>routeTo('/'));
    return;
  }

  try{ await loadEmployeeContext(); routeTo('/app'); }
  catch(e){ toast($('#msg'),e.message); await signOut(); }
}
boot();
