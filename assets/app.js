// === SUPABASE ===
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// === SPA (vistas) ===
const views = {
  '/app': 'homeCard',
  '/marcas': 'punchCard',
  '/proyectos': 'projectsCard',
  '/licencias': 'leaveCard',
  '/comprobantes': 'payslipsCard',
  '/reset': 'resetCard'
};
const ALL_CARDS = ['authCard','resetCard','homeCard','punchCard','projectsCard','leaveCard','payslipsCard'];
function showOnly(id){ ALL_CARDS.forEach(v=>document.getElementById(v).style.display='none'); document.getElementById(id).style.display='block'; }
function navigate(path){ if(!views[path]) path='/app'; history.pushState({},'',path); route(); }
addEventListener('popstate', route);
document.addEventListener('click', e => { const n=e.target?.closest('[data-nav]'); if(n){ e.preventDefault(); navigate(n.getAttribute('data-nav')); }});

// === Estado ===
let IS_RECOVERY=false;
let CURRENT_EMP_UID=null;

// === Helpers ===
const $ = id => document.getElementById(id);

// Reset de contraseña: detectar /reset o type=recovery
function detectRecovery(){
  const qs=new URLSearchParams(location.search);
  if (location.pathname==='/reset' || (location.hash||'').includes('type=recovery') || qs.get('type')==='recovery'){
    IS_RECOVERY=true; showOnly('resetCard');
  }
}
addEventListener('hashchange', detectRecovery);
detectRecovery();

// Router protegido
async function route(){
  if (IS_RECOVERY){ showOnly('resetCard'); return; }
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user){ showOnly('authCard'); return; }
  showOnly(views[location.pathname] || 'homeCard');
}

// Cargar empleado
async function render(){
  if (IS_RECOVERY){ showOnly('resetCard'); return; }
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user){ showOnly('authCard'); return; }

  const { data: emp, error } = await supabase
    .from('employees')
    .select('employee_uid, full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !emp){
    $('msg') && ($('msg').textContent = error ? error.message : 'Tu usuario no está vinculado a employees.');
    await supabase.auth.signOut(); showOnly('authCard'); return;
  }

  CURRENT_EMP_UID = emp.employee_uid;
  $('empName')  && ($('empName').textContent  = emp.full_name || '(sin nombre)');
  $('empUid')   && ($('empUid').textContent   = 'employee_uid: ' + emp.employee_uid);
  $('empName2') && ($('empName2').textContent = emp.full_name || '(sin nombre)');
  $('empUid2')  && ($('empUid2').textContent  = 'employee_uid: ' + emp.employee_uid);

  await loadRecentPunches();
  await loadEstadoYHorasHoy();
  navigate('/app');
}

// Auth
$('btnLogin').onclick = async ()=>{
  $('msg').textContent='';
  const email=$('email').value.trim(), password=$('password').value;
  if(!email||!password){ $('msg').textContent='Escribe correo y contraseña.'; return; }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error){ $('msg').textContent=error.message; return; }
  render();
};
$('btnForgot').onclick = async ()=>{
  $('msg').textContent='';
  const email=$('email').value.trim();
  if(!email){ $('msg').textContent='Escribe tu correo y vuelve a pulsar.'; return; }
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/reset' });
  $('msg').textContent = error ? error.message : 'Te envié un correo para restablecer la contraseña.';
};
$('btnSetNew').onclick = async ()=>{
  $('msg2').textContent='';
  const np=$('newPassword').value;
  if(!np||np.length<6){ $('msg2').textContent='La contraseña debe tener al menos 6 caracteres.'; return; }
  const { error } = await supabase.auth.updateUser({ password: np });
  if(error){ $('msg2').textContent=error.message; return; }
  $('msg2').textContent='Contraseña actualizada. Ahora puedes iniciar sesión.';
  IS_RECOVERY=false; await supabase.auth.signOut(); history.replaceState({},'','/'); showOnly('authCard');
};
$('btnCancelReset').onclick = ()=>{ history.replaceState({},'','/'); IS_RECOVERY=false; showOnly('authCard'); };

async function logout(){
  try{ await supabase.auth.signOut(); }
  finally{ IS_RECOVERY=false; CURRENT_EMP_UID=null; history.replaceState({},'','/'); showOnly('authCard'); }
}
$('btnLogout').onclick = logout;
$('btnLogout2').onclick = logout;

supabase.auth.onAuthStateChange((event)=>{ 
  if(event==='PASSWORD_RECOVERY'){ IS_RECOVERY=true; showOnly('resetCard'); return; } 
  if(IS_RECOVERY){ showOnly('resetCard'); return; } 
  render(); 
});

// ========== MARCAS ==========
function getGeo(timeoutMs=10000){
  return new Promise(resolve=>{
    if(!('geolocation' in navigator)) return resolve({lat:null,lon:null});
    let done=false; const finish=(a,b)=>{ if(!done){ done=true; resolve({lat:a,lon:b}); } };
    const t=setTimeout(()=>finish(null,null),timeoutMs);
    navigator.geolocation.getCurrentPosition(
      p=>{ clearTimeout(t); finish(p.coords.latitude,p.coords.longitude); },
      _=>{ clearTimeout(t); finish(null,null); },
      { enableHighAccuracy:true, maximumAge:0, timeout:timeoutMs }
    );
  });
}

async function punch(direction){
  const info=$('punchMsg'); info.textContent='';
  if(!CURRENT_EMP_UID){ info.textContent='No hay empleado cargado.'; return; }

  const { lat, lon } = await getGeo(); // si falla, manda nulls
  const payload = {
    employee_uid: CURRENT_EMP_UID,
    direction,                // IN / OUT (la BD exige esta columna)
    latitude:     lat,
    longitude:    lon
    // project_code: 'OPCIONAL'
  };

  const { data, error } = await supabase.from('time_punches').insert(payload).select().maybeSingle();
  if(error){ info.textContent='Error al marcar: ' + (error.message || 'desconocido'); return; }

  const at=new Date(data.punch_at).toLocaleString();
  info.textContent=`Marca ${direction} registrada a las ${at}`;
  await loadRecentPunches();
  await loadEstadoYHorasHoy();
}

async function loadRecentPunches(){
  const box=$('recentPunches');
  if(!CURRENT_EMP_UID){ box.textContent='—'; return; }
  const { data, error } = await supabase
    .from('time_punches')
    .select('punch_at, direction, latitude, longitude')
    .eq('employee_uid', CURRENT_EMP_UID)
    .order('punch_at',{ascending:false})
    .limit(5);
  if(error){ box.textContent='Error cargando historial'; return; }
  if(!data||data.length===0){ box.textContent='Sin marcas aún.'; return; }

  box.innerHTML = data.map(r=>{
    const when=new Date(r.punch_at).toLocaleString();
    const gps=(r.latitude&&r.longitude)?` (${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)})`:'';
    return `<div><strong>${r.direction}</strong> – ${when}${gps}</div>`;
  }).join('');
}
$('btnIn').onclick  = ()=>punch('IN');
$('btnOut').onclick = ()=>punch('OUT');

// ========== ESTADO + HORAS DE HOY ==========
function formatHHMM(totalMinutes){
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

async function loadEstadoYHorasHoy(){
  const estadoEl = document.getElementById('estadoActual');
  const horasEl  = document.getElementById('horasHoy');
  if (!estadoEl || !horasEl) return;
  if (!CURRENT_EMP_UID){ estadoEl.textContent='—'; horasEl.textContent='—'; return; }

  // Estado actual: hay sesión OPEN?
  const { data: openSess } = await supabase
    .from('work_sessions')
    .select('id, start_at')
    .eq('employee_uid', CURRENT_EMP_UID)
    .eq('status', 'OPEN')
    .order('start_at', { ascending:false })
    .limit(1);

  estadoEl.textContent = (openSess && openSess.length) ? 'Dentro' : 'Fuera';

  // Horas de hoy (sumando sesiones del día)
  const today = new Date();
  const y = today.getFullYear(), m = String(today.getMonth()+1).padStart(2,'0'), d = String(today.getDate()).padStart(2,'0');
  const todayStr = `${y}-${m}-${d}`;

  const { data: sessions } = await supabase
    .from('work_sessions')
    .select('start_at, end_at, status, session_date')
    .eq('employee_uid', CURRENT_EMP_UID)
    .eq('session_date', todayStr)
    .order('start_at', { ascending:true });

  if (!sessions || sessions.length === 0){ horasEl.textContent='00:00'; return; }

  let totalMin = 0;
  const nowMs = Date.now();
  for (const s of sessions){
    const startMs = new Date(s.start_at).getTime();
    const endMs   = s.end_at ? new Date(s.end_at).getTime() : nowMs;
    if (endMs > startMs) totalMin += (endMs - startMs) / 60000;
  }
  horasEl.textContent = formatHHMM(totalMin);
}

// Inicio
render(); route();
