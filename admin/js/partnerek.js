// =====================================================================
//  ADMIN — Partnerek fül
//
//  Egy helyen mindenki, aki valaha foglalt egy programra VAGY egyedi
//  ajánlatot kért. A fő kérdés, amire válaszol: „volt már nálunk ez az
//  ember, vagy most találkozunk vele először?"
//
//  ÖSSZEVONÁS: e-mail cím szerint (kisbetűsítve) — egy sor = egy partner.
//  A név, a telefon és a cím a LEGUTÓBBI alkalomból származik, mert az a
//  legfrissebb adat (időközben költözhetett, változhatott a száma).
//
//  Nincs külön partner-tábla: a lista mindig a foglalásokból és az
//  ajánlatokból épül fel. Ha egy foglalást/ajánlatot törölnek, a partner
//  is eltűnik innen — erre a törlő párbeszédek figyelmeztetnek is.
// =====================================================================
let partnerSorok   = [];            // összevont partnerek (megjelenítéshez)
let partnerKereso  = {};            // oszlop → keresőszöveg
let partnerNyitott = new Set();     // kibontott sorok (e-mail kulcsok)

const PARTNER_OSZLOPOK = [
  { kulcs:"nev",       cim:"Név" },
  { kulcs:"telefon",   cim:"Telefon" },
  { kulcs:"email",     cim:"E-mail" },
  { kulcs:"cim",       cim:"Lakcím" },
  { kulcs:"alkalmak",  cim:"Alkalmak" },
];

// A „megvalósult" alkalom: jóváhagyott foglalás, illetve elfogadott ajánlat.
const MEGVALOSULT_FOGLALAS = "jovahagyott";
const MEGVALOSULT_AJANLAT  = "elfogadva";

// -------------------- Betöltés --------------------
async function betoltPartnerek(){
  const cel = document.getElementById("partnerLista");
  cel.innerHTML = `<p class="status">Betöltés…</p>`;

  const [{ data: fogl, error: hibaF }, { data: ajanl, error: hibaA }, { data: epk }] = await Promise.all([
    db.from("bookings").select("id, azonosito, nev, email, telefon, iranyitoszam, helyseg, cim_tovabbi, letszam, statusz, created_at, idopont_id"),
    db.from("ajanlatok").select("id, azonosito, nev, email, telefon, iranyitoszam, helyseg, cim_tovabbi, letszam, vegleges_letszam, statusz, created_at, egyedi_program_id, vegleges_idopont, kivant_idopont"),
    db.from("egyedi_programok").select("id, cim"),
  ]);
  if(hibaF || hibaA){
    cel.innerHTML = `<p class="status">Hiba: ${(hibaF || hibaA).message}</p>`;
    return;
  }

  await betoltBeallitasok();      // core.js — az azonosító-formátumhoz
  if(!programok.length) await betoltProgramok();   // core.js — program + időpont nevekhez

  // időpont_id → { programCim, idopont }
  const idoMap = new Map();
  programok.forEach(p => (p.idopontok || []).forEach(i => idoMap.set(i.id, { programCim: p.cim, idopont: i.idopont })));
  const epCim = new Map((epk || []).map(e => [e.id, e.cim]));

  // --- egységes „esemény" lista a két ágból ---
  const esemenyek = [];
  (fogl || []).forEach(b => {
    const ido = idoMap.get(b.idopont_id);
    esemenyek.push({
      tipus: "foglalas",
      rekordId: b.id,
      azonosito: azon(b.azonosito),
      programCim: ido?.programCim || "(törölt program)",
      idopont: ido?.idopont || null,
      statusz: b.statusz,
      statuszSzoveg: STAT[b.statusz]?.szoveg || b.statusz,
      megvalosult: b.statusz === MEGVALOSULT_FOGLALAS,
      letszam: b.letszam,
      ...partnerAdat(b),
    });
  });
  (ajanl || []).forEach(a => {
    esemenyek.push({
      tipus: "ajanlat",
      rekordId: a.id,
      azonosito: azonAjanlat(a.azonosito),
      programCim: a.egyedi_program_id ? (epCim.get(a.egyedi_program_id) || "Egyedi program") : "Általános megkeresés",
      // Elfogadott ajánlatnál a véglegesített időpont a mérvadó, addig a kívánt.
      idopont: a.vegleges_idopont || a.kivant_idopont || null,
      statusz: a.statusz,
      statuszSzoveg: STAT_AJANLAT[a.statusz]?.szoveg || a.statusz,
      megvalosult: a.statusz === MEGVALOSULT_AJANLAT,
      letszam: a.vegleges_letszam ?? a.letszam,
      ...partnerAdat(a),
    });
  });

  partnerSorok = osszevon(esemenyek);
  megjelenitPartnerek();
}

// A partnerhez tartozó adatok egy foglalás/ajánlat sorból.
// FIGYELEM: itt a `cim` a LAKCÍM — az esemény programneve `programCim`.
function partnerAdat(x){
  return {
    nev: (x.nev || "").trim(),
    email: (x.email || "").trim(),
    telefon: (x.telefon || "").trim(),
    cim: cimSzovegNyers(x),
    created_at: x.created_at,
  };
}

// Cím egy sorban, HTML-escape nélkül (a megjelenítésnél escape-eljük)
function cimSzovegNyers(x){
  const eleje = [x.iranyitoszam, x.helyseg].filter(Boolean).join(" ");
  return [eleje, x.cim_tovabbi].filter(Boolean).join(", ");
}

// -------------------- Összevonás e-mail szerint --------------------
function osszevon(esemenyek){
  const map = new Map();
  esemenyek.forEach(e => {
    const kulcs = e.email.toLowerCase();
    if(!kulcs) return;                         // e-mail nélküli sor nem azonosítható partnerként
    if(!map.has(kulcs)) map.set(kulcs, { kulcs, email: e.email, esemenyek: [] });
    map.get(kulcs).esemenyek.push(e);
  });

  return [...map.values()].map(p => {
    // A legfrissebb beküldés adja a nevet, telefont, címet.
    const rendezett = [...p.esemenyek].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const utolso = rendezett[0];
    return {
      ...p,
      nev: utolso.nev,
      telefon: utolso.telefon,
      cim: rendezett.find(e => e.cim)?.cim || "",   // a legutóbbi NEM üres cím
      esemenyek: rendezett,
    };
  }).sort((a, b) => a.nev.localeCompare(b.nev, "hu"));
}

// -------------------- Szűrés --------------------
function partnerSzurt(){
  const tol = document.getElementById("pSzurTol").value;
  const ig  = document.getElementById("pSzurIg").value;
  const csakMegvalosult = document.getElementById("pCsakMegvalosult").checked;

  return partnerSorok
    .map(p => {
      // Az időszak és a „csak megvalósult" az ALKALMAKRA szűr, nem a partnerre:
      // akinek a szűrt körben nem marad alkalma, az kiesik a listából.
      const esemenyek = p.esemenyek.filter(e => {
        if(csakMegvalosult && !e.megvalosult) return false;
        const d = (e.idopont || e.created_at || "").slice(0, 10);
        if(tol && d < tol) return false;
        if(ig  && d > ig)  return false;
        return true;
      });
      return { ...p, esemenyek };
    })
    .filter(p => p.esemenyek.length > 0)
    .filter(p => {
      // Oszloponkénti tartalmi keresés (kis-nagybetű mindegy)
      return PARTNER_OSZLOPOK.every(o => {
        const keres = (partnerKereso[o.kulcs] || "").trim().toLowerCase();
        if(!keres) return true;
        return partnerMezoSzoveg(p, o.kulcs).toLowerCase().includes(keres);
      });
    });
}

// Egy oszlop kereshető szövege
function partnerMezoSzoveg(p, kulcs){
  switch(kulcs){
    case "alkalmak":  return alkalomSzoveg(p);
    case "cim":       return p.cim || "";
    default:          return p[kulcs] || "";
  }
}

// „2 foglalás · 1 ajánlat"
function alkalomSzoveg(p){
  const f = p.esemenyek.filter(e => e.tipus === "foglalas").length;
  const a = p.esemenyek.filter(e => e.tipus === "ajanlat").length;
  return [f ? `${f} foglalás` : "", a ? `${a} ajánlat` : ""].filter(Boolean).join(" · ");
}

// -------------------- Megjelenítés --------------------
function megjelenitPartnerek(){
  const cel = document.getElementById("partnerLista");
  const osszegzes = document.getElementById("pOsszegzes");

  if(partnerSorok.length === 0){
    cel.innerHTML = `<p class="status">Még nincs egyetlen foglalás vagy ajánlatkérés sem, így partner sincs.</p>`;
    osszegzes.textContent = "";
    return;
  }

  const lista = partnerSzurt();
  const visszateroDb = lista.filter(p => p.esemenyek.length > 1).length;

  // A „Szűrők törlése" gomb csak akkor látszik, ha tényleg szűrve van valami
  const torlesGomb = document.getElementById("pSzurTorles");
  if(torlesGomb) torlesGomb.hidden = !vanAktivSzuro();
  osszegzes.textContent = lista.length
    ? `${lista.length} partner · ebből ${visszateroDb} visszatérő · összesen ${lista.reduce((n, p) => n + p.esemenyek.length, 0)} alkalom`
    : "";

  const fejlec = PARTNER_OSZLOPOK.map(o => `<th>${o.cim}</th>`).join("");
  const keresoSor = PARTNER_OSZLOPOK.map(o =>
    `<th><input type="search" class="partner-kereso" data-oszlop="${o.kulcs}" value="${escapeHtml(partnerKereso[o.kulcs] || "")}" placeholder="keresés…" aria-label="${o.cim} keresése"></th>`
  ).join("");

  const sorok = lista.length
    ? lista.map(partnerSorHtml).join("")
    : `<tr><td colspan="${PARTNER_OSZLOPOK.length}" class="halvany kozep">Nincs a szűrésnek megfelelő partner.</td></tr>`;

  cel.innerHTML = `<table class="tbl partner-tabla">
    <thead><tr>${fejlec}</tr><tr class="kereso-sor">${keresoSor}</tr></thead>
    <tbody>${sorok}</tbody></table>`;

  // Keresőmezők — a fókusz megmarad gépelés közben
  cel.querySelectorAll(".partner-kereso").forEach(inp => {
    inp.addEventListener("input", () => {
      partnerKereso[inp.dataset.oszlop] = inp.value;
      const hol = inp.dataset.oszlop, poz = inp.selectionStart;
      megjelenitPartnerek();
      const ujInp = document.querySelector(`.partner-kereso[data-oszlop="${hol}"]`);
      if(ujInp){ ujInp.focus(); ujInp.setSelectionRange(poz, poz); }
    });
  });

  // Az azonosítóra kattintva HELYBEN nyílik meg a foglalás/ajánlat ablaka
  cel.querySelectorAll("[data-ugras]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();                       // ne csukja össze a sort
    nyitMegAzEsemenyt(b.dataset.ugras, b.dataset.id);
  }));

  // Sor kibontása / összecsukása
  cel.querySelectorAll("[data-partner]").forEach(tr => tr.addEventListener("click", e => {
    if(e.target.closest("input")) return;
    const k = tr.dataset.partner;
    partnerNyitott.has(k) ? partnerNyitott.delete(k) : partnerNyitott.add(k);
    megjelenitPartnerek();
  }));
}

function partnerSorHtml(p){
  const nyitva = partnerNyitott.has(p.kulcs);
  const visszatero = p.esemenyek.length > 1
    ? `<span class="pill g visszatero">Visszatérő</span>` : "";

  const reszletek = nyitva ? `<tr class="partner-reszlet">
    <td colspan="${PARTNER_OSZLOPOK.length}">
      <table class="partner-alsotabla">
        <thead><tr><th>Azonosító</th><th>Típus</th><th>Program / ajánlat</th><th>Időpont</th><th>Fő</th><th>Státusz</th></tr></thead>
        <tbody>${p.esemenyek.map(e => `<tr>
          <td class="azon"><button type="button" class="azon-link" data-ugras="${e.tipus}" data-id="${e.rekordId}" title="${e.tipus === "foglalas" ? "Foglalás megnyitása" : "Ajánlat megnyitása"}">${e.azonosito}</button></td>
          <td>${e.tipus === "foglalas" ? "Foglalás" : "Ajánlat"}</td>
          <td>${escapeHtml(e.programCim)}</td>
          <td>${e.idopont ? formatDatum(e.idopont) : "—"}</td>
          <td class="kozep">${e.letszam ?? "—"}</td>
          <td>${escapeHtml(e.statuszSzoveg)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </td>
  </tr>` : "";

  return `<tr class="partner-sor${nyitva ? " nyitva" : ""}" data-partner="${escapeHtml(p.kulcs)}">
    <td data-cim="Név"><span class="partner-nyil">${nyitva ? "▾" : "▸"}</span> <b>${escapeHtml(p.nev || "—")}</b></td>
    <td data-cim="Telefon">${escapeHtml(p.telefon || "—")}</td>
    <td data-cim="E-mail">${escapeHtml(p.email)}</td>
    <td data-cim="Lakcím">${escapeHtml(p.cim || "—")}</td>
    <td data-cim="Alkalmak">${escapeHtml(alkalomSzoveg(p))} ${visszatero}</td>
  </tr>${reszletek}`;
}

// -------------------- A foglalás / ajánlat megnyitása HELYBEN --------------------
// Nem váltunk fület: ugyanaz az ablak nyílik meg, mint a Foglalások, illetve az
// Ajánlatok fülön — így a partnerlista szűrése és a kibontott sorok megmaradnak.
// Az ablakok a saját fülük adataiból dolgoznak, ezért ha az még nincs betöltve
// (vagy időközben változott), előbb betöltjük.
async function nyitMegAzEsemenyt(tipus, id){
  const foglalas = tipus === "foglalas";
  const megvan = () => foglalas
    ? (typeof osszesFoglalas !== "undefined" && osszesFoglalas.some(x => x.id === id))
    : (typeof osszesAjanlat  !== "undefined" && osszesAjanlat.some(x => x.id === id));

  if(!megvan()){
    await (foglalas ? betoltFoglalasok() : betoltAjanlatok());   // foglalasok.js / ajanlatok.js
  }
  if(!megvan()){
    return dialog.uzen("Ez a tétel időközben megszűnt. Frissítsd az oldalt.", { cim:"Nem található" });
  }

  if(foglalas) await nyitSzerkeszto(id);      // foglalasok.js
  else         nyitAjReszlet(id);             // ajanlatok.js

  // Ha az ablakot bezárták, frissítjük a partnerlistát — hátha módosult az adat.
  figyelAblakZarast(foglalas ? "szerkModal" : "ajReszletModal", betoltPartnerek);
}

// Egyszeri figyelő: amikor a megadott ablak újra rejtett lesz, lefuttat egy függvényt.
function figyelAblakZarast(modalId, teendo){
  const modal = document.getElementById(modalId);
  if(!modal || modal.hidden) return;          // meg sem nyílt (pl. megerősítésnél Mégse)
  const figyelo = new MutationObserver(() => {
    if(modal.hidden){ figyelo.disconnect(); teendo(); }
  });
  figyelo.observe(modal, { attributes:true, attributeFilter:["hidden"] });
}

// -------------------- Szűrők törlése --------------------
function vanAktivSzuro(){
  return PARTNER_OSZLOPOK.some(o => (partnerKereso[o.kulcs] || "").trim())
      || !!document.getElementById("pSzurTol").value
      || !!document.getElementById("pSzurIg").value
      || document.getElementById("pCsakMegvalosult").checked;
}

function torolSzurok(){
  partnerKereso = {};
  document.getElementById("pSzurTol").value = "";
  document.getElementById("pSzurIg").value = "";
  document.getElementById("pCsakMegvalosult").checked = false;
  megjelenitPartnerek();
}
document.getElementById("pSzurTorles")?.addEventListener("click", torolSzurok);

// -------------------- Szűrők eseményei --------------------
["pSzurTol", "pSzurIg", "pCsakMegvalosult"].forEach(id =>
  document.getElementById(id)?.addEventListener("change", megjelenitPartnerek));

// -------------------- Excel-export --------------------
const PARTNER_EXPORT_FEJ = ["Név", "Telefon", "E-mail", "Lakcím", "Alkalmak", "Ebből foglalás", "Ebből ajánlat", "Programok, ajánlatok"];

function partnerExportSorok(){
  return partnerSzurt().map(p => [
    p.nev || "",
    p.telefon || "",
    p.email || "",
    p.cim || "",
    p.esemenyek.length,
    p.esemenyek.filter(e => e.tipus === "foglalas").length,
    p.esemenyek.filter(e => e.tipus === "ajanlat").length,
    p.esemenyek.map(e => `${e.azonosito} ${e.programCim}${e.idopont ? ` (${formatDatum(e.idopont)})` : ""}`).join(" | "),
  ]);
}

async function partnerExportExcel(){
  if(!partnerSzurt().length) return dialog.uzen("A jelenlegi nézetben nincs exportálható partner.", { cim:"Nincs adat" });
  try {
    await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const adat = [PARTNER_EXPORT_FEJ, ...partnerExportSorok()];
    const ws = XLSX.utils.aoa_to_sheet(adat);
    ws["!cols"] = PARTNER_EXPORT_FEJ.map((h, i) => ({ wch: i === 3 ? 34 : i === 7 ? 50 : Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Partnerek");
    XLSX.writeFile(wb, "partnerek-" + new Date().toISOString().slice(0, 10) + ".xlsx");
  } catch(e){ dialog.uzen("Az Excel-export nem sikerült: " + e.message, { cim:"Hiba" }); }
}
document.getElementById("pExportExcel")?.addEventListener("click", partnerExportExcel);
