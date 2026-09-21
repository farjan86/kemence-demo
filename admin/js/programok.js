// =====================================================================
//  ADMIN — Programok fül: lista + több-időpontos szerkesztő + CRUD
// =====================================================================
const progModal = document.getElementById("progModal");
const progForm  = document.getElementById("progForm");
const pStatusz  = document.getElementById("pStatusz");
const idopontLista  = document.getElementById("idopontLista");
const idopontokMezo = document.getElementById("idopontokMezo");
const pErr = document.getElementById("pErr");
let progLista = [];
let progArchivNezet = false;
let globalisSzunet = false;           // settings.foglalas_szunet — „minden foglalás" globális szünet
let progFoglalasSzam = new Map();     // workshop → összes foglalás
let progElofoglalasSzam = new Map();  // workshop → élő foglalás (vár + jóváhagyott)
let idopontFoglalasSzam = new Map();  // idopont_id → összes foglalás (bármely státusz; a ✕ ez alapján tilt)
let idopontFoglaltFo = new Map();     // idopont_id → élő (foglalt) fő; a max. létszám nem mehet ez alá
let torlesLezarttal = new Set();      // idopont-id-k, amelyeket a lezárt (lemondott/elutasított) foglalásaikkal EGYÜTT törlünk (mentéskor)

// --- Rich text (félkövér / dőlt / felsorolás) a leírás-mezőkhöz ---
const edRovid     = document.getElementById("edRovid");
const edReszletes = document.getElementById("edReszletes");
try { document.execCommand("styleWithCSS", false, false); } catch(_){}
document.querySelectorAll(".rte-tb .rte-b").forEach(b => {
  b.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if(b.dataset.cmd){ document.execCommand(b.dataset.cmd, false, null); }
    else if(b.dataset.size){
      let sz = parseInt(document.queryCommandValue("fontSize")) || 3;
      sz = Math.max(1, Math.min(7, sz + parseInt(b.dataset.size)));
      document.execCommand("fontSize", false, sz);
    }
  });
});
[edRovid, edReszletes].forEach(ed => ed.addEventListener("keydown", (e) => {
  if(e.key === "Tab"){ e.preventDefault(); document.execCommand(e.shiftKey ? "outdent" : "indent", false, null); }
}));

function pHiba(msg){ pErr.textContent = msg; pErr.hidden = false; }
function zarProgModal(){ progModal.hidden = true; }

// --- Időpont-sorok az űrlapon ---
function idopontSorHtml(i){
  i = i || {};
  const letezo = !!i.id;
  const elmaradt = i.statusz === "elmaradt";
  // Új (még nem mentett) időpont mindig aktív — „Elmarad” CSAK meglévő időpontnál választható.
  const allapotCella = letezo
    ? `<select class="ido-statusz">
      <option value="aktiv"${!elmaradt ? " selected" : ""}>Aktív</option>
      <option value="elmaradt"${elmaradt ? " selected" : ""}>Elmarad</option>
    </select>`
    : `<span class="ido-uj-jel">Aktív</span>`;
  return `<div class="idopont-sor${elmaradt ? " elmaradt" : ""}" data-id="${i.id || ""}" data-eredeti-max="${i.max_letszam ?? ""}">
    <div class="ido-fej">
      <input class="ido-datum" type="datetime-local" value="${i.idopont ? isoToLocalInput(i.idopont) : ""}">
      ${allapotCella}
      <button type="button" class="btn sm ghost ido-torol" title="Időpont törlése">✕</button>
    </div>
    <div class="ido-mezok">
      <label class="ido-mezo">Ár (Ft)<input class="ido-ar" type="number" min="0" step="1" value="${i.ar ?? ""}"></label>
      <label class="ido-mezo">Kedv. ár<input class="ido-kedv" type="number" min="0" step="1" value="${i.kedvezmenyes_ar ?? ""}"></label>
      <label class="ido-mezo">Max. létszám<input class="ido-max" type="number" min="1" step="1" value="${i.max_letszam ?? ""}"></label>
      <label class="ido-mezo">Min. fő/foglalás<input class="ido-min" type="number" min="1" step="1" placeholder="—" value="${i.min_letszam ?? ""}"></label>
      <label class="ido-mezo">Max. foglalás<input class="ido-maxfogl" type="number" min="1" step="1" placeholder="—" value="${i.max_foglalasok ?? ""}"></label>
    </div>
  </div>`;
}
function renderIdopontSorok(idopontok){
  idopontLista.innerHTML = (idopontok || []).map(idopontSorHtml).join("");
}
function frissitIdopontokLathatosag(){
  idopontokMezo.hidden = (pStatusz.value !== "aktiv");
}
pStatusz.addEventListener("change", frissitIdopontokLathatosag);
// --- „?" súgó a csoportos korlátokhoz (Min. fő/foglalás, Max. foglalás) ---
// Védett bekötés: ha a böngésző régi (gyorsítótárazott) index.html-t tölt be, amiben még
// nincsenek meg ezek az elemek, az NE döntse el az egész fájlt (különben a Programok fül
// sem töltődne be, mert a betoltProgramLista létre sem jönne).
const korlatSugo    = document.getElementById("korlatSugo");
const korlatSugoGmb = document.getElementById("korlatSugoGomb");
if(korlatSugo && korlatSugoGmb){
  korlatSugoGmb.addEventListener("click", () => { korlatSugo.hidden = false; });
  korlatSugo.querySelectorAll("[data-sugo-zar]").forEach(b =>
    b.addEventListener("click", () => { korlatSugo.hidden = true; }));
  korlatSugo.addEventListener("click", e => { if(e.target === korlatSugo) korlatSugo.hidden = true; });   // háttérre kattintás
  document.addEventListener("keydown", e => { if(e.key === "Escape" && !korlatSugo.hidden) korlatSugo.hidden = true; });
}

document.getElementById("idopontAdd").addEventListener("click", () => {
  idopontLista.insertAdjacentHTML("beforeend", idopontSorHtml());
});
idopontLista.addEventListener("click", async (e) => {
  const torol = e.target.closest(".ido-torol");
  if(!torol) return;
  const sor  = torol.closest(".idopont-sor");
  const idId = sor?.dataset.id;
  if(!idId){ sor?.remove(); return; }   // új (még nem mentett) időpont → simán törölhető

  const eloFo  = idopontFoglaltFo.get(idId) || 0;      // élő (foglalt) fő
  const osszes = idopontFoglalasSzam.get(idId) || 0;   // összes foglalás-rekord (bármely státusz)

  if(eloFo > 0){
    // Van ÉLŐ foglalás → nem törölhető, az „Elmarad” a helyes út.
    dialog.uzen(
      "Ehhez az időponthoz ÉLŐ (jóváhagyásra váró vagy jóváhagyott) foglalás tartozik, ezért nem törölhető.\n\nHa az alkalom elmarad, állítsd az állapotát „Elmarad”-ra (a jobb oldali legördülőben) — így a jelentkezők értesíthetők.",
      { cim: "Az időpont nem törölhető" });
    return;
  }
  if(osszes > 0){
    // Csak LEZÁRT (lemondott/elutasított) foglalás(ok), élő nincs → törölhető, de azok a rekordok is törlődnek (pucolás).
    const ok = await dialog.megerosit(
      `Ehhez az időponthoz ${osszes} lezárt (lemondott/elutasított) foglalás tartozik. Az időpont törlésével ezek a foglalások is VÉGLEGESEN törlődnek — az előzményből (analitikából) is eltűnnek.\n\nBiztos így szeretnéd? Ha nem, inkább állítsd az időpontot „Elmarad” státuszra — akkor a foglalások megmaradnak.`,
      { cim:"Lezárt foglalások törlése", okCimke:"Igen, töröljük", megseCimke:"Mégse", veszelyes:true });
    if(!ok) return;
    torlesLezarttal.add(idId);   // a mentéskori törlés előbb a lezárt foglalásokat törli
  }
  sor.remove();
});
idopontLista.addEventListener("change", (e) => {
  if(e.target.classList.contains("ido-statusz")){
    e.target.closest(".idopont-sor")?.classList.toggle("elmaradt", e.target.value === "elmaradt");
    return;
  }
  // Max. létszám: nem mehet a már befoglalt fő alá — azonnal szólunk és visszaállítunk.
  if(e.target.classList.contains("ido-max")){
    const sor  = e.target.closest(".idopont-sor");
    const idId = sor?.dataset.id;
    if(!idId) return;                       // új (még nem mentett) időponton nincs foglalás
    const foglalt = idopontFoglaltFo.get(idId) || 0;
    const uj = parseInt(e.target.value, 10);
    if(Number.isFinite(uj) && uj < foglalt){
      const eredeti = sor.dataset.eredetiMax || "";
      e.target.value = eredeti;             // vissza az eredeti értékre
      dialog.uzen(
        `Erre az időpontra jelenleg ${foglalt} fő foglalás van, ezért a max. létszám nem lehet ennél kevesebb.\n\nVisszaállítottam az eredeti értékre (${eredeti} fő). Ha csökkentenéd, előbb mondj le foglalás(oka)t a Foglalások fülön.`,
        { cim:"Túl kevés hely" });
    }
  }
});

// Programlista betöltése + kirajzolás (Aktuális vagy Archivált nézet)
async function betoltProgramLista(){
  const cel = document.getElementById("programLista");
  cel.innerHTML = `<p class="status">Betöltés…</p>`;
  document.getElementById("ujProgramBtn").hidden = progArchivNezet;

  // globális foglalás-szünet állapot + a gomb frissítése
  const { data: st } = await db.from("settings").select("foglalas_szunet").eq("id", 1).maybeSingle();
  globalisSzunet = !!st?.foglalas_szunet;
  frissitGlobalSzunetGomb();

  const { data: ws, error } = await db.from("workshops").select("*")
    .eq("archivalt", progArchivNezet)
    .order("sorrend", { ascending:true }).order("cim", { ascending:true });
  if(error){ cel.innerHTML = `<p class="status">Hiba: ${error.message}</p>`; return; }

  const { data: idos } = await db.from("idopontok").select("*").order("idopont", { ascending:true });
  const { data: bk }   = await db.from("bookings").select("idopont_id, statusz, letszam");

  const idoByWs = new Map();
  (idos || []).forEach(i => { if(!idoByWs.has(i.workshop_id)) idoByWs.set(i.workshop_id, []); idoByWs.get(i.workshop_id).push(i); });
  const idoToWs = new Map((idos || []).map(i => [i.id, i.workshop_id]));
  progFoglalasSzam = new Map(); progElofoglalasSzam = new Map(); idopontFoglalasSzam = new Map(); idopontFoglaltFo = new Map();
  (bk || []).forEach(b => {
    idopontFoglalasSzam.set(b.idopont_id, (idopontFoglalasSzam.get(b.idopont_id) || 0) + 1);   // bármely státusz
    const wid = idoToWs.get(b.idopont_id); if(!wid) return;
    progFoglalasSzam.set(wid, (progFoglalasSzam.get(wid) || 0) + 1);
    if(b.statusz === "jovahagyasra_var" || b.statusz === "jovahagyott"){
      progElofoglalasSzam.set(wid, (progElofoglalasSzam.get(wid) || 0) + 1);
      idopontFoglaltFo.set(b.idopont_id, (idopontFoglaltFo.get(b.idopont_id) || 0) + (Number(b.letszam) || 0));
    }
  });

  progLista = (ws || []).map(w => ({
    ...w,
    idopontok: (idoByWs.get(w.id) || []).sort((a, b) => new Date(a.idopont) - new Date(b.idopont))
  }));

  if(progLista.length === 0){
    cel.innerHTML = `<p class="status">${progArchivNezet
      ? "Nincs archivált program."
      : "Még nincs program. Vegyél fel egyet a „+ Új program” gombbal."}</p>`;
    return;
  }

  cel.innerHTML = `<div class="prog-lista">` + progLista.map(p => {
    const hamarosan = p.statusz === "hamarosan";
    const badge = progArchivNezet
      ? `<span class="prog-badge arch">Archivált</span>`
      : (hamarosan ? `<span class="prog-badge soon">Hamarosan</span>` : `<span class="prog-badge aktiv">Aktív</span>`);
    const szunetel = p.foglalas_felfuggesztve || globalisSzunet;   // program-szintű VAGY globális szünet
    // A főoldal csak a jövőbeli alkalmakat mutatja; enélkül a szünet üzenete sem jelenik meg ott.
    const vanJovobeli = p.idopontok.some(i => !lezarultNap(i.idopont));
    const szunetJel = szunetel ? `<div class="prog-szunet-jel">Foglalás szünetel</div>` : "";
    // Ha nincs jövőbeli alkalom, a főoldalon a szünet üzenete helyett az „Új időpontok
    // egyeztetés alatt" sáv látszik — itt jelezzük, hogy a gombnyomásnak most nincs látható hatása.
    const szunetMegj = (szunetel && !vanJovobeli && !progArchivNezet)
      ? `<div class="prog-nincs-ido">A szünet a főoldalon most nem látszik — nincs jövőbeli időpont.</div>`
      : "";
    // A főoldalon ilyenkor az „Új időpontok egyeztetés alatt" sáv jelenik meg (archívnál nincs jelentősége).
    const nincsJovoMegj = (hamarosan || progArchivNezet) ? "" : " — a főoldalon „Új időpontok egyeztetés alatt” felirattal jelenik meg";
    const eloadoSor = p.eloado ? `<div class="prog-eloado">Előadó: ${escapeHtml(p.eloado)}</div>` : "";

    const idoSorok = p.idopontok.length
      ? `<ul class="prog-idopontok">` + p.idopontok.map(i => {
          const elo = idopontFoglaltFo.get(i.id) || 0;
          const elmaradt = i.statusz === "elmaradt";
          const arTxt = i.kedvezmenyes_ar ? `${HUF(i.kedvezmenyes_ar)}` : HUF(i.ar);
          return `<li class="${elmaradt ? "elmaradt" : ""}">
            <span class="pi-datum">${formatDatum(i.idopont)}</span>
            <span class="pi-ar">${arTxt}</span>
            <span class="pi-hely">${elo}/${i.max_letszam} fő</span>
            ${elmaradt ? `<span class="arch-jel elmaradt">elmarad</span>` : ""}
          </li>`;
        }).join("") + `</ul>`
        + (vanJovobeli || progArchivNezet ? "" : `<div class="prog-nincs-ido">Nincs jövőbeli időpont${nincsJovoMegj}.</div>`)
      : `<div class="prog-nincs-ido">Nincs időpont${nincsJovoMegj}.</div>`;

    const fogo = progArchivNezet ? "" : `<span class="drag-fogo" title="Húzd a sorrend átrendezéséhez">⠿</span>`;
    const foglSzam = progFoglalasSzam.get(p.id) || 0;
    let gombok;
    if(progArchivNezet){
      gombok = `<button class="btn sm" data-progrestore="${p.id}">Visszaállítás</button>` +
               (foglSzam === 0 ? `<button class="btn sm ghost" data-progdel="${p.id}">Törlés</button>` : "");
    } else {
      gombok = `<button class="btn sm ghost" data-progedit="${p.id}">Szerkesztés</button>` +
               `<button class="btn sm ghost ${p.foglalas_felfuggesztve ? "szunetel" : ""}" data-progsusp="${p.id}">${p.foglalas_felfuggesztve ? "Foglalás engedélyezése" : "Foglalás felfüggesztése"}</button>` +
               `<button class="btn sm ghost" data-progarch="${p.id}">Archiválás</button>` +
               (foglSzam === 0 ? `<button class="btn sm ghost" data-progdel="${p.id}">Törlés</button>` : "");
    }

    return `<article class="prog-kartya${szunetel ? " szunetel" : ""}" data-id="${p.id}">
      ${szunetJel}${szunetMegj}
      <div class="fej"><span class="fej-cim">${fogo}<h4>${escapeHtml(p.cim)}</h4></span>${badge}</div>
      ${eloadoSor}
      <p class="leiras">${tisztitHtml(p.rovid_leiras || p.leiras || "")}</p>
      ${idoSorok}
      <div class="gombok">${gombok}</div>
    </article>`;
  }).join("") + `</div>`;

  cel.querySelectorAll("[data-progedit]").forEach(b => b.addEventListener("click", () => nyitProgram(b.dataset.progedit)));
  cel.querySelectorAll("[data-progdel]").forEach(b => b.addEventListener("click", () => torolProgram(b.dataset.progdel)));
  cel.querySelectorAll("[data-progarch]").forEach(b => b.addEventListener("click", () => archivalProgram(b.dataset.progarch)));
  cel.querySelectorAll("[data-progrestore]").forEach(b => b.addEventListener("click", () => visszaallitProgram(b.dataset.progrestore)));
  cel.querySelectorAll("[data-progsusp]").forEach(b => b.addEventListener("click", () => valtSzunet(b.dataset.progsusp)));

  // Húzással átrendezhető (csak az Aktuális nézetben) — a főoldal ezt a sorrendet követi
  if(!progArchivNezet){
    sortableSorrend(cel.querySelector(".prog-lista"), "workshops", document.getElementById("progSorrendMentve"));
  }
}

// Al-fül váltás (Aktuális / Archivált) — a Programok fül al-fülei
document.querySelectorAll('.prog-fejlec .altab').forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll('.prog-fejlec .altab').forEach(x => x.classList.toggle("active", x === t));
  progArchivNezet = (t.dataset.altab === "archivalt");
  betoltProgramLista();
}));

// ===================== FOGLALÁS-SZÜNET (globális + program-szintű) =====================
function frissitGlobalSzunetGomb(){
  const btn = document.getElementById("globalSzunetBtn");
  if(!btn) return;
  btn.textContent = globalisSzunet ? "Minden foglalás feloldása" : "Minden foglalás felfüggesztése";
  btn.classList.toggle("aktiv-szunet", globalisSzunet);
}
document.getElementById("globalSzunetBtn").addEventListener("click", async () => {
  const uj = !globalisSzunet;
  const ok = await dialog.megerosit(
    uj ? "Felfüggeszted MINDEN program foglalását? A látogatók addig nem tudnak foglalni — a főoldalon „Foglalás átmenetileg felfüggesztve” jelenik meg minden programnál."
       : "Feloldod a szünetet? MINDEN program foglalása újra elérhető lesz — a kézzel, egyenként felfüggesztett programoké is.",
    { cim: uj ? "Minden foglalás felfüggesztése" : "Minden foglalás feloldása",
      okCimke: uj ? "Igen, felfüggesztem" : "Igen, mindent feloldok", veszelyes: uj });
  if(!ok) return;
  const { error } = await db.from("settings").update({ foglalas_szunet: uj, updated_at: new Date().toISOString() }).eq("id", 1);
  if(error) return dialog.uzen("Hiba: " + error.message, { cim:"Hiba" });
  if(!uj){
    // Feloldáskor a program-szintű szüneteket is feloldjuk → tényleg minden foglalható lesz.
    const { error: e2 } = await db.from("workshops").update({ foglalas_felfuggesztve: false }).eq("foglalas_felfuggesztve", true);
    if(e2) return dialog.uzen("A program-szintű szünetek feloldása nem sikerült: " + e2.message, { cim:"Hiba" });
  }
  globalisSzunet = uj;
  frissitGlobalSzunetGomb();
  betoltProgramLista();
});

// Egy program foglalásának átmeneti felfüggesztése / engedélyezése
async function valtSzunet(id){
  const p = progLista.find(x => x.id === id);
  const uj = !p?.foglalas_felfuggesztve;
  const { error } = await db.from("workshops").update({ foglalas_felfuggesztve: uj }).eq("id", id);
  if(error) return dialog.uzen("Hiba: " + error.message, { cim:"Hiba" });
  betoltProgramLista();
}

// Szerkesztő megnyitása (id nélkül = új)
function nyitProgram(id){
  progForm.reset(); pErr.hidden = true;
  torlesLezarttal = new Set();
  edRovid.innerHTML = ""; edReszletes.innerHTML = "";
  document.getElementById("pFotoElonezet").hidden = true;
  const p = id ? progLista.find(x => x.id === id) : null;
  document.getElementById("pTitle").textContent = p ? "Program szerkesztése" : "Új program";
  progForm.dataset.id   = p ? p.id : "";
  progForm.dataset.foto = p?.foto_url || "";
  if(p){
    progForm.statusz.value           = p.statusz;
    progForm.cim.value               = p.cim;
    edRovid.innerHTML     = tisztitHtml(p.rovid_leiras || "");
    edReszletes.innerHTML = tisztitHtml(p.leiras || "");
    progForm.eloado.value            = p.eloado ?? "";
    progForm.varhato_idotartam.value = p.varhato_idotartam ?? "";
    renderIdopontSorok(p.idopontok);
    if(p.foto_url){
      document.getElementById("pFotoImg").src = p.foto_url;
      document.getElementById("pFotoElonezet").hidden = false;
    }
  } else {
    progForm.statusz.value = "aktiv";
    renderIdopontSorok([{}]);   // egy üres időpont-sor
  }
  // Élő foglalással rendelkező programnál a „Hamarosan” nem választható (nincs időpont/foglalás).
  const hamOpt = pStatusz.querySelector('option[value="hamarosan"]');
  if(hamOpt) hamOpt.disabled = (id ? (progElofoglalasSzam.get(id) || 0) : 0) > 0;
  frissitIdopontokLathatosag();
  progModal.hidden = false;
  progForm.cim.focus();
}

document.getElementById("ujProgramBtn").addEventListener("click", () => nyitProgram(null));

document.getElementById("pFoto").addEventListener("change", e => {
  const f = e.target.files[0];
  if(f){
    document.getElementById("pFotoImg").src = URL.createObjectURL(f);
    document.getElementById("pFotoElonezet").hidden = false;
  }
});

async function feltoltKep(file){
  const kiterj = (file.name.split(".").pop() || "jpg").toLowerCase();
  const nev = `${Date.now()}-${Math.random().toString(36).slice(2)}.${kiterj}`;
  const { error } = await db.storage.from("program-fotok").upload(nev, file, { cacheControl:"3600", upsert:false });
  if(error) throw error;
  return db.storage.from("program-fotok").getPublicUrl(nev).data.publicUrl;
}

// Az űrlap időpont-sorainak összegyűjtése + validálása
function gyujtIdopontok(){
  const sorok = [...idopontLista.querySelectorAll(".idopont-sor")];
  const out = [];
  for(const sor of sorok){
    const datum = sor.querySelector(".ido-datum").value;
    const arv   = sor.querySelector(".ido-ar").value;
    const kedvv = sor.querySelector(".ido-kedv").value;
    const maxv  = sor.querySelector(".ido-max").value;
    const minv  = sor.querySelector(".ido-min").value;
    const maxfoglv = sor.querySelector(".ido-maxfogl").value;
    const stEl  = sor.querySelector(".ido-statusz");
    const st    = stEl ? stEl.value : "aktiv";     // új sornál nincs választó → mindig aktív
    const idId  = sor.dataset.id || null;
    if(!idId && !datum && !arv && !maxv) continue;   // teljesen üres új sor → kihagyjuk
    if(!datum) return { hiba:"Minden időpontnál kötelező a dátum." };
    const ar = arv ? parseInt(arv, 10) : null;
    const max_letszam = maxv ? parseInt(maxv, 10) : null;
    const kedvezmenyes_ar = kedvv ? parseInt(kedvv, 10) : null;
    const min_letszam = minv ? parseInt(minv, 10) : null;
    const max_foglalasok = maxfoglv ? parseInt(maxfoglv, 10) : null;
    if(ar == null)          return { hiba:"Minden időpontnál kötelező az ár." };
    if(!(max_letszam >= 1)) return { hiba:"Minden időpontnál kötelező a max létszám (min. 1)." };
    // Csoportos korlátok validálása (a butaságot tiltjuk):
    if(min_letszam != null && min_letszam < 1)        return { hiba:"A min. fő/foglalás legalább 1 legyen (vagy hagyd üresen)." };
    if(max_foglalasok != null && max_foglalasok < 1)  return { hiba:"A max. foglalás legalább 1 legyen (vagy hagyd üresen)." };
    if(min_letszam != null && min_letszam > max_letszam)
      return { hiba:`A min. fő/foglalás (${min_letszam}) nem lehet nagyobb a max. létszámnál (${max_letszam}).` };
    // Meglévő időpontnál a max. létszám nem lehet kevesebb a már befoglalt főnél.
    if(idId){
      const foglalt = idopontFoglaltFo.get(idId) || 0;
      if(max_letszam < foglalt){
        if(sor.dataset.eredetiMax) sor.querySelector(".ido-max").value = sor.dataset.eredetiMax;
        return { hiba:`Egy időpontnál a max. létszám (${max_letszam}) kevesebb, mint az oda befoglalt ${foglalt} fő — visszaállítottam az eredeti értékre.` };
      }
    }
    if(kedvezmenyes_ar != null && kedvezmenyes_ar >= ar)
      return { hiba:"A kedvezményes ár legyen kisebb az alap árnál." };
    out.push({ id:idId, idopont:new Date(datum).toISOString(), ar, kedvezmenyes_ar, max_letszam, min_letszam, max_foglalasok, statusz:st });
  }
  return { idopontok: out };
}

progForm.addEventListener("submit", async e => {
  e.preventDefault();
  pErr.hidden = true;
  const id       = progForm.dataset.id;
  const statusz  = progForm.statusz.value;
  const cim      = progForm.cim.value.trim();
  const rovid_leiras = edRovid.textContent.trim() ? tisztitHtml(edRovid.innerHTML) : "";
  const leiras       = edReszletes.textContent.trim() ? tisztitHtml(edReszletes.innerHTML) : null;
  const eloado   = progForm.eloado.value.trim() || null;
  const varhato_idotartam = progForm.varhato_idotartam.value.trim() || null;

  if(!cim)          return pHiba("A cím kötelező.");
  if(!rovid_leiras) return pHiba("A rövid leírás kötelező.");
  // Élő foglalással rendelkező program nem állítható „Hamarosan”-ra.
  if(id && statusz === "hamarosan" && (progElofoglalasSzam.get(id) || 0) > 0){
    return pHiba("Ennek a programnak élő (jóváhagyásra váró vagy jóváhagyott) foglalása van, ezért nem állítható „Hamarosan” állapotba. Előbb kezeld a foglalásokat (mondd le, vagy állítsd az érintett időpontot „Elmarad”-ra).");
  }

  // --- Időpontok begyűjtése + döntések MÉG mentés előtt (nincs félbe-mentés, nincs dupla kérdés) ---
  let idopontok = [];
  let torlendo = [];              // kivett (✕-elt) meglévő időpontok id-i
  let ujElmaradt = [];            // most 'aktiv' → 'elmaradt'-ra váltott meglévő időpontok id-i
  let elmaradErintett = [];       // az elmaradó időpontok élő foglalásainak id-i
  let elmaradDontes = null;       // 'lemond' | 'ertesit' — a mentés után alkalmazzuk

  if(statusz === "aktiv"){
    const gy = gyujtIdopontok();
    if(gy.hiba) return pHiba(gy.hiba);
    idopontok = gy.idopontok;

    const eredetiIdk  = (id ? (progLista.find(x => x.id === id)?.idopontok || []) : []).map(i => i.id);
    const eredetiById = new Map((id ? (progLista.find(x => x.id === id)?.idopontok || []) : []).map(i => [i.id, i]));
    const megtartott  = idopontok.filter(i => i.id).map(i => i.id);
    torlendo   = eredetiIdk.filter(x => !megtartott.includes(x));
    ujElmaradt = idopontok
      .filter(i => i.id && i.statusz === "elmaradt" && eredetiById.get(i.id)?.statusz !== "elmaradt")
      .map(i => i.id);

    // (a) Kivett időpont foglalással → nem törölhető, jól látható üzenet, abort (nincs félbe-mentés)
    if(torlendo.length){
      const { data: fogl } = await db.from("bookings").select("id")
        .in("idopont_id", torlendo).in("statusz", ["jovahagyasra_var","jovahagyott"]).limit(1);
      if(fogl && fogl.length){
        await dialog.uzen(
          "Egy törlésre jelölt (✕) időponthoz ÉLŐ foglalás tartozik, ezért nem törölhető — a mentést nem hajtottam végre.\n\nHa az alkalom elmarad, NE töröld: állítsd az állapotát „Elmarad”-ra.",
          { cim: "Az időpont nem törölhető" });
        return;
      }
    }

    // (b) Most elmaradóra állított időpont(ok) élő foglalásai → EGYETLEN egyértelmű döntés.
    //     Ha elmarad az alkalom, a rajta lévő foglalások nem maradhatnak — lemondjuk őket.
    if(ujElmaradt.length){
      const { data: erintett } = await db.from("bookings")
        .select("id").in("idopont_id", ujElmaradt).in("statusz", ["jovahagyasra_var","jovahagyott"]);
      elmaradErintett = (erintett || []).map(b => b.id);
      if(elmaradErintett.length){
        const valasz = await dialog.valaszt(
          `Elmarad ${ujElmaradt.length} időpont, amelyen összesen ${elmaradErintett.length} élő foglalás van. Elmaradáskor ezeket a foglalásokat lemondjuk. Hogyan folytassuk?`,
          [
            { cimke:"Mégse (ne legyen elmaradt)",    ertek:"megse",   stilus:"ghost" },
            { cimke:"Lemondás, e-mail értesítő nélkül",     ertek:"lemond",  stilus:"ghost" },
            { cimke:"Lemondás + elmaradás e-mail értesítő", ertek:"ertesit", stilus:"danger" },
          ], { cim:"Elmaradó időpont" });
        if(valasz === "megse" || valasz === false){
          // Mégsem legyen elmaradt → az érintett időpont-sorok visszaállnak „Aktív”-ra, és nem mentünk.
          ujElmaradt.forEach(idId => {
            const s   = idopontLista.querySelector(`.idopont-sor[data-id="${idId}"]`);
            const sel = s?.querySelector(".ido-statusz");
            if(sel) sel.value = "aktiv";
            s?.classList.remove("elmaradt");
          });
          return;
        }
        elmaradDontes = valasz;   // 'lemond' | 'ertesit'
      }
    }
  }

  // (Nincs általános „biztosan mented?" figyelmeztetés: a valóban fontos eseteknek saját,
  //  egyértelmű ablakuk van — időpont „Elmarad” (lemondás/e-mail), foglalt időpont ✕ tiltása.)

  const gomb = progForm.querySelector('button[type="submit"]');
  gomb.disabled = true;

  let foto_url = progForm.dataset.foto || null;
  const file = document.getElementById("pFoto").files[0];
  if(file){
    try { foto_url = await feltoltKep(file); }
    catch(err){ gomb.disabled = false; return pHiba("A kép feltöltése nem sikerült: " + err.message); }
  }

  // 1) Program (workshop) mentése
  const sor = { statusz, cim, rovid_leiras, leiras, eloado, varhato_idotartam, foto_url };
  let workshopId = id;
  if(id){
    const { error } = await db.from("workshops").update(sor).eq("id", id);
    if(error){ gomb.disabled = false; return pHiba("Mentési hiba: " + error.message); }
  } else {
    // Új program a lista VÉGÉRE kerül (sorrend = jelenlegi elemszám); utána húzással átrendezhető.
    const { data, error } = await db.from("workshops").insert({ ...sor, sorrend: progLista.length }).select("id").single();
    if(error){ gomb.disabled = false; return pHiba("Mentési hiba: " + error.message); }
    workshopId = data.id;
  }

  // 2) Időpontok szinkronizálása — CSAK aktív programnál. A „Hamarosan” nem tart időpontot;
  //    ilyenkor a meglévő időpontokat NEM bántjuk (nem töröljük), csak elrejtődnek a főoldalon.
  if(statusz === "aktiv"){
    for(const i of idopontok){
      const rec = { workshop_id:workshopId, idopont:i.idopont, ar:i.ar,
        kedvezmenyes_ar:i.kedvezmenyes_ar, max_letszam:i.max_letszam,
        min_letszam:i.min_letszam, max_foglalasok:i.max_foglalasok, statusz:i.statusz };
      const { error } = i.id
        ? await db.from("idopontok").update(rec).eq("id", i.id)
        : await db.from("idopontok").insert(rec);
      if(error){ gomb.disabled = false; return pHiba("Időpont mentési hiba: " + error.message); }
    }
    for(const delId of torlendo){
      if(torlesLezarttal.has(delId)){
        // Előbb a lezárt (lemondott/elutasított) foglalások törlése, hogy az FK ne blokkoljon.
        const { error: bde } = await db.from("bookings").delete()
          .eq("idopont_id", delId).in("statusz", ["lemondott","elutasitott"]);
        if(bde){ gomb.disabled = false; return pHiba("A lezárt foglalások törlése nem sikerült: " + bde.message); }
      }
      const { error } = await db.from("idopontok").delete().eq("id", delId);
      if(error){ gomb.disabled = false;
        return pHiba("Egy időpont nem törölhető, mert (időközben) élő foglalás tartozik hozzá. Állítsd inkább „Elmarad” állapotra."); }
    }

    // 3) Elmaradó időpontok foglalásainak lemondása (+ értesítő) — a fenti döntés szerint
    if(elmaradDontes && elmaradErintett.length){
      const { error: be } = await db.from("bookings")
        .update({ statusz:"lemondott" })
        .in("idopont_id", ujElmaradt).in("statusz", ["jovahagyasra_var","jovahagyott"]);
      if(be){ gomb.disabled = false; return pHiba("A foglalások lemondása nem sikerült: " + be.message); }

      if(elmaradDontes === "ertesit"){
        let ok = 0, hiba = 0;
        for(const bid of elmaradErintett){
          const { data, error } = await db.functions.invoke("send-email", { body:{ booking_id: bid, tipus:"program_elmarad" } });
          if(error || (data && data.ok === false)) hiba++; else ok++;
        }
        await dialog.uzen(
          `A(z) ${elmaradErintett.length} foglalás lemondva.\n\nElmaradás-értesítő kiküldve: ${ok} db${hiba ? `, sikertelen: ${hiba} db` : ""}.`,
          { cim:"Kész" });
      }
    }
  }

  gomb.disabled = false;
  progModal.hidden = true;
  betoltProgramLista();
});

async function torolProgram(id){
  const p = progLista.find(x => x.id === id);
  const ok = await dialog.megerosit(`Biztosan véglegesen törlöd a(z) „${p?.cim ?? ""}" programot (minden időpontjával együtt)?`,
    { cim:"Program törlése", okCimke:"Törlés", veszelyes:true });
  if(!ok) return;
  const { error } = await db.from("workshops").delete().eq("id", id);
  if(error) return dialog.uzen("Törlési hiba: " + error.message, { cim:"Hiba" });
  betoltProgramLista();
}

// Archiválás — a program lekerül a főoldalról; a foglalások megmaradnak.
async function archivalProgram(id){
  const p = progLista.find(x => x.id === id);
  const elo = progElofoglalasSzam.get(id) || 0;
  const uzenet = elo > 0
    ? `Archiválod a(z) „${p?.cim ?? ""}" programot? Lekerül a főoldalról. A(z) ${elo} élő foglalás megmarad — ha le akarod mondani őket, azt a Foglalások fülön tedd, vagy állítsd az érintett időpontokat „Elmarad” állapotra a szerkesztőben.`
    : `Archiválod a(z) „${p?.cim ?? ""}" programot? Lekerül a főoldalról, a foglalások megmaradnak.`;
  const ok = await dialog.megerosit(uzenet, { cim:"Archiválás", okCimke:"Archiválás" });
  if(!ok) return;
  const { error } = await db.from("workshops").update({ archivalt:true }).eq("id", id);
  if(error) return dialog.uzen("Archiválási hiba: " + error.message, { cim:"Hiba" });
  betoltProgramLista();
}

// Visszaállítás archiváltból → Aktív vagy Hamarosan
async function visszaallitProgram(id){
  const cel = await dialog.valaszt("Milyen állapotban állítsuk vissza?",
    [
      { cimke:"Mégse",     ertek:"megse",     stilus:"ghost" },
      { cimke:"Hamarosan", ertek:"hamarosan", stilus:"ghost" },
      { cimke:"Aktív",     ertek:"aktiv",     stilus:"primary" },
    ], { cim:"Visszaállítás" });
  if(cel === "megse" || cel === false) return;

  const { error } = await db.from("workshops").update({ archivalt:false, statusz:cel }).eq("id", id);
  if(error) return dialog.uzen("Hiba: " + error.message, { cim:"Hiba" });
  betoltProgramLista();
}

document.getElementById("pClose").addEventListener("click", zarProgModal);
document.getElementById("pMegse").addEventListener("click", zarProgModal);
