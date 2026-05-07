// Ruta: assets/facturas-liquidacion-modal.js  [v=10]
// Modal de reclamo (paso 2) — adaptado al patrón de Meridian:
//   1. Resumen del documento
//   2. Destino del gasto         (combo destino + combo capa)
//   3. Cliente y Proyecto         (cascada: cliente → proyecto del destino)
//   4. Instrumento de pago        (agrupado por categoría NIIF con border-left)
//   5. Notas internas
//
// El modal antiguo de FacturasUI (proyecto-cliente-capa-tipo-responsable-comentario)
// queda totalmente reemplazado. El modelo es ahora 1:1 con el modal paso 2 del
// frontend de Meridian (LiqPanel.jsx — sección "Reclamar factura").
//
// Backend: complete-claim del backend de Meridian (vía meridian-api.js).
console.error("🟢 MODAL v10 (filtro tipo_uso restaurado + highlight siguiente campo) CARGADO", new Date().toISOString());

// Wrapper a Meridian — los catálogos del paso 2 y el guardado se hacen
// contra el backend de Meridian, no contra el Supabase de Planillas.
// El cliente Supabase global de la PWA sigue usándose para autenticación
// (el JWT del usuario logueado se manda al backend en cada request).
import {
  fetchCatalogProjectsMeridian,
  fetchCatalogExpenseDestinationsMeridian,
  fetchCatalogPaymentMethodsMeridian,
  fetchInvoiceDetailMeridian,
  completeClaimMeridian,
  openInvoicePdfMeridian,
} from './meridian-api.js?v=01';

//#1 constantes internas del modal
const LIQ_MODAL_ID     = "facturasLiqEditModal";
const LIQ_MODAL_CSS_ID = "facturas-liquidacion-modal-css-link";
const PDF_MODAL_ID     = "facturasLiqPdfModal";
const PICKER_MODAL_ID  = "facturasLiqPickerModal";

// Acentos por categoría NIIF (mismos que usa Meridian en la web).
// El código de categoría sale del backend (payment_methods.category_codigo).
const CATEGORIA_ACCENTS = {
  pago_contado:      { color: '#16a34a', help: 'Liquidación inmediata. Baja del activo en la fecha de transacción.' },
  pago_ciclo_liq:    { color: '#0891b2', help: 'Liquidación diferida. Se liquida en el ciclo del instrumento.' },
  credito_comercial: { color: '#d97706', help: 'Crédito comercial. Genera un pasivo financiero.' },
};
const CATEGORIA_FALLBACK = { color: '#94a3b8', help: '' };

//#2 fábrica del controlador del modal
export function createFacturasLiquidacionModalController({
  getSupabaseClient,
  getLoggedEmployeeName,
  openPdfModal,
  onAfterSave,
  logPrefix = "[FACTURAS-LIQ-MODAL]",
} = {}) {
  //#3 estado interno privado
  const state = {
    // catálogos
    proyectos:      [],   // { id, codigo, nombre, cliente_nombre, estado }
    destinos:       [],   // { id, codigo, nombre, prefijo_proyecto, capas[], activo }
    metodosPago:    [],   // { id, codigo, nombre, tipo_uso, category_id, category_codigo, category_nombre, category_orden, sort_order, activo }
    catalogsLoaded: false,

    // UI
    modalOpen:      false,
    guardando:      false,
    facturaActual:  null,
    hiddenForPdf:   false,
    pdfObserver:    null,
    pdfBridgeBound: false,

    // selección actual del formulario
    form: {
      expense_destination_id: '',
      capa:                   '',
      cliente_sel:            '',
      proyecto_id:            '',   // UUID del proyecto en Meridian
      proyecto_codigo:        '',
      proyecto_nombre:        '',
      tipo_pago:              '',   // codigo del método elegido
      metodo_pago_id:         '',   // UUID del método (si lo tenemos)
      notas:                  '',
    },

    // picker bottom sheet (solo cliente / proyecto)
    pickerOpen: false,
    pickerType: '',
    pickerSearch: { cliente: '', proyecto: '' },
  };

  //#4 utilidades base
  function log(...args) { console.log(logPrefix, ...args); }
  function logError(...args) { console.error(logPrefix, ...args); }

  function getSupabase() {
    const client = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
    if (!client) throw new Error("No hay conexión disponible para abrir la liquidación.");
    return client;
  }

  function getEmployeeName() {
    return String(typeof getLoggedEmployeeName === "function" ? getLoggedEmployeeName() : "").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function toNumberSafe(value) {
    if (value === null || value === undefined || value === "") return 0;
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
  }

  function formatIssueDate(dateValue) {
    const raw = String(dateValue || "").trim();
    if (!raw) return "—";
    const dt = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return raw;
    return dt.toLocaleDateString("es-CR", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function formatMoney(currency, amount) {
    const code = String(currency || "").trim().toUpperCase();
    const value = toNumberSafe(amount);
    if (code === "USD") {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency: "USD",
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(value);
    }
    return new Intl.NumberFormat("es-CR", {
      style: "currency", currency: "CRC",
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(value);
  }

  function resolveDisplayAmount(factura) {
    const currency = String(factura?.currency_code || "").trim().toUpperCase();
    if (currency === "USD") return { currency: "USD", amount: toNumberSafe(factura?.amount_usd) };
    return { currency: currency || "CRC", amount: toNumberSafe(factura?.amount_crc) };
  }

  function formatSupplierLabel(factura) {
    return String(factura?.supplier_name || "").trim() || "Proveedor no disponible";
  }

  function resolveLiquidacionEstadoVisible(factura) {
    const valor = String(factura?.liq_status || "").trim();
    if (!valor) return "Pendiente";
    if (normalizeText(valor) === "revision") return "Reclamada";
    return valor;
  }

  function resolvePdfInfo(factura) {
    // El PDF se sirve desde Meridian con auth Bearer. Cualquier factura con id
    // puede tener PDF (el endpoint devuelve 404 si no lo tiene).
    const facturaId = String(factura?.id || "").trim();
    return { hasPdf: !!facturaId, facturaId };
  }

  function mapHumanLiquidacionError(error) {
    const raw = String(error?.message || error?.details || error?.hint || "").trim()
      || "No se pudo completar la operación.";
    const lower = raw.toLowerCase();
    if (lower.includes("network") || lower.includes("fetch")) {
      return "Hubo un problema de conexión. Intenta nuevamente.";
    }
    if (lower.includes("not exist")) {
      return "La factura o alguno de los datos requeridos ya no está disponible.";
    }
    return raw;
  }

  //#5 hoja de estilos
  function ensureStylesheet() {
    if (document.getElementById(LIQ_MODAL_CSS_ID)) return;
    const link = document.createElement("link");
    link.id = LIQ_MODAL_CSS_ID;
    link.rel = "stylesheet";
    link.href = new URL("./facturas-liquidacion-modal.css?v=03", import.meta.url).href;
    document.head.appendChild(link);
    log("css externo del modal enlazado");
  }

  //#6 puente con visor PDF (legacy)
  function getModalRoot() { return document.getElementById(LIQ_MODAL_ID); }
  function getPdfRoot()   { return document.getElementById(PDF_MODAL_ID); }

  function hideForPdf() {
    const modal = getModalRoot();
    if (!modal || !state.modalOpen) return;
    state.hiddenForPdf = true;
    modal.style.visibility = "hidden";
    modal.style.pointerEvents = "none";
    modal.setAttribute("data-hidden-for-pdf", "1");
  }

  function restoreAfterPdf() {
    const modal = getModalRoot();
    if (!modal || !state.modalOpen || !state.hiddenForPdf) return;
    modal.style.visibility = "";
    modal.style.pointerEvents = "";
    modal.removeAttribute("data-hidden-for-pdf");
    state.hiddenForPdf = false;
  }

  function syncWithPdfVisibility() {
    const pdfModal = getPdfRoot();
    if (!pdfModal) { restoreAfterPdf(); return; }
    if (pdfModal.style.display !== "flex") restoreAfterPdf();
  }

  function observePdfModal(pdfModal) {
    if (!pdfModal) return;
    if (state.pdfObserver) { state.pdfObserver.disconnect(); state.pdfObserver = null; }
    state.pdfObserver = new MutationObserver(() => syncWithPdfVisibility());
    state.pdfObserver.observe(pdfModal, { attributes: true, attributeFilter: ["style", "class"] });
  }

  function ensurePdfBridge() {
    if (state.pdfBridgeBound) return;
    state.pdfBridgeBound = true;
    const pdfModal = getPdfRoot();
    if (pdfModal) observePdfModal(pdfModal);
    const bodyObserver = new MutationObserver(() => {
      const m = getPdfRoot();
      if (m && !state.pdfObserver) observePdfModal(m);
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", () => setTimeout(syncWithPdfVisibility, 30));
    document.addEventListener("click",   () => setTimeout(syncWithPdfVisibility, 30));
  }

  async function openPdfFromLiquidacion() {
    if (!state.facturaActual) return;
    const facturaId = String(state.facturaActual.id || "").trim();
    if (!facturaId) return;
    try {
      const supabase = getSupabase();
      log("abriendo PDF desde Meridian:", facturaId);
      await openInvoicePdfMeridian(supabase, facturaId);
    } catch (err) {
      logError("error abriendo PDF:", err);
      setMessage("error", err?.message || "No se pudo abrir el PDF de la factura.");
    }
  }

  //#7 ensure modal — DOM principal con secciones tipo Meridian paso 2
  function ensureModal() {
    ensureStylesheet();
    ensurePdfBridge();
    ensurePickerModal();

    let modal = document.getElementById(LIQ_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = LIQ_MODAL_ID;
    modal.className = "facturasLiqEditModalBack";
    modal.innerHTML = `
      <div class="facturasLiqEditModal" role="dialog" aria-modal="true" aria-label="Reclamar factura">
        <div class="facturasLiqEditHead">
          <div class="facturasLiqEditHeadText">
            <h3>
              <span id="facturasLiqTipoDoc">Reclamar factura</span>
              <span class="facturasLiqDocSep"> · </span>
              <span id="facturasLiqEditDoc">Sin documento</span>
            </h3>
            <p id="facturasLiqEditSubtitle" class="facturasLiqEditSubtitle">—</p>
          </div>
          <button id="facturasLiqEditCloseBtn" type="button" class="facturasLiqModalCloseBtn">Cerrar</button>
        </div>

        <div class="facturasLiqEditBody">

          <!-- ─── 1) Resumen del documento ─── -->
          <section class="facturasLiqEditSection">
            <div class="facturasLiqEditSectionHead">
              <h4>Resumen del documento</h4>
            </div>

            <div class="facturasLiqEditTop">
              <div class="facturasLiqEditDocBox">
                <span class="facturasLiqEditLabel">Documento</span>
                <strong class="facturasLiqEditDocValue" id="facturasLiqEditDocValue">Sin consecutivo</strong>
              </div>
              <button id="facturasLiqEditPdfBtn" type="button" class="facturasLiqModalBtn facturasLiqModalBtnDark">Ver PDF</button>
            </div>

            <div class="facturasLiqEditInfoGrid">
              <div class="facturasLiqEditInfoPill">
                <span class="facturasLiqEditLabel">Fecha</span>
                <strong id="facturasLiqEditFecha">—</strong>
              </div>
              <div class="facturasLiqEditInfoPill">
                <span class="facturasLiqEditLabel">Proveedor</span>
                <strong id="facturasLiqEditProveedor">—</strong>
              </div>
              <div class="facturasLiqEditInfoPill">
                <span class="facturasLiqEditLabel">Monto</span>
                <strong id="facturasLiqEditMonto">—</strong>
              </div>
              <div class="facturasLiqEditInfoPill">
                <span class="facturasLiqEditLabel">Estado</span>
                <strong id="facturasLiqEditEstadoVisible">Pendiente</strong>
              </div>
            </div>
          </section>

          <!-- ─── 2) Destino del gasto ─── -->
          <section class="facturasLiqEditSection">
            <div class="facturasLiqEditSectionHead">
              <h4>Destino del gasto</h4>
            </div>

            <div class="facturasLiqField">
              <label class="facturasLiqFieldLabel" for="facturasLiqDestinoSelect">Destino *</label>
              <select id="facturasLiqDestinoSelect" class="facturasLiqSelect">
                <option value="">Seleccionar destino...</option>
              </select>
            </div>

            <div class="facturasLiqField" id="facturasLiqCapaWrap" style="display:none;">
              <label class="facturasLiqFieldLabel" for="facturasLiqCapaSelect">Capa / Sub-categoría</label>
              <select id="facturasLiqCapaSelect" class="facturasLiqSelect">
                <option value="">Seleccionar capa...</option>
              </select>
            </div>
          </section>

          <!-- ─── 3) Cliente y Proyecto ─── -->
          <section class="facturasLiqEditSection" id="facturasLiqClienteProyectoSection" style="display:none;">
            <div class="facturasLiqEditSectionHead">
              <h4>Cliente y Proyecto asociado</h4>
            </div>

            <div class="facturasLiqField">
              <label class="facturasLiqFieldLabel" for="facturasLiqClienteInput">Cliente *</label>
              <div class="facturasLiqPickerTriggerWrap">
                <button id="facturasLiqClienteTrigger" type="button" class="facturasLiqPickerTrigger">
                  <span id="facturasLiqClienteInput" class="facturasLiqPickerTriggerText is-placeholder">Seleccionar cliente...</span>
                  <span class="facturasLiqPickerTriggerIcon">⌄</span>
                </button>
                <button id="facturasLiqClearClienteBtn" type="button" class="facturasLiqModalBtn facturasLiqModalBtnLight facturasLiqPickerClearBtn">Limpiar</button>
              </div>
            </div>

            <div class="facturasLiqField">
              <label class="facturasLiqFieldLabel" for="facturasLiqProyectoInput">Proyecto *</label>
              <div class="facturasLiqPickerTriggerWrap">
                <button id="facturasLiqProyectoTrigger" type="button" class="facturasLiqPickerTrigger">
                  <span id="facturasLiqProyectoInput" class="facturasLiqPickerTriggerText is-placeholder">Seleccionar proyecto...</span>
                  <span class="facturasLiqPickerTriggerIcon">⌄</span>
                </button>
                <button id="facturasLiqClearProyectoBtn" type="button" class="facturasLiqModalBtn facturasLiqModalBtnLight facturasLiqPickerClearBtn">Limpiar</button>
              </div>
            </div>
          </section>

          <!-- ─── 4) Instrumento de compra ─── -->
          <section class="facturasLiqEditSection" id="facturasLiqInstrumentoSection" style="display:none;">
            <div class="facturasLiqEditSectionHead">
              <h4>Instrumento de compra</h4>
            </div>
            <div id="facturasLiqInstrumentoList" class="facturasLiqInstrumentoList"></div>
          </section>

          <!-- ─── 5) Notas ─── -->
          <section class="facturasLiqEditSection">
            <div class="facturasLiqEditSectionHead">
              <h4>Notas internas</h4>
            </div>
            <div class="facturasLiqField">
              <textarea
                id="facturasLiqComentarioInput"
                class="facturasLiqTextarea"
                rows="2"
                placeholder="Observaciones opcionales del reclamo..."
              ></textarea>
            </div>
          </section>

          <div id="facturasLiqModalInfo"  class="facturasLiqModalMsgInfo" style="display:none;"></div>
          <div id="facturasLiqModalError" class="facturasLiqModalMsgErr"  style="display:none;"></div>
          <div id="facturasLiqModalOk"    class="facturasLiqModalMsgOk"   style="display:none;"></div>

          <div class="facturasLiqEditFooter">
            <button id="facturasLiqVolverBtn" type="button" class="facturasLiqModalBtn facturasLiqModalBtnLight">Volver</button>
            <div class="facturasLiqEditFooterRight">
              <button id="facturasLiqGuardarBtn" type="button" class="facturasLiqModalBtn facturasLiqModalBtnBlue">Guardar reclamo</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => {
      if (e.target === modal && !state.guardando && !state.pickerOpen) close();
    });

    modal.querySelector("#facturasLiqEditCloseBtn")?.addEventListener("click", () => {
      if (!state.guardando) close();
    });
    modal.querySelector("#facturasLiqVolverBtn")?.addEventListener("click", () => {
      if (!state.guardando) close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.pickerOpen) { closePicker(); return; }
      if (e.key === "Escape" && state.modalOpen && !state.guardando) close();
    });

    return modal;
  }

  //#8 picker bottom sheet (cliente / proyecto)
  function ensurePickerModal() {
    let modal = document.getElementById(PICKER_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = PICKER_MODAL_ID;
    modal.className = "facturasLiqPickerBack";
    modal.innerHTML = `
      <div class="facturasLiqPickerSheet" role="dialog" aria-modal="true" aria-label="Selector">
        <div class="facturasLiqPickerHandleWrap"><div class="facturasLiqPickerHandle"></div></div>
        <div class="facturasLiqPickerHead">
          <div class="facturasLiqPickerHeadText">
            <h3 id="facturasLiqPickerTitle">Seleccionar</h3>
            <p id="facturasLiqPickerSubtitle">Busca y elige una opción</p>
          </div>
          <button id="facturasLiqPickerCloseBtn" type="button" class="facturasLiqModalCloseBtn">Cerrar</button>
        </div>
        <div class="facturasLiqPickerSearchWrap">
          <input id="facturasLiqPickerSearchInput" class="facturasLiqInput facturasLiqPickerSearchInput" type="text" autocomplete="off" placeholder="Buscar..." />
        </div>
        <div id="facturasLiqPickerList" class="facturasLiqPickerList"></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => { if (e.target === modal) closePicker(); });
    modal.querySelector("#facturasLiqPickerCloseBtn")?.addEventListener("click", () => closePicker());
    modal.querySelector("#facturasLiqPickerSearchInput")?.addEventListener("input", (e) => {
      const value = String(e.target?.value || "");
      if (!state.pickerType) return;
      state.pickerSearch[state.pickerType] = value;
      renderPickerList();
    });

    return modal;
  }

  //#9 referencias DOM
  function getEls() {
    const modal = document.getElementById(LIQ_MODAL_ID);
    if (!modal) return null;
    return {
      modal,
      tipoDoc:           modal.querySelector("#facturasLiqTipoDoc"),
      docSmall:          modal.querySelector("#facturasLiqEditDoc"),
      docBig:            modal.querySelector("#facturasLiqEditDocValue"),
      subtitle:          modal.querySelector("#facturasLiqEditSubtitle"),
      fecha:             modal.querySelector("#facturasLiqEditFecha"),
      proveedor:         modal.querySelector("#facturasLiqEditProveedor"),
      monto:             modal.querySelector("#facturasLiqEditMonto"),
      estadoVisible:     modal.querySelector("#facturasLiqEditEstadoVisible"),
      pdfBtn:            modal.querySelector("#facturasLiqEditPdfBtn"),
      destinoSelect:     modal.querySelector("#facturasLiqDestinoSelect"),
      capaWrap:          modal.querySelector("#facturasLiqCapaWrap"),
      capaSelect:        modal.querySelector("#facturasLiqCapaSelect"),
      cpSection:         modal.querySelector("#facturasLiqClienteProyectoSection"),
      clienteTrigger:    modal.querySelector("#facturasLiqClienteTrigger"),
      clienteInput:      modal.querySelector("#facturasLiqClienteInput"),
      clearClienteBtn:   modal.querySelector("#facturasLiqClearClienteBtn"),
      proyectoTrigger:   modal.querySelector("#facturasLiqProyectoTrigger"),
      proyectoInput:     modal.querySelector("#facturasLiqProyectoInput"),
      clearProyectoBtn:  modal.querySelector("#facturasLiqClearProyectoBtn"),
      instrumentoSection:modal.querySelector("#facturasLiqInstrumentoSection"),
      instrumentoList:   modal.querySelector("#facturasLiqInstrumentoList"),
      comentarioInput:   modal.querySelector("#facturasLiqComentarioInput"),
      guardarBtn:        modal.querySelector("#facturasLiqGuardarBtn"),
      infoBox:           modal.querySelector("#facturasLiqModalInfo"),
      errorBox:          modal.querySelector("#facturasLiqModalError"),
      okBox:             modal.querySelector("#facturasLiqModalOk"),
    };
  }

  function getPickerEls() {
    const modal = document.getElementById(PICKER_MODAL_ID);
    if (!modal) return null;
    return {
      modal,
      title:       modal.querySelector("#facturasLiqPickerTitle"),
      subtitle:    modal.querySelector("#facturasLiqPickerSubtitle"),
      searchInput: modal.querySelector("#facturasLiqPickerSearchInput"),
      list:        modal.querySelector("#facturasLiqPickerList"),
    };
  }

  //#10 mensajes
  function setMessage(type, text) {
    const els = getEls();
    if (!els) return;
    [els.infoBox, els.errorBox, els.okBox].forEach((box) => {
      if (!box) return;
      box.style.display = "none";
      box.textContent = "";
    });
    if (!type || !text) return;
    const target = type === "error" ? els.errorBox : type === "ok" ? els.okBox : els.infoBox;
    if (!target) return;
    target.textContent = text;
    target.style.display = "";
  }

  //#11 catálogos — todo desde Meridian
  async function ensureCatalogs() {
    if (state.catalogsLoaded) return;
    const supabase = getSupabase();
    log("cargando catálogos del modal desde Meridian...");

    const [pRes, dRes, mRes] = await Promise.allSettled([
      fetchCatalogProjectsMeridian(supabase),
      fetchCatalogExpenseDestinationsMeridian(supabase),
      fetchCatalogPaymentMethodsMeridian(supabase),
    ]);

    if (pRes.status !== "fulfilled") {
      logError("error projects:", pRes.reason);
      throw pRes.reason;
    }
    state.proyectos = (pRes.value || []).map((p) => ({
      id:             p.id,
      codigo:         String(p.codigo || "").trim(),
      nombre:         String(p.nombre || "").trim(),
      cliente_nombre: String(p.cliente_nombre || "").trim(),
      estado:         String(p.estado || "").trim(),
    }));

    state.destinos = (dRes.status === "fulfilled" ? (dRes.value || []) : [])
      .map((d) => ({
        id:               d.id,
        codigo:           String(d.codigo || "").trim(),
        nombre:           String(d.nombre || "").trim(),
        prefijo_proyecto: String(d.prefijo_proyecto || "").trim(),
        capas:            Array.isArray(d.capas) ? d.capas : [],
        sort_order:       d.sort_order ?? 99,
        activo:           d.activo !== false,
      }))
      .filter((d) => d.activo);

    // Solo mostramos métodos con tipo_uso="reclamo" o "ambos". Los marcados
    // tipo_uso="pago" son exclusivos del paso 6 (Pagar al proveedor) y no
    // deben aparecer en el modal de reclamo. Mismo criterio que Meridian web.
    state.metodosPago = (mRes.status === "fulfilled" ? (mRes.value || []) : [])
      .map((m) => ({
        id:               m.id,
        codigo:           String(m.codigo || "").trim(),
        nombre:           String(m.nombre || "").trim(),
        tipo_uso:         String(m.tipo_uso || "ambos").trim(),
        category_id:      m.category_id || "",
        category_codigo:  String(m.category_codigo || "").trim(),
        category_nombre:  String(m.category_nombre || "").trim(),
        category_orden:   m.category_orden ?? 9999,
        sort_order:       m.sort_order ?? 99,
        activo:           m.activo !== false,
      }))
      .filter((m) => m.activo)
      .filter((m) => !m.tipo_uso || m.tipo_uso === "reclamo" || m.tipo_uso === "ambos");

    state.catalogsLoaded = true;
    log("catálogos:", {
      proyectos: state.proyectos.length,
      destinos:  state.destinos.length,
      metodos:   state.metodosPago.length,
    });
  }

  //#12 cargar factura desde Meridian
  async function fetchFacturaCompletaById(facturaId) {
    const supabase = getSupabase();
    log("cargando factura desde Meridian:", facturaId);
    const raw = await fetchInvoiceDetailMeridian(supabase, facturaId);
    if (!raw || !raw.id) throw new Error("La factura no existe o no está disponible.");
    const moneda = String(raw.moneda || "CRC").toUpperCase();
    const total  = Number(raw.total_comprobante) || 0;
    return {
      id:                raw.id,
      document_number:   raw.numero || "",
      document_type:     raw.tipo_documento || "",
      issue_date:        raw.fecha_emision || "",
      supplier_name:     raw.emisor_nombre || "",
      supplier_id:       raw.emisor_ident || "",
      currency_code:     moneda,
      amount_crc:        moneda === "CRC" ? total : 0,
      amount_usd:        moneda === "USD" ? total : 0,
      client_name:       raw.cliente_nombre || "",
      project_code:      raw.liq_proyecto_codigo || "",
      project_name:      raw.liq_proyecto_nombre || "",
      capa:              raw.liq_capa || "",
      liq_assigned_to:   raw.liq_reclamada_por || "",
      liq_type:          raw.liq_tipo_pago || "",
      liq_status:        raw.liq_status || "",
      liq_comments:      raw.liq_notas_reclamo || "",
    };
  }

  //#13 derivados destino → capas, proyectos, clientes
  function getSelectedDestino() {
    return state.destinos.find((d) => d.id === state.form.expense_destination_id) || null;
  }

  function getDestinoProjects() {
    const dest = getSelectedDestino();
    const activos = state.proyectos.filter((p) => {
      const e = p.estado.toLowerCase();
      return !e.includes("cerrad") && !e.includes("cancel") && !e.includes("anulad");
    });
    if (!dest) return activos;
    // Filtramos los proyectos cuyo código empieza con el código del destino +"-"
    // (mismo patrón que LiqPanel.jsx). Si el destino no tiene `codigo`, usamos
    // `prefijo_proyecto` como fallback.
    const prefijo = (dest.codigo || dest.prefijo_proyecto || "").trim();
    if (!prefijo) return activos;
    const upper = prefijo.toUpperCase();
    return activos.filter((p) =>
      p.codigo && (
        p.codigo.toUpperCase().startsWith(upper + "-") ||
        p.codigo.toUpperCase().startsWith(upper)
      )
    );
  }

  function getClientesUnicos() {
    const set = new Set(getDestinoProjects().map((p) => p.cliente_nombre).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }

  function getFilteredProjects() {
    const dest = getDestinoProjects();
    const cliente = state.form.cliente_sel;
    if (!cliente) return dest;
    return dest.filter((p) => p.cliente_nombre === cliente);
  }

  //#14 render destino
  function renderDestinoSelect() {
    const els = getEls();
    if (!els) return;
    const opts = [...state.destinos]
      .sort((a, b) => (a.sort_order - b.sort_order) || a.nombre.localeCompare(b.nombre, "es"))
      .map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.nombre)}${d.codigo ? ` (${escapeHtml(d.codigo)})` : ""}</option>`)
      .join("");
    els.destinoSelect.innerHTML = `<option value="">Seleccionar destino...</option>${opts}`;
    els.destinoSelect.value = state.form.expense_destination_id || "";
  }

  function renderCapaSelect() {
    const els = getEls();
    if (!els) return;
    const dest = getSelectedDestino();
    const capas = dest && Array.isArray(dest.capas) ? dest.capas : [];
    if (!dest || capas.length === 0) {
      els.capaWrap.style.display = "none";
      els.capaSelect.innerHTML = `<option value="">Seleccionar capa...</option>`;
      els.capaSelect.value = "";
      return;
    }
    els.capaWrap.style.display = "";
    const opts = capas
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join("");
    els.capaSelect.innerHTML = `<option value="">Seleccionar capa...</option>${opts}`;
    els.capaSelect.value = state.form.capa || "";
  }

  //#15 render cliente y proyecto
  function renderClienteProyectoSection() {
    const els = getEls();
    if (!els) return;
    const visible = !!state.form.expense_destination_id;
    els.cpSection.style.display = visible ? "" : "none";
    if (!visible) return;
    updatePickerTriggerTexts();
  }

  //#15b highlight del siguiente campo a llenar
  // Resalta con borde azul el primer campo obligatorio que aún no está
  // completo. Ayuda al empleado a saber sin pensar dónde es la próxima
  // acción. La lógica sigue el orden visual: destino → capa → cliente →
  // proyecto → instrumento de pago.
  function highlightNextField() {
    const els = getEls();
    if (!els) return;

    // Limpia cualquier highlight previo.
    [
      els.destinoSelect,
      els.capaSelect,
      els.clienteTrigger,
      els.proyectoTrigger,
      els.instrumentoSection,
    ].forEach((node) => node && node.classList.remove("is-next-field"));

    const f = state.form;
    let next = null;

    if (!f.expense_destination_id) {
      next = els.destinoSelect;
    } else {
      const dest = getSelectedDestino();
      const requiereCapa = !!(dest && Array.isArray(dest.capas) && dest.capas.length > 0);
      if (requiereCapa && !f.capa) {
        next = els.capaSelect;
      } else if (!f.cliente_sel) {
        next = els.clienteTrigger;
      } else if (!f.proyecto_id) {
        next = els.proyectoTrigger;
      } else if (!f.tipo_pago) {
        next = els.instrumentoSection;
      }
    }

    if (next) next.classList.add("is-next-field");
  }

  function updatePickerTriggerTexts() {
    const els = getEls();
    if (!els) return;
    const cliente = state.form.cliente_sel;
    const proyecto = state.proyectos.find((p) => p.id === state.form.proyecto_id);
    const projText = proyecto
      ? `${proyecto.codigo}${proyecto.nombre ? " · " + proyecto.nombre : ""}`
      : "";

    els.clienteInput.textContent = cliente || "Seleccionar cliente...";
    els.clienteInput.classList.toggle("is-placeholder", !cliente);

    els.proyectoInput.textContent = projText || "Seleccionar proyecto...";
    els.proyectoInput.classList.toggle("is-placeholder", !projText);
  }

  //#16 render instrumento de pago — agrupado por categoría NIIF
  function renderInstrumentoSection() {
    const els = getEls();
    if (!els) return;
    const visible = !!state.form.expense_destination_id;
    els.instrumentoSection.style.display = visible ? "" : "none";
    if (!visible) { els.instrumentoList.innerHTML = ""; return; }

    // Agrupar por category_id
    const grupos = new Map();
    for (const m of state.metodosPago) {
      const key = m.category_id || "__sin__";
      if (!grupos.has(key)) {
        grupos.set(key, {
          key,
          codigo: m.category_codigo || "",
          nombre: m.category_nombre || (key === "__sin__" ? "Otros instrumentos" : "Sin categoría"),
          orden:  m.category_orden ?? (key === "__sin__" ? 99999 : 9000),
          items:  [],
        });
      }
      grupos.get(key).items.push(m);
    }
    const lista = Array.from(grupos.values())
      .sort((a, b) => a.orden - b.orden)
      .map((g) => ({
        ...g,
        items: g.items.sort((x, y) => (x.sort_order - y.sort_order) || x.nombre.localeCompare(y.nombre, "es")),
      }));

    if (lista.length === 0) {
      els.instrumentoList.innerHTML = `<p class="facturasLiqHint">No hay instrumentos disponibles. Avise al administrador.</p>`;
      return;
    }

    els.instrumentoList.innerHTML = lista.map((g) => {
      const accent = CATEGORIA_ACCENTS[g.codigo] || CATEGORIA_FALLBACK;
      return `
        <div class="facturasLiqInstrumentoGroup" style="border-left: 3px solid ${accent.color};">
          <div class="facturasLiqInstrumentoGroupHead">
            <div class="facturasLiqInstrumentoGroupTitle">
              <span>${escapeHtml(g.nombre)}</span>
              <span class="facturasLiqInstrumentoGroupCount">${g.items.length} ${g.items.length === 1 ? "opción" : "opciones"}</span>
            </div>
            ${accent.help ? `<div class="facturasLiqInstrumentoGroupHelp">${escapeHtml(accent.help)}</div>` : ""}
          </div>
          <div class="facturasLiqInstrumentoChips">
            ${g.items.map((m) => {
              const isSelected = state.form.tipo_pago === m.codigo;
              const style = isSelected
                ? `border-color: ${accent.color}; color: ${accent.color}; font-weight: 600;`
                : "";
              return `
                <button
                  type="button"
                  class="facturasLiqInstrumentoChip ${isSelected ? "is-selected" : ""}"
                  data-codigo="${escapeHtml(m.codigo)}"
                  data-id="${escapeHtml(m.id)}"
                  style="${style}"
                >
                  ${escapeHtml(m.nombre)}
                </button>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("");

    // Bind chips
    els.instrumentoList.querySelectorAll(".facturasLiqInstrumentoChip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const codigo = btn.getAttribute("data-codigo") || "";
        const id     = btn.getAttribute("data-id") || "";
        state.form.tipo_pago      = codigo;
        state.form.metodo_pago_id = id;
        renderInstrumentoSection();
        highlightNextField();
      });
    });
  }

  //#17 picker bottom sheet
  function getPickerItems() {
    const search = normalizeText(state.pickerSearch[state.pickerType] || "");
    if (state.pickerType === "cliente") {
      let items = getClientesUnicos();
      if (search) items = items.filter((it) => normalizeText(it).includes(search));
      const sel = state.form.cliente_sel;
      return items.slice(0, 200).map((c) => ({
        key: c, value: c, title: c, subtitle: "", meta: "",
        selected: normalizeText(c) === normalizeText(sel),
      }));
    }
    if (state.pickerType === "proyecto") {
      let items = getFilteredProjects();
      if (search) {
        items = items.filter((p) => {
          const code   = normalizeText(p.codigo);
          const name   = normalizeText(p.nombre);
          const client = normalizeText(p.cliente_nombre);
          return code.includes(search) || name.includes(search) || client.includes(search);
        });
      }
      const selId = state.form.proyecto_id;
      return items.slice(0, 250).map((p) => ({
        key: p.id, value: p.id,
        title: `${p.codigo}${p.nombre ? " · " + p.nombre : ""}`,
        subtitle: p.cliente_nombre || "",
        meta: p.estado ? `Estado: ${p.estado}` : "",
        selected: p.id === selId,
      }));
    }
    return [];
  }

  function openPicker(type) {
    if (!state.facturaActual) return;
    if (type === "proyecto" && !state.form.cliente_sel) {
      // permitido — solo filtra por destino
    }
    const picker = getPickerEls();
    if (!picker) return;
    state.pickerType = type;
    state.pickerOpen = true;
    picker.modal.style.display = "flex";
    if (type === "cliente") {
      picker.title.textContent = "Seleccionar cliente";
      picker.subtitle.textContent = "Busca el cliente del destino seleccionado";
      picker.searchInput.placeholder = "Buscar cliente...";
    } else {
      picker.title.textContent = "Seleccionar proyecto";
      picker.subtitle.textContent = "Busca por código, nombre o cliente";
      picker.searchInput.placeholder = "Buscar proyecto...";
    }
    picker.searchInput.value = String(state.pickerSearch[type] || "");
    renderPickerList();
    setTimeout(() => { picker.searchInput.focus(); scrollPickerToSelected(); }, 40);
  }

  function closePicker() {
    const picker = getPickerEls();
    if (!picker) return;
    picker.modal.style.display = "none";
    state.pickerOpen = false;
    state.pickerType = "";
  }

  function scrollPickerToSelected() {
    const picker = getPickerEls();
    if (!picker) return;
    const sel = picker.list.querySelector(".facturasLiqPickerOption.is-selected");
    if (!sel) return;
    sel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderPickerList() {
    const picker = getPickerEls();
    if (!picker) return;
    const items = getPickerItems();
    if (!items.length) {
      picker.list.innerHTML = `<div class="facturasLiqPickerEmpty">No hay opciones que coincidan.</div>`;
      return;
    }
    picker.list.innerHTML = items.map((item) => `
      <button type="button"
        class="facturasLiqPickerOption ${item.selected ? "is-selected" : ""}"
        data-value="${escapeHtml(item.value)}"
      >
        <div class="facturasLiqPickerOptionMainRow">
          <span class="facturasLiqPickerOptionTitle">${escapeHtml(item.title)}</span>
          ${item.selected ? `<span class="facturasLiqPickerOptionCheck">✓</span>` : ""}
        </div>
        ${item.subtitle ? `<div class="facturasLiqPickerOptionSub">${escapeHtml(item.subtitle)}</div>` : ""}
        ${item.meta ? `<div class="facturasLiqPickerOptionMeta">${escapeHtml(item.meta)}</div>` : ""}
      </button>
    `).join("");
    picker.list.querySelectorAll("[data-value]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyPickerSelection(String(btn.getAttribute("data-value") || ""));
      });
    });
    setTimeout(scrollPickerToSelected, 20);
  }

  function applyPickerSelection(value) {
    const t = state.pickerType;
    if (!t) return;
    if (t === "cliente") {
      state.form.cliente_sel     = value;
      // Si el proyecto actual no pertenece al nuevo cliente, lo limpiamos.
      const proj = state.proyectos.find((p) => p.id === state.form.proyecto_id);
      if (!proj || proj.cliente_nombre !== value) {
        state.form.proyecto_id     = "";
        state.form.proyecto_codigo = "";
        state.form.proyecto_nombre = "";
      }
    } else if (t === "proyecto") {
      const p = state.proyectos.find((x) => x.id === value);
      if (!p) return;
      state.form.proyecto_id     = p.id;
      state.form.proyecto_codigo = p.codigo;
      state.form.proyecto_nombre = p.nombre;
      // Sincronizamos el cliente al del proyecto.
      if (p.cliente_nombre) state.form.cliente_sel = p.cliente_nombre;
    }
    updatePickerTriggerTexts();
    highlightNextField();
    closePicker();
  }

  //#18 eventos del modal — bind único
  function bindEvents() {
    const els = getEls();
    if (!els || els.modal.dataset.bound === "1") return;
    els.modal.dataset.bound = "1";

    els.pdfBtn.addEventListener("click", () => {
      if (!state.facturaActual) return;
      openPdfFromLiquidacion();
    });

    els.destinoSelect.addEventListener("change", () => {
      state.form.expense_destination_id = els.destinoSelect.value || "";
      // Reset cascada — capa, cliente y proyecto se invalidan al cambiar destino.
      state.form.capa            = "";
      state.form.cliente_sel     = "";
      state.form.proyecto_id     = "";
      state.form.proyecto_codigo = "";
      state.form.proyecto_nombre = "";
      renderCapaSelect();
      renderClienteProyectoSection();
      renderInstrumentoSection();
      highlightNextField();
    });

    els.capaSelect.addEventListener("change", () => {
      state.form.capa = els.capaSelect.value || "";
      highlightNextField();
    });

    els.clienteTrigger.addEventListener("click", () => openPicker("cliente"));
    els.proyectoTrigger.addEventListener("click", () => openPicker("proyecto"));

    els.clearClienteBtn.addEventListener("click", () => {
      state.form.cliente_sel     = "";
      state.form.proyecto_id     = "";
      state.form.proyecto_codigo = "";
      state.form.proyecto_nombre = "";
      updatePickerTriggerTexts();
      highlightNextField();
    });

    els.clearProyectoBtn.addEventListener("click", () => {
      state.form.proyecto_id     = "";
      state.form.proyecto_codigo = "";
      state.form.proyecto_nombre = "";
      updatePickerTriggerTexts();
      highlightNextField();
    });

    els.comentarioInput.addEventListener("input", () => {
      state.form.notas = String(els.comentarioInput.value || "");
    });

    els.guardarBtn.addEventListener("click", () => save());
  }

  //#19 fill — pinta resumen + arranca selección con datos previos si los había
  function fill(factura) {
    const els = getEls();
    if (!els) return;

    if (els.tipoDoc) els.tipoDoc.textContent = formatTipoDocumento(factura.document_type);

    els.docSmall.textContent = String(factura.document_number || "").trim() || "Sin número";
    els.docBig.textContent   = String(factura.document_number || "").trim() || "Sin consecutivo";
    els.subtitle.textContent = `${formatSupplierLabel(factura)} · ${formatIssueDate(factura.issue_date)}`;
    els.fecha.textContent     = formatIssueDate(factura.issue_date);
    els.proveedor.textContent = formatSupplierLabel(factura);
    const monto = resolveDisplayAmount(factura);
    els.monto.textContent = formatMoney(monto.currency, monto.amount);
    els.estadoVisible.textContent = resolveLiquidacionEstadoVisible(factura);

    // Pre-fill: si la factura ya tenía datos de reclamo (corrección), los traemos.
    state.form.expense_destination_id = ""; // el backend del portal no devuelve el id; queda vacío
    state.form.capa            = String(factura.capa || "").trim();
    state.form.cliente_sel     = String(factura.client_name || "").trim();
    state.form.proyecto_id     = "";
    state.form.proyecto_codigo = String(factura.project_code || "").trim();
    state.form.proyecto_nombre = String(factura.project_name || "").trim();
    state.form.tipo_pago       = String(factura.liq_type || "").trim();
    state.form.metodo_pago_id  = "";
    state.form.notas           = String(factura.liq_comments || "").trim();

    // Si tenemos código de proyecto y existe en catálogo, resolvemos su id y deducimos el destino.
    if (state.form.proyecto_codigo) {
      const proj = state.proyectos.find((p) => p.codigo === state.form.proyecto_codigo);
      if (proj) {
        state.form.proyecto_id = proj.id;
        state.form.proyecto_nombre = proj.nombre;
        state.form.cliente_sel = proj.cliente_nombre || state.form.cliente_sel;
        // Inferir destino por prefijo del código (si match único).
        const upper = proj.codigo.toUpperCase();
        const destMatch = state.destinos.find((d) => {
          const pref = (d.codigo || d.prefijo_proyecto || "").toUpperCase();
          return pref && (upper.startsWith(pref + "-") || upper.startsWith(pref));
        });
        if (destMatch) state.form.expense_destination_id = destMatch.id;
      }
    }

    // Si el método ya estaba elegido, intentamos resolver su id por código.
    if (state.form.tipo_pago) {
      const m = state.metodosPago.find((x) =>
        x.codigo.toLowerCase() === state.form.tipo_pago.toLowerCase() ||
        x.nombre.toLowerCase() === state.form.tipo_pago.toLowerCase()
      );
      if (m) {
        state.form.tipo_pago      = m.codigo;
        state.form.metodo_pago_id = m.id;
      }
    }

    renderDestinoSelect();
    renderCapaSelect();
    renderClienteProyectoSection();
    renderInstrumentoSection();
    els.comentarioInput.value = state.form.notas || "";

    els.pdfBtn.disabled = !resolvePdfInfo(factura).hasPdf;
    els.guardarBtn.disabled = false;
    els.guardarBtn.textContent = "Guardar reclamo";

    highlightNextField();
  }

  //#20 validate
  function validate() {
    const f = state.form;
    if (!state.facturaActual?.id) return "No se encontró la factura a guardar.";
    if (!f.expense_destination_id) return "Seleccione el destino de gasto.";

    const dest = getSelectedDestino();
    const requiereCapa = !!(dest && Array.isArray(dest.capas) && dest.capas.length > 0);
    if (requiereCapa && !f.capa) return "Seleccione la capa para este destino.";

    if (!f.cliente_sel) return "Seleccione el cliente.";
    if (!f.proyecto_id || !f.proyecto_codigo) return "Seleccione el proyecto asociado.";
    if (!f.tipo_pago) return "Seleccione el instrumento de pago.";
    return "";
  }

  //#21 save — POST a /complete-claim de Meridian
  async function save() {
    if (state.guardando) return;
    const supabase = getSupabase();
    const els = getEls();
    if (!els) return;

    const err = validate();
    if (err) { setMessage("error", err); return; }

    const payload = {
      expense_destination_id: state.form.expense_destination_id,
      proyecto_codigo:        state.form.proyecto_codigo,
      capa:                   state.form.capa || "",
      tipo_pago:              state.form.tipo_pago,
      notas_reclamo:          state.form.notas || "",
    };
    if (state.form.metodo_pago_id) payload.metodo_pago_id = state.form.metodo_pago_id;

    log("guardando reclamo:", { facturaId: state.facturaActual.id, payload });

    try {
      state.guardando = true;
      els.guardarBtn.disabled = true;
      els.guardarBtn.textContent = "Guardando...";
      setMessage("info", "Guardando reclamo...");

      const result = await completeClaimMeridian(supabase, state.facturaActual.id, payload);
      if (!result || !result.ok) {
        throw new Error("El backend rechazó el reclamo: " + JSON.stringify(result || {}));
      }

      // Actualizamos el state para que la UI refleje los datos enviados.
      const proj = state.proyectos.find((p) => p.id === state.form.proyecto_id);
      state.facturaActual = {
        ...state.facturaActual,
        liq_status:      "reclamada",
        liq_assigned_to: result.actor || getEmployeeName(),
        liq_type:        state.form.tipo_pago,
        liq_comments:    state.form.notas || "",
        client_name:     state.form.cliente_sel || (proj?.cliente_nombre || ""),
        project_code:    state.form.proyecto_codigo,
        project_name:    state.form.proyecto_nombre || (proj?.nombre || ""),
        capa:            state.form.capa || "",
      };

      setMessage("ok", "Reclamo guardado correctamente.");
      if (typeof onAfterSave === "function") {
        try { await onAfterSave(state.facturaActual); } catch (e) { logError("onAfterSave:", e); }
      }
      setTimeout(() => close(), 700);
    } catch (e) {
      logError("save:", e);
      setMessage("error", mapHumanLiquidacionError(e));
    } finally {
      state.guardando = false;
      if (els?.guardarBtn) {
        els.guardarBtn.disabled = false;
        els.guardarBtn.textContent = "Guardar reclamo";
      }
    }
  }

  //#22 API pública — open / close / ensure
  async function open(facturaBase) {
    const facturaId = String(facturaBase?.id || "").trim();
    if (!facturaId) return;
    log("open:", { facturaId, document_number: facturaBase?.document_number });

    try {
      ensureModal();
      bindEvents();
      setMessage("info", "Cargando información...");

      const modal = document.getElementById(LIQ_MODAL_ID);
      modal.style.display = "flex";
      modal.style.visibility = "";
      modal.style.pointerEvents = "";
      modal.removeAttribute("data-hidden-for-pdf");
      document.body.style.overflow = "hidden";

      state.modalOpen     = true;
      state.guardando     = false;
      state.hiddenForPdf  = false;
      state.facturaActual = null;
      // reset form
      state.form = {
        expense_destination_id: '',
        capa:            '',
        cliente_sel:     '',
        proyecto_id:     '',
        proyecto_codigo: '',
        proyecto_nombre: '',
        tipo_pago:       '',
        metodo_pago_id:  '',
        notas:           '',
      };

      await ensureCatalogs();
      const factura = await fetchFacturaCompletaById(facturaId);
      state.facturaActual = factura;
      fill(factura);
      setMessage("", "");
    } catch (e) {
      logError("open:", e);
      setMessage("error", e?.message || "No se pudo abrir la liquidación.");
    }
  }

  function close() {
    const modal = document.getElementById(LIQ_MODAL_ID);
    if (!modal) return;
    closePicker();
    modal.style.display = "none";
    modal.style.visibility = "";
    modal.style.pointerEvents = "";
    modal.removeAttribute("data-hidden-for-pdf");
    state.modalOpen     = false;
    state.facturaActual = null;
    state.guardando     = false;
    state.hiddenForPdf  = false;
    document.body.style.overflow = "";
  }

  function ensure() {
    ensureModal();
    bindEvents();
    log("modal inicializado");
    return true;
  }

  return {
    ensure,
    open,
    close,
    isOpen:   () => state.modalOpen,
    isSaving: () => state.guardando,
  };
}

//#util formatTipoDocumento
function formatTipoDocumento(tipo) {
  const mapa = {
    FacturaElectronica:           "Factura Electrónica",
    NotaCreditoElectronica:       "Nota de Crédito Electrónica",
    NotaDebitoElectronica:        "Nota de Débito Electrónica",
    TiqueteElectronico:           "Tiquete Electrónico",
    FacturaElectronicaCompra:     "Factura de Compra",
    FacturaElectronicaExportacion:"Factura de Exportación",
  };
  return mapa[String(tipo || "").trim()] || String(tipo || "").trim() || "Reclamar factura";
}
