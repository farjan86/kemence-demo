// =====================================================================
//  Kemence Akadémia — EGYEDI PROGRAMOK + AJÁNLATKÉRÉS (publikus)
//  A FOGLALÁSTÓL FÜGGETLEN ág: az egyedi_programok táblát olvassa
//  (időpont nélküli „ötlet"-kártyák), és ajánlatkérést ír az ajanlatok
//  táblába. A közös `db`-t és a util.js segédeit használja (app.js után
//  töltődik). A „Részletek" a meglévő reszletModal-t hasznosítja újra.
// =====================================================================

let egyediLista = [];   // a betöltött egyedi programok

// -------------------- Egy kártya HTML --------------------
function egyediKartya(p){
  const kep     = p.foto_url ? `<img class="card-kep" src="${p.foto_url}" alt="" loading="lazy">` : "";
  const rovid   = tisztitHtml(p.rovid_leiras || p.leiras || "");
  const reszlet = p.leiras ? `<button class="reszlet-btn" data-ep-reszlet="${p.id}">Részletek →</button>` : "";
  return `<article class="card ep-card">
    ${kep}
    <div class="card-top"><h3>${escapeHtml(p.cim)}</h3></div>
    <p class="desc">${rovid}</p>
    ${reszlet}
    <button class="btn ep-cta" type="button" data-ep-ajanlat="${p.id}">Kérjen egyedi ajánlatot</button>
  </article>`;
}

// -------------------- Betöltés + kirajzolás --------------------
async function betoltEgyediProgramok(){
  const cel = document.getElementById("egyedi-programok-lista");
  if(!cel) return;
  const { data, error } = await db
    .from("egyedi_programok").select("*")
    .eq("archivalt", false)
    .order("sorrend", { ascending: true })
    .order("cim", { ascending: true });

  if(error){ cel.innerHTML = `<p class="status">Hiba a betöltéskor: ${error.message}</p>`; console.error(error); return; }

  // Ha nincs felvéve egyetlen egyedi program sem, a teljes szekciót elrejtjük.
  if(!data || data.length === 0){
    const szekcio = document.getElementById("egyedi-programok");
    if(szekcio) szekcio.hidden = true;
    return;
  }

  egyediLista = data;
  cel.innerHTML = data.map(egyediKartya).join("");
  cel.querySelectorAll("[data-ep-ajanlat]").forEach(b =>
    b.addEventListener("click", () => nyitAjanlat(b.dataset.epAjanlat)));
  cel.querySelectorAll("[data-ep-reszlet]").forEach(b =>
    b.addEventListener("click", () => mutatEgyediReszletek(b.dataset.epReszlet)));
}

// -------------------- Részletek (a meglévő reszletModal újrahasznosítása) --------------------
function mutatEgyediReszletek(id){
  const p = egyediLista.find(x => x.id === id);
  if(!p) return;
  document.getElementById("rTitle").textContent = p.cim;
  document.getElementById("rLeiras").innerHTML = tisztitHtml(p.leiras || "");
  document.getElementById("reszletModal").hidden = false;
}

// -------------------- Ajánlatkérő ablak --------------------
const aModal  = document.getElementById("ajanlatModal");
const aForm   = document.getElementById("ajanlatForm");
const aErr    = document.getElementById("aErr");
const aSubmit = document.getElementById("aSubmit");

let aAktualisProgram   = null;    // melyik egyedi programra kér ajánlatot
let aEmailFigyelmeztetve = false; // domain-javaslat után másodszorra megy el

function nyitAjanlat(id){
  aAktualisProgram = egyediLista.find(x => x.id === id) || null;
  document.getElementById("aTitle").textContent =
    aAktualisProgram ? aAktualisProgram.cim : "Egyedi ajánlatkérés";

  aForm.reset(); aErr.hidden = true; aEmailFigyelmeztetve = false;
  aForm.querySelectorAll(".bad").forEach(el => el.classList.remove("bad"));
  document.getElementById("aFormWrap").hidden = false;
  document.getElementById("aSuccess").hidden = true;
  aModal.hidden = false;
  aForm.nev.focus();
}

function zarAjanlat(){ aModal.hidden = true; aAktualisProgram = null; }

function aHiba(uzenet, mezo){
  aErr.textContent = uzenet; aErr.hidden = false;
  if(mezo){ mezo.classList.add("bad"); mezo.focus(); }
}

// -------------------- Beküldés --------------------
aForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  aErr.hidden = true;
  aForm.querySelectorAll(".bad").forEach(el => el.classList.remove("bad"));

  const nev       = aForm.nev.value.trim();
  const email     = aForm.email.value.trim();
  const telefon   = tisztitTelefon(aForm.telefon.value);         // normalizált (+36..)
  const letszam   = parseInt(aForm.letszam.value, 10);
  const kivantRaw = aForm.kivant_idopont.value;
  const kivant    = kivantRaw ? new Date(kivantRaw).toISOString() : null;  // helyi idő → UTC
  const keres     = aForm.keres_szoveg.value.trim();

  // Minden mező KÖTELEZŐ ezen a formon (név + e-mail + telefon + létszám + időpont + üzenet).
  if(!nev)            return aHiba("Kérlek add meg a neved.", aForm.nev);
  if(!emailOk(email)) return aHiba("Érvényes e-mail címet adj meg.", aForm.email);

  // Elgépelés-figyelmeztetés (nem tiltás)
  const javaslat = domainJavaslat(email);
  if(javaslat && !aEmailFigyelmeztetve){
    aEmailFigyelmeztetve = true;
    return aHiba(`Biztos jó az e-mail? Talán @${javaslat} akartál. Ha stimmel, nyomd meg mégegyszer a Küldést.`, aForm.email);
  }

  if(!telefonOk(telefon)) return aHiba("Érvényes telefonszámot adj meg.", aForm.telefon);
  if(!(letszam >= 1))     return aHiba("Kérlek add meg a létszámot (legalább 1 fő).", aForm.letszam);
  if(!kivantRaw)          return aHiba("Kérlek add meg a kívánt időpontot.", aForm.kivant_idopont);
  if(!keres)              return aHiba("Kérlek írd le pár mondatban, mit szeretnél.", aForm.keres_szoveg);

  aSubmit.disabled = true; aSubmit.textContent = "Küldés…";

  // A statusz alapból "ajanlatra_var" (az adatbázis állítja be)
  const { error } = await db.from("ajanlatok").insert({          // db: app.js
    egyedi_program_id: aAktualisProgram ? aAktualisProgram.id : null,
    nev, email, telefon,
    letszam,
    kivant_idopont: kivant,
    keres_szoveg: keres || null
  });

  aSubmit.disabled = false; aSubmit.textContent = "Ajánlatkérés elküldése";

  if(error){
    console.error(error);
    return aHiba("Hiba történt a beküldéskor: " + error.message);
  }

  // Siker → sikerképernyő
  document.getElementById("aFormWrap").hidden = true;
  document.getElementById("aSuccess").hidden = false;
});

// Ha az e-mailt módosítják, a figyelmeztetés nullázódik
aForm.email.addEventListener("input", () => { aEmailFigyelmeztetve = false; });

// Ablak bezárása (Esc + gombok). Háttér-kattintás itt sincs (mint a foglalásnál).
document.getElementById("aClose").addEventListener("click", zarAjanlat);
document.getElementById("aDone").addEventListener("click", zarAjanlat);
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && !aModal.hidden) zarAjanlat(); });

// -------------------- Indítás --------------------
betoltEgyediProgramok();
