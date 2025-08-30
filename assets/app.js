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

// === Estado global ===
let IS_RECOVERY=false;
let CURRENT_EMP_UID=null;

// === Helpers ===
const $ = id => document.getElementById(id);

// detectar modo reset
function detectRecovery(){
  const qs=new URLSearchParams(location.search);
  if (location.pathname==='/reset' || (location.hash||'').includes('type=recovery') || qs.get('type')==='recovery'){
    IS_RECOVERY=true; showOnly('resetCard');
  }
}
addEventListener('hashchange', detectRecovery);
detectRecovery();

// router protegido
async function route(){
  if (IS_RECOVERY){ showOnly('resetCard'); return; }
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user){ showOnly('authCard'); return; }
  showOnly(views[location.pathname] || 'homeCard');
}

// cargar datos del empleado
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
    await supabase.auth.signOut();
    showOnly('authCard'); 
    return;
  }

  CURRENT_EMP_UID = emp.employee_uid;
  $('empName')  && ($('empName').textContent  = emp.full_name || '(sin nombre)');
  $('empUid')   && ($('empUid').textContent   = 'employee_uid: ' + emp.employee_uid);
  $('empName2') && ($('empName2').textContent = emp.full_name || '(sin nombre)');
  $('empUid2')  && ($('empUid2').textContent  = 'employee_uid: ' + emp.employee_uid);

  await loadRecentPunches();
  navigate('/app');
}

// === Auth ===
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

// === Marcas (IN/OUT) ===
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

/**
 * Inserta una marca con fallback automático:
 * - Primero intenta con { direction, punch_type } (para esquemas mixtos)
 * - Si la BD dice "column ... does not exist", reintenta con la variante válida
 * - Si la BD dice "null value in column ..." para direction/punch_type, reintenta añadiéndola
 */
async function insertPunchWithFallback(base, type, infoNode){
  // helper para crear payload sin incluir claves undefined
  const withKeys = (obj) => {
    const out = {};
    Object.keys(obj).forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; });
    return out;
  };

  // intento 1: ambos (si existen los dos, perfecto)
  let payload = withKeys({ ...base, direction: type, punch_type: type });

  let { data, error } = await supabase.from('time_punches').insert(payload).select().maybeSingle();
  if (!error) return { data };

  const msg = (error.message || '').toLowerCase();

  // si dice que "direction" no existe, prueba SOLO punch_type
  if (msg.includes('column "direction"') && msg.includes('does not exist')){
    payload = withKeys({ ...base, punch_type: type });
    ({ data, error } = await supabase.from('time_punches').insert(payload).select().maybeSingle());
    if (!error) return { data, error: null };
  }

  // si dice que "punch_type" no existe, prueba SOLO direction
  if (msg.includes('column "punch_type"') && msg.includes('does not exist')){
    payload = withKeys({ ...base, direction: type });
    ({ data, error } = await supabase.from('time_punches').insert(payload).select().maybeSingle());
    if (!error) return { data, error: null };
  }

  // si dice que "null value in column 'direction'", reintenta forzando direction
  if (msg.includes('null value') && msg.includes('column "direction"')){
    payload = withKeys({ ...base, direction: type });
    ({ data, error } = await supabase.from('time_punches').insert(payload).select().maybeSingle());
    if (!error) return { data, error: null };
  }

  // si dice que "null value in column 'punch_type'", reintenta forzando punch_type
  if (msg.includes('null value') && msg.includes('column "punch_type"')){
    payload = withKeys({ ...base, punch_type: type });
    ({ data, error } = await supabase.from('time_punches').insert(payload).select().maybeSingle());
    if (!error) return { data, error: null };
  }

  return { data: null, error };
}

async function punch(type){
  const info=$('punchMsg'); info.textContent='';
  if(!CURRENT_EMP_UID){ info.textContent='No hay empleado cargado.'; return; }

  const { lat, lon } = await getGeo();  // si falla GPS, manda nulls y no bloquea

  // payload mínimo (triggers en BD rellenan punch_at / punch_date / punch_time / employee_code)
  const base = {
    employee_uid: CURRENT_EMP_UID,
    latitude:     lat,
    longitude:    lon
    // project_code: 'OPCIONAL'
  };

  const { data, error } = await insertPunchWithFallback(base, type, info);
  if (error){
    info.textContent = 'Error al marcar: ' + (error.message || 'desconocido');
    return;
  }

  const at=new Date(data.punch_at).toLocaleString();
  info.textContent=`Marca ${type} registrada a las ${at}`;
  await loadRecentPunches();
}

async function loadRecentPunches(){
  const box=$('recentPunches');
  if(!CURRENT_EMP_UID){ box.textContent='—'; return; }
  const { data, error } = await supabase
    .from('time_punches')
    .select('punch_at, latitude, longitude, direction, punch_type')
    .eq('employee_uid', CURRENT_EMP_UID)
    .order('punch_at',{ascending:false})
    .limit(5);
  if(error){ box.textContent='Error cargando historial'; return; }
  if(!data||data.length===0){ box.textContent='Sin marcas aún.'; return; }

  box.innerHTML = data.map(r=>{
    const when=new Date(r.punch_at).toLocaleString();
    const label = r.direction || r.punch_type || '—';
    const gps=(r.latitude&&r.longitude)?` (${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)})`:'';
    return `<div><strong>${label}</strong> – ${when}${gps}</div>`;
  }).join('');
}
$('btnIn').onclick  = ()=>punch('IN');
$('btnOut').onclick = ()=>punch('OUT');

// Inicio
render(); route();
