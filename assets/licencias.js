// assets/licencias.js
// Licencias · Tecnomédica
// Todos los logs van con [LICENCIAS] para rastreo

(() => {
  // ✅ Guard: si el archivo se carga 2 veces, evitamos doble boot/listeners
  if (window.__tmiLicenciasBooted) {
    console.warn("[LICENCIAS] licencias.js ya estaba inicializado. Se evita doble carga.");
    return;
  }
  window.__tmiLicenciasBooted = true;

  console.log("[LICENCIAS] Cargando script licencias.js…");

  // ==== CONFIGURAR SUPABASE ====
  const URL_SUPABASE = "https://xducrljbdyneyihjcjvo.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWNybGpiZHluZXlpaGpjanZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzMTYzNDIsImV4cCI6MjA2Nzg5MjM0Mn0.I0JcXD9jUZNNefpt5vyBFBxwQncV9TSwsG8FHp0n85Y";

  function getSupabaseClient() {
    try {
      if (
        window.__tmiSupabaseClient &&
        window.__tmiSupabaseClient.from &&
        window.__tmiSupabaseClient.auth
      ) {
        console.log("[LICENCIAS] Reusando window.__tmiSupabaseClient");
        return window.__tmiSupabaseClient;
      }

      if (window.supabase && window.supabase.from && window.supabase.auth) {
        console.log("[LICENCIAS] Reusando cliente existente en window.supabase");
        window.__tmiSupabaseClient = window.supabase;
        return window.__tmiSupabaseClient;
      }

      if (window.supabase && typeof window.supabase.createClient === "function") {
        console.log("[LICENCIAS] Creando cliente Supabase (createClient)");
        window.__tmiSupabaseClient = window.supabase.createClient(
          URL_SUPABASE,
          SUPABASE_ANON_KEY,
          {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: false,
            },
          }
        );
        return window.__tmiSupabaseClient;
      }

      console.error("[LICENCIAS] supabase-js no está cargado o no expone createClient.");
      return null;
    } catch (e) {
      console.error("[LICENCIAS] Error creando/obteniendo cliente Supabase:", e);
      return null;
    }
  }

  const sb = getSupabaseClient();
  if (!sb) return;

  // ==== ESTADO SIMPLE ====
  const st = {
    user: null,
    employee: null, // { uid, full_name }
    lastInsertedId: null,
  };

  // ==== AYUDANTES DOM ====
  const $ = (s) => document.querySelector(s);

  function setFormMsg(msg, isError = false) {
    const el = $("#formMsg");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b91c1c" : "#6b7280";
  }

  function setHistoryMsg(msg) {
    const el = $("#historyContainer");
    if (!el) return;
    el.textContent = msg || "";
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmt(v) {
    if (v === null || v === undefined || v === "") return "—";
    return String(v);
  }

  function normText(v) {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  }

  function upperKey(v) {
    const s = normText(v);
    if (!s) return "";
    return String(s).trim().toUpperCase();
  }

  function normalizeStatus(s) {
    const raw = String(s || "").trim().toLowerCase();
    if (!raw) return { key: "OTRO", label: "Sin estado" };

    if (raw === "pendiente") return { key: "PENDIENTE", label: "Pendiente" };
    if (raw === "aprobada" || raw === "aprobado")
      return { key: "APROBADA", label: "Aprobada" };
    if (raw === "denegada" || raw === "rechazada" || raw === "rechazado")
      return { key: "DENEGADA", label: "Denegada" };
    if (raw === "cancelada" || raw === "cancelado")
      return { key: "CANCELADA", label: "Cancelada" };
    if (raw === "reabierta" || raw === "reabierto")
      return { key: "REABIERTA", label: "Reabierta" };
    if (raw === "borrador" || raw === "no guardado" || raw === "no_guardado")
      return { key: "BORRADOR", label: "No guardado" };

    return { key: "OTRO", label: s };
  }

  // ============================
  // ✅ NUEVA REGLA UI
  // ============================
  function isIncapacityUiType(uiType) {
    return uiType === "incapacidad_medica";
  }

  function toggleIssuerCertByUiType(uiType) {
    const issuerWrap = $("#issuerWrap");
    const certWrap = $("#certWrap");
    const issuerEl = $("#leaveIssuer");
    const certEl = $("#leaveCert");

    const show = isIncapacityUiType(uiType);

    if (issuerWrap) issuerWrap.style.display = show ? "" : "none";
    if (certWrap) certWrap.style.display = show ? "" : "none";

    if (!show) {
      if (issuerEl) issuerEl.value = "";
      if (certEl) certEl.value = "";
    }
  }

  // ============================
  // ✅ MAPEO UI -> BD
  // ============================
  function mapUiTypeToDbType(value) {
    switch (value) {
      case "vacaciones":
        return "VACACIONES";
      case "incapacidad_medica":
        return "INCAPACIDAD";
      default:
        return "OTRO";
    }
  }

  function mapUiTypeToDbSubtype(value) {
    switch (value) {
      case "vacaciones":
        return "VACACIONES";
      case "incapacidad_medica":
        return "INCAPACIDAD_MEDICA";
      case "permiso_con_goce":
        return "PERMISO_CON_GOCE";
      case "permiso_sin_goce":
        return "PERMISO_SIN_GOCE";
      case "duelo":
        return "DUELO";
      case "otro":
      default:
        return "HORAS_AUSENCIA_DIA";
    }
  }

  function prettyType(dbValue, uiValue = null, dbSubtype = null) {
    const ui = String(uiValue || "").trim().toLowerCase();
    const st = upperKey(dbSubtype);
    const lt = upperKey(dbValue);

    if (ui === "vacaciones") return "Vacaciones";
    if (ui === "incapacidad_medica") return "Incapacidad Médica";
    if (ui === "permiso_con_goce") return "Permiso con goce";
    if (ui === "permiso_sin_goce") return "Permiso sin goce";
    if (ui === "duelo") return "Duelo";
    if (ui === "otro") return "Horas Ausencia día";

    if (st === "VACACIONES") return "Vacaciones";
    if (st === "INCAPACIDAD_MEDICA" || st === "INCAPACIDAD") return "Incapacidad Médica";
    if (st === "PERMISO_CON_GOCE") return "Permiso con goce";
    if (st === "PERMISO_SIN_GOCE") return "Permiso sin goce";
    if (st === "DUELO") return "Duelo";
    if (st === "HORAS_AUSENCIA_DIA") return "Horas Ausencia día";

    if (lt === "VACACIONES") return "Vacaciones";
    if (lt === "INCAPACIDAD") return "Incapacidad Médica";
    if (lt === "MATERNIDAD") return "Maternidad";
    if (lt === "OTRO") return st || "Otro";

    return dbValue || "Otro";
  }

  function inferUiTypeFromRecord(record) {
    const lt = upperKey(record?.leave_type);
    const st = upperKey(record?.leave_subtype);

    if (st === "VACACIONES" || lt === "VACACIONES") return "vacaciones";
    if (
      st === "INCAPACIDAD_MEDICA" ||
      st === "INCAPACIDAD" ||
      lt === "INCAPACIDAD"
    ) {
      return "incapacidad_medica";
    }
    if (st === "PERMISO_CON_GOCE") return "permiso_con_goce";
    if (st === "PERMISO_SIN_GOCE") return "permiso_sin_goce";
    if (st === "DUELO") return "duelo";
    if (st === "HORAS_AUSENCIA_DIA") return "otro";

    return "";
  }

  // ==== CARGAR SESIÓN Y EMPLEADO ====
  async function loadSessionAndEmployee() {
    console.log("[LICENCIAS] loadSessionAndEmployee…");
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) {
        console.error("[LICENCIAS] getSession error:", error);
        throw error;
      }

      const session = data?.session || null;
      if (!session?.user) {
        console.warn("[LICENCIAS] Sin sesión activa.");
        setFormMsg(
          "No hay sesión activa. Abre primero el portal y vuelve a intentar.",
          true
        );
        const n = $("#empName");
        if (n) n.textContent = "—";
        return false;
      }

      st.user = session.user;
      console.log("[LICENCIAS] Usuario:", st.user.email, "user.id:", st.user.id);

      const n = $("#empName");
      if (n) n.textContent = st.user.email || "—";

      let { data: emp, error: empErr } = await sb
        .from("employees")
        .select("employee_uid, full_name")
        .eq("user_id", st.user.id)
        .single();

      if (empErr || !emp) {
        console.warn(
          "[LICENCIAS] Empleado por user_id no encontrado. Probando por email…",
          empErr
        );
        const r = await sb
          .from("employees")
          .select("employee_uid, full_name")
          .eq("email", st.user.email)
          .single();
        emp = r.data || null;
        empErr = r.error || null;
      }

      if (empErr || !emp) {
        console.error("[LICENCIAS] No se encontró empleado para este usuario:", empErr);
        setFormMsg(
          "No se encontró tu ficha de empleado. Contacta a administración.",
          true
        );
        return false;
      }

      st.employee = {
        uid: emp.employee_uid,
        full_name: emp.full_name || "(sin nombre)",
      };

      if (n) n.textContent = st.employee.full_name;

      console.log("[LICENCIAS] Empleado OK:", st.employee);
      return true;
    } catch (err) {
      console.error("[LICENCIAS] loadSessionAndEmployee catch:", err);
      setFormMsg("Error cargando datos de usuario. Intenta recargar la página.", true);
      return false;
    }
  }

  // ==== RESUMEN (SOLO LEE SUPABASE) ====
  function renderSummary(record, uiTypeHint = null) {
    const card = $("#summaryCard");
    const box = $("#summaryBox");
    if (!card || !box) return;

    if (!record) {
      card.style.display = "none";
      box.innerHTML = "";
      return;
    }

    const uiType = uiTypeHint || inferUiTypeFromRecord(record);
    const typeLabel = prettyType(record.leave_type, uiType, record.leave_subtype);
    const status = normalizeStatus(record.status);
    const createdAt = record.created_at
      ? String(record.created_at).replace("T", " ").replace("Z", "")
      : "—";

    const baseRows = [];
    baseRows.push(`<div class="row between gap" style="align-items:flex-start;flex-wrap:wrap;">
      <div class="big">${escapeHtml(typeLabel)}</div>
      <span class="statusBadge ${status.key}">${escapeHtml(status.label)}</span>
    </div>`);

    baseRows.push(`<div class="muted m-t">
      <div><strong>Rango:</strong> ${escapeHtml(fmt(record.date_start))} → ${escapeHtml(fmt(record.date_end))}</div>
      <div><strong>Creada:</strong> ${escapeHtml(createdAt)}</div>
      <div><strong>ID:</strong> ${escapeHtml(fmt(record.id))}</div>
    </div>`);

    const fields = (label, value) =>
      `<div style="display:flex;justify-content:space-between;gap:10px; padding:6px 0; border-bottom:1px solid #eef2f7;">
        <div class="muted" style="font-weight:700;color:#374151">${escapeHtml(label)}</div>
        <div style="font-weight:800;color:#111827">${escapeHtml(fmt(value))}</div>
      </div>`;

    const section = (title, inner) =>
      `<div class="m-t" style="padding:12px 14px;border:1px solid #e5e7eb;border-radius:16px;background:#fbfcfe;">
        <div style="font-weight:900;color:#111827;margin-bottom:8px;">${escapeHtml(title)}</div>
        ${inner}
      </div>`;

    const dbType = upperKey(record.leave_type);
    const dbSubtype = upperKey(record.leave_subtype);

    if (dbType === "VACACIONES") {
      let inner = "";
      inner += fields("Días naturales", record.natural_days);
      inner += fields("Días hábiles en rango", record.workdays_in_range);
      inner += fields("Días a rebajar", record.vacation_days_to_deduct);
      baseRows.push(section("Resumen (Vacaciones)", inner));
    }

    if (dbType === "INCAPACIDAD" || dbSubtype === "INCAPACIDAD_MEDICA") {
      let inner = "";
      inner += fields("Emisor", record.issuer);
      inner += fields("Certificado", record.certificate_no);
      inner += fields("Días naturales", record.natural_days);
      inner += fields("Días hábiles en rango", record.workdays_in_range);

      if ("pay_hours_per_day" in record) inner += fields("Horas/día", record.pay_hours_per_day);
      if ("employer_pct_day1_3" in record)
        inner += fields("% patrono días 1–3", record.employer_pct_day1_3);
      if ("employer_pct_after3" in record)
        inner += fields("% patrono después de 3", record.employer_pct_after3);
      if ("insurer_pct_after3" in record)
        inner += fields("% aseguradora después de 3", record.insurer_pct_after3);

      baseRows.push(section("Resumen (Incapacidad Médica)", inner));
    }

    if (dbType === "OTRO") {
      let inner = "";
      inner += fields("Subtipo", prettyType(dbType, null, dbSubtype));
      if ("pay_hours_per_day" in record) inner += fields("Horas/día", record.pay_hours_per_day);
      baseRows.push(section("Resumen", inner));
    }

    if (record.notes) {
      baseRows.push(
        `<div class="m-t" style="padding:12px 14px;border:1px dashed #e5e7eb;border-radius:16px;background:#fff;">
          <div style="font-weight:900;color:#111827;margin-bottom:6px;">Notas</div>
          <div style="color:#111827;white-space:pre-wrap;">${escapeHtml(record.notes)}</div>
        </div>`
      );
    }

    card.style.display = "";
    box.innerHTML = baseRows.join("");
  }

  async function fetchLeaveById(id) {
    console.log("[LICENCIAS] fetchLeaveById:", id);
    const { data, error } = await sb
      .from("employee_leaves")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("[LICENCIAS] fetchLeaveById error:", error);
      return null;
    }
    return data || null;
  }

  // ==== INSERTAR NUEVA LICENCIA ====
  async function submitLeave() {
    console.log("[LICENCIAS] submitLeave click");
    try {
      if (!st.employee?.uid) {
        setFormMsg(
          "No se encontró el empleado. Vuelve a entrar desde el portal.",
          true
        );
        return;
      }

      const typeEl = $("#leaveType");
      const fromEl = $("#leaveFrom");
      const toEl = $("#leaveTo");
      const issuerEl = $("#leaveIssuer");
      const certEl = $("#leaveCert");
      const notesEl = $("#leaveNotes");

      const uiType = (typeEl?.value || "").trim();
      const dateStart = (fromEl?.value || "").trim();
      const dateEnd = (toEl?.value || "").trim();
      const issuer = (issuerEl?.value || "").trim();
      const cert = (certEl?.value || "").trim();
      const notes = (notesEl?.value || "").trim();

      setFormMsg("");

      if (!uiType) {
        setFormMsg("Selecciona el tipo de licencia.", true);
        typeEl?.focus();
        return;
      }
      if (!dateStart) {
        setFormMsg("Selecciona la fecha de inicio.", true);
        fromEl?.focus();
        return;
      }
      if (!dateEnd) {
        setFormMsg("Selecciona la fecha de fin.", true);
        toEl?.focus();
        return;
      }
      if (dateEnd < dateStart) {
        setFormMsg("La fecha final no puede ser anterior a la inicial.", true);
        toEl?.focus();
        return;
      }

      const dbType = mapUiTypeToDbType(uiType);
      const dbSubtype = mapUiTypeToDbSubtype(uiType);
      const needsIssuer = isIncapacityUiType(uiType);

      if (needsIssuer) {
        const issuerUpper = upperKey(issuer);
        if (!issuerUpper) {
          setFormMsg("Debes seleccionar el emisor (CCSS o INS).", true);
          issuerEl?.focus();
          return;
        }
        if (issuerUpper !== "CCSS" && issuerUpper !== "INS") {
          setFormMsg("El emisor debe ser CCSS o INS.", true);
          issuerEl?.focus();
          return;
        }
      }

      const payload = {
        employee_uid: st.employee.uid,
        leave_type: dbType,
        leave_subtype: dbSubtype,
        date_start: dateStart,
        date_end: dateEnd,
        issuer: needsIssuer ? upperKey(issuer) || null : null,
        certificate_no: needsIssuer ? cert || null : null,
        notes: notes || null,
        status: "pendiente",
      };

      console.log("[LICENCIAS] Insert payload:", payload);

      setFormMsg("Enviando solicitud…");
      const btn = $("#btnSubmit");
      if (btn) btn.disabled = true;

      const { data: inserted, error: insErr } = await sb
        .from("employee_leaves")
        .insert(payload)
        .select("*")
        .single();

      if (insErr) {
        console.error("[LICENCIAS] insert error:", insErr);
        setFormMsg("Error al guardar la licencia. Revisa la consola.", true);
        return;
      }

      console.log("[LICENCIAS] Insert OK:", inserted);
      st.lastInsertedId = inserted?.id || null;

      let finalRow = null;
      if (st.lastInsertedId) finalRow = await fetchLeaveById(st.lastInsertedId);
      if (!finalRow) finalRow = inserted;

      renderSummary(finalRow, uiType);

      setFormMsg("Solicitud registrada correctamente.");

      typeEl.value = "";
      fromEl.value = "";
      toEl.value = "";
      if (issuerEl) issuerEl.value = "";
      if (certEl) certEl.value = "";
      if (notesEl) notesEl.value = "";

      toggleIssuerCertByUiType("");

      await loadHistory();
    } catch (err) {
      console.error("[LICENCIAS] submitLeave catch:", err);
      setFormMsg("Error inesperado al guardar la licencia.", true);
    } finally {
      const btn = $("#btnSubmit");
      if (btn) btn.disabled = false;
    }
  }

  // ==== CARGAR HISTORIAL (ORDER BY created_at DESC) ====
  async function loadHistory() {
    console.log("[LICENCIAS] loadHistory…");
    const cont = $("#historyContainer");
    const summary = $("#historySummary");
    if (!cont) return;

    if (!st.employee?.uid) {
      setHistoryMsg("No se pudo cargar el historial (empleado no definido).");
      return;
    }

    setHistoryMsg("Cargando licencias…");

    try {
      const { data, error } = await sb
        .from("employee_leaves")
        .select(
          "id, leave_type, leave_subtype, date_start, date_end, issuer, certificate_no, notes, status, created_at"
        )
        .eq("employee_uid", st.employee.uid)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("[LICENCIAS] loadHistory error:", error);
        setHistoryMsg("Error al cargar el historial.");
        return;
      }

      if (!data || !data.length) {
        setHistoryMsg("Aún no tienes licencias registradas.");
        if (summary) summary.textContent = "";
        renderSummary(null);
        return;
      }

      console.log("[LICENCIAS] Historial cargado:", data.length, "registros");

      const rowsHtml = data
        .map((r) => {
          const d1 = r.date_start || "";
          const d2 = r.date_end || "";
          const issuer = r.issuer || "—";
          const cert = r.certificate_no || "—";
          const notes = r.notes || "—";
          const badgeClass = upperKey(r.leave_type) || "OTRO";
          const label = prettyType(r.leave_type, null, r.leave_subtype);
          const stx = normalizeStatus(r.status);

          return `
            <tr>
              <td>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  <span class="badge ${escapeHtml(badgeClass)}">${escapeHtml(label)}</span>
                  <span class="statusMini ${escapeHtml(stx.key)}">${escapeHtml(stx.label)}</span>
                </div>
              </td>
              <td>${escapeHtml(d1)}</td>
              <td>${escapeHtml(d2)}</td>
              <td class="hide-sm">${escapeHtml(issuer)}</td>
              <td class="hide-sm">${escapeHtml(cert)}</td>
              <td class="hide-sm">${escapeHtml(notes)}</td>
            </tr>
          `;
        })
        .join("");

      cont.innerHTML = `
        <table class="history-table">
          <thead>
            <tr>
              <th>Tipo / Estado</th>
              <th>Desde</th>
              <th>Hasta</th>
              <th class="hide-sm">Emisor</th>
              <th class="hide-sm">Boleta / cert.</th>
              <th class="hide-sm">Notas</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      `;

      const total = data.length;
      if (summary) {
        summary.textContent = `${total} licencia${total !== 1 ? "s" : ""} registradas`;
      }

      const latest = data[0] || null;
      if (latest?.id) {
        const full = await fetchLeaveById(latest.id);
        renderSummary(full || latest, inferUiTypeFromRecord(full || latest));
      } else {
        renderSummary(null);
      }
    } catch (err) {
      console.error("[LICENCIAS] loadHistory catch:", err);
      setHistoryMsg("Error inesperado al cargar el historial.");
    }
  }

  // ==== BOTONES MENÚ / SALIR ====
  function bindNavButtons() {
    const btnMenu = $("#btnMenu");
    const btnLogout = $("#btnLogout");

    if (btnMenu) {
      btnMenu.addEventListener("click", () => {
        console.log("[LICENCIAS] Click Menú");
        window.location.href = "/";
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        console.log("[LICENCIAS] Click Salir");
        try {
          await sb.auth.signOut();
        } catch (e) {
          console.warn("[LICENCIAS] signOut warn:", e);
        }
        window.location.href = "/";
      });
    }
  }

  function bindTypeToggle() {
    const typeEl = $("#leaveType");
    if (!typeEl) return;

    toggleIssuerCertByUiType((typeEl.value || "").trim());

    typeEl.addEventListener("change", () => {
      const v = (typeEl.value || "").trim();
      console.log("[LICENCIAS] leaveType change:", v);
      toggleIssuerCertByUiType(v);
    });
  }

  function bindClearMsgOnInput() {
    const ids = [
      "leaveType",
      "leaveFrom",
      "leaveTo",
      "leaveIssuer",
      "leaveCert",
      "leaveNotes",
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => setFormMsg(""));
      el.addEventListener("change", () => setFormMsg(""));
    });
  }

  // ==== BOOT ====
  async function bootLicencias() {
    console.log("[LICENCIAS] BOOT start");

    bindNavButtons();
    bindTypeToggle();
    bindClearMsgOnInput();

    const ok = await loadSessionAndEmployee();
    if (!ok) {
      console.warn("[LICENCIAS] No se pudo cargar sesión/empleado.");
      return;
    }

    const btnSubmit = $("#btnSubmit");
    if (btnSubmit) {
      btnSubmit.addEventListener("click", (ev) => {
        ev.preventDefault();
        submitLeave();
      });
    }

    await loadHistory();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootLicencias);
  } else {
    bootLicencias();
  }
})();
