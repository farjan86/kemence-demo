// =====================================================================
//  ELŐADÓINK — a „Rólunk" szakasz névsora és a bemutatkozó ablak
//
//  Két helyen jelennek meg a nevek:
//    1. a Rólunk szakaszban, a szöveg alatt — csak a NEM rejtett előadók;
//    2. a program-kártyákon („Előadó: …"), a nézet `eloadok` mezőjéből.
//
//  Mindkét helyen a névre kattintva ugyanaz az ablak nyílik meg.
//  A REJTETT előadó neve a kártyán megjelenik, de nem kattintható:
//  a rejtés azt jelenti, hogy nem mutatjuk be a főoldalon.
// =====================================================================
let eloadoMap = new Map();        // id → { nev, bemutatkozas, foto_url }

const eloadoModal = document.getElementById("eloadoModal");

// -------------------- Betöltés + a Rólunk névsor --------------------
async function betoltEloadok(){
  const { data, error } = await db.from("eloadok")          // db: app.js
    .select("id, nev, bemutatkozas, foto_url")
    .eq("rejtett", false)
    .order("sorrend", { ascending: true })
    .order("nev", { ascending: true });
  if(error){ console.error(error); return; }

  eloadoMap = new Map((data || []).map(e => [e.id, e]));

  const blokk = document.getElementById("eloadoink");
  const cel   = document.getElementById("eloadoinkNevek");
  if(!blokk || !cel) return;

  // Nincs látható előadó → a blokk meg sem jelenik (üres felirat nélkül)
  if(!data || data.length === 0){ blokk.hidden = true; return; }

  cel.innerHTML = data.map(e => eloadoNevHtml(e.id, e.nev, false)).join(" · ");
  blokk.hidden = false;
  kotEloadoKattintas(cel);
}

// Egy név HTML-je: kattintható gomb, vagy sima szöveg (rejtett előadónál)
function eloadoNevHtml(id, nev, rejtett){
  return rejtett
    ? `<span class="eloado-nev-sima">${escapeHtml(nev)}</span>`
    : `<button type="button" class="eloado-nev-gomb" data-eloado="${id}">${escapeHtml(nev)}</button>`;
}

// -------------------- A program-kártya „Előadó:" sora --------------------
// Az app.js hívja. A felvett előadókból dolgozik (a nézet `eloadok` mezője);
// ha a programhoz nincs hozzárendelve senki, a sor egyszerűen elmarad.
function eloadoSorHtml(p){
  if(!Array.isArray(p.eloadok) || !p.eloadok.length) return "";   // nincs előadó → nincs sor
  const nevek = p.eloadok.map(e => eloadoNevHtml(e.id, e.nev, e.rejtett)).join(", ");
  return `<p class="eloado">Előadó: ${nevek}</p>`;
}

// -------------------- Az ablak --------------------
function kotEloadoKattintas(gyoker){
  gyoker.querySelectorAll("[data-eloado]").forEach(b =>
    b.addEventListener("click", () => nyitEloadoAblak(b.dataset.eloado)));
}

function nyitEloadoAblak(id){
  const e = eloadoMap.get(id);
  if(!e) return;                       // rejtett vagy időközben törölt előadó
  document.getElementById("eloadoNev").textContent = e.nev;

  const kep = document.getElementById("eloadoKep");
  if(e.foto_url){ kep.src = e.foto_url; kep.alt = e.nev; kep.hidden = false; }
  else { kep.removeAttribute("src"); kep.hidden = true; }

  // A bemutatkozás az adminban formázható; a tisztitHtml csak a biztonságos
  // címkéket engedi át (félkövér, dőlt, felsorolás, sortörés).
  document.getElementById("eloadoBemutatkozas").innerHTML =
    e.bemutatkozas ? tisztitHtml(e.bemutatkozas) : "<p class='halvany'>Erről az előadóról még nincs bemutatkozás.</p>";

  eloadoModal.hidden = false;
}

function zarEloadoAblak(){ eloadoModal.hidden = true; }

document.getElementById("eloadoClose")?.addEventListener("click", zarEloadoAblak);
eloadoModal?.addEventListener("click", e => { if(e.target === eloadoModal) zarEloadoAblak(); });
document.addEventListener("keydown", e => {
  if(e.key === "Escape" && eloadoModal && !eloadoModal.hidden) zarEloadoAblak();
});

// A program-kártyákon lévő nevek bekötése — az app.js a kártyák kirajzolása
// után hívja meg (a kártyák többször is újrarajzolódhatnak).
function kotProgramEloadok(){
  document.querySelectorAll(".card [data-eloado]").forEach(b => {
    if(b.dataset.kotve) return;        // ne kössük be kétszer
    b.dataset.kotve = "1";
    b.addEventListener("click", () => nyitEloadoAblak(b.dataset.eloado));
  });
}

betoltEloadok();
