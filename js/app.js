// =====================================================================
//  Kemence Akadémia — publikus oldal logikája
//  1) Programok betöltése a "programok" nézetből, kirajzolás.
//  2) Foglalási ablak: validáció + foglalás írása a "bookings" táblába.
// =====================================================================

// Kapcsolat a Supabase-hez (a config.js adataival)
const db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// Segédek
const HUF = n => Number(n).toLocaleString("hu-HU") + " Ft";
function formatDatum(iso){
  if(!iso) return null;
  return new Date(iso).toLocaleString("hu-HU",
    { year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit" });
}
// Lezárult-e a program? A NAP számít: a mai nap még foglalható, a korábbiak nem.
function lezarultNap(iso){
  if(!iso) return false;
  const d = new Date(iso), most = new Date();
  const esemenyNap = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const maNap      = new Date(most.getFullYear(), most.getMonth(), most.getDate());
  return esemenyNap < maNap;
}

// A betöltött programok (id → adatok), hogy a foglaláskor elérjük őket
let programLista = [];

// -------------------- Beállítások (settings) --------------------
// Az info-sáv szövege az adatbázisból jön; az admin szerkesztheti.
// (Sima szövegként jelenítjük meg — textContent — a biztonság miatt.)
async function betoltBeallitasok(){
  const { data } = await db.from("settings")
    .select("foglalas_infosav").eq("id", 1).maybeSingle();
  if(data && data.foglalas_infosav){
    const el = document.getElementById("mInfosav");
    if(el) el.textContent = data.foglalas_infosav;
  }
}

// Biztonsági HTML-tisztító: csak félkövér/dőlt/aláhúzás/felsorolás/sortörés maradhat (a leírás rich text)
function tisztitHtml(html){
  const OK = { B:1, STRONG:1, I:1, EM:1, U:1, UL:1, OL:1, LI:1, BR:1, P:1, DIV:1, BLOCKQUOTE:1, FONT:1 };
  const tpl = document.createElement("template");
  tpl.innerHTML = html || "";
  (function walk(parent){
    Array.from(parent.childNodes).forEach(n => {
      if(n.nodeType === 1){
        if(OK[n.tagName]){
          const keepSize = (n.tagName === "FONT") ? n.getAttribute("size") : null;
          while(n.attributes.length) n.removeAttribute(n.attributes[0].name);
          if(keepSize && /^[1-7]$/.test(keepSize)) n.setAttribute("size", keepSize);
          walk(n);
        }
        else { walk(n); while(n.firstChild) parent.insertBefore(n.firstChild, n); parent.removeChild(n); }
      } else if(n.nodeType === 8){ parent.removeChild(n); }
    });
  })(tpl.content);
  return tpl.innerHTML.trim();
}

// -------------------- Kártya HTML --------------------
function kartya(p){
  const kep = p.foto_url ? `<img class="card-kep" src="${p.foto_url}" alt="" loading="lazy">` : "";
  const rovid = tisztitHtml(p.rovid_leiras || p.leiras || "");
  const reszlet = p.leiras ? `<button class="reszlet-btn" data-reszlet="${p.id}">Részletek →</button>` : "";

  if(p.statusz === "hamarosan"){
    return `<article class="card">
      ${kep}
      <div class="card-top"><h3>${p.cim}</h3><span class="badge soon">Hamarosan</span></div>
      <p class="desc">${rovid}</p>
      ${reszlet}
    </article>`;
  }
  const ar = p.kedvezmenyes_ar
    ? `<span class="old">${HUF(p.ar)}</span><span class="sale">${HUF(p.kedvezmenyes_ar)}</span>`
    : `${HUF(p.ar)}`;
  const lezarult = lezarultNap(p.idopont);
  const betelt   = p.szabad_helyek <= 0;
  const foglalhato = !lezarult && !betelt;
  const seats = lezarult
    ? `<div class="seats full">Lezárult</div>`
    : betelt
    ? `<div class="seats full">Betelt</div>`
    : `<div class="seats free">${p.szabad_helyek} szabad hely / ${p.max_letszam}</div>`;
  const gombFelirat = lezarult ? "Lezárult" : betelt ? "Betelt" : "Foglalás →";
  const datum = formatDatum(p.idopont);

  return `<article class="card">
    ${kep}
    <div class="card-top"><h3>${p.cim}</h3></div>
    <p class="desc">${rovid}</p>
    ${reszlet}
    ${datum ? `<div class="meta"><b>${datum}</b>${p.varhato_idotartam ? " · "+p.varhato_idotartam : ""}</div>` : ""}
    ${seats}
    <div class="card-foot">
      <div class="price">${ar}</div>
      <button class="btn" data-id="${p.id}" ${foglalhato ? "" : "disabled"}>${gombFelirat}</button>
    </div>
  </article>`;
}

// -------------------- Programok betöltése --------------------
async function betoltProgramok(){
  const cel = document.getElementById("programok");
  const { data, error } = await db
    .from("programok").select("*")
    .eq("archivalt", false)
    .order("idopont", { ascending: true, nullsFirst: false });

  if(error){ cel.innerHTML = `<p class="status">Hiba a betöltéskor: ${error.message}</p>`; console.error(error); return; }
  if(!data || data.length === 0){ cel.innerHTML = `<p class="status">Még nincs meghirdetett program.</p>`; return; }

  programLista = data;
  cel.innerHTML = data.map(kartya).join("");
  cel.querySelectorAll(".btn[data-id]").forEach(b =>
    b.addEventListener("click", () => nyitFoglalas(b.dataset.id)));
  cel.querySelectorAll(".reszlet-btn").forEach(b =>
    b.addEventListener("click", () => mutatReszletek(b.dataset.reszlet)));
}

// -------------------- Részletek ablak --------------------
const reszletModal = document.getElementById("reszletModal");
function mutatReszletek(id){
  const p = programLista.find(x => x.id === id);
  if(!p) return;
  document.getElementById("rTitle").textContent = p.cim;
  document.getElementById("rLeiras").innerHTML = tisztitHtml(p.leiras || "");
  reszletModal.hidden = false;
}
document.getElementById("rClose").addEventListener("click", () => { reszletModal.hidden = true; });
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && !reszletModal.hidden) reszletModal.hidden = true; });

// ===================== Foglalási ablak =====================
const modal   = document.getElementById("foglalasModal");
const formEl  = document.getElementById("foglalasForm");
const errEl   = document.getElementById("mErr");
const submitBtn = document.getElementById("mSubmit");
let aktualisProgram = null;

// -------- Validáció --------
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

// Telefon: bármilyen elválasztó megengedett (szóköz, -, /, ., () ).
// Tisztításkor csak a számjegyeket (+ opcionális +) tartjuk meg, és a
// hazai 06.. / 36.. formát +36..-ra normalizáljuk → egységes adat.
function tisztitTelefon(v){
  let s = v.replace(/[^\d+]/g, "");     // csak számjegy és +
  s = s.replace(/(?!^)\+/g, "");        // + csak az elején lehet
  if(s.startsWith("06"))      s = "+36" + s.slice(2);
  else if(s.startsWith("36")) s = "+"  + s;
  return s;
}
const telefonOk = s => /^\+?\d{8,15}$/.test(s);

// Gyakori e-mail domain-elgépelések felismerése (pl. gmail.coom → gmail.com).
const GYAKORI_DOMAINEK = ["gmail.com","googlemail.com","yahoo.com","hotmail.com",
  "outlook.com","icloud.com","freemail.hu","citromail.hu","t-online.hu"];
function tavolsag(a,b){                 // Levenshtein-távolság
  const dp = Array.from({length:a.length+1}, (_,i)=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++) dp[i][0]=i;
  for(let j=0;j<=b.length;j++) dp[0][j]=j;
  for(let i=1;i<=a.length;i++)
    for(let j=1;j<=b.length;j++)
      dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return dp[a.length][b.length];
}
function domainJavaslat(email){         // a legközelebbi gyakori domain, ha közel van
  const d = (email.split("@")[1]||"").toLowerCase();
  if(!d || GYAKORI_DOMAINEK.includes(d)) return null;
  let best=null, bestD=3;
  for(const g of GYAKORI_DOMAINEK){ const t=tavolsag(d,g); if(t>0 && t<bestD){ bestD=t; best=g; } }
  return best;
}
let emailFigyelmeztetve = false;        // hogy a javaslat után másodszorra elmenjen

function nyitFoglalas(id){
  aktualisProgram = programLista.find(p => p.id === id);
  if(!aktualisProgram) return;
  if(lezarultNap(aktualisProgram.idopont)) return;   // lezárult programra nem nyílik foglalás

  document.getElementById("mTitle").textContent = aktualisProgram.cim;
  const datum = formatDatum(aktualisProgram.idopont);
  document.getElementById("mMeta").innerHTML =
    `${datum ? "<b>"+datum+"</b> · " : ""}${aktualisProgram.szabad_helyek} szabad hely`;

  // alaphelyzet
  formEl.reset(); errEl.hidden = true; emailFigyelmeztetve = false;
  formEl.querySelectorAll(".bad").forEach(el => el.classList.remove("bad"));
  document.getElementById("mFormWrap").hidden = false;
  document.getElementById("mSuccess").hidden = true;
  modal.hidden = false;
  formEl.nev.focus();
}

function zarFoglalas(){ modal.hidden = true; aktualisProgram = null; }

function hiba(uzenet, mezo){
  errEl.textContent = uzenet; errEl.hidden = false;
  if(mezo){ mezo.classList.add("bad"); mezo.focus(); }
}

// Beküldés
formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.hidden = true;
  formEl.querySelectorAll(".bad").forEach(el => el.classList.remove("bad"));

  const nev        = formEl.nev.value.trim();
  const email      = formEl.email.value.trim();
  const telefon    = tisztitTelefon(formEl.telefon.value);   // normalizált (+36..)
  const letszam    = parseInt(formEl.letszam.value, 10);
  const megjegyzes = formEl.megjegyzes.value.trim();

  // Ellenőrzések — hibás adattal nem küldhető el
  if(lezarultNap(aktualisProgram.idopont))
    return hiba("Erre a programra már nem lehet foglalni (lezárult). Frissítsd az oldalt.");
  if(!nev)            return hiba("Kérlek add meg a neved.", formEl.nev);
  if(!emailOk(email)) return hiba("Érvényes e-mail címet adj meg.", formEl.email);

  // Elgépelés-figyelmeztetés (nem tiltás): ha közel van egy gyakori domainhez
  const javaslat = domainJavaslat(email);
  if(javaslat && !emailFigyelmeztetve){
    emailFigyelmeztetve = true;
    return hiba(`Biztos jó az e-mail? Talán @${javaslat} akartál. Ha stimmel, nyomd meg mégegyszer a Küldést.`, formEl.email);
  }

  if(!telefonOk(telefon)) return hiba("Érvényes telefonszámot adj meg.", formEl.telefon);
  if(!(letszam >= 1))     return hiba("A létszám legalább 1 fő.", formEl.letszam);
  if(letszam > aktualisProgram.szabad_helyek)
    return hiba(`Csak ${aktualisProgram.szabad_helyek} szabad hely van.`, formEl.letszam);

  submitBtn.disabled = true; submitBtn.textContent = "Küldés…";

  // A statusz alapból "jovahagyasra_var" (az adatbázis állítja be)
  const { error } = await db.from("bookings").insert({
    workshop_id: aktualisProgram.id,
    nev, email, telefon, letszam,
    megjegyzes: megjegyzes || null
  });

  submitBtn.disabled = false; submitBtn.textContent = "Foglalás elküldése";

  if(error){
    // pl. ha közben betelt (a szerveroldali túlfoglalás-védelem jelez)
    const uzenet = /szabad hely/i.test(error.message)
      ? "Sajnos időközben betelt a hely. Frissítsd az oldalt."
      : "Hiba történt a foglaláskor: " + error.message;
    console.error(error);
    return hiba(uzenet);
  }

  // Siker → sikerképernyő + a lista frissítése (szabad helyek)
  document.getElementById("mFormWrap").hidden = true;
  document.getElementById("mSuccess").hidden = false;
  betoltProgramok();
});

// Ha az e-mailt módosítják, a figyelmeztetés nullázódik
formEl.email.addEventListener("input", () => { emailFigyelmeztetve = false; });

// Ablak bezárása
document.getElementById("mClose").addEventListener("click", zarFoglalas);
document.getElementById("mDone").addEventListener("click", zarFoglalas);
// Nincs háttér-kattintás bezárás (szövegkijelöléskor is elsülne). Esc marad.
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && !modal.hidden) zarFoglalas(); });

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

// Indítás
betoltBeallitasok();
betoltProgramok();
latogatasSzamlalo();
