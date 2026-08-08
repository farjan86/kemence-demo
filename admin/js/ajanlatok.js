// =====================================================================
//  ADMIN — Ajánlatok fül: a beérkezett egyedi ajánlatkérések kezelése.
//  A Foglalások fül mintája (lista + státusz-fülek + státuszváltás),
//  de az egyedi ág saját tábláira (ajanlatok / egyedi_programok) épül.
//
//  E-mail küldés NINCS itt — az az 5. fázis (send-ajanlat-email). Itt csak
//  az állapotot + az elfogadáskori végleges adatokat + a belső jegyzetet
//  kezeljük. A csatolmány a PRIVÁT ajanlat-csatolmanyok bucketbe kerül.
// =====================================================================
let osszesAjanlat = [];
let ajStatuszFul  = "ajanlatra_var";

const STAT_AJANLAT = {
  ajanlatra_var:    { szoveg:"Ajánlatra vár",    cls:"o" },
  ajanlat_kikuldve: { szoveg:"Ajánlat kiküldve", cls:"e" },
  elfogadva:        { szoveg:"Elfogadva",        cls:"g" },
  elutasitva:       { szoveg:"Elutasítva",       cls:"r" },
  lemondva:         { szoveg:"Lemondva",         cls:"x" },
};
const AJ_URES = {
  ajanlatra_var:    "Nincs ajánlatra váró kérés.",
  ajanlat_kikuldve: "Nincs kiküldött ajánlat.",
  elfogadva:        "Nincs elfogadott ajánlat.",
  elutasitva:       "Nincs elutasított ajánlat.",
  lemondva:         "Nincs lemondott ajánlat.",
  osszes:           "Nincs a szűrésnek megfelelő ajánlat.",
};

// Kiküldött ajánlat-levelek naplója (ajanlat_id → lista) + a státusz→sablon leképezés
let ajLogMap = new Map();
const AJ_STATUSZ_SABLON = { elfogadva:"ajanlat_megerosites", elutasitva:"ajanlat_elutasitas", lemondva:"ajanlat_lemondas" };
const AJ_EMAIL_CIMKE = {
  ajanlat_visszaigazolas:  "Visszaigazolás (kéréskor)",
  ajanlat_csapat_ertesito: "Csapat-értesítő",
  ajanlat_megerosites:     "Megerősítés (elfogadás)",
  ajanlat_elutasitas:      "Elutasítás",
  ajanlat_lemondas:        "Lemondás",
};
async function betoltAjLog(){
  const { data } = await db.from("ajanlat_log")
    .select("ajanlat_id, tipus, elkuldve").order("elkuldve", { ascending:false });
  const map = new Map();
  (data || []).forEach(l => {
    if(l.tipus === "ajanlat_csapat_ertesito") return;   // belső levél a csapatnak — ne látszódjon a vendég-sornál
    if(!map.has(l.ajanlat_id)) map.set(l.ajanlat_id, []);
    map.get(l.ajanlat_id).push(l);
  });
  ajLogMap = map;
}
function ajLevelMezok(a){
  return {
    nev: a.nev, email: a.email, telefon: a.telefon,
    program: a._programCim || "Általános megkeresés",
    letszam: a.letszam ?? "",
    kivant_idopont: a.kivant_idopont ? formatDatum(a.kivant_idopont) : "",
    keres_szoveg: a.keres_szoveg ?? "",
    azonosito: azonAjanlat(a.azonosito),
    vegleges_idopont: a.vegleges_idopont ? formatDatum(a.vegleges_idopont) : "",
    vegleges_letszam: a.vegleges_letszam ?? "",
    vegleges_ar: a.vegleges_ar != null ? HUF(a.vegleges_ar) : "",
    ajanlat_szoveg: a.ajanlat_szoveg ?? "",
  };
}

// A közvetlen státuszváltó gombok (az „Elfogad" külön, mert űrlapot nyit)
function muveletekAjanlat(statusz){
  switch(statusz){
    case "ajanlatra_var":
    case "ajanlat_kikuldve": return [
      { cimke:"Elutasítás", uj:"elutasitva", stilus:"ghost" },
      { cimke:"Lemondás",   uj:"lemondva",   stilus:"ghost" } ];
    case "elfogadva": return [
      { cimke:"Lemondás",   uj:"lemondva",   stilus:"ghost" } ];
    default: return [];
  }
}

async function betoltAjanlatok(){
  const cel = document.getElementById("ajanlatok");
  cel.innerHTML = `<p class="status">Betöltés…</p>`;
  const { data, error } = await db.from("ajanlatok")
    .select("*")
    .order("created_at", { ascending:false });
  if(error){ cel.innerHTML = `<p class="status">Hiba: ${error.message}</p>`; console.error(error); return; }
  osszesAjanlat = data || [];
  // Az egyedi program címét KÜLÖN kérjük le (embed/join nélkül — robusztusabb, séma-cache-független),
  // és id szerint párosítjuk minden ajánlathoz (a._programCim).
  const { data: epk } = await db.from("egyedi_programok").select("id, cim");
  const epCim = new Map((epk || []).map(e => [e.id, e.cim]));
  osszesAjanlat.forEach(a => { a._programCim = a.egyedi_program_id ? (epCim.get(a.egyedi_program_id) || null) : null; });
  await betoltBeallitasok();   // core.js — az azonosító-formátumhoz (azonAjanlat)
  await betoltAjLog();         // a kiment levelek naplója
  megjelenitAjanlat();
}

function ajSzurt(){
  const n = document.getElementById("aFNev").value.trim().toLowerCase();
  return osszesAjanlat.filter(a => {
    const fulOk = ajStatuszFul === "osszes" || a.statusz === ajStatuszFul;
    return fulOk && (!n || (a.nev || "").toLowerCase().includes(n));
  });
}

function ajFulSzamlalok(){
  const szam = { ajanlatra_var:0, ajanlat_kikuldve:0, elfogadva:0, elutasitva:0, lemondva:0 };
  osszesAjanlat.forEach(a => { if(szam[a.statusz] != null) szam[a.statusz]++; });
  szam.osszes = osszesAjanlat.length;
  document.querySelectorAll(".ajanlat-fulek .altab").forEach(t => {
    const d = t.querySelector(".db");
    if(d) d.textContent = "(" + (szam[t.dataset.astat] || 0) + ")";
  });
}

function ajSorHtml(a){
  const st = STAT_AJANLAT[a.statusz] || { szoveg:a.statusz, cls:"x" };
  const prog = a._programCim
    ? `<b>${escapeHtml(a._programCim)}</b>`
    : `<span class="arch-jel">Általános</span>`;
  const reszletGomb = `<button class="btn sm ghost" data-ajreszlet="${a.id}">Részletek</button>`;
  // Előbb az „Ajánlat kiküldve" (jelzés), utána az „Elfogad" — logikai sorrend.
  const kikuldveGomb = (a.statusz === "ajanlatra_var")
    ? `<button class="btn sm" data-ajid="${a.id}" data-ajuj="ajanlat_kikuldve">Ajánlat kiküldve</button>` : "";
  const elfogadGomb = (a.statusz === "ajanlatra_var" || a.statusz === "ajanlat_kikuldve")
    ? `<button class="btn sm" data-ajelfogad="${a.id}">Elfogad</button>` : "";
  const statuszGombok = muveletekAjanlat(a.statusz).map(mv =>
    `<button class="btn sm ${mv.stilus}" data-ajid="${a.id}" data-ajuj="${mv.uj}">${mv.cimke}</button>`).join("");
  const torolGomb = (a.statusz === "elutasitva" || a.statusz === "lemondva")
    ? `<button class="btn sm ghost" data-ajdel="${a.id}">🗑 Törlés</button>` : "";
  // ✉ Levél: csak ahol van küldhető vendég-sablon (elfogadva/elutasitva/lemondva).
  const mailGomb = AJ_STATUSZ_SABLON[a.statusz]
    ? `<button class="btn sm ghost" data-ajmail="${a.id}">✉ Levél</button>` : "";
  const veglegesJel = (a.statusz === "elfogadva")
    ? `<small>${formatDatum(a.vegleges_idopont)} · ${a.vegleges_letszam} fő · ${HUF(a.vegleges_ar)} össz.</small>` : "";

  return `<tr>
    <td class="azon" data-cim="Azonosító">${azonAjanlat(a.azonosito)}</td>
    <td class="prog" data-cim="Program">${prog}${veglegesJel}</td>
    <td class="kontakt" data-cim="Vendég">
      ${escapeHtml(a.nev)}
      <small>${escapeHtml(a.telefon || "")}</small>
      <small>${escapeHtml(a.email || "")}</small>
      <button class="loglink" data-ajlog="${a.id}">✉ ${(ajLogMap.get(a.id) || []).length} kiment levél</button>
    </td>
    <td data-cim="Fő">${a.letszam ?? "—"}</td>
    <td data-cim="Kívánt időpont">${a.kivant_idopont ? formatDatum(a.kivant_idopont) : "—"}</td>
    <td data-cim="Státusz"><span class="pill ${st.cls}">${st.szoveg}</span></td>
    <td data-cim="Művelet"><div class="actions">${reszletGomb}${kikuldveGomb}${elfogadGomb}${statuszGombok}${mailGomb}${torolGomb}</div></td>
  </tr>`;
}

function megjelenitAjanlat(){
  ajFulSzamlalok();
  const cel = document.getElementById("ajanlatok");
  if(osszesAjanlat.length === 0){ cel.innerHTML = `<p class="status">Még nincs beérkezett ajánlatkérés.</p>`; return; }
  const lista = ajSzurt();
  if(lista.length === 0){ cel.innerHTML = `<p class="status">${AJ_URES[ajStatuszFul] || "Nincs ilyen ajánlat."}</p>`; return; }
  cel.innerHTML = `<table class="tbl">
    <thead><tr><th>Azonosító</th><th>Program</th><th>Vendég</th><th>Fő</th><th>Kívánt időpont</th><th>Státusz</th><th>Művelet</th></tr></thead>
    <tbody>${lista.map(ajSorHtml).join("")}</tbody></table>`;

  cel.querySelectorAll("[data-ajreszlet]").forEach(b => b.addEventListener("click", () => nyitAjReszlet(b.dataset.ajreszlet)));
  cel.querySelectorAll("[data-ajelfogad]").forEach(b => b.addEventListener("click", () => nyitElfogad(b.dataset.ajelfogad)));
  cel.querySelectorAll(".actions [data-ajuj]").forEach(b => b.addEventListener("click", () => ajStatuszValt(b.dataset.ajid, b.dataset.ajuj, b)));
  cel.querySelectorAll("[data-ajdel]").forEach(b => b.addEventListener("click", () => torolAjanlat(b.dataset.ajdel)));
  cel.querySelectorAll("[data-ajmail]").forEach(b => b.addEventListener("click", () => levelAjanlatnak(b.dataset.ajmail)));
  cel.querySelectorAll("[data-ajlog]").forEach(b => b.addEventListener("click", () => mutatAjLevelek(b.dataset.ajlog)));
}

// Státusz-fülek + név-szűrő
document.querySelectorAll(".ajanlat-fulek .altab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".ajanlat-fulek .altab").forEach(x => x.classList.toggle("active", x === t));
  ajStatuszFul = t.dataset.astat;
  megjelenitAjanlat();
}));
document.getElementById("aFNev").addEventListener("input", megjelenitAjanlat);

// -------------------- Státuszváltás (kiküldve / elutasít / lemond) --------------------
async function ajStatuszValt(id, ujStatusz, btn){
  const a = osszesAjanlat.find(x => x.id === id);
  const c = {
    ajanlat_kikuldve: { cim:"Ajánlat kiküldve", szoveg:"Megjelölöd, hogy az ajánlatot (a rendszeren kívül, e-mailben) kiküldted, és várod a választ?", ok:"Igen, kiküldve", vesz:false },
    elutasitva:       { cim:"Elutasítás", szoveg:"Biztosan elutasítod ezt az ajánlatkérést?", ok:"Igen, elutasítom", vesz:true },
    lemondva:         { cim:"Lemondás", szoveg:"Biztosan lemondottként rögzíted ezt az ajánlatot?", ok:"Igen, lemondva", vesz:true },
  }[ujStatusz];
  if(c){
    const ok = await dialog.megerosit(c.szoveg, { cim:c.cim, okCimke:c.ok, veszelyes:c.vesz });
    if(!ok) return;
  }
  btn.disabled = true;
  const { error } = await db.from("ajanlatok").update({ statusz: ujStatusz }).eq("id", id);
  if(error){ btn.disabled = false; return dialog.uzen("Hiba: " + error.message, { cim:"Hiba" }); }
  if(a) a.statusz = ujStatusz;
  megjelenitAjanlat();
  // (E-mail értesítő kézzel, az 5. fázistól.)
}

// -------------------- Törlés (lezárt ajánlat pucolása) --------------------
async function torolAjanlat(id){
  const a = osszesAjanlat.find(x => x.id === id);
  if(!a || !(a.statusz === "elutasitva" || a.statusz === "lemondva")) return;
  const ok = await dialog.megerosit(
    `Véglegesen törlöd ezt a lezárt ajánlatot?\n\n${azonAjanlat(a.azonosito)} · ${a.nev} · ${STAT_AJANLAT[a.statusz]?.szoveg || a.statusz}\n\nEz nem vonható vissza.`,
    { cim:"Ajánlat törlése", okCimke:"Törlés", veszelyes:true });
  if(!ok) return;
  const { error } = await db.from("ajanlatok").delete().eq("id", id);
  if(error) return dialog.uzen("Törlési hiba: " + error.message, { cim:"Hiba" });
  await betoltAjanlatok();
}

// ==================== Elfogadás-űrlap (4 végleges adat + csatolmány) ====================
const ajElfModal = document.getElementById("ajElfogadModal");
const ajElfForm  = document.getElementById("ajElfForm");
const ajElfErr   = document.getElementById("ajElfErr");
let ajElfAktualis = null;

function ajElfHiba(msg){ ajElfErr.textContent = msg; ajElfErr.hidden = false; }
function zarElfModal(){ ajElfModal.hidden = true; }

function nyitElfogad(id){
  const a = osszesAjanlat.find(x => x.id === id);
  if(!a) return;
  ajElfAktualis = a;
  ajElfForm.reset(); ajElfErr.hidden = true;
  document.getElementById("ajElfCim").textContent  = "Ajánlat elfogadása — " + azonAjanlat(a.azonosito);
  document.getElementById("ajElfMeta").textContent =
    `${a.nev} · ${a.telefon || ""} · ${a._programCim || "Általános megkeresés"}`;
  // Előkitöltés: meglévő végleges adatok, különben a kéréskoriak
  ajElfForm.vegleges_idopont.value = isoToLocalInput(a.vegleges_idopont || a.kivant_idopont);
  ajElfForm.vegleges_letszam.value = a.vegleges_letszam ?? a.letszam ?? "";
  ajElfForm.vegleges_ar.value      = a.vegleges_ar ?? "";
  ajElfForm.ajanlat_szoveg.value   = a.ajanlat_szoveg ?? "";
  const meglevo = document.getElementById("ajCsatMeglevo");
  meglevo.hidden = !a.csatolmany_url;
  meglevo.textContent = a.csatolmany_url ? "Van feltöltött csatolmány (új fájl felülírja)." : "";
  ajElfModal.hidden = false;
  ajElfForm.vegleges_idopont.focus();
}

// A csatolmány a PRIVÁT ajanlat-csatolmanyok bucketbe; a KULCSOT tároljuk (nem publikus URL).
async function feltoltCsatolmany(file){
  const kiterj = (file.name.split(".").pop() || "dat").toLowerCase();
  const nev = `csat-${Date.now()}-${Math.random().toString(36).slice(2)}.${kiterj}`;
  const { error } = await db.storage.from("ajanlat-csatolmanyok").upload(nev, file, { cacheControl:"3600", upsert:false });
  if(error) throw error;
  return nev;
}

ajElfForm.addEventListener("submit", async e => {
  e.preventDefault();
  ajElfErr.hidden = true;
  if(!ajElfAktualis) return;
  const idopontRaw = ajElfForm.vegleges_idopont.value;
  const letszam = parseInt(ajElfForm.vegleges_letszam.value, 10);
  const ar      = parseInt(ajElfForm.vegleges_ar.value, 10);
  const szoveg  = ajElfForm.ajanlat_szoveg.value.trim();

  if(!idopontRaw)     return ajElfHiba("A végleges időpont kötelező.");
  if(!(letszam >= 1)) return ajElfHiba("A végleges létszám legalább 1 fő.");
  if(!(ar >= 0))      return ajElfHiba("A végleges (összesített) ár kötelező.");
  if(!szoveg)         return ajElfHiba("Az ajánlat szövege kötelező (lehet „Ajánlat a csatolmány szerint”).");

  const gomb = ajElfForm.querySelector('button[type="submit"]');
  gomb.disabled = true;

  let csatolmany_url = ajElfAktualis.csatolmany_url || null;
  const file = document.getElementById("ajCsatolmany").files[0];
  if(file){
    try { csatolmany_url = await feltoltCsatolmany(file); }
    catch(err){ gomb.disabled = false; return ajElfHiba("A csatolmány feltöltése nem sikerült: " + err.message); }
  }

  const { error } = await db.from("ajanlatok").update({
    vegleges_idopont: new Date(idopontRaw).toISOString(),
    vegleges_letszam: letszam,
    vegleges_ar: ar,
    ajanlat_szoveg: szoveg,
    csatolmany_url,
    statusz: "elfogadva",
  }).eq("id", ajElfAktualis.id);
  gomb.disabled = false;
  if(error) return ajElfHiba("Mentési hiba: " + error.message);

  ajElfModal.hidden = true;
  await betoltAjanlatok();
  // (A megerősítő e-mail kézzel, az 5. fázistól.)
});

document.getElementById("ajElfClose").addEventListener("click", zarElfModal);
document.getElementById("ajElfMegse").addEventListener("click", zarElfModal);

// ==================== Részletek + belső jegyzet ====================
const ajReszModal   = document.getElementById("ajReszletModal");
const ajJegyzetForm = document.getElementById("ajJegyzetForm");
let ajReszAktualis = null;

function nyitAjReszlet(id){
  const a = osszesAjanlat.find(x => x.id === id);
  if(!a) return;
  ajReszAktualis = a;
  document.getElementById("ajReszCim").textContent = "Ajánlatkérés — " + azonAjanlat(a.azonosito);

  const ujsor = s => (s ? escapeHtml(s).replace(/\n/g, "<br>") : "—");
  const sorok = [
    `<p><b>Ötlet:</b> ${a._programCim ? escapeHtml(a._programCim) : "Általános megkeresés"}</p>`,
    `<p><b>Vendég:</b> ${escapeHtml(a.nev)} · ${escapeHtml(a.telefon||"")} · ${escapeHtml(a.email||"")}</p>`,
    `<p><b>Kért létszám:</b> ${a.letszam ? a.letszam + " fő" : "—"} · <b>Kívánt időpont:</b> ${a.kivant_idopont ? formatDatum(a.kivant_idopont) : "—"}</p>`,
    `<p><b>Üzenet:</b><br>${ujsor(a.keres_szoveg)}</p>`,
    `<p><b>Beérkezett:</b> ${formatDatum(a.created_at)} · <b>Státusz:</b> ${STAT_AJANLAT[a.statusz]?.szoveg || a.statusz}</p>`,
  ];
  // A végleges adatok akkor jelennek meg, ha az ajánlatot valaha elfogadták (van végleges időpont) —
  // így egy utólag LEMONDOTT (korábban elfogadott) ajánlatnál is látszanak előzményként.
  if(a.vegleges_idopont){
    sorok.push(`<hr>`);
    sorok.push(`<p><b>Végleges időpont:</b> ${formatDatum(a.vegleges_idopont)}</p>`);
    sorok.push(`<p><b>Végleges létszám:</b> ${a.vegleges_letszam} fő · <b>Végleges ár (összesen):</b> ${HUF(a.vegleges_ar)}</p>`);
    sorok.push(`<p><b>Ajánlat szövege:</b><br>${ujsor(a.ajanlat_szoveg)}</p>`);
    if(a.csatolmany_url) sorok.push(`<p><b>Csatolmány:</b> <button class="btn sm ghost" id="ajCsatLetolt">Letöltés</button></p>`);
    // A módosít/megtekint gomb CSAK elfogadott állapotban — lemondás után már nem.
    if(a.statusz === "elfogadva")
      sorok.push(`<p><button class="btn sm ghost" id="ajElfModosit">Végleges adatok módosítása / megtekintése</button></p>`);
  }
  document.getElementById("ajReszTartalom").innerHTML = sorok.join("");
  ajJegyzetForm.belso_jegyzet.value = a.belso_jegyzet || "";

  const letolt = document.getElementById("ajCsatLetolt");
  if(letolt) letolt.addEventListener("click", async () => {
    try {
      const { data, error } = await db.storage.from("ajanlat-csatolmanyok").createSignedUrl(a.csatolmany_url, 3600);
      if(error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch(err){ dialog.uzen("A csatolmány megnyitása nem sikerült: " + err.message, { cim:"Hiba" }); }
  });
  const modosit = document.getElementById("ajElfModosit");
  if(modosit) modosit.addEventListener("click", () => { ajReszModal.hidden = true; nyitElfogad(a.id); });

  ajReszModal.hidden = false;
}

ajJegyzetForm.addEventListener("submit", async e => {
  e.preventDefault();
  if(!ajReszAktualis) return;
  const jegyzet = ajJegyzetForm.belso_jegyzet.value.trim() || null;
  const gomb = ajJegyzetForm.querySelector('button[type="submit"]');
  gomb.disabled = true;
  const { error } = await db.from("ajanlatok").update({ belso_jegyzet: jegyzet }).eq("id", ajReszAktualis.id);
  gomb.disabled = false;
  if(error) return dialog.uzen("A jegyzet mentése nem sikerült: " + error.message, { cim:"Hiba" });
  ajReszAktualis.belso_jegyzet = jegyzet;
  dialog.uzen("Jegyzet mentve.", { cim:"Mentve ✓" });
});

document.getElementById("ajReszClose").addEventListener("click", () => { ajReszModal.hidden = true; });
document.getElementById("ajReszMegse").addEventListener("click", () => { ajReszModal.hidden = true; });

// ==================== Kézi levélküldés (megerősítés / elutasítás / lemondás) ====================
const ajLevelModal = document.getElementById("ajLevelModal");
const ajLevelForm  = document.getElementById("ajLevelForm");
const ajLevelErr   = document.getElementById("ajLevelErr");
let ajLevelAktualis = null;

async function levelAjanlatnak(id){
  const a = osszesAjanlat.find(x => x.id === id);
  if(!a) return;
  const tipus = AJ_STATUSZ_SABLON[a.statusz];
  if(!tipus) return dialog.uzen("Ehhez a státuszhoz nincs küldhető levél.", { cim:"Levél" });

  const { data: sablon, error } = await db.from("ajanlat_sablonok")
    .select("targy, torzs").eq("tipus", tipus).single();
  if(error || !sablon) return dialog.uzen("Nem sikerült betölteni a sablont.", { cim:"Hiba" });

  const mezok = ajLevelMezok(a);
  const vanCsat = tipus === "ajanlat_megerosites" && !!a.csatolmany_url;
  ajLevelAktualis = { id, tipus, email: a.email };
  document.getElementById("ajLevelCim").textContent     = `✉ ${AJ_EMAIL_CIMKE[tipus] || tipus}`;
  document.getElementById("ajLevelCimzett").textContent = `${a.nev} · ${a.email}`;
  const csatInfo = document.getElementById("ajLevelCsat");
  if(csatInfo) csatInfo.hidden = !vanCsat;
  ajLevelForm.targy.value = behelyettesitJs(sablon.targy, mezok);   // behelyettesitJs: foglalasok.js
  ajLevelForm.torzs.value = behelyettesitJs(sablon.torzs, mezok);
  ajLevelErr.hidden = true;
  ajLevelModal.hidden = false;
}

ajLevelForm.addEventListener("submit", async e => {
  e.preventDefault();
  if(!ajLevelAktualis) return;
  const targy = ajLevelForm.targy.value.trim();
  const torzs = ajLevelForm.torzs.value;
  if(!targy){ ajLevelErr.textContent = "A tárgy nem lehet üres."; ajLevelErr.hidden = false; return; }

  const gomb = ajLevelForm.querySelector('button[type="submit"]');
  gomb.disabled = true; gomb.textContent = "Küldés…";
  const { data, error } = await db.functions.invoke("send-ajanlat-email", {
    body: { ajanlat_id: ajLevelAktualis.id, tipus: ajLevelAktualis.tipus, targy, torzs },
  });
  gomb.disabled = false; gomb.textContent = "Küldés";

  if(error){
    let reszlet = error.message || "Ismeretlen hiba.";
    try { const j = await error.context?.json?.(); if(j?.error) reszlet = j.error; } catch(_){}
    ajLevelErr.textContent = "Nem sikerült: " + reszlet; ajLevelErr.hidden = false; return;
  }
  if(data && data.ok === false){ ajLevelErr.textContent = "Nem sikerült: " + (data.error || ""); ajLevelErr.hidden = false; return; }

  ajLevelModal.hidden = true;
  await betoltAjLog();
  megjelenitAjanlat();
  dialog.uzen(`Levél elküldve: ${ajLevelAktualis.email}`, { cim:"Elküldve ✓" });
});

document.getElementById("ajLevelClose").addEventListener("click", () => { ajLevelModal.hidden = true; });
document.getElementById("ajLevelMegse").addEventListener("click", () => { ajLevelModal.hidden = true; });

// A kiment ajánlat-levelek listája
function mutatAjLevelek(id){
  const a = osszesAjanlat.find(x => x.id === id);
  const fejlec = "Kiment levelek — " + azonAjanlat(a?.azonosito ?? 0) + (a ? " · " + a.nev : "");
  const logok = ajLogMap.get(id) || [];
  if(logok.length === 0) return dialog.uzen("Ehhez az ajánlathoz még nem ment ki levél.", { cim: fejlec });
  const sorok = [...logok]
    .sort((x, y) => new Date(x.elkuldve) - new Date(y.elkuldve))
    .map(l => (AJ_EMAIL_CIMKE[l.tipus] || l.tipus) + " — " + formatDatum(l.elkuldve)).join("\n");
  dialog.uzen(sorok, { cim: fejlec });
}

// ==================== Excel-export (a jelenlegi szűrt nézet) ====================
const AJ_EXPORT_FEJ = ["Azonosító","Program/ötlet","Vendég","Telefon","E-mail","Kért fő","Kívánt időpont","Státusz","Végleges időpont","Végleges fő","Végleges összár (Ft)"];
function ajExportSorok(){
  return ajSzurt().map(a => [
    azonAjanlat(a.azonosito),
    a._programCim || "Általános",
    a.nev || "", a.telefon || "", a.email || "",
    a.letszam ?? "",
    a.kivant_idopont ? formatDatum(a.kivant_idopont) : "",
    STAT_AJANLAT[a.statusz]?.szoveg || a.statusz,
    a.vegleges_idopont ? formatDatum(a.vegleges_idopont) : "",
    a.vegleges_letszam ?? "",
    a.vegleges_ar ?? "",
  ]);
}
async function ajExportExcel(){
  if(!ajSzurt().length) return dialog.uzen("A jelenlegi nézetben nincs exportálható ajánlat.", { cim:"Nincs adat" });
  try {
    await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const adat = [AJ_EXPORT_FEJ, ...ajExportSorok()];
    const ws = XLSX.utils.aoa_to_sheet(adat);
    ws["!cols"] = AJ_EXPORT_FEJ.map((h, i) => ({ wch: i === 1 ? 24 : Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ajánlatok");
    XLSX.writeFile(wb, "ajanlatok-" + ajStatuszFul + "-" + new Date().toISOString().slice(0, 10) + ".xlsx");
  } catch(e){ dialog.uzen("Az Excel-export nem sikerült: " + e.message, { cim:"Hiba" }); }
}
document.getElementById("ajExportExcel")?.addEventListener("click", ajExportExcel);
