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

// Filtro - cliente select
const fClienteSel = $('#fClienteSel');

const dlgCreate = $('#dlgCreate');
const frmCreate = $('#frmCreate');
const btnCancel = $('#btnCancel');
const btnCreate = $('#btnCreate');
const btnHome = $('#btnHome');
const btnSignOut = $('#btnSignOut');
const adminFields = $('#adminFields');
const createMsg = $('#createMsg');
const createErr = $('#createErr');

// Formulario - cliente select & nuevo cliente
const cliSelect = $('#cliSelect');
const chkNewClient = $('#chkNewClient');
const newClientFields = $('#newClientFields');
const newClientName = $('#newClientName');
const newClientTaxId = $('#newClientTaxId');

// === Estado ===
const st = {
  user: null,
  isAdmin: false,
  all: [],
  filtered: [],
  openCode: null,
  clients: []
};

// === Helpers ===
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
function show(el, v){ el.style.display = v ? '' : 'none'; }
function setText(el, t){ el.textContent = t; }

// Usa status o is_active para decidir visual
function isActivo(p){
  const s = String(p.status || '').toLowerCase();
  return p.is_active === true || s === 'activo';
}
function isCerrado(p){
  const s = String(p.status || '').toLowerCase();
  return p.is_active === false || s === 'cerrado';
}
function pillClsFromProj(p){ return isActivo(p) ? 'pill act' : 'pill cer'; }

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
  // IMPORTANTE: NO filtrar por is_active aquí.
  const { data, error } = await supabase
    .from('projects')
    .select(cols)
    .order('project_code', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchClients(){
  // 1) Intentar desde tabla clients (recomendada)
  try{
    const { data, error } = await supabase
      .from('clients')
      .select('id,name,status')
      .eq('status','Activo')
      .order('name', { ascending: true });
    if (error) throw error;
    if (data && data.length) return data.map(c => ({ id: c.id, name: c.name }));
  }catch(e){
    console.warn('[clients] no disponible o vacía:', e?.message);
  }

  // 2) Fallback: distintos client_name desde projects
  try{
    const { data, error } = await supabase
      .from('projects')
      .select('client_name')
      .neq('client_name', null)
      .neq('client_name', '')
      .order('client_name', { ascending: true });
    if (error) throw error;
    const uniq = [...new Set((data||[]).map(r => r.client_name))];
    return uniq.map(n => ({ id: null, name: n }));
  }catch(e){
    console.error('[clients fallback]', e);
    return [];
  }
}

function populateClientSelects(){
  // Filtro
  fClienteSel.innerHTML = `<option value="">— Todos los clientes —</option>`;
  // Formulario
  cliSelect.innerHTML = `<option value="">— Seleccione un cliente —</option>`;

  for(const c of st.clients){
    const opt1 = document.createElement('option');
    opt1.value = c.name;
    opt1.textContent = c.name;
    fClienteSel.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = c.id ? `${c.id}::${c.name}` : `::${c.name}`; // "id::name" o "::name" si no hay id
    opt2.textContent = c.name;
    cliSelect.appendChild(opt2);
  }
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
    if (st.openCode === p.project_code) row.classList.add('open');
    row.dataset.code = p.project_code;

    const left = document.createElement('div');
    left.innerHTML = `
      <div class="id">${esc(p.project_code)}</div>
      <div class="name">${esc(p.name)}</div>
      <div class="client">${esc(p.client_name || '—')}</div>
    `;

    const pill = document.createElement('div');
    pill.className = pillClsFromProj(p);
    // Texto del pill: prioriza status; si no está, deriva de is_active
    const pillTxt = p.status || (p.is_active === false ? 'Cerrado' : 'Activo');
    pill.textContent = pillTxt;

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
          <div class="kv"><div class="k">Estado</div><div class="v">${esc(pillTxt)}</div></div>
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

function applyFilter(){
  const estado  = (fEstado.value || '').trim().toLowerCase(); // '', 'activo', 'cerrado'
  const cliente = (fClienteSel.value || '').trim().toLowerCase();

  st.filtered = st.all.filter(p => {
    // Filtro por estado:
    let matchEstado = true;
    if (estado === 'activo')   matchEstado = isActivo(p);
    else if (estado === 'cerrado') matchEstado = isCerrado(p);
    // Si estado === '' => "Todos", no filtra

    // Filtro por cliente (por nombre contiene)
    const matchCliente = !cliente || (p.client_name || '').toLowerCase().includes(cliente);

    return matchEstado && matchCliente;
  });

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

// === Toggle Nuevo Cliente ===
chkNewClient?.addEventListener('change', () => {
  const isNew = chkNewClient.checked;
  newClientFields.style.display = isNew ? '' : 'none';
  // Si es nuevo, deselecciona el select
  if (isNew) cliSelect.value = '';
});

frmCreate?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  show(createMsg,false); show(createErr,false);

  try{
    // Validaciones base del proyecto
    const fd = new FormData(frmCreate);
    const base = {
      project_code: (fd.get('project_code')||'').trim(),
      name: (fd.get('name')||'').trim(),
      description: (fd.get('description')||'').trim() || null,
      status: (fd.get('status')||'Activo').trim(),
      start_date: (fd.get('start_date')||'') || null,
      end_date: (fd.get('end_date')||'') || null,
      is_active: true
    };
    if (!base.project_code || !base.name){
      throw new Error('Complete los campos obligatorios (*).');
    }
    if (base.status !== 'Activo' && base.status !== 'Cerrado'){
      throw new Error('Estado inválido.');
    }
    if (base.start_date && base.end_date && base.end_date < base.start_date){
      throw new Error('La fecha de fin no puede ser anterior al inicio.');
    }

    // Resolver cliente
    let client_id = null;
    let client_name = '';

    if (chkNewClient.checked){
      // Crear cliente nuevo (requiere tabla clients)
      const cname = (newClientName.value||'').trim();
      const ctax  = (newClientTaxId.value||'').trim() || null;
      if (!cname) throw new Error('Ingrese el nombre del nuevo cliente.');

      // upsert simple por nombre
      const { data: existing, error: eFind } = await supabase
        .from('clients')
        .select('id,name')
        .eq('name', cname)
        .limit(1);
      if (eFind) throw eFind;

      if (existing && existing.length){
        client_id = existing[0].id;
        client_name = existing[0].name;
      }else{
        const { data: ins, error: eIns } = await supabase
          .from('clients')
          .insert({ name: cname, tax_id: ctax, status: 'Activo' })
          .select('id,name')
          .single();
        if (eIns) throw eIns;
        client_id = ins.id;
        client_name = ins.name;
        // Actualizar cache local y selects
        st.clients.push({ id: client_id, name: client_name });
        populateClientSelects();
      }
    }else{
      // Cliente seleccionado del dropdown
      const sel = cliSelect.value;        // formato "id::name" o "::name"
      if (!sel) throw new Error('Seleccione un cliente o marque "Nuevo cliente".');
      const [cid, cname] = sel.split('::');
      client_id = cid || null;
      client_name = cname || '';
    }

    const payload = {
      ...base,
      client_id,
      client_name
    };

    // Solo admin puede enviar presupuesto/afectación
    if (st.isAdmin){
      const pres = ($('#frmCreate [name="presupuesto"]')?.value || '').trim();
      const afe  = ($('#frmCreate [name="afectacion"]')?.value || '').trim() || null;
      payload.presupuesto = pres === '' ? null : Number(pres);
      payload.afectacion  = afe;
    }

    const { error } = await supabase.from('projects').insert(payload);
    if (error){
      if (String(error.message||'').includes('duplicate key')){
        throw new Error('El código de proyecto ya existe.');
      }
      throw error;
    }

    createMsg.textContent = '✅ Proyecto creado correctamente.';
    show(createMsg,true);

    // refrescar lista + clientes (por si creaste uno nuevo)
    const [freshProjects, freshClients] = await Promise.all([fetchProjects(), fetchClients()]);
    st.all = freshProjects;
    st.clients = freshClients;
    populateClientSelects();
    applyFilter();

    setTimeout(() => {
      dlgCreate.close();
      show(createMsg,false); show(createErr,false);
      frmCreate.reset();
      newClientFields.style.display = 'none';
      chkNewClient.checked = false;
    }, 800);

  }catch(e){
    createErr.textContent = e.message || String(e);
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

  // ➊ Cargar clientes y poblar selects (antes de proyectos)
  try{
    st.clients = await fetchClients();
    populateClientSelects();
  }catch(e){
    console.warn('[clients]', e?.message);
  }

  // ➋ Cargar proyectos (sin filtro previo por is_active)
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

  // ➌ Listeners de filtros
  [fEstado, fClienteSel].forEach(el => el?.addEventListener('input', applyFilter));
})();
