// =====================================================================
//  ADMIN — Előadóink fül
//
//  A csapattagok, akik a programokat tartják. A főoldal „Rólunk"
//  szakaszában kattintható névsorként jelennek meg, a program-kártyán
//  pedig az adott alkalom előadóiként.
//
//  Megjelenítés: CSUPASZ LISTA — kép és szövegrészlet nélkül, hogy 20-30
//  névnél is átlátható maradjon. A kép a szerkesztő ablakban látszik.
//
//  SZABÁLYOK:
//    • Törölni csak programhoz NEM kötött előadót lehet (az adatbázis is
//      tiltja: program_eloadok.eloado_id → on delete restrict).
//    • Elrejteni bármikor lehet — a rejtés csak a Rólunk névsort érinti,
//      a program-kártyán a neve továbbra is megjelenik (nem kattinthatóan).
// =====================================================================
let eloadoLista      = [];          // a betöltött előadók
let eloadoProgramSzam = new Map();  // eloado_id → hány programhoz van kötve

const eloadoModal = document.getElementById("eloadoModal");
const eloadoForm  = document.getElementById("eloadoForm");
const eloadoErr   = document.getElementById("eloadoErr");
const edEloadoBem = document.getElementById("edEloadoBemutatkozas");

function eloadoHiba(msg){ eloadoErr.textContent = msg; eloadoErr.hidden = false; }
function zarEloadoModal(){ eloadoModal.hidden = true; }

// -------------------- Betöltés --------------------
async function betoltEloadok(){
  const cel = document.getElementById("eloadoLista");
  cel.innerHTML = `<p class="status">Betöltés…</p>`;

  const [{ data, error }, { data: kapcsolatok }] = await Promise.all([
    db.from("eloadok").select("*").order("sorrend", { ascending:true }).order("nev", { ascending:true }),
    db.from("program_eloadok").select("eloado_id"),
  ]);
  if(error){ cel.innerHTML = `<p class="status">Hiba: ${error.message}</p>`; return; }
  eloadoLista = data || [];

  // Hány programhoz van kötve? Ettől függ, törölhető-e.
  eloadoProgramSzam = new Map();
  (kapcsolatok || []).forEach(k =>
    eloadoProgramSzam.set(k.eloado_id, (eloadoProgramSzam.get(k.eloado_id) || 0) + 1));

  megjelenitEloadok();
}

function megjelenitEloadok(){
  const cel = document.getElementById("eloadoLista");

  if(eloadoLista.length === 0){
    cel.innerHTML = `<p class="status">Még nincs előadó. Vegyél fel egyet a „+ Új előadó” gombbal.</p>`;
    return;
  }

  cel.innerHTML = `<div class="eloado-sorok">` + eloadoLista.map(e => {
    const progSzam = eloadoProgramSzam.get(e.id) || 0;
    const jelek =
      (e.rejtett  ? `<span class="arch-jel">Rejtett</span>` : "") +
      (progSzam   ? `<span class="eloado-progjel">${progSzam} program</span>` : "");
    // Programhoz kötött előadót nem lehet törölni — a gomb meg sem jelenik.
    const torolGomb = progSzam === 0
      ? `<button class="btn sm ghost" data-eldel="${e.id}">Törlés</button>` : "";

    return `<div class="eloado-sor" data-id="${e.id}">
      <span class="drag-fogo" title="Húzd a sorrend átrendezéséhez">⠿</span>
      <span class="eloado-nev">${escapeHtml(e.nev)}</span>
      <span class="eloado-jelek">${jelek}</span>
      <span class="eloado-gombok">
        <button class="btn sm ghost" data-eledit="${e.id}">Szerkesztés</button>
        <button class="btn sm ghost" data-elrejt="${e.id}">${e.rejtett ? "Megjelenítés" : "Rejtés"}</button>
        ${torolGomb}
      </span>
    </div>`;
  }).join("") + `</div>`;

  cel.querySelectorAll("[data-eledit]").forEach(b => b.addEventListener("click", () => nyitEloado(b.dataset.eledit)));
  cel.querySelectorAll("[data-elrejt]").forEach(b => b.addEventListener("click", () => rejtEloado(b.dataset.elrejt)));
  cel.querySelectorAll("[data-eldel]").forEach(b => b.addEventListener("click", () => torolEloado(b.dataset.eldel)));

  // Húzással átrendezhető — a főoldali névsor ezt a sorrendet követi
  sortableSorrend(cel.querySelector(".eloado-sorok"), "eloadok", document.getElementById("eloadoSorrendMentve"));
}

// -------------------- Szerkesztő ablak --------------------
function nyitEloado(id){
  const e = id ? eloadoLista.find(x => x.id === id) : null;
  eloadoForm.reset(); eloadoErr.hidden = true;
  edEloadoBem.innerHTML = "";
  document.getElementById("eloadoFotoElonezet").hidden = true;
  document.getElementById("eloadoCim").textContent = e ? "Előadó szerkesztése" : "Új előadó";
  eloadoForm.dataset.id   = e ? e.id : "";
  eloadoForm.dataset.foto = e?.foto_url || "";

  if(e){
    eloadoForm.nev.value  = e.nev;
    edEloadoBem.innerHTML = tisztitHtml(e.bemutatkozas || "");
    if(e.foto_url){
      document.getElementById("eloadoFotoImg").src = e.foto_url;
      document.getElementById("eloadoFotoElonezet").hidden = false;
    }
  }
  eloadoModal.hidden = false;
  eloadoForm.nev.focus();
}

document.getElementById("ujEloadoBtn")?.addEventListener("click", () => nyitEloado(null));
document.getElementById("eloadoClose")?.addEventListener("click", zarEloadoModal);
document.getElementById("eloadoMegse")?.addEventListener("click", zarEloadoModal);

document.getElementById("eloadoFoto")?.addEventListener("change", ev => {
  const f = ev.target.files[0];
  if(f){
    document.getElementById("eloadoFotoImg").src = URL.createObjectURL(f);
    document.getElementById("eloadoFotoElonezet").hidden = false;
  }
});

// A kép a meglévő PUBLIKUS program-fotok bucketbe (mint a programoknál)
async function feltoltEloadoKep(file){
  const kiterj = (file.name.split(".").pop() || "jpg").toLowerCase();
  const nev = `eloado-${Date.now()}-${Math.random().toString(36).slice(2)}.${kiterj}`;
  const { error } = await db.storage.from("program-fotok").upload(nev, file, { cacheControl:"3600", upsert:false });
  if(error) throw error;
  return db.storage.from("program-fotok").getPublicUrl(nev).data.publicUrl;
}

// -------------------- Mentés --------------------
eloadoForm?.addEventListener("submit", async e => {
  e.preventDefault();
  eloadoErr.hidden = true;
  const id  = eloadoForm.dataset.id;
  const nev = eloadoForm.nev.value.trim();
  const bemutatkozas = edEloadoBem.textContent.trim() ? tisztitHtml(edEloadoBem.innerHTML) : null;
  if(!nev) return eloadoHiba("A név kötelező.");

  const gomb = eloadoForm.querySelector('button[type="submit"]');
  gomb.disabled = true;

  let foto_url = eloadoForm.dataset.foto || null;
  const file = document.getElementById("eloadoFoto").files[0];
  if(file){
    try { foto_url = await feltoltEloadoKep(file); }
    catch(err){ gomb.disabled = false; return eloadoHiba("A kép feltöltése nem sikerült: " + err.message); }
  }

  const sor = { nev, bemutatkozas, foto_url };
  // Új előadó a lista VÉGÉRE; utána húzással átrendezhető.
  const { error } = id
    ? await db.from("eloadok").update(sor).eq("id", id)
    : await db.from("eloadok").insert({ ...sor, sorrend: eloadoLista.length });
  gomb.disabled = false;
  if(error) return eloadoHiba("Mentési hiba: " + error.message);

  eloadoModal.hidden = true;
  betoltEloadok();
});

// -------------------- Rejtés / megjelenítés --------------------
// Bármikor megtehető, akkor is, ha az előadó programhoz van kötve.
async function rejtEloado(id){
  const e = eloadoLista.find(x => x.id === id);
  if(!e) return;
  const { error } = await db.from("eloadok").update({ rejtett: !e.rejtett }).eq("id", id);
  if(error) return dialog.uzen("Nem sikerült: " + error.message, { cim:"Hiba" });
  betoltEloadok();
}

// -------------------- Törlés --------------------
async function torolEloado(id){
  const e = eloadoLista.find(x => x.id === id);
  if(!e) return;
  if((eloadoProgramSzam.get(id) || 0) > 0) return;   // biztonság: kötött előadó nem törölhető

  const ok = await dialog.megerosit(
    `Véglegesen törlöd: „${e.nev}”?\n\nEz nem vonható vissza. (Csak olyan előadó törölhető, aki egyetlen programhoz sincs hozzárendelve.)`,
    { cim:"Előadó törlése", okCimke:"Törlés", veszelyes:true });
  if(!ok) return;

  const { error } = await db.from("eloadok").delete().eq("id", id);
  if(error){
    // Ha időközben hozzákötötték egy programhoz, az adatbázis is tiltja.
    return dialog.uzen(/foreign key|violates/i.test(error.message)
      ? "Ez az előadó közben programhoz lett rendelve, ezért nem törölhető. Előbb vedd le a programról."
      : "Törlési hiba: " + error.message, { cim:"Hiba" });
  }
  betoltEloadok();
}

// A bemutatkozás formázó gombjait (félkövér, dőlt, …) NEM kötjük be itt:
// a programok.js egyetlen, GLOBÁLIS kezelőt tesz minden ".rte-tb .rte-b" gombra
// az oldalon — beleértve ezt az ablakot is. Ha itt is bekötnénk, a parancs
// kétszer futna le (a félkövér be-, majd rögtön kikapcsolna).
