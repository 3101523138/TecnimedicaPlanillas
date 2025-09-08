// ===============================
// TMI · Proyectos (Etapa 1)
// 
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
window.st = st; // para debug rápido en consola

// === Permisos especiales ===
const REOPENER_EMAIL = 'jrojas@tecnomedicacr.com';

// === Helpers ===
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
function show(el, v){ el.style.display = v ? '' : 'none'; }
function setText(el, t){ el.textContent = t; }
function toastOk(t){ msgEl.textContent = t; show(msgEl,true); setTimeout(()=>show(msgEl,false),1500); }
function toastErr(t){ errEl.textContent = t; show(errEl,true); setTimeout(()=>show(errEl,false),2500); }

// ---- Normalización de filas (acepta columnas en ES o EN) ----
function normalizeRow(r){
  const isActive = (typeof r.is_active === 'boolean') ? r.is_active
                  : (typeof r.esta_activo === 'boolean') ? r.esta_activo
                  : null;

  return {
    project_code: r.project_code ?? r.codigo_del_proyecto ?? r['código_del_proyecto'] ?? null,
    name: r.name ?? r.nombre ?? null,
    description: r.description ?? r.descripcion ?? null,
    status: r.status ?? r.estado ?? '',
    start_date: r.start_date ?? r.fecha_inicio ?? null,
    end_date: r.end_date ?? r.fecha_fin ?? null,
    client_id: r.client_id ?? r.id_del_cliente ?? null,
    client_name: r.client_name ?? r.nombre_del_cliente ?? '',
    is_active: isActive, // queda por compatibilidad/back-end, la UI lo ignora
    presupuesto: r.presupuesto ?? null,
    afectacion: r.afectacion ?? null,
    updated_at: r.updated_at ?? r.actualizado_en ?? r.updatedAt ?? null,
    // Auditoría de cierre
    closed_at: r.closed_at ?? r.cerrado_en ?? null,
    closed_by_email: r.closed_by_email ?? r.cerrado_por ?? null,
  };
}

// === Estado SOLO por `status` ===
function estadoDe(p){
  const s = (p.status || '').toString().trim().toLowerCase();
  if (s === 'activo' || s === 'activa' || s === 'abierto' || s === 'abierta') return 'activo';
  if (s === 'cerrado' || s === 'cerrada') return 'cerrado';
  return 'activo';
}
function pillClass(p){ return estadoDe(p) === 'activo' ? 'pill act' : 'pill cer'; }
function pillText(p){
  const s = (p.status || '').toString().trim();
  return s ? s : (estadoDe(p) === 'activo' ? 'Activo' : 'Cerrado');
}

function canClose(p){ return st.isAdmin && estadoDe(p) === 'activo'; }
function canReopen(p){ return (st.user?.email === REOPENER_EMAIL) && estadoDe(p) === 'cerrado'; }

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
  // SIN filtros. Tomamos todas las columnas para evitar errores de nombres.
  const { data, error } = await supabase
    .from('projects')
    .select('*');
  if (error) throw error;

  const normalized = (data || []).map(normalizeRow);

  // orden local por código si existe
  normalized.sort((a,b) => (a.project_code||'').localeCompare(b.project_code||''));

  // debug útil (sin is_active para no confundir)
  console.info('[projects] total filas:', normalized.length);
  console.table(normalized.slice(0,10).map(p => ({
    project_code: p.project_code,
    status: p.status,
    client: p.client_name
  })));

  return normalized;
}

async function fetchClients(){
  // 1) Tabla clients
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

  // 2) Fallback: desde projects normalizados
  try{
    const projs = st.all.length ? st.all : await fetchProjects();
    const names = Array.from(new Set(projs.map(p => p.client_name).filter(Boolean))).sort();
    return names.map(n => ({ id: null, name: n }));
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
    opt2.value = c.id ? `${c.id}::${c.name}` : `::${c.name}`;
    opt2.textContent = c.name;
    cliSelect.appendChild(opt2);
  }
}

// === Acciones de estado (cerrar/reabrir) ===
function askConfirm(texto){ return window.confirm(texto); }

async function updateStatus(projectCode, nextStatus){
  try{
    const { error } = await supabase
      .from('projects')
      .update({ status: nextStatus })
      .eq('project_code', projectCode);

    if (error) throw error;

    // refrescar datos y re-render
    st.all = await fetchProjects();
    applyFilter();
    toastOk(`Estado actualizado a ${nextStatus}.`);
  }catch(e){
    toastErr(e.message || String(e));
  }
}

async function closeProject(p){
  if (!canClose(p)) return;
  if (!askConfirm(`¿Cerrar el proyecto ${p.project_code}?`)) return;
  await updateStatus(p.project_code, 'Cerrado');
}

async function reopenProject(p){
  if (!canReopen(p)) return;
  if (!askConfirm(`¿Reabrir el proyecto ${p.project_code}?`)) return;
  await updateStatus(p.project_code, 'Activo'); // o 'Abierto' si prefieres
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
      <div class="id">${esc(p.project_code ?? '—')}</div>
      <div class="name">${esc(p.name ?? '—')}</div>
      <div class="client">${esc(p.client_name || '—')}</div>
    `;

    const pill = document.createElement('div');
    pill.className = pillClass(p);
    const pillTxt = pillText(p);
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
    btnToggle.addEventListener('click', () => toggleDrawer(p.project_code));
    actions.appendChild(btnToggle);

    // Botón Cerrar (solo admin cuando está activo)
    if (canClose(p)){
      const btnClose = document.createElement('button');
      btnClose.className = 'btn-slim';
      btnClose.style.borderColor = '#10b981';
      btnClose.textContent = 'Cerrar';
      btnClose.addEventListener('click', () => closeProject(p));
      actions.appendChild(btnClose);
    }

    // Botón Reabrir (solo jrojas cuando está cerrado)
    if (canReopen(p)){
      const btnOpen = document.createElement('button');
      btnOpen.className = 'btn-slim';
      btnOpen.style.borderColor = '#1e88e5';
      btnOpen.textContent = 'Reabrir';
      btnOpen.addEventListener('click', () => reopenProject(p));
      actions.appendChild(btnOpen);
    }

    row.appendChild(left);
    row.appendChild(pill);
    row.appendChild(meta);
    row.appendChild(actions);

    if (st.openCode === p.project_code){
      const drawer = document.createElement('div');
      drawer.className = 'drawer';
      drawer.innerHTML = `
        <div class="grid">
          <div class="kv"><div class="k">Código</div><div class="v">${esc(p.project_code ?? '—')}</div></div>
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
          ${estadoDe(p) === 'cerrado' ? `
            <div class="kv"><div class="k">Cerrado por</div><div class="v">${esc(p.closed_by_email || '—')}</div></div>
            <div class="kv"><div class="k">Cerrado el</div><div class="v">${p.closed_at ? esc(new Date(p.closed_at).toLocaleString()) : '—'}</div></div>
          `:``}
        </div>
        <div style="margin-top:8px" class="client">Actualizado: ${p.updated_at ? esc(new Date(p.updated_at).toLocaleString()) : '—'}</div>
      `;
      row.appendChild(drawer);
    }

    listEl.appendChild(row);
  }
}

function toggleDrawer(code){ st.openCode = (st.openCode === code) ? null : code; render(); }

function applyFilter(){
  const estado  = (fEstado.value || '').trim().toLowerCase(); // '', 'activo', 'cerrado'
  const cliente = (fClienteSel.value || '').trim().toLowerCase();

  st.filtered = st.all.filter(p => {
    const e = estadoDe(p); // 'activo' | 'cerrado'
    const matchEstado   = !estado || e === estado;
    const matchCliente  = !cliente || (p.client_name || '').toLowerCase().includes(cliente);
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
  if (isNew) cliSelect.value = '';
});

frmCreate?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  show(createMsg,false); show(createErr,false);

  try{
    const fd = new FormData(frmCreate);
    const base = {
      project_code: (fd.get('project_code')||'').trim(),
      name: (fd.get('name')||'').trim(),
      description: (fd.get('description')||'').trim() || null,
      status: (fd.get('status')||'Activo').trim(),
      start_date: (fd.get('start_date')||'') || null,
      end_date: (fd.get('end_date')||'') || null
      // is_active: true  // <- YA NO: la UI solo usa status
    };
    if (!base.project_code || !base.name){
      throw new Error('Complete los campos obligatorios (*).');
    }
    const stLower = base.status.toLowerCase();
    if (stLower !== 'activo' && stLower !== 'cerrado' && stLower !== 'abierto' && stLower !== 'abierta'){
      throw new Error('Estado inválido.');
    }
    if (base.start_date && base.end_date && base.end_date < base.start_date){
      throw new Error('La fecha de fin no puede ser anterior al inicio.');
    }

    // Resolver cliente
    let client_id = null;
    let client_name = '';

    if (chkNewClient.checked){
      const cname = (newClientName.value||'').trim();
      const ctax  = (newClientTaxId.value||'').trim() || null;
      if (!cname) throw new Error('Ingrese el nombre del nuevo cliente.');

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
        st.clients.push({ id: client_id, name: client_name });
        populateClientSelects();
      }
    }else{
      const sel = cliSelect.value; // "id::name" o "::name"
      if (!sel) throw new Error('Seleccione un cliente o marque "Nuevo cliente".');
      const [cid, cname] = sel.split('::');
      client_id = cid || null;
      client_name = cname || '';
    }

    const payload = { ...base, client_id, client_name };

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

    st.all = await fetchProjects();
    st.clients = await fetchClients();
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
  st.user = await getUser();
  if (!st.user){
    errEl.textContent = 'Sesión no válida. Inicie sesión.';
    show(errEl,true);
    setTimeout(() => location.href = './', 1200);
    return;
  }

  st.isAdmin = await resolveIsAdmin(st.user);

  try{
    st.all = await fetchProjects();
  }catch(e){
    errEl.textContent = 'Error al cargar proyectos: ' + (e.message || e);
    show(errEl,true);
    return;
  }

  try{
    st.clients = await fetchClients();
    populateClientSelects();
  }catch(e){
    console.warn('[clients]', e?.message);
  }

  // Por defecto: Activo
  fEstado.value = 'Activo';
  applyFilter();

  [fEstado, fClienteSel].forEach(el => el?.addEventListener('input', applyFilter));
})();
