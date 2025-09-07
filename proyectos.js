// ===============================
// TMI · Proyectos (Etapa 1)
// Página independiente (NO toca index.html, app.js ni app.css)
// ===============================

// === CONFIG SUPABASE ===
const SUPABASE_URL = 'https://xducrljbdyneyihjcjvo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

// === UI refs ===
const $ = (q) => document.querySelector(q);
const listEl = $('#list');
const emptyEl = $('#empty');
const msgEl = $('#msg');
const errEl = $('#err');
const chipCount = $('#chipCount');
const fEstado = $('#fEstado');
const fCliente = $('#fCliente');
const fQuery = $('#fQuery');

const dlgCreate = $('#dlgCreate');
const frmCreate = $('#frmCreate');
const btnCancel = $('#btnCancel');
const btnCreate = $('#btnCreate');
const btnHome = $('#btnHome');
const btnSignOut = $('#btnSignOut');
const adminFields = $('#adminFields');
const createMsg = $('#createMsg');
const createErr = $('#createErr');

// === Estado ===
const st = {
  user: null,
  isAdmin: false,
  all: [],
  filtered: [],
  openCode: null // cajón abierto
};

// === Helpers ===
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
function show(el, v){ el.style.display = v ? '' : 'none'; }
function setText(el, t){ el.textContent = t; }
function pillCls(status){ return (String(status||'').toLowerCase()==='cerrado')?'pill cer':'pill act'; }

async function getUser(){
  try{
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) console.warn('[auth.getUser]', error.message);
    return user || null;
  }catch(e){
    console.error('[getUser]', e);
    return null;
  }
}

async function resolveIsAdmin(user){
  try{
    const { data, error } = await supabase
      .from('employees')
      .select('is_admin')
      .eq('user_id', user.id)
      .limit(1);
    if (error) throw error;
    return !!(data && data[0] && data[0].is_admin);
  }catch(e){
    console.warn('[isAdmin]', e?.message);
    return false;
  }
}

// === Data ===
async function fetchProjects(){
  const cols = 'project_code,name,description,status,start_date,end_date,client_id,client_name,is_active,presupuesto,afectacion,updated_at';
  const { data, error } = await supabase
    .from('projects')
    .select(cols)
    .eq('is_active', true)
    .order('project_code', { ascending: true });
  if (error) throw error;
  return data || [];
}

// === Render ===
function render(){
  listEl.innerHTML = '';
  const arr = st.filtered;

  setText(chipCount, `${arr.length} resultado${arr.length===1?'':'s'}`);
  show(emptyEl, arr.length === 0);

  for (const p of arr){
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.code = p.project_code;

    const left = document.createElement('div');
    left.innerHTML = `
      <div class="id">${esc(p.project_code)}</div>
      <div class="name">${esc(p.name)}</div>
      <div class="client">${esc(p.client_name || '—')}</div>
    `;

    const pill = document.createElement('div');
    pill.className = pillCls(p.status);
    pill.textContent = p.status || '—';

    const meta = document.createElement('div');
    meta.className = 'meta';
    if (st.isAdmin){
      const pres = (p.presupuesto==null || p.presupuesto==='') ? '—' : Number(p.presupuesto).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});
      const afe  = p.afectacion || '—';
      meta.innerHTML = `<span><b>Pres:</b> ${esc(pres)}</span><span><b>Afect:</b> ${esc(afe)}</span>`;
    }else{
      meta.innerHTML = `<span class="muted">—</span>`;
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const btnToggle = document.createElement('button');
    btnToggle.className = 'btn-slim';
    btnToggle.textContent = (st.openCode === p.project_code) ? 'Ocultar' : 'Ver detalle';
    btnToggle.addEventListener('click', () => toggleDrawer(p.project_code, p));
    actions.appendChild(btnToggle);

    row.appendChild(left);
    row.appendChild(pill);
    row.appendChild(meta);
    row.appendChild(actions);

    if (st.openCode === p.project_code){
      const drawer = document.createElement('div');
      drawer.className = 'drawer';
      drawer.innerHTML = `
        <div class="grid">
          <div class="kv"><div class="k">Código</div><div class="v">${esc(p.project_code)}</div></div>
          <div class="kv"><div class="k">Estado</div><div class="v">${esc(p.status)}</div></div>
          <div class="kv"><div class="k">Cliente</div><div class="v">${esc(p.client_name || '—')}</div></div>
          <div class="kv"><div class="k">Client ID</div><div class="v">${esc(p.client_id || '—')}</div></div>
          <div class="kv"><div class="k">Inicio</div><div class="v">${esc(p.start_date || '—')}</div></div>
          <div class="kv"><div class="k">Fin</div><div class="v">${esc(p.end_date || '—')}</div></div>
          <div class="kv" style="grid-column:1/-1"><div class="k">Descripción</div><div class="v">${esc(p.description || '—')}</div></div>
          ${st.isAdmin ? `
            <div class="kv"><div class="k">Presupuesto</div><div class="v">${esc(p.presupuesto ?? '—')}</div></div>
            <div class="kv"><div class="k">Afectación</div><div class="v">${esc(p.afectacion ?? '—')}</div></div>
          `:''}
        </div>
        <div style="margin-top:8px" class="client">Actualizado: ${esc(new Date(p.updated_at).toLocaleString())}</div>
      `;
      row.appendChild(drawer);
    }

    listEl.appendChild(row);
  }
}

function toggleDrawer(code, proj){
  st.openCode = (st.openCode === code) ? null : code;
  render();
}

// === Filtro ===
function applyFilter(){
  const q = (fQuery.value || '').trim().toLowerCase();
  const estado = (fEstado.value || '').trim().toLowerCase();
  const cliente = (fCliente.value || '').trim().toLowerCase();

  st.filtered = st.all.filter(p => {
    const hitQ = !q || p.project_code.toLowerCase().includes(q) || (p.name||'').toLowerCase().includes(q);
    const hitE = !estado || (p.status||'').toLowerCase() === estado;
    const hitC = !cliente || (p.client_name||'').toLowerCase().includes(cliente);
    return hitQ && hitE && hitC && p.is_active !== false;
  });

  // reset drawer al filtrar
  st.openCode = null;
  render();
}

// === Crear proyecto ===
function openCreate(){ dlgCreate.showModal(); }
function closeCreate(){
  dlgCreate.close();
  show(createMsg,false); show(createErr,false);
  frmCreate.reset();
  // ocultar campos admin si no aplica
  adminFields.style.display = st.isAdmin ? '' : 'none';
}

btnCreate?.addEventListener('click', () => {
  adminFields.style.display = st.isAdmin ? '' : 'none';
  openCreate();
});
btnCancel?.addEventListener('click', closeCreate);

frmCreate?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  show(createMsg,false); show(createErr,false);

  const fd = new FormData(frmCreate);
  const payload = {
    project_code: (fd.get('project_code')||'').trim(),
    name: (fd.get('name')||'').trim(),
    description: (fd.get('description')||'').trim() || null,
    status: (fd.get('status')||'Activo').trim(),
    start_date: (fd.get('start_date')||'') || null,
    end_date: (fd.get('end_date')||'') || null,
    client_id: (fd.get('client_id')||'').trim() || null,
    client_name: (fd.get('client_name')||'').trim(),
    is_active: true
  };

  // Solo admin puede enviar estos campos (aunque existan en el form)
  if (st.isAdmin){
    const pres = (fd.get('presupuesto')||'').trim();
    payload.presupuesto = pres === '' ? null : Number(pres);
    payload.afectacion = (fd.get('afectacion')||'').trim() || null;
  }

  // Validaciones mínimas
  if (!payload.project_code || !payload.name || !payload.client_name){
    createErr.textContent = 'Complete los campos obligatorios (*).';
    show(createErr,true);
    return;
  }
  if (payload.status !== 'Activo' && payload.status !== 'Cerrado'){
    createErr.textContent = 'Estado inválido.';
    show(createErr,true);
    return;
  }
  if (payload.start_date && payload.end_date && payload.end_date < payload.start_date){
    createErr.textContent = 'La fecha de fin no puede ser anterior al inicio.';
    show(createErr,true);
    return;
  }

  try{
    const { error } = await supabase.from('projects').insert(payload);
    if (error){
      if (String(error.message||'').includes('duplicate key')){
        throw new Error('El código de proyecto ya existe.');
      }
      throw error;
    }
    createMsg.textContent = '✅ Proyecto creado correctamente.';
    show(createMsg,true);

    // refrescar lista
    const fresh = await fetchProjects();
    st.all = fresh;
    applyFilter();

    setTimeout(() => closeCreate(), 800);
  }catch(e){
    createErr.textContent = 'No se pudo crear el proyecto: ' + (e.message || e);
    show(createErr,true);
  }
});

// === Navegación ===
btnHome?.addEventListener('click', () => location.href = './');
btnSignOut?.addEventListener('click', async () => { try{ await supabase.auth.signOut(); }catch{} location.href='./'; });

// === Init ===
(async function init(){
  // sesión
  st.user = await getUser();
  if (!st.user){
    errEl.textContent = 'Sesión no válida. Inicie sesión.';
    show(errEl,true);
    setTimeout(() => location.href = './', 1200);
    return;
  }

  // rol
  st.isAdmin = await resolveIsAdmin(st.user);

  try{
    const data = await fetchProjects();
    st.all = data;
    // filtro por defecto: Activo
    fEstado.value = 'Activo';
    applyFilter();
  }catch(e){
    errEl.textContent = 'Error al cargar proyectos: ' + (e.message || e);
    show(errEl,true);
  }

  // Listeners de filtro
  [fEstado, fCliente, fQuery].forEach(el => el?.addEventListener('input', applyFilter));
})();
