// =====================================================================
//  ADMIN — Foglalások fül: lista, szűrő, export, levél, szerkesztő/áthelyezés
// =====================================================================
let foglStatuszFul = "jovahagyasra_var";   // az aktív státusz-fül
const URES_UZENET = {
  jovahagyasra_var: "Nincs jóváhagyásra váró foglalás.",
  jovahagyott:      "Nincs jóváhagyott foglalás.",
  elutasitott:      "Nincs elutasított foglalás.",
  lemondott:        "Nincs lemondott foglalás.",
  osszes:           "Nincs a szűrésnek megfelelő foglalás.",
};

async function betoltFoglalasok(){
  const cel = document.getElementById("foglalasok");
  cel.innerHTML = `<p class="status">Betöltés…</p>`;

  const { data, error } = await db
    .from("bookings")
    .select(BOOKING_SELECT)
    .order("created_at", { ascending: false })
    .order("id",         { ascending: false });

  if(error){ cel.innerHTML = `<p class="status">Hiba: ${error.message}</p>`; console.error(error); return; }
  osszesFoglalas = data || [];
  await betoltBeallitasok();   // core.js
  await betoltEmailLog();      // core.js
  await betoltProgramok();     // core.js
  toltProgramSzuro();
  megjelenit();
}

// A program-szűrő feltöltése — CSAK az aktív státusz-fülhöz tartozó foglalások
// programjaiból (egy program = cím). Value = workshop_id.
function toltProgramSzuro(){
  const sel = document.getElementById("fProgram");
  const latott = new Map();   // idopont_id → { cim, idopont }
  osszesFoglalas.forEach(b => {
    if(foglStatuszFul !== "osszes" && b.statusz !== foglStatuszFul) return;
    const iid = b.idopont_id;
    if(iid && !latott.has(iid)) latott.set(iid, { cim: progOf(b)?.cim ?? "—", idopont: idoOf(b)?.idopont });
  });
  const jelenlegi = sel.value;
  const opciok = [...latott]
    .sort((a, b) => (a[1].cim || "").localeCompare(b[1].cim || "", "hu")
                 || (a[1].idopont || "").localeCompare(b[1].idopont || ""))   // program, azon belül dátum
    .map(([id, p]) => {
      const cimke = p.idopont ? `${p.cim} — ${formatDatum(p.idopont)}` : p.cim;
      return `<option value="${id}">${cimke}</option>`;
    }).join("");
  sel.innerHTML = `<option value="">Összes program / időpont</option>` + opciok;
  sel.value = latott.has(jelenlegi) ? jelenlegi : "";
}

function szurtLista(){
  const p = document.getElementById("fProgram").value;
  const n = document.getElementById("fNev").value.trim().toLowerCase();
  const i = document.getElementById("fIdoallapot").value;
  return osszesFoglalas.filter(b =>
    (foglStatuszFul === "osszes" || b.statusz === foglStatuszFul) &&
    (!p || b.idopont_id === p) &&
    (!n || (b.nev || "").toLowerCase().includes(n)) &&
    (!i || masodlagos(idoOf(b)?.idopont)?.kulcs === i)
  );
}

function sorHtml(b){
  const st = STAT[b.statusz] || { szoveg:b.statusz, cls:"x" };
  const m  = masodlagos(idoOf(b)?.idopont);
  const prog = progOf(b);
  const idoElmaradt = idoOf(b)?.statusz === "elmaradt";
  const progJel = idoElmaradt
    ? ` <span class="arch-jel elmaradt">elmarad</span>`
    : (prog?.archivalt ? ` <span class="arch-jel">archivált</span>` : "");
  const szerkGomb = `<button class="btn sm ghost" data-edit="${b.id}">Szerkesztés</button>`;
  const mailGomb = (b.statusz !== "jovahagyasra_var")
    ? `<button class="btn sm ghost" data-mail="${b.id}">✉ Levél</button>` : "";
  // Törlés (pucolás) CSAK lezárt foglalásnál (lemondott / elutasított); a többinél nincs.
  const torolGomb = (b.statusz === "lemondott" || b.statusz === "elutasitott")
    ? `<button class="btn sm ghost" data-bookingdel="${b.id}">🗑 Törlés</button>` : "";
  const gombok = szerkGomb + muveletek(b.statusz).map(mv =>
    `<button class="btn sm ${mv.stilus}" data-id="${b.id}" data-uj="${mv.uj}">${mv.cimke}</button>`
  ).join("") + mailGomb + torolGomb;
  return `<tr>
    <td class="azon" data-cim="Azonosító">${azon(b.azonosito)}</td>
    <td class="prog" data-cim="Program">
      <b>${prog?.cim ?? "—"}</b>${progJel}
      <small>${formatDatum(idoOf(b)?.idopont)}</small>
    </td>
    <td data-cim="Időállapot">${m ? `<span class="ido ${m.kulcs}">${m.szoveg}</span>` : "—"}</td>
    <td class="kontakt" data-cim="Vendég">
      ${b.nev}
      <small>${b.telefon}</small>
      <small>${b.email}</small>
      <button class="loglink" data-log="${b.id}">✉ ${(emailLogMap.get(b.id) || []).length} kiment levél</button>
    </td>
    <td data-cim="Fő">${b.letszam}</td>
    <td class="megj-cella" data-cim="Megjegyzés">${b.megjegyzes ? `<button class="megj-ikon" data-megj="${b.id}" title="Megjegyzés megtekintése">📝</button>` : ""}</td>
    <td data-cim="Státusz"><span class="pill ${st.cls}">${st.szoveg}</span></td>
    <td data-cim="Művelet"><div class="actions">${gombok}</div></td>
  </tr>`;
}

function frissitFulSzamlalok(){
  const szam = { jovahagyasra_var:0, jovahagyott:0, elutasitott:0, lemondott:0 };
  osszesFoglalas.forEach(b => { if(szam[b.statusz] != null) szam[b.statusz]++; });
  szam.osszes = osszesFoglalas.length;
  document.querySelectorAll(".foglalas-fulek .altab").forEach(t => {
    const db = t.querySelector(".db");
    if(db) db.textContent = "(" + (szam[t.dataset.fstat] || 0) + ")";
  });
}

function megjelenit(){
  frissitFulSzamlalok();
  const cel = document.getElementById("foglalasok");
  if(osszesFoglalas.length === 0){ cel.innerHTML = `<p class="status">Még nincs foglalás.</p>`; return; }
  const lista = szurtLista();
  if(lista.length === 0){ cel.innerHTML = `<p class="status">${URES_UZENET[foglStatuszFul] || "Nincs ilyen foglalás."}</p>`; return; }

  cel.innerHTML = `<table class="tbl">
    <thead><tr><th>Azonosító</th><th>Program</th><th>Időállapot</th><th>Vendég</th><th>Fő</th><th>Megjegyzés</th><th>Státusz</th><th>Művelet</th></tr></thead>
    <tbody>${lista.map(sorHtml).join("")}</tbody></table>`;

  cel.querySelectorAll(".actions .btn[data-uj]").forEach(btn =>
    btn.addEventListener("click", () => statuszValt(btn.dataset.id, btn.dataset.uj, btn)));
  cel.querySelectorAll(".loglink").forEach(btn =>
    btn.addEventListener("click", () => mutatLevelek(btn.dataset.log)));
  cel.querySelectorAll(".actions [data-edit]").forEach(btn =>
    btn.addEventListener("click", () => nyitSzerkeszto(btn.dataset.edit)));
  cel.querySelectorAll(".megj-ikon").forEach(btn =>
    btn.addEventListener("click", () => mutatMegjegyzes(btn.dataset.megj)));
  cel.querySelectorAll("[data-mail]").forEach(btn =>
    btn.addEventListener("click", () => levelPartnernek(btn.dataset.mail)));
  cel.querySelectorAll("[data-bookingdel]").forEach(btn =>
    btn.addEventListener("click", () => torolFoglalas(btn.dataset.bookingdel)));
}

// Lezárt (lemondott/elutasított) foglalás végleges törlése — „pucolás".
async function torolFoglalas(id){
  const b = osszesFoglalas.find(x => x.id === id);
  if(!b) return;
  if(b.statusz !== "lemondott" && b.statusz !== "elutasitott") return;   // biztonság: csak lezártnál
  const ok = await dialog.megerosit(
    `Véglegesen törlöd ezt a lezárt foglalást?\n\n${azon(b.azonosito)} · ${b.nev} · ${STAT[b.statusz]?.szoveg || b.statusz}\n\nEz nem vonható vissza, és eltűnik az előzményekből is.`,
    { cim:"Foglalás törlése", okCimke:"Törlés", veszelyes:true });
  if(!ok) return;
  const { error } = await db.from("bookings").delete().eq("id", id);
  if(error) return dialog.uzen("Törlési hiba: " + error.message, { cim:"Hiba" });
  await betoltFoglalasok();   // teljes újratöltés (számlálók + szűrő is frissül)
}

// ==================== Export (Excel) ====================
const EXPORT_FEJ = ["Azonosító","Program","Program időpontja","Időállapot","Vendég neve","Telefon","E-mail","Fő","Státusz","Megjegyzés"];
function exportSorok(){
  return szurtLista().map(b => [
    azon(b.azonosito),
    progOf(b)?.cim ?? "—",
    formatDatum(idoOf(b)?.idopont),
    masodlagos(idoOf(b)?.idopont)?.szoveg ?? "—",
    b.nev ?? "",
    b.telefon ?? "",
    b.email ?? "",
    b.letszam ?? "",
    STAT[b.statusz]?.szoveg ?? b.statusz,
    b.megjegyzes ?? ""
  ]);
}
function exportFajlnev(){
  return "foglalasok-" + foglStatuszFul + "-" + new Date().toISOString().slice(0, 10);
}
function vanExportAdat(){
  if(szurtLista().length) return true;
  dialog.uzen("A jelenlegi nézetben nincs exportálható foglalás.", { cim: "Nincs adat" });
  return false;
}
async function exportExcel(){
  if(!vanExportAdat()) return;
  try{
    await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const adat = [EXPORT_FEJ, ...exportSorok()];
    const ws = XLSX.utils.aoa_to_sheet(adat);
    ws["!cols"] = EXPORT_FEJ.map((h, i) => ({ wch: i === 1 ? 28 : i === 9 ? 40 : Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Foglalások");
    XLSX.writeFile(wb, exportFajlnev() + ".xlsx");
  }catch(e){ dialog.uzen("Az Excel-export nem sikerült: " + e.message, { cim: "Hiba" }); }
}
document.getElementById("exportExcel")?.addEventListener("click", exportExcel);

// A megjegyzés megmutatása
function mutatMegjegyzes(id){
  const b = osszesFoglalas.find(x => x.id === id);
  if(!b || !b.megjegyzes) return;
  dialog.uzen(b.megjegyzes, { cim: "Megjegyzés — " + azon(b.azonosito) });
}
// A kiküldött levelek megmutatása
function mutatLevelek(id){
  const b = osszesFoglalas.find(x => x.id === id);
  const fejlec = "Kiment levelek — " + azon(b?.azonosito ?? 0) + (b ? " · " + b.nev : "");
  const logok = emailLogMap.get(id) || [];
  if(logok.length === 0){
    dialog.uzen("Ehhez a foglaláshoz még nem ment ki levél.", { cim: fejlec });
    return;
  }
  const sorok = [...logok]
    .sort((a, b) => new Date(a.elkuldve) - new Date(b.elkuldve))   // időrendben (a lekérdezés fordított sorrendű)
    .map(l => (EMAIL_CIMKE[l.tipus] || l.tipus) + " — " + formatDatum(l.elkuldve)).join("\n");
  dialog.uzen(sorok, { cim: fejlec });
}

// ✉ Levél a partnernek — a foglalás STÁTUSZA határozza meg a sablont
const STATUSZ_SABLON = { jovahagyott: "jovahagyas", elutasitott: "elutasitas", lemondott: "lemondas" };
function levelMezok(b){
  return {
    nev: b.nev, email: b.email, telefon: b.telefon,
    program: progOf(b)?.cim ?? "",
    idopont: formatDatum(idoOf(b)?.idopont),
    letszam: b.letszam,
    azonosito: azon(b.azonosito),
  };
}
function behelyettesitJs(sablon, mezok){
  return String(sablon ?? "").replace(/\{(\w+)\}/g, (_, k) => (mezok[k] ?? ""));
}

const levelModal = document.getElementById("levelModal");
const levelForm  = document.getElementById("levelForm");
const levelErr   = document.getElementById("levelErr");
let levelAktualis = null;

async function levelPartnernek(id){
  const b = osszesFoglalas.find(x => x.id === id);
  if(!b) return;
  const tipus = STATUSZ_SABLON[b.statusz];
  if(!tipus) return dialog.uzen("Ehhez a státuszhoz nincs küldhető levél.", { cim:"Levél" });

  const { data: sablon, error } = await db.from("email_sablonok")
    .select("targy, torzs").eq("tipus", tipus).single();
  if(error || !sablon) return dialog.uzen("Nem sikerült betölteni a sablont.", { cim:"Hiba" });

  const mezok = levelMezok(b);
  levelAktualis = { id, tipus, email: b.email };
  document.getElementById("levelCim").textContent = `✉ ${EMAIL_CIMKE[tipus] || tipus}`;
  document.getElementById("levelCimzett").textContent = `${b.nev} · ${b.email}`;
  levelForm.targy.value = behelyettesitJs(sablon.targy, mezok);
  levelForm.torzs.value = behelyettesitJs(sablon.torzs, mezok);
  levelErr.hidden = true;
  levelModal.hidden = false;
}

levelForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if(!levelAktualis) return;
  const targy = levelForm.targy.value.trim();
  const torzs = levelForm.torzs.value;
  if(!targy){ levelErr.textContent = "A tárgy nem lehet üres."; levelErr.hidden = false; return; }

  const gomb = levelForm.querySelector('button[type="submit"]');
  gomb.disabled = true; gomb.textContent = "Küldés…";
  const { data, error } = await db.functions.invoke("send-email", {
    body: { booking_id: levelAktualis.id, tipus: levelAktualis.tipus, targy, torzs },
  });
  gomb.disabled = false; gomb.textContent = "Küldés";

  if(error){
    let reszlet = error.message || "Ismeretlen hiba.";
    try { const j = await error.context?.json?.(); if(j?.error) reszlet = j.error; } catch(_){}
    levelErr.textContent = "Nem sikerült: " + reszlet; levelErr.hidden = false; return;
  }
  if(data && data.ok === false){
    levelErr.textContent = "Nem sikerült: " + (data.error || ""); levelErr.hidden = false; return;
  }
  levelModal.hidden = true;
  await betoltEmailLog();
  megjelenit();
  dialog.uzen(`Levél elküldve: ${levelAktualis.email}`, { cim:"Elküldve ✓" });
});

document.getElementById("levelClose").addEventListener("click", () => { levelModal.hidden = true; });
document.getElementById("levelMegse").addEventListener("click", () => { levelModal.hidden = true; });

// Szűrő-események
["fProgram","fNev","fIdoallapot"].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener("input",  megjelenit);
  el.addEventListener("change", megjelenit);
});

// Státusz-fülek váltása
document.querySelectorAll(".foglalas-fulek .altab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".foglalas-fulek .altab").forEach(x => x.classList.toggle("active", x === t));
  foglStatuszFul = t.dataset.fstat;
  toltProgramSzuro();
  megjelenit();
}));

// -------------------- Státusz módosítása --------------------
async function statuszValt(id, ujStatusz, btn){
  const rec = osszesFoglalas.find(b => b.id === id);

  if(ujStatusz === "lemondott"){
    const ok = await dialog.megerosit(
      "Biztosan rögzíted, hogy a vendég lemondta? A lemondott foglalás nem hozható vissza.",
      { cim:"Vendég lemondta", okCimke:"Igen, lemondta", veszelyes:true });
    if(!ok) return;
  }
  else if(ujStatusz === "elutasitott"){
    const ok = await dialog.megerosit(
      "Biztosan elutasítod a foglalást? Az elutasított foglalás nem hozható vissza.",
      { cim:"Elutasítás", okCimke:"Igen, elutasítom", veszelyes:true });
    if(!ok) return;
  }
  else if(rec && rec.statusz === "jovahagyott"){
    const ok = await dialog.megerosit(
      "Ez a foglalás már JÓVÁHAGYOTT. Biztosan visszavonod a jóváhagyást (vissza „jóváhagyásra vár” állapotba)?",
      { cim:"Jóváhagyott foglalás", okCimke:"Igen, visszavonom", veszelyes:true });
    if(!ok) return;
  }

  btn.disabled = true;
  const { error } = await db.from("bookings").update({ statusz: ujStatusz }).eq("id", id);
  if(error){
    await dialog.uzen(
      /szabad hely/i.test(error.message)
        ? "Nem állítható vissza: időközben betelt a hely."
        : "Hiba: " + error.message,
      { cim: "Hiba" }
    );
    btn.disabled = false;
    return;
  }
  if(rec) rec.statusz = ujStatusz;
  toltProgramSzuro();
  megjelenit();
}

// ===================== Foglalás-szerkesztő (áthelyezés is) =====================
const szerkModal = document.getElementById("szerkModal");
const szerkForm  = document.getElementById("szerkForm");
const szProgram  = document.getElementById("szProgram");
const szErr      = document.getElementById("szErr");
function szHiba(msg){ szErr.textContent = msg; szErr.hidden = false; }
function zarSzerkeszto(){ szerkModal.hidden = true; }

async function nyitSzerkeszto(id){
  const b = osszesFoglalas.find(x => x.id === id);
  if(!b) return;
  if(b.statusz === "jovahagyott"){
    const ok = await dialog.megerosit("Ez egy JÓVÁHAGYOTT foglalás. Biztosan szerkeszted az adatait?",
      { cim:"Jóváhagyott foglalás", okCimke:"Igen, szerkesztem", veszelyes:true });
    if(!ok) return;
  }
  szerkForm.reset(); szErr.hidden = true;
  document.getElementById("szTitle").textContent = "Foglalás szerkesztése — " + azon(b.azonosito);

  // Áthelyezés: ugyanazon program AZONOS ÁRÚ, nem elmaradt időpontjai (+ a jelenlegi mindig).
  const cur  = idoOf(b);
  const wid  = cur?.workshop_id;
  const prog = programok.find(p => p.id === wid);
  const cim  = progOf(b)?.cim ?? "";
  let opts = (prog?.idopontok || []).filter(i => i.statusz !== "elmaradt" && i.ar === cur?.ar);
  if(!opts.some(i => i.id === b.idopont_id) && cur) opts.unshift(cur);
  szProgram.innerHTML = opts.map(i =>
    `<option value="${i.id}">${cim} — ${formatDatum(i.idopont)}${i.id === b.idopont_id ? " (jelenlegi)" : ""}</option>`).join("");
  szProgram.value = b.idopont_id;

  szerkForm.nev.value        = b.nev;
  szerkForm.email.value      = b.email;
  szerkForm.telefon.value    = b.telefon;
  szerkForm.letszam.value    = b.letszam;
  szerkForm.megjegyzes.value = b.megjegyzes || "";
  szerkForm.dataset.id = id;
  szerkModal.hidden = false;
  szerkForm.nev.focus();
}

szerkForm.addEventListener("submit", async e => {
  e.preventDefault();
  szErr.hidden = true;
  const id         = szerkForm.dataset.id;
  const nev        = szerkForm.nev.value.trim();
  const email      = szerkForm.email.value.trim();
  const telefon    = tisztitTelefon(szerkForm.telefon.value);
  const letszam    = parseInt(szerkForm.letszam.value, 10);
  const idopont_id = szProgram.value;
  const megjegyzes = szerkForm.megjegyzes.value.trim();

  if(!nev)                return szHiba("A név nem lehet üres.");
  if(!emailOk(email))     return szHiba("Érvényes e-mail címet adj meg.");
  if(!telefonOk(telefon)) return szHiba("Érvényes telefonszámot adj meg.");
  if(!(letszam >= 1))     return szHiba("A létszám legalább 1 fő.");

  // Lágy figyelmeztetés (nem tiltás): a cél-időpont minimuma alatti létszám.
  const celIdo = programok.flatMap(p => p.idopontok).find(i => i.id === idopont_id);
  if(celIdo && celIdo.min_letszam != null && letszam < celIdo.min_letszam){
    const ok = await dialog.megerosit(
      `Erre az időpontra a beállított minimum ${celIdo.min_letszam} fő, te ${letszam} főt adtál meg. Így mentsem?`,
      { cim:"Létszám a minimum alatt", okCimke:"Igen, mentés", veszelyes:true });
    if(!ok) return;
  }

  const gomb = szerkForm.querySelector('button[type="submit"]');
  gomb.disabled = true;
  const { error } = await db.from("bookings").update({
    idopont_id, nev, email, telefon, letszam, megjegyzes: megjegyzes || null,
  }).eq("id", id);
  gomb.disabled = false;

  if(error){
    return szHiba(/szabad hely/i.test(error.message)
      ? "Nincs elég szabad hely a választott időponton."
      : "Hiba: " + error.message);
  }
  szerkModal.hidden = true;
  betoltFoglalasok();
});

document.getElementById("szClose").addEventListener("click", zarSzerkeszto);
document.getElementById("szMegse").addEventListener("click", zarSzerkeszto);
