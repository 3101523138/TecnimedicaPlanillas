// === CONFIG SUPABASE (tus valores) ===
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === VISTAS y Router SPA ===
const views = {
  '/app': 'homeCard',
  '/marcas': 'punchCard',
  '/proyectos': 'projectsCard',
  '/licencias': 'leaveCard',
  '/comprobantes': 'payslipsCard',
  '/reset': 'resetCard'
};
function showOnly(id){
  Object.values(views).forEach(v => document.getElementById(v).style.display = 'none');
  document.getElementById(id).style.display = 'block';
}
function navigate(path){
  if (!views[path]) path = '/app';
  history.pushState({}, '', path);
  route();
}
function route(){
  if (IS_RECOVERY) { showOnly('resetCard'); return; }
  const id = views[location.pathname] || 'homeCard';
  showOnly(id);
}
addEventListener('popstate', route);
document.addEventListener('click', (e)=>{
  const nav = e.target?.closest('[data-nav]');
  if (nav){ e.preventDefault(); navigate(nav.getAttribute('data-nav')); }
});

// === Estado ===
let IS_RECOVERY = false;
let CURRENT_EMP_UID = null;

// === Helpers DOM ===
const $ = (id) => document.getElementById(id);

// === Detección de modo recuperación (/reset o type=recovery) ===
function detectRecovery(){
  const pathIsReset = location.pathname === '/reset';
  const hash = location.hash || '';
  const qs = new URLSearchParams(location.search);
  if (pathIsReset || hash.includes('type=recovery') || qs.get('type') === 'recovery') {
    IS_RECOVERY = true;
    showOnly('resetCard');
  }
}
addEventListener('hashchange', detectRecovery);
detectRecovery();

// === Render principal (carga datos empleado / menú) ===
async function render() {
  if (IS_RECOVERY) { showOnly('resetCard'); return; }

  const { data:{ user } } = await supabase.auth.getUser();
  if (!user) { showOnly('authCard'); return; }

  const { data: emp, error } = await supabase
    .from('employees')
    .select('employee_uid, full_name, login_enabled, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !emp) {
    $('msg').textContent = error ? error.message : 'Sin vínculo en employees.user_id o login deshabilitado.';
    await supabase.auth.signOut();
    showOnly('authCard'); return;
  }

  CURRENT_EMP_UID = emp.employee_uid;
  $('empName').textContent  = emp.full_name || '(sin nombre)';
  $('empUid').textContent   = 'employee_uid: ' + emp.employee_uid;
  $('empName2').textContent = emp.full_name || '(sin nombre)';
  $('empUid2').textContent  = 'employee_uid: ' + emp.employee_uid;

  await loadRecentPunches();
  navigate('/app');
}

// === Auth ===
$('btnLogin').onclick = async ()=>{
  $('msg').textContent = '';
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password){ $('msg').textContent = 'Escribe correo y contraseña.'; return; }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { $('msg').textContent = error.message; return; }
  render();
};
$('btnForgot').onclick = async ()=>{
  $('msg').textContent = '';
  const email = $('email').value.trim();
  if (!email) { $('msg').textContent = 'Escribe tu correo y vuelve a pulsar.'; return; }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + '/reset'
  });
  $('msg').textContent = error ? error.message : 'Te envié un correo para restablecer la contraseña.';
};
$('btnSetNew').onclick = async ()=>{
  $('msg2').textContent = '';
  const np = $('newPassword').value;
  if (!np || np.length < 6) { $('msg2').textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
  const { error } = await supabase.auth.updateUser({ password: np });
  if (error) { $('msg2').textContent = error.message; return; }
  $('msg2').textContent = 'Contraseña actualizada. Ahora puedes iniciar sesión.';
  history.replaceState(null, '', '/');
  IS_RECOVERY = false;
  await supabase.auth.signOut();
  showOnly('authCard');
};
$('btnCancelReset').onclick = ()=>{
  history.replaceState(null, '', '/'); IS_RECOVERY=false; showOnly('authCard');
};
$('btnLogout').onclick  = async ()=>{ await supabase.auth.signOut(); location.replace('/'); };
$('btnLogout2').onclick = async ()=>{ await supabase.auth.signOut(); location.replace('/'); };

supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') { IS_RECOVERY = true; showOnly('resetCard'); return; }
  if (IS_RECOVERY) { showOnly('resetCard'); return; }
  render();
});

// === Marcas IN/OUT con GPS ===
function getGeo(timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ lat:null, lon:null });
    let done=false; const finish=(a,b)=>{ if(!done){ done=true; resolve({lat:a,lon:b}); } };
    const t=setTimeout(()=>finish(null,null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      p=>{ clearTimeout(t); finish(p.coords.latitude, p.coords.longitude); },
      _=>{ clearTimeout(t); finish(null,null); },
      { enableHighAccuracy:true, maximumAge:0, timeout:timeoutMs }
    );
  });
}
async function punch(type) {
  const info = $('punchMsg');
  info.textContent = '';
  if (!CURRENT_EMP_UID) { info.textContent = 'No hay empleado cargado.'; return; }
  const { lat, lon } = await getGeo();
  const { data, error } = await supabase
    .from('time_punches')
    .insert({ employee_uid: CURRENT_EMP_UID, punch_type: type, latitude: lat, longitude: lon })
    .select().maybeSingle();
  if (error) { info.textContent = 'Error al marcar: ' + error.message; return; }
  const at = new Date(data.punch_at).toLocaleString();
  info.textContent = `Marca ${type} registrada a las ${at}`;
  await loadRecentPunches();
}
async function loadRecentPunches() {
  const box = $('recentPunches');
  if (!CURRENT_EMP_UID) { box.textContent = '—'; return; }
  const { data, error } = await supabase
    .from('time_punches')
    .select('punch_at, punch_type, latitude, longitude')
    .eq('employee_uid', CURRENT_EMP_UID)
    .order('punch_at', { ascending:false })
    .limit(5);
  if (error) { box.textContent = 'Error cargando historial'; return; }
  if (!data || data.length===0) { box.textContent = 'Sin marcas aún.'; return; }
  box.innerHTML = data.map(r=>{
    const when = new Date(r.punch_at).toLocaleString();
    const gps = (r.latitude && r.longitude) ? ` (${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)})` : '';
    return `<div><strong>${r.punch_type}</strong> – ${when}${gps}</div>`;
  }).join('');
}
$('btnIn').onclick  = ()=>punch('IN');
$('btnOut').onclick = ()=>punch('OUT');

// start
render(); route();
