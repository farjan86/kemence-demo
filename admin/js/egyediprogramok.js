// =====================================================================
//  ADMIN — Egyedi programok fül: lista + szerkesztő + CRUD
//  A Programok fül mintája, de IDŐPONT / ár / foglalás NÉLKÜL — csak
//  cím + rövid/hosszú leírás (rich text) + sorrend + fotó + archiválás.
//
//  A leírás-mezők eszköztárát (B / I / U / A± / felsorolás) a programok.js
//  GLOBÁLIS RTE-kezelője drótozza (közös `.rte-tb .rte-b` gombok az egész
//  oldalon) — itt csak a tartalmat írjuk/olvassuk. A kép a meglévő PUBLIKUS
//  `program-fotok` bucketbe kerül, mint a Programoknál.
// =====================================================================
const epModal = document.getElementById("epModal");
const epForm  = document.getElementById("epForm");
const epErr   = document.getElementById("epErr");
const edEpRovid  = document.getElementById("edEpRovid");
const edEpLeiras = document.getElementById("edEpLeiras");

let epLista = [];
let epArchivNezet = false;

function epHiba(msg){ epErr.textContent = msg; epErr.hidden = false; }
function zarEpModal(){ epModal.hidden = true; }

// -------------------- Lista betöltése + kirajzolás --------------------
let epAjanlatSzam = new Map();   // egyedi program id → a rá érkezett ajánlatkérések száma

async function betoltEgyediProgramLista(){
  const cel = document.getElementById("epLista");
  cel.innerHTML = `<p class="status">Betöltés…</p>`;
  document.getElementById("ujEpBtn").hidden = epArchivNezet;

  const { data, error } = await db.from("egyedi_programok").select("*")
    .eq("archivalt", epArchivNezet)
    .order("sorrend", { ascending:true }).order("cim", { ascending:true });
  if(error){ cel.innerHTML = `<p class="status">Hiba: ${error.message}</p>`; return; }
  epLista = data || [];

  // Hány ajánlatkérés érkezett az egyes egyedi programokra? Ettől függ a törölhetőség:
  // ugyanaz a szabály, mint a programoknál — amire már jött kérés, azt archiválni kell, nem törölni.
  const { data: ajanlatok } = await db.from("ajanlatok").select("egyedi_program_id");
  epAjanlatSzam = new Map();
  (ajanlatok || []).forEach(a => {
    if(!a.egyedi_program_id) return;
    epAjanlatSzam.set(a.egyedi_program_id, (epAjanlatSzam.get(a.egyedi_program_id) || 0) + 1);
  });

  if(epLista.length === 0){
    cel.innerHTML = `<p class="status">${epArchivNezet
      ? "Nincs archivált egyedi program."
      : "Még nincs egyedi program. Vegyél fel egyet a „+ Új egyedi program” gombbal."}</p>`;
    return;
  }

  cel.innerHTML = `<div class="prog-lista">` + epLista.map(p => {
    const badge = epArchivNezet
      ? `<span class="prog-badge arch">Archivált</span>`
      : `<span class="prog-badge aktiv">Aktív</span>`;
    const fogo = epArchivNezet ? "" : `<span class="drag-fogo" title="Húzd a sorrend átrendezéséhez">⠿</span>`;
    const ajSzam = epAjanlatSzam.get(p.id) || 0;
    const torolGomb = ajSzam === 0 ? `<button class="btn sm ghost" data-epdel="${p.id}">Törlés</button>` : "";
    const gombok = epArchivNezet
      ? `<button class="btn sm" data-eprestore="${p.id}">Visszaállítás</button>` + torolGomb
      : `<button class="btn sm ghost" data-epedit="${p.id}">Szerkesztés</button>` +
        `<button class="btn sm ghost" data-eparch="${p.id}">Archiválás</button>` + torolGomb;
    return `<article class="prog-kartya" data-id="${p.id}">
      <div class="fej"><span class="fej-cim">${fogo}<h4>${escapeHtml(p.cim)}</h4></span>${badge}</div>
      <p class="leiras">${tisztitHtml(p.rovid_leiras || p.leiras || "")}</p>
      ${p.foto_url ? `<div class="prog-nincs-ido">📷 fotó feltöltve</div>` : ""}
      ${ajSzam ? `<div class="prog-nincs-ido">${ajSzam} ajánlatkérés érkezett rá — ezért nem törölhető, csak archiválható.</div>` : ""}
      <div class="gombok">${gombok}</div>
    </article>`;
  }).join("") + `</div>`;

  cel.querySelectorAll("[data-epedit]").forEach(b => b.addEventListener("click", () => nyitEp(b.dataset.epedit)));
  cel.querySelectorAll("[data-eparch]").forEach(b => b.addEventListener("click", () => archivalEp(b.dataset.eparch)));
  cel.querySelectorAll("[data-eprestore]").forEach(b => b.addEventListener("click", () => visszaallitEp(b.dataset.eprestore)));
  cel.querySelectorAll("[data-epdel]").forEach(b => b.addEventListener("click", () => torolEp(b.dataset.epdel)));

  // Húzással átrendezhető (csak az Aktuális nézetben) — a főoldal ezt a sorrendet követi
  if(!epArchivNezet){
    sortableSorrend(cel.querySelector(".prog-lista"), "egyedi_programok", document.getElementById("epSorrendMentve"));
  }
}

// Al-fül váltás (Aktuális / Archivált)
document.querySelectorAll('[data-panel="egyediprogramok"] .altab').forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll('[data-panel="egyediprogramok"] .altab').forEach(x => x.classList.toggle("active", x === t));
  epArchivNezet = (t.dataset.epaltab === "archivalt");
  betoltEgyediProgramLista();
}));

// -------------------- Szerkesztő megnyitása (id nélkül = új) --------------------
function nyitEp(id){
  epForm.reset(); epErr.hidden = true;
  edEpRovid.innerHTML = ""; edEpLeiras.innerHTML = "";
  document.getElementById("epFotoElonezet").hidden = true;
  const p = id ? epLista.find(x => x.id === id) : null;
  document.getElementById("epTitle").textContent = p ? "Egyedi program szerkesztése" : "Új egyedi program";
  epForm.dataset.id   = p ? p.id : "";
  epForm.dataset.foto = p?.foto_url || "";
  if(p){
    epForm.cim.value     = p.cim;
    edEpRovid.innerHTML  = tisztitHtml(p.rovid_leiras || "");
    edEpLeiras.innerHTML = tisztitHtml(p.leiras || "");
    if(p.foto_url){
      document.getElementById("epFotoImg").src = p.foto_url;
      document.getElementById("epFotoElonezet").hidden = false;
    }
  }
  epModal.hidden = false;
  epForm.cim.focus();
}

document.getElementById("ujEpBtn").addEventListener("click", () => nyitEp(null));

document.getElementById("epFoto").addEventListener("change", e => {
  const f = e.target.files[0];
  if(f){
    document.getElementById("epFotoImg").src = URL.createObjectURL(f);
    document.getElementById("epFotoElonezet").hidden = false;
  }
});

// A kép a meglévő PUBLIKUS program-fotok bucketbe (mint a Programoknál)
async function feltoltEpKep(file){
  const kiterj = (file.name.split(".").pop() || "jpg").toLowerCase();
  const nev = `ep-${Date.now()}-${Math.random().toString(36).slice(2)}.${kiterj}`;
  const { error } = await db.storage.from("program-fotok").upload(nev, file, { cacheControl:"3600", upsert:false });
  if(error) throw error;
  return db.storage.from("program-fotok").getPublicUrl(nev).data.publicUrl;
}

// -------------------- Mentés --------------------
epForm.addEventListener("submit", async e => {
  e.preventDefault();
  epErr.hidden = true;
  const id  = epForm.dataset.id;
  const cim = epForm.cim.value.trim();
  const rovid_leiras = edEpRovid.textContent.trim() ? tisztitHtml(edEpRovid.innerHTML) : "";
  const leiras       = edEpLeiras.textContent.trim() ? tisztitHtml(edEpLeiras.innerHTML) : null;
  if(!cim)          return epHiba("A cím kötelező.");
  if(!rovid_leiras) return epHiba("A rövid leírás kötelező.");

  const gomb = epForm.querySelector('button[type="submit"]');
  gomb.disabled = true;

  let foto_url = epForm.dataset.foto || null;
  const file = document.getElementById("epFoto").files[0];
  if(file){
    try { foto_url = await feltoltEpKep(file); }
    catch(err){ gomb.disabled = false; return epHiba("A kép feltöltése nem sikerült: " + err.message); }
  }

  const sor = { cim, rovid_leiras, leiras, foto_url };
  // Új elem a lista VÉGÉRE (sorrend = jelenlegi elemszám); utána húzással átrendezhető.
  const { error } = id
    ? await db.from("egyedi_programok").update(sor).eq("id", id)
    : await db.from("egyedi_programok").insert({ ...sor, sorrend: epLista.length });
  if(error){ gomb.disabled = false; return epHiba("Mentési hiba: " + error.message); }

  gomb.disabled = false;
  epModal.hidden = true;
  betoltEgyediProgramLista();
});

// -------------------- Archiválás / Visszaállítás / Törlés --------------------
async function archivalEp(id){
  const p = epLista.find(x => x.id === id);
  const ok = await dialog.megerosit(`Archiválod a(z) „${p?.cim ?? ""}" egyedi programot? Lekerül a főoldalról; a beérkezett ajánlatkérések megmaradnak.`,
    { cim:"Archiválás", okCimke:"Archiválás" });
  if(!ok) return;
  const { error } = await db.from("egyedi_programok").update({ archivalt:true }).eq("id", id);
  if(error) return dialog.uzen("Archiválási hiba: " + error.message, { cim:"Hiba" });
  betoltEgyediProgramLista();
}

async function visszaallitEp(id){
  const p = epLista.find(x => x.id === id);
  const ok = await dialog.megerosit(`Visszaállítod a(z) „${p?.cim ?? ""}" egyedi programot? Újra megjelenik a főoldalon.`,
    { cim:"Visszaállítás", okCimke:"Visszaállítás" });
  if(!ok) return;
  const { error } = await db.from("egyedi_programok").update({ archivalt:false }).eq("id", id);
  if(error) return dialog.uzen("Hiba: " + error.message, { cim:"Hiba" });
  betoltEgyediProgramLista();
}

async function torolEp(id){
  const p = epLista.find(x => x.id === id);
  const ok = await dialog.megerosit(
    `Biztosan véglegesen törlöd a(z) „${p?.cim ?? ""}" egyedi programot?

Ez nem vonható vissza. (Csak olyan egyedi program törölhető, amire még nem érkezett ajánlatkérés.)`,
    { cim:"Egyedi program törlése", okCimke:"Törlés", veszelyes:true });
  if(!ok) return;
  const { error } = await db.from("egyedi_programok").delete().eq("id", id);
  if(error) return dialog.uzen("Törlési hiba: " + error.message, { cim:"Hiba" });
  betoltEgyediProgramLista();
}

document.getElementById("epClose").addEventListener("click", zarEpModal);
document.getElementById("epMegse").addEventListener("click", zarEpModal);
