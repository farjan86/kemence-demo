// =====================================================================
//  Kemence Akadémia — publikus oldal: ADAT + PROGRAMOK kirajzolása
//  Programonként csoportosít: egy program = egy kártya, benne több
//  IDŐPONT-csempe (dátum · ár · szabad hely). A segédek: util.js;
//  a foglalási ablak: foglalas.js.
// =====================================================================

// Kapcsolat a Supabase-hez (a config.js adataival)
const db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// A betöltött programok (csoportosítva) + időpont-index a foglaláshoz.
// (A foglalas.js ezt olvassa futásidőben.)
let programLista = [];
let idopontIndex = {};   // idopont_id -> { program, ido }
let globalisSzunet = false;   // settings.foglalas_szunet — „minden foglalás" felfüggesztve

// -------------------- Beállítások (settings) --------------------
// Az info-sáv szövege az adatbázisból jön; az admin szerkesztheti.
// (Sima szövegként jelenítjük meg — textContent — a biztonság miatt.)
async function betoltBeallitasok(){
  const { data } = await db.from("settings")
    .select("foglalas_infosav, foglalas_szunet").eq("id", 1).maybeSingle();
  if(data){
    globalisSzunet = !!data.foglalas_szunet;
    if(data.foglalas_infosav){
      const el = document.getElementById("mInfosav");
      if(el) el.textContent = data.foglalas_infosav;
    }
  }
}

// -------------------- Egy időpont-csempe --------------------
function csempe(i, felfuggesztve){
  const datum = formatDatumRovid(i.idopont);
  const ar = i.kedvezmenyes_ar
    ? `<span class="i-ar"><span class="old">${HUF(i.ar)}</span><span class="sale">${HUF(i.kedvezmenyes_ar)}</span></span>`
    : `<span class="i-ar">${HUF(i.ar)}</span>`;

  // Csoportos korlátok: lezárt-e, mert elérte a max. foglalásokat, vagy a szabad hely < minimum?
  const maxElerve = (i.max_foglalasok != null) && ((i.foglalasok_szama || 0) >= i.max_foglalasok);
  const kevesMint = (i.min_letszam != null) && (i.szabad_helyek < i.min_letszam);
  const csoportos = (i.min_letszam != null) || (i.max_foglalasok != null);

  let allapot, cls, disabled = "";
  if(i.idopont_statusz === "elmaradt"){ allapot = "Elmarad"; cls = "full"; disabled = "disabled"; }
  else if(i.szabad_helyek <= 0 || maxElerve || kevesMint){ allapot = "Betelt"; cls = "full"; disabled = "disabled"; }
  else if(i.min_letszam != null){      allapot = `Min. ${i.min_letszam} fő`; cls = "free"; }
  else if(csoportos){                  allapot = "Csoportos"; cls = "free"; }
  else {                               allapot = `${i.max_letszam - i.szabad_helyek}/${i.max_letszam} foglalt`; cls = "free"; }
  if(felfuggesztve) disabled = "disabled";   // szünet: nem foglalható, de a dátum/ár látszik

  return `<button class="idopont-btn" type="button" data-idopont="${i.idopont_id}" ${disabled}>
    <span class="i-datum">${datum}</span>
    ${ar}
    <span class="i-hely ${cls}">${allapot}</span>
  </button>`;
}

// -------------------- Kártya HTML (egy program) --------------------
function kartya(p){
  const kep    = p.foto_url ? `<img class="card-kep" src="${p.foto_url}" alt="" loading="lazy">` : "";
  const rovid  = tisztitHtml(p.rovid_leiras || p.leiras || "");
  const reszlet = p.leiras ? `<button class="reszlet-btn" data-reszlet="${p.workshop_id}">Részletek →</button>` : "";
  const eloadoHtml = p.eloado ? `<p class="eloado">Előadó: <b>${escapeHtml(p.eloado)}</b></p>` : "";

  // Csak a JÖVŐBELI időpontokat mutatjuk (a múltat elrejtjük), időrendben.
  const jovo = p.idopontok
    .filter(i => !lezarultNap(i.idopont))
    .sort((a, b) => new Date(a.idopont) - new Date(b.idopont));

  // „Hamarosan": ha a program hamarosan-státuszú, vagy nincs jövőbeli időpont.
  if(p.program_statusz === "hamarosan" || jovo.length === 0){
    return `<article class="card">
      ${kep}
      <div class="card-top"><h3>${p.cim}</h3><span class="badge soon">Hamarosan</span></div>
      ${eloadoHtml}
      <p class="desc">${rovid}</p>
      ${reszlet}
    </article>`;
  }

  const idotartam = p.varhato_idotartam ? `<div class="meta">${escapeHtml(p.varhato_idotartam)}</div>` : "";

  // Átmeneti szünet (program-szintű vagy globális): üzenet + tiltott (de látható) csempék.
  if(p.foglalas_felfuggesztve || globalisSzunet){
    return `<article class="card">
      ${kep}
      <div class="card-top"><h3>${p.cim}</h3></div>
      ${eloadoHtml}
      <p class="desc">${rovid}</p>
      ${reszlet}
      ${idotartam}
      <div class="idopont-lista">${jovo.map(i => csempe(i, true)).join("")}</div>
      <div class="szunet-sav">Foglalás átmenetileg felfüggesztve</div>
    </article>`;
  }

  return `<article class="card">
    ${kep}
    <div class="card-top"><h3>${p.cim}</h3></div>
    ${eloadoHtml}
    <p class="desc">${rovid}</p>
    ${reszlet}
    ${idotartam}
    <div class="idopont-cimke">Válassz időpontot</div>
    <div class="idopont-lista">${jovo.map(i => csempe(i)).join("")}</div>
  </article>`;
}

// -------------------- Programok betöltése + csoportosítás --------------------
async function betoltProgramok(){
  const cel = document.getElementById("programok");
  const { data, error } = await db
    .from("programok").select("*")
    .eq("archivalt", false)
    .order("cim", { ascending: true })
    .order("idopont", { ascending: true, nullsFirst: true });

  if(error){ cel.innerHTML = `<p class="status">Hiba a betöltéskor: ${error.message}</p>`; console.error(error); return; }
  if(!data || data.length === 0){ cel.innerHTML = `<p class="status">Még nincs meghirdetett program.</p>`; return; }

  // Csoportosítás workshop_id szerint (a nézet program × időpont sorokat ad).
  const map = new Map();
  idopontIndex = {};
  for(const r of data){
    let p = map.get(r.workshop_id);
    if(!p){
      p = {
        workshop_id: r.workshop_id, cim: r.cim, rovid_leiras: r.rovid_leiras, leiras: r.leiras,
        eloado: r.eloado, varhato_idotartam: r.varhato_idotartam, foto_url: r.foto_url,
        program_statusz: r.program_statusz, foglalas_felfuggesztve: r.foglalas_felfuggesztve,
        sorrend: r.sorrend, idopontok: []
      };
      map.set(r.workshop_id, p);
    }
    if(r.idopont_id){
      const ido = {
        idopont_id: r.idopont_id, idopont: r.idopont, ar: r.ar, kedvezmenyes_ar: r.kedvezmenyes_ar,
        max_letszam: r.max_letszam, idopont_statusz: r.idopont_statusz, szabad_helyek: r.szabad_helyek,
        max_foglalasok: r.max_foglalasok, min_letszam: r.min_letszam, foglalasok_szama: r.foglalasok_szama
      };
      p.idopontok.push(ido);
      idopontIndex[r.idopont_id] = { program: p, ido };
    }
  }
  programLista = Array.from(map.values());

  // Sorrend: az admin által húzással beállított KÉZI sorrend (workshops.sorrend);
  // azonos sorrendnél a legközelebbi jövőbeli időpont szerint (a régi viselkedés tie-breakként).
  const kulcs = p => {
    const jovo = p.idopontok.filter(i => !lezarultNap(i.idopont)).map(i => +new Date(i.idopont));
    return jovo.length ? Math.min(...jovo) : Infinity;
  };
  programLista.sort((a, b) => ((a.sorrend || 0) - (b.sorrend || 0)) || (kulcs(a) - kulcs(b)));

  cel.innerHTML = programLista.map(kartya).join("");
  cel.querySelectorAll(".idopont-btn[data-idopont]").forEach(b =>
    b.addEventListener("click", () => nyitFoglalas(b.dataset.idopont)));   // nyitFoglalas: foglalas.js
  cel.querySelectorAll(".reszlet-btn[data-reszlet]").forEach(b =>
    b.addEventListener("click", () => mutatReszletek(b.dataset.reszlet)));
}

// -------------------- Részletek ablak --------------------
const reszletModal = document.getElementById("reszletModal");
function mutatReszletek(workshop_id){
  const p = programLista.find(x => x.workshop_id === workshop_id);
  if(!p) return;
  document.getElementById("rTitle").textContent = p.cim;
  document.getElementById("rLeiras").innerHTML = tisztitHtml(p.leiras || "");
  reszletModal.hidden = false;
}
document.getElementById("rClose").addEventListener("click", () => { reszletModal.hidden = true; });
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && !reszletModal.hidden) reszletModal.hidden = true; });

// -------------------- Látogatás-számláló --------------------
// Böngészőnként 6 óránként max egyszer számít új látogatásnak (localStorage).
async function latogatasSzamlalo(){
  const KULCS = "ka_utolso_latogatas";
  const HAT_ORA = 6 * 60 * 60 * 1000;
  try {
    const most = Date.now();
    const utolso = parseInt(localStorage.getItem(KULCS) || "0", 10);
    const ujLatogatas = !utolso || (most - utolso) > HAT_ORA;
    const { data, error } = ujLatogatas
      ? await db.rpc("latogatas_rogzites")   // növel + visszaadja az összeget
      : await db.rpc("latogatas_szam");      // csak olvassa
    if(error || data == null) return;        // csendben kihagyjuk (pl. ha a migráció még nem futott)
    if(ujLatogatas) localStorage.setItem(KULCS, String(most));
    const el = document.getElementById("latogatoSzam");
    const wrap = document.getElementById("latogatoWrap");
    if(el){ el.textContent = Number(data).toLocaleString("hu-HU"); if(wrap) wrap.hidden = false; }
  } catch(_){ /* a látogatót ne zavarja meg semmilyen hiba */ }
}

// Indítás — előbb a beállítások (globális szünet), utána a programok
(async () => { await betoltBeallitasok(); betoltProgramok(); })();
latogatasSzamlalo();
