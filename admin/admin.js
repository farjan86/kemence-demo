// =====================================================================
//  Kemence Akadémia — ADMIN logika
//  Belépés (Supabase Auth) + foglalások listája + státuszkezelés.
// =====================================================================
const db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const loginView = document.getElementById("loginView");
const adminView = document.getElementById("adminView");
const loginForm = document.getElementById("loginForm");
const loginErr  = document.getElementById("loginErr");

// -------------------- Segédek --------------------
function formatDatum(iso){
  if(!iso) return "—";
  return new Date(iso).toLocaleString("hu-HU",
    { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}
const HUF = n => Number(n).toLocaleString("hu-HU") + " Ft";
// Időállapot a program időpontja alapján (közeledő / ma / múltbéli)
function masodlagos(iso){
  if(!iso) return null;
  const most = new Date(), d = new Date(iso);
  if(most.toDateString() === d.toDateString()) return { kulcs:"ma",       szoveg:"Ma" };
  return d > most ? { kulcs:"kozeledo", szoveg:"Jövőbeli" } : { kulcs:"multbeli", szoveg:"Múltbéli" };
}
// Státusz megjelenítés (szöveg + szín-osztály)
const STAT = {
  jovahagyasra_var: { szoveg:"Jóváhagyásra vár", cls:"o" },
  jovahagyott:      { szoveg:"Jóváhagyott",      cls:"g" },
  elutasitott:      { szoveg:"Elutasított",      cls:"r" },
  lemondott:        { szoveg:"Lemondott",        cls:"x" },
};
// Milyen műveletek lehetségesek egy adott státuszból
function muveletek(statusz){
  switch(statusz){
    case "jovahagyasra_var": return [
      { cimke:"Jóváhagyás", uj:"jovahagyott", stilus:"" },
      { cimke:"Elutasítás", uj:"elutasitott", stilus:"ghost" },
      { cimke:"Vendég lemondta",   uj:"lemondott",   stilus:"ghost" } ];
    case "jovahagyott": return [
      { cimke:"Vendég lemondta",               uj:"lemondott",        stilus:"ghost" },
      { cimke:"Jóváhagyás visszavonása", uj:"jovahagyasra_var", stilus:"ghost" } ];
    default: return []; // elutasitott / lemondott — lezárt állapot, nincs művelet
  }
}

// Azonosító-formátum (a settingsből): elotag + (belső sorszám + kezdő - 1)
let beall = { azonosito_elotag: "F-", azonosito_kezdo: 100 };
function azon(azonosito){
  return beall.azonosito_elotag + (Number(azonosito) + Number(beall.azonosito_kezdo) - 1);
}

// Kiküldött e-mailek naplója (booking_id → [{tipus, elkuldve}])
let emailLogMap = new Map();
const EMAIL_CIMKE = {
  visszaigazolas:  "Visszaigazolás (foglaláskor)",
  csapat_ertesito: "Csapat-értesítő",
  jovahagyas:      "Jóváhagyás",
  elutasitas:      "Elutasítás",
  lemondas:        "Lemondás",
  emlekezteto:     "Emlékeztető",
};

// Validáció a szerkesztőhöz (mint a publikus űrlapon)
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
function tisztitTelefon(v){
  let s = v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if(s.startsWith("06"))      s = "+36" + s.slice(2);
  else if(s.startsWith("36")) s = "+"  + s;
  return s;
}
const telefonOk = s => /^\+?\d{8,15}$/.test(s);

// A programok gyorsítótára a szerkesztő legördülőjéhez
let programok = [];

// -------------------- Bejelentkezés --------------------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginErr.hidden = true;
  const btn = document.getElementById("loginBtn");
  btn.disabled = true; btn.textContent = "Belépés…";

  const { data, error } = await db.auth.signInWithPassword({
    email: loginForm.email.value.trim(),
    password: loginForm.jelszo.value,
  });

  btn.disabled = false; btn.textContent = "Belépés";
  if(error){
    console.error("Belépési hiba:", error);
    let uzenet = error.message || "Sikertelen belépés.";
    if(/not confirmed/i.test(error.message))
      uzenet = "A fiók nincs megerősítve. A Supabase gépházban erősítsd meg a felhasználót (Auto Confirm), vagy kapcsold ki az e-mail-megerősítést.";
    else if(/invalid login/i.test(error.message))
      uzenet = "Hibás e-mail vagy jelszó (vagy nincs ilyen felhasználó).";
    loginErr.textContent = uzenet;
    loginErr.hidden = false;
    return;
  }
  // Sikeres belépés → közvetlenül átváltunk (nem várunk az auth-eseményre)
  frissitNezet(data.session);
});

document.getElementById("logoutBtn").addEventListener("click", () => db.auth.signOut());

// Melyik felületet mutassuk (belépve vs. kilépve)
function frissitNezet(session){
  if(session){
    loginView.hidden = true;
    adminView.hidden = false;
    document.getElementById("whoami").textContent = session.user.email;
    betoltFoglalasok();
  } else {
    adminView.hidden = true;
    loginView.hidden = false;
  }
}
// Auth-állapot változás (kilépés, más fülön belépés stb.)
db.auth.onAuthStateChange((_event, session) => frissitNezet(session));

// -------------------- Foglalások betöltése --------------------
let osszesFoglalas = [];   // az összes foglalás (a szűrés innen dolgozik)
let foglStatuszFul = "jovahagyasra_var";   // az aktív státusz-fül
const URES_UZENET = {
  jovahagyasra_var: "Nincs jóváhagyásra váró foglalás.",
  jovahagyott:      "Nincs jóváhagyott foglalás.",
  elutasitott:      "Nincs elutasított foglalás.",
  lemondott:        "Nincs lemondott foglalás.",
};

async function betoltFoglalasok(){
  const cel = document.getElementById("foglalasok");
  cel.innerHTML = `<p class="status">Betöltés…</p>`;

  // Rendezés: a foglalás ideje (created_at) csökkenő; az id állandó másodkulcs,
  // hogy azonos időbélyegnél se ugráljon a sorrend.
  const { data, error } = await db
    .from("bookings")
    .select("*, workshops ( cim, idopont, archivalt, statusz )")
    .order("created_at", { ascending: false })
    .order("id",         { ascending: false });

  if(error){ cel.innerHTML = `<p class="status">Hiba: ${error.message}</p>`; console.error(error); return; }
  osszesFoglalas = data || [];
  await betoltBeallitasok();
  await betoltEmailLog();
  await betoltProgramok();
  toltProgramSzuro();
  megjelenit();
}

// A programok (workshops) betöltése a szerkesztő legördülőjéhez
async function betoltProgramok(){
  const { data } = await db.from("workshops")
    .select("id, cim, idopont, statusz, archivalt").order("idopont", { ascending: true, nullsFirst: false });
  programok = data || [];
}

// Beállítások (azonosító-formátum) betöltése
async function betoltBeallitasok(){
  const { data } = await db.from("settings")
    .select("azonosito_elotag, azonosito_kezdo").eq("id", 1).maybeSingle();
  if(data){
    beall.azonosito_elotag = data.azonosito_elotag ?? "F-";
    beall.azonosito_kezdo  = data.azonosito_kezdo ?? 100;
  }
}

// Kiküldött e-mailek naplójának betöltése (booking_id → lista)
async function betoltEmailLog(){
  emailLogMap = new Map();
  const { data } = await db.from("email_log")
    .select("booking_id, tipus, elkuldve").order("elkuldve", { ascending: true });
  (data || []).forEach(l => {
    if(!emailLogMap.has(l.booking_id)) emailLogMap.set(l.booking_id, []);
    emailLogMap.get(l.booking_id).push(l);
  });
}

// A program-szűrő feltöltése — CSAK az aktív státusz-fülhöz tartozó
// foglalások programjaiból (így nem jön fel olyan program, amire ezen a
// fülön nincs foglalás). Egy program = cím + időpont.
function toltProgramSzuro(){
  const sel = document.getElementById("fProgram");
  const latott = new Map();
  osszesFoglalas.forEach(b => {
    if(b.statusz !== foglStatuszFul) return;              // csak az aktív fül státusza
    if(b.workshop_id && !latott.has(b.workshop_id))
      latott.set(b.workshop_id, { cim:b.workshops?.cim ?? "—", idopont:b.workshops?.idopont });
  });
  const jelenlegi = sel.value;
  const opciok = [...latott]
    .sort((a, b) => (a[1].idopont || "").localeCompare(b[1].idopont || ""))  // dátum szerint
    .map(([id, p]) => {
      const cimke = p.idopont ? `${p.cim} — ${formatDatum(p.idopont)}` : p.cim;
      return `<option value="${id}">${cimke}</option>`;
    }).join("");
  sel.innerHTML = `<option value="">Összes program</option>` + opciok;
  // A korábbi kiválasztást csak akkor tartjuk meg, ha ezen a fülön is létezik
  sel.value = latott.has(jelenlegi) ? jelenlegi : "";
}

// A szűrőknek megfelelő részhalmaz
function szurtLista(){
  const p = document.getElementById("fProgram").value;
  const n = document.getElementById("fNev").value.trim().toLowerCase();
  const i = document.getElementById("fIdoallapot").value;
  return osszesFoglalas.filter(b =>
    b.statusz === foglStatuszFul &&                        // az aktív státusz-fül
    (!p || b.workshop_id === p) &&
    (!n || (b.nev || "").toLowerCase().includes(n)) &&
    (!i || masodlagos(b.workshops?.idopont)?.kulcs === i)
  );
}

// Egy sor HTML-je
function sorHtml(b){
  const st = STAT[b.statusz] || { szoveg:b.statusz, cls:"x" };
  const m  = masodlagos(b.workshops?.idopont);
  const szerkGomb = `<button class="btn sm ghost" data-edit="${b.id}">Szerkesztés</button>`;
  // ✉ Levél: NEM a „jóváhagyásra vár" soron (ott a vendég a foglaláskori visszaigazolót kapta),
  // és MINDIG a műveletek utolsója.
  const mailGomb = (b.statusz !== "jovahagyasra_var")
    ? `<button class="btn sm ghost" data-mail="${b.id}">✉ Levél</button>` : "";
  const gombok = szerkGomb + muveletek(b.statusz).map(mv =>
    `<button class="btn sm ${mv.stilus}" data-id="${b.id}" data-uj="${mv.uj}">${mv.cimke}</button>`
  ).join("") + mailGomb;
  return `<tr>
    <td class="azon" data-cim="Azonosító">${azon(b.azonosito)}</td>
    <td class="prog" data-cim="Program">
      <b>${b.workshops?.cim ?? "—"}</b>${b.workshops?.statusz === "elmaradt" ? ` <span class="arch-jel elmaradt">elmarad</span>` : (b.workshops?.archivalt ? ` <span class="arch-jel">archivált</span>` : "")}
      <small>${formatDatum(b.workshops?.idopont)}</small>
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

// A táblázat kirajzolása a szűrt lista alapján
function frissitFulSzamlalok(){
  const szam = { jovahagyasra_var:0, jovahagyott:0, elutasitott:0, lemondott:0 };
  osszesFoglalas.forEach(b => { if(szam[b.statusz] != null) szam[b.statusz]++; });
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

  cel.querySelectorAll(".actions .btn").forEach(btn =>
    btn.addEventListener("click", () => statuszValt(btn.dataset.id, btn.dataset.uj, btn)));
  cel.querySelectorAll(".loglink").forEach(btn =>
    btn.addEventListener("click", () => mutatLevelek(btn.dataset.log)));
  cel.querySelectorAll(".actions [data-edit]").forEach(btn =>
    btn.addEventListener("click", () => nyitSzerkeszto(btn.dataset.edit)));
  cel.querySelectorAll(".megj-ikon").forEach(btn =>
    btn.addEventListener("click", () => mutatMegjegyzes(btn.dataset.megj)));
  cel.querySelectorAll("[data-mail]").forEach(btn =>
    btn.addEventListener("click", () => levelPartnernek(btn.dataset.mail)));
}

// ==================== Export (Excel / PDF) ====================
// A könyvtárakat CSAK exportáláskor töltjük be (CDN-ről), hogy az admin oldal gyors maradjon.
const _scriptCache = {};
function loadScript(src){
  if(_scriptCache[src]) return _scriptCache[src];
  _scriptCache[src] = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error("Betöltés sikertelen: " + src));
    document.head.appendChild(s);
  });
  return _scriptCache[src];
}

const EXPORT_FEJ = ["Azonosító","Program","Program időpontja","Időállapot","Vendég neve","Telefon","E-mail","Fő","Státusz","Megjegyzés"];
// A jelenleg szűrt lista (aktív státusz-fül + szűrők) sorai export-formában
function exportSorok(){
  return szurtLista().map(b => [
    azon(b.azonosito),
    b.workshops?.cim ?? "—",
    formatDatum(b.workshops?.idopont),
    masodlagos(b.workshops?.idopont)?.szoveg ?? "—",
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

// A megjegyzés megmutatása (saját ablakban)
function mutatMegjegyzes(id){
  const b = osszesFoglalas.find(x => x.id === id);
  if(!b || !b.megjegyzes) return;
  dialog.uzen(b.megjegyzes, { cim: "Megjegyzés — " + azon(b.azonosito) });
}

// A kiküldött levelek megmutatása (típus + időpont; tartalom nélkül)
function mutatLevelek(id){
  const b = osszesFoglalas.find(x => x.id === id);
  const fejlec = "Kiment levelek — " + azon(b?.azonosito ?? 0) + (b ? " · " + b.nev : "");
  const logok = emailLogMap.get(id) || [];
  if(logok.length === 0){
    dialog.uzen("Ehhez a foglaláshoz még nem ment ki levél.", { cim: fejlec });
    return;
  }
  const sorok = logok
    .map(l => (EMAIL_CIMKE[l.tipus] || l.tipus) + " — " + formatDatum(l.elkuldve))
    .join("\n");
  dialog.uzen(sorok, { cim: fejlec });
}

// ✉ Levél a partnernek — a foglalás STÁTUSZA határozza meg a sablont;
// előnézet + szabad szerkesztés (tárgy/törzs), majd küldés a send-email függvénnyel.
// (A program csapat általi elmaradásának csoportos levele NEM ide tartozik.)
const STATUSZ_SABLON = {
  jovahagyott: "jovahagyas",
  elutasitott: "elutasitas",
  lemondott:   "lemondas",
};
function levelMezok(b){
  return {
    nev: b.nev, email: b.email, telefon: b.telefon,
    program: b.workshops?.cim ?? "",
    idopont: formatDatum(b.workshops?.idopont),
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
let levelAktualis = null;   // { id, tipus, email }

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
  await betoltEmailLog();   // a „✉ N kiment levél" számláló frissüljön
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

// Státusz-fülek váltása (a fül helyettesíti a régi státusz-szűrőt)
document.querySelectorAll(".foglalas-fulek .altab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".foglalas-fulek .altab").forEach(x => x.classList.toggle("active", x === t));
  foglStatuszFul = t.dataset.fstat;
  toltProgramSzuro();   // a program-szűrő kövesse az aktív fület
  megjelenit();
}));

// -------------------- Státusz módosítása --------------------
async function statuszValt(id, ujStatusz, btn){
  const rec = osszesFoglalas.find(b => b.id === id);

  // Megerősítés LEMONDÁSKOR — bármelyik státuszból (a lemondott foglalás nem hozható vissza)
  if(ujStatusz === "lemondott"){
    const ok = await dialog.megerosit(
      "Biztosan rögzíted, hogy a vendég lemondta? A lemondott foglalás nem hozható vissza.",
      { cim:"Vendég lemondta", okCimke:"Igen, lemondta", veszelyes:true });
    if(!ok) return;
  }
  // Megerősítés ELUTASÍTÁSKOR (lezárt állapot, nem hozható vissza)
  else if(ujStatusz === "elutasitott"){
    const ok = await dialog.megerosit(
      "Biztosan elutasítod a foglalást? Az elutasított foglalás nem hozható vissza.",
      { cim:"Elutasítás", okCimke:"Igen, elutasítom", veszelyes:true });
    if(!ok) return;
  }
  // Megerősítés már JÓVÁHAGYOTT foglalás visszavonásánál
  else if(rec && rec.statusz === "jovahagyott"){
    const ok = await dialog.megerosit(
      "Ez a foglalás már JÓVÁHAGYOTT. Biztosan visszavonod a jóváhagyást (vissza „jóváhagyásra vár” állapotba)?",
      { cim:"Jóváhagyott foglalás", okCimke:"Igen, visszavonom", veszelyes:true });
    if(!ok) return;
  }

  btn.disabled = true;
  const { error } = await db.from("bookings").update({ statusz: ujStatusz }).eq("id", id);
  if(error){
    // pl. ha "vissza várra" közben már nincs elég hely (túlfoglalás-védelem)
    await dialog.uzen(
      /szabad hely/i.test(error.message)
        ? "Nem állítható vissza: időközben betelt a hely."
        : "Hiba: " + error.message,
      { cim: "Hiba" }
    );
    btn.disabled = false;
    return;
  }
  // Csak a helyi rekordot frissítjük és újrarajzolunk — nincs teljes újratöltés,
  // ezért a sorrend nem változik (nem ugrál a képernyő).
  if(rec) rec.statusz = ujStatusz;
  toltProgramSzuro();   // a szűrő tükrözze, hogy a program kikerülhetett/bekerülhetett a fülre
  megjelenit();
}

// ===================== Foglalás-szerkesztő =====================
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

  // Program-legördülő: aktív programok + biztosan a jelenlegi is
  const opts = programok.filter(p => p.statusz === "aktiv" && !p.archivalt).slice();
  if(!opts.some(p => p.id === b.workshop_id) && b.workshops){
    opts.unshift({ id:b.workshop_id, cim:b.workshops.cim, idopont:b.workshops.idopont });
  }
  szProgram.innerHTML = opts.map(p =>
    `<option value="${p.id}">${p.cim} — ${formatDatum(p.idopont)}</option>`).join("");
  szProgram.value = b.workshop_id;

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
  const id          = szerkForm.dataset.id;
  const nev         = szerkForm.nev.value.trim();
  const email       = szerkForm.email.value.trim();
  const telefon     = tisztitTelefon(szerkForm.telefon.value);
  const letszam     = parseInt(szerkForm.letszam.value, 10);
  const workshop_id = szProgram.value;
  const megjegyzes  = szerkForm.megjegyzes.value.trim();

  if(!nev)                return szHiba("A név nem lehet üres.");
  if(!emailOk(email))     return szHiba("Érvényes e-mail címet adj meg.");
  if(!telefonOk(telefon)) return szHiba("Érvényes telefonszámot adj meg.");
  if(!(letszam >= 1))     return szHiba("A létszám legalább 1 fő.");

  const gomb = szerkForm.querySelector('button[type="submit"]');
  gomb.disabled = true;
  const { error } = await db.from("bookings").update({
    workshop_id, nev, email, telefon, letszam, megjegyzes: megjegyzes || null,
  }).eq("id", id);
  gomb.disabled = false;

  if(error){
    return szHiba(/szabad hely/i.test(error.message)
      ? "Nincs elég szabad hely a választott programon."
      : "Hiba: " + error.message);
  }
  szerkModal.hidden = true;
  betoltFoglalasok();   // teljes frissítés (a program is változhatott)
});

document.getElementById("szClose").addEventListener("click", zarSzerkeszto);
document.getElementById("szMegse").addEventListener("click", zarSzerkeszto);
// Szándékosan NINCS háttér-kattintás / Esc bezárás — csak a gombokkal záródik.

// ===================== BEÁLLÍTÁSOK fül =====================
function escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function mentesVisszajelzes(form, error){
  if(error){ dialog.uzen("Nem sikerült menteni: " + error.message, { cim:"Hiba" }); return; }
  const jel = form.querySelector(".mentve");
  if(jel){ jel.hidden = false; setTimeout(() => { jel.hidden = true; }, 2000); }
}

// Fülváltás (a beállítások lazán, első nyitáskor töltődik)
let beallToltve = false;
document.querySelectorAll(".tab").forEach(t =>
  t.addEventListener("click", () => valtTab(t.dataset.tab)));
function valtTab(nev){
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === nev));
  document.querySelectorAll(".tab-panel").forEach(p => p.hidden = (p.dataset.panel !== nev));
  if(nev === "beallitasok" && !beallToltve){
    beallToltve = true;
    betoltBeallitasokUrlap();
    betoltSablonok();
  }
  if(nev === "programok"){ betoltProgramLista(); }
  if(nev === "naptar"){ betoltNaptar(); }
}

// Az azonosító-formátum élő előnézete
const fZ = document.getElementById("formAzonosito");
function azonPreview(){
  const elotag = fZ.azonosito_elotag.value || "";
  const kezdo  = parseInt(fZ.azonosito_kezdo.value, 10);
  document.getElementById("azonPreview").textContent = elotag + (Number.isFinite(kezdo) ? kezdo : "");
}
fZ.azonosito_elotag.addEventListener("input", azonPreview);
fZ.azonosito_kezdo.addEventListener("input", azonPreview);

// Beállítás-űrlapok feltöltése az adatbázisból
async function betoltBeallitasokUrlap(){
  const { data } = await db.from("settings").select("*").eq("id", 1).maybeSingle();
  if(!data) return;
  const fA = document.getElementById("formAltalanos");
  fA.levelezesi_email.value = data.levelezesi_email ?? "";
  fA.foglalas_infosav.value = data.foglalas_infosav ?? "";
  fZ.azonosito_elotag.value = data.azonosito_elotag ?? "F-";
  fZ.azonosito_kezdo.value  = data.azonosito_kezdo ?? 100;
  azonPreview();
}

// Általános beállítások mentése
document.getElementById("formAltalanos").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  const { error } = await db.from("settings").update({
    levelezesi_email: f.levelezesi_email.value.trim() || null,
    foglalas_infosav: f.foglalas_infosav.value.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  mentesVisszajelzes(f, error);
});

// Azonosító-formátum mentése
fZ.addEventListener("submit", async e => {
  e.preventDefault();
  const elotag = fZ.azonosito_elotag.value;
  const kezdo  = parseInt(fZ.azonosito_kezdo.value, 10);
  if(elotag.length > 2) return dialog.uzen("Az előtag legfeljebb 2 karakter lehet.", { cim:"Hiba" });
  if(!(kezdo >= 1 && kezdo <= 999)) return dialog.uzen("A kezdő sorszám 1 és 999 között legyen.", { cim:"Hiba" });
  const { error } = await db.from("settings").update({
    azonosito_elotag: elotag, azonosito_kezdo: kezdo, updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if(!error){
    beall.azonosito_elotag = elotag;
    beall.azonosito_kezdo  = kezdo;
    megjelenit();  // a foglalás-tábla azonosítói is frissüljenek
  }
  mentesVisszajelzes(fZ, error);
});

// E-mail sablonok betöltése + szerkesztő űrlapok
const SABLON_SORREND = ["visszaigazolas","csapat_ertesito","jovahagyas","elutasitas","lemondas","program_elmarad","emlekezteto"];
const SABLON_CIMKE = {
  visszaigazolas:  "Visszaigazolás (foglaláskor, a vendégnek)",
  csapat_ertesito: "Csapat-értesítő (foglaláskor, nektek)",
  jovahagyas:      "Jóváhagyás",
  elutasitas:      "Elutasítás",
  lemondas:        "Lemondás",
  program_elmarad: "Program elmarad (a vendégeknek)",
  emlekezteto:     "Emlékeztető (a program előtti napon, a vendégnek)",
};
async function betoltSablonok(){
  const cel = document.getElementById("sablonok");
  const { data, error } = await db.from("email_sablonok").select("*").in("tipus", SABLON_SORREND);
  if(error){ cel.innerHTML = `<p class="status">Hiba: ${error.message}</p>`; return; }
  const rendezett = SABLON_SORREND.map(t => (data || []).find(s => s.tipus === t)).filter(Boolean);
  cel.innerHTML = rendezett.map(s => `
    <form class="sablon-form" data-tipus="${s.tipus}">
      <h4>${SABLON_CIMKE[s.tipus] || s.tipus}</h4>
      <label>Tárgy <input name="targy" value="${escapeHtml(s.targy)}"></label>
      <label>Törzsszöveg <textarea name="torzs" rows="6">${escapeHtml(s.torzs)}</textarea></label>
      <div class="beall-foot"><button class="btn" type="submit">Mentés</button><span class="mentve" hidden>Mentve ✓</span></div>
    </form>`).join("");
  cel.querySelectorAll(".sablon-form").forEach(f => f.addEventListener("submit", mentSablon));
}
async function mentSablon(e){
  e.preventDefault();
  const f = e.target;
  const { error } = await db.from("email_sablonok").update({
    targy: f.targy.value, torzs: f.torzs.value, updated_at: new Date().toISOString(),
  }).eq("tipus", f.dataset.tipus);
  mentesVisszajelzes(f, error);
}

// ===================== PROGRAMOK (admin CRUD) =====================
const progModal = document.getElementById("progModal");
const progForm  = document.getElementById("progForm");

// --- Rich text (félkövér / dőlt / felsorolás) a leírás-mezőkhöz ---
const edRovid     = document.getElementById("edRovid");
const edReszletes = document.getElementById("edReszletes");
try { document.execCommand("styleWithCSS", false, false); } catch(_){}  // szemantikus <b>/<i>, ne inline stílus
document.querySelectorAll(".rte-tb .rte-b").forEach(b => {
  b.addEventListener("mousedown", (e) => {   // mousedown: ne vesszen el a kijelölés a kattintáskor
    e.preventDefault();
    if(b.dataset.cmd){ document.execCommand(b.dataset.cmd, false, null); }
    else if(b.dataset.size){
      let sz = parseInt(document.queryCommandValue("fontSize")) || 3;
      sz = Math.max(1, Math.min(7, sz + parseInt(b.dataset.size)));
      document.execCommand("fontSize", false, sz);
    }
  });
});
// Tab = behúzás, Shift+Tab = kihúzás (felsorolásnál a pontokat nesteli)
[edRovid, edReszletes].forEach(ed => ed.addEventListener("keydown", (e) => {
  if(e.key === "Tab"){ e.preventDefault(); document.execCommand(e.shiftKey ? "outdent" : "indent", false, null); }
}));
// Biztonsági HTML-tisztító: csak félkövér/dőlt/aláhúzás/felsorolás/sortörés maradhat, attribútum nélkül
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
const pErr      = document.getElementById("pErr");
let progLista = [];   // a betöltött programok (szerkesztéshez)

function pHiba(msg){ pErr.textContent = msg; pErr.hidden = false; }
function zarProgModal(){ progModal.hidden = true; }
function isoToLocalInput(iso){
  if(!iso) return "";
  const d = new Date(iso), pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Programlista betöltése + kirajzolás (Aktuális vagy Archivált nézet)
let progArchivNezet = false;         // false = aktuális, true = archivált
let progFoglalasSzam = new Map();    // program → összes foglalás
let progElofoglalasSzam = new Map(); // program → élő foglalás (vár + jóváhagyott)

async function betoltProgramLista(){
  const cel = document.getElementById("programLista");
  cel.innerHTML = `<p class="status">Betöltés…</p>`;
  document.getElementById("ujProgramBtn").hidden = progArchivNezet;   // "Új program" csak az aktuálison

  const { data, error } = await db.from("programok").select("*")
    .eq("archivalt", progArchivNezet)
    .order("idopont", { ascending:true, nullsFirst:false });
  if(error){ cel.innerHTML = `<p class="status">Hiba: ${error.message}</p>`; return; }
  progLista = data || [];

  // foglalás-számok programonként (összes + élő)
  progFoglalasSzam = new Map(); progElofoglalasSzam = new Map();
  const { data: bk } = await db.from("bookings").select("workshop_id, statusz");
  (bk || []).forEach(b => {
    progFoglalasSzam.set(b.workshop_id, (progFoglalasSzam.get(b.workshop_id) || 0) + 1);
    if(b.statusz === "jovahagyasra_var" || b.statusz === "jovahagyott")
      progElofoglalasSzam.set(b.workshop_id, (progElofoglalasSzam.get(b.workshop_id) || 0) + 1);
  });

  if(progLista.length === 0){
    cel.innerHTML = `<p class="status">${progArchivNezet
      ? "Nincs archivált program."
      : "Még nincs program. Vegyél fel egyet a „+ Új program” gombbal."}</p>`;
    return;
  }

  cel.innerHTML = `<div class="prog-lista">` + progLista.map(p => {
    const hamarosan = p.statusz === "hamarosan";
    // Az Archivált fülön nem az élő státusz a lényeg (ott semmi sem "aktív"):
    // elmaradtnál "Elmarad", egyébként "Archivált". Az Aktuális fülön Aktív / Hamarosan.
    let badge;
    if(p.statusz === "elmaradt"){
      badge = `<span class="prog-badge elmaradt">Elmarad</span>`;
    } else if(progArchivNezet){
      badge = `<span class="prog-badge arch">Archivált</span>`;
    } else {
      badge = hamarosan
        ? `<span class="prog-badge soon">Hamarosan</span>`
        : `<span class="prog-badge aktiv">Aktív</span>`;
    }
    const arak = hamarosan ? "" : (p.kedvezmenyes_ar
      ? `<span class="old">${HUF(p.ar)}</span><span class="sale">${HUF(p.kedvezmenyes_ar)}</span>` : HUF(p.ar));
    const helyek = hamarosan ? "" : `<span class="helyek">${p.max_letszam - p.szabad_helyek}/${p.max_letszam} foglalt</span>`;
    const foglSzam = progFoglalasSzam.get(p.id) || 0;

    let gombok;
    if(progArchivNezet){
      gombok = `<button class="btn sm" data-progrestore="${p.id}">Visszaállítás</button>` +
               (foglSzam === 0 ? `<button class="btn sm ghost" data-progdel="${p.id}">Törlés</button>` : "");
    } else {
      gombok = `<button class="btn sm ghost" data-progedit="${p.id}">Szerkesztés</button>` +
               `<button class="btn sm ghost" data-progarch="${p.id}">Archiválás</button>` +
               (foglSzam === 0 ? `<button class="btn sm ghost" data-progdel="${p.id}">Törlés</button>` : "");
    }

    return `<article class="prog-kartya">
      <div class="fej"><h4>${escapeHtml(p.cim)}</h4>${badge}</div>
      ${hamarosan ? "" : `<div class="datum">${formatDatum(p.idopont)}</div>`}
      <p class="leiras">${tisztitHtml(p.rovid_leiras || p.leiras || "")}</p>
      <div class="also"><span class="arak">${arak}</span>${helyek}</div>
      <div class="gombok">${gombok}</div>
    </article>`;
  }).join("") + `</div>`;

  cel.querySelectorAll("[data-progedit]").forEach(b => b.addEventListener("click", () => nyitProgram(b.dataset.progedit)));
  cel.querySelectorAll("[data-progdel]").forEach(b => b.addEventListener("click", () => torolProgram(b.dataset.progdel)));
  cel.querySelectorAll("[data-progarch]").forEach(b => b.addEventListener("click", () => archivalProgram(b.dataset.progarch)));
  cel.querySelectorAll("[data-progrestore]").forEach(b => b.addEventListener("click", () => visszaallitProgram(b.dataset.progrestore)));
}

// Al-fül váltás (Aktuális / Archivált)
document.querySelectorAll(".altab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".altab").forEach(x => x.classList.toggle("active", x === t));
  progArchivNezet = (t.dataset.altab === "archivalt");
  betoltProgramLista();
}));

// Szerkesztő megnyitása (id nélkül = új)
function nyitProgram(id){
  progForm.reset(); pErr.hidden = true;
  edRovid.innerHTML = ""; edReszletes.innerHTML = "";
  document.getElementById("pFotoElonezet").hidden = true;
  const p = id ? progLista.find(x => x.id === id) : null;
  document.getElementById("pTitle").textContent = p ? "Program szerkesztése" : "Új program";
  progForm.dataset.id   = p ? p.id : "";
  progForm.dataset.foto = p?.foto_url || "";
  if(p){
    progForm.statusz.value          = p.statusz;
    progForm.cim.value              = p.cim;
    edRovid.innerHTML     = tisztitHtml(p.rovid_leiras || "");
    edReszletes.innerHTML = tisztitHtml(p.leiras || "");
    progForm.ar.value               = p.ar ?? "";
    progForm.kedvezmenyes_ar.value  = p.kedvezmenyes_ar ?? "";
    progForm.idopont.value          = isoToLocalInput(p.idopont);
    progForm.max_letszam.value      = p.max_letszam ?? "";
    progForm.varhato_idotartam.value = p.varhato_idotartam ?? "";
    if(p.foto_url){
      document.getElementById("pFotoImg").src = p.foto_url;
      document.getElementById("pFotoElonezet").hidden = false;
    }
  }
  progModal.hidden = false;
  progForm.cim.focus();
}

document.getElementById("ujProgramBtn").addEventListener("click", () => nyitProgram(null));

// Fotó előnézet a kiválasztott fájlból
document.getElementById("pFoto").addEventListener("change", e => {
  const f = e.target.files[0];
  if(f){
    document.getElementById("pFotoImg").src = URL.createObjectURL(f);
    document.getElementById("pFotoElonezet").hidden = false;
  }
});

// Kép feltöltése a Storage-ba → publikus URL
async function feltoltKep(file){
  const kiterj = (file.name.split(".").pop() || "jpg").toLowerCase();
  const nev = `${Date.now()}-${Math.random().toString(36).slice(2)}.${kiterj}`;
  const { error } = await db.storage.from("program-fotok").upload(nev, file, { cacheControl:"3600", upsert:false });
  if(error) throw error;
  return db.storage.from("program-fotok").getPublicUrl(nev).data.publicUrl;
}

// Program mentése
progForm.addEventListener("submit", async e => {
  e.preventDefault();
  pErr.hidden = true;
  const id       = progForm.dataset.id;
  const statusz  = progForm.statusz.value;
  const cim      = progForm.cim.value.trim();
  const rovid_leiras = edRovid.textContent.trim() ? tisztitHtml(edRovid.innerHTML) : "";
  const leiras       = edReszletes.textContent.trim() ? tisztitHtml(edReszletes.innerHTML) : null;
  const ar       = progForm.ar.value ? parseInt(progForm.ar.value, 10) : null;
  const kedvezmenyes_ar = progForm.kedvezmenyes_ar.value ? parseInt(progForm.kedvezmenyes_ar.value, 10) : null;
  const idopont  = progForm.idopont.value ? new Date(progForm.idopont.value).toISOString() : null;
  const max_letszam = progForm.max_letszam.value ? parseInt(progForm.max_letszam.value, 10) : null;
  const varhato_idotartam = progForm.varhato_idotartam.value.trim() || null;

  if(!cim)    return pHiba("A cím kötelező.");
  if(!rovid_leiras) return pHiba("A rövid leírás kötelező.");
  if(statusz === "aktiv"){
    if(ar == null)          return pHiba("Aktív programnál az ár kötelező.");
    if(!idopont)            return pHiba("Aktív programnál az időpont kötelező.");
    if(!(max_letszam >= 1)) return pHiba("Aktív programnál a max létszám kötelező (min. 1).");
  }
  if(kedvezmenyes_ar != null && ar == null) return pHiba("Kedvezményes árhoz add meg az alap árat is.");
  if(kedvezmenyes_ar != null && ar != null && kedvezmenyes_ar >= ar)
    return pHiba("A kedvezményes ár legyen kisebb az alap árnál.");

  // Szabály: figyelmeztetés módosításnál, ha már van foglalás
  if(id){
    const { count } = await db.from("bookings").select("id", { count:"exact", head:true }).eq("workshop_id", id);
    if(count && count > 0){
      const ok = await dialog.megerosit(
        `Erre a programra már ${count} foglalás tartozik. A módosítás érinti a jelentkezőket. Biztosan mented?`,
        { cim:"Foglalás tartozik hozzá", okCimke:"Igen, mentem", veszelyes:true });
      if(!ok) return;
    }
  }

  const gomb = progForm.querySelector('button[type="submit"]');
  gomb.disabled = true;

  // Új kép feltöltése, ha választottak
  let foto_url = progForm.dataset.foto || null;
  const file = document.getElementById("pFoto").files[0];
  if(file){
    try { foto_url = await feltoltKep(file); }
    catch(err){ gomb.disabled = false; return pHiba("A kép feltöltése nem sikerült: " + err.message); }
  }

  const sor = { statusz, cim, rovid_leiras, leiras, ar, kedvezmenyes_ar, idopont, max_letszam, varhato_idotartam, foto_url };
  const { error } = id
    ? await db.from("workshops").update(sor).eq("id", id)
    : await db.from("workshops").insert(sor);
  gomb.disabled = false;

  if(error) return pHiba("Mentési hiba: " + error.message);
  progModal.hidden = true;
  betoltProgramLista();
});

// Program végleges törlése — csak akkor hívódik, ha nincs foglalás (a gomb is csak akkor látszik)
async function torolProgram(id){
  const p = progLista.find(x => x.id === id);
  const ok = await dialog.megerosit(`Biztosan véglegesen törlöd a(z) „${p?.cim ?? ""}" programot?`,
    { cim:"Program törlése", okCimke:"Törlés", veszelyes:true });
  if(!ok) return;
  const { error } = await db.from("workshops").delete().eq("id", id);
  if(error) return dialog.uzen("Törlési hiba: " + error.message, { cim:"Hiba" });
  betoltProgramLista();
}

// Archiválás — ha van élő foglalás, felajánljuk az elmaradást (értesítéssel)
async function archivalProgram(id){
  const p = progLista.find(x => x.id === id);
  const elo = progElofoglalasSzam.get(id) || 0;
  // Múltbéli (lezajlott) programnál NINCS "elmarad" — ami megtörtént, az nem tud elmaradni.
  const multbeli = masodlagos(p?.idopont)?.kulcs === "multbeli";
  let volElmaras = false, ertesites = false, elmaradErtesitok = [];

  if(elo > 0 && !multbeli){
    // Jövőbeli/mai program élő foglalással → felajánljuk az elmaradást (értesítéssel)
    const valasz = await dialog.valaszt(
      `Ennek a programnak ${elo} élő foglalása van. Mi történjen?`,
      [
        { cimke:"Mégse",             ertek:"megse",   stilus:"ghost" },
        { cimke:"Archiválás",        ertek:"archiv",  stilus:"ghost" },
        { cimke:"Elmarad a program", ertek:"elmarad", stilus:"danger" },
      ], { cim:"Archiválás" });
    if(valasz === "megse" || valasz === false) return;
    if(valasz === "elmarad"){
      volElmaras = true;
      // Az érintett élő foglalások kigyűjtése MÉG a lemondás előtt (a levélküldéshez).
      const { data: erintett, error: selErr } = await db.from("bookings")
        .select("id").eq("workshop_id", id).in("statusz", ["jovahagyasra_var","jovahagyott"]);
      if(selErr) return dialog.uzen("Hiba a foglalások lekérdezésekor: " + selErr.message, { cim:"Hiba" });
      const { error: be } = await db.from("bookings")
        .update({ statusz:"lemondott" }).eq("workshop_id", id)
        .in("statusz", ["jovahagyasra_var","jovahagyott"]);
      if(be) return dialog.uzen("Nem sikerült a foglalások lemondása: " + be.message, { cim:"Hiba" });
      ertesites = await dialog.megerosit(`Kiküldjük az elmaradás-értesítőt a ${elo} vendégnek?`,
        { cim:"Elmaradás-értesítő", okCimke:"Igen, kiküldöm", megseCimke:"Most nem" });
      if(ertesites) elmaradErtesitok = erintett || [];
    }
  } else {
    // Nincs élő foglalás VAGY múltbéli program → sima archiválás (a foglalások megmaradnak)
    const uzenet = (multbeli && elo > 0)
      ? `Archiválod a(z) „${p?.cim ?? ""}" programot? Ez egy lezárult (múltbéli) program — a(z) ${elo} foglalás megmarad, csak lekerül a főoldalról.`
      : `Archiválod a(z) „${p?.cim ?? ""}" programot? Lekerül a főoldalról, a foglalások megmaradnak.`;
    const ok = await dialog.megerosit(uzenet, { cim:"Archiválás", okCimke:"Archiválás" });
    if(!ok) return;
  }

  // Elmaradásnál a program állapota is "elmaradt"; egyszerű archiválásnál marad a státusz.
  const frissites = volElmaras ? { archivalt:true, statusz:"elmaradt" } : { archivalt:true };
  const { error } = await db.from("workshops").update(frissites).eq("id", id);
  if(error) return dialog.uzen("Archiválási hiba: " + error.message, { cim:"Hiba" });

  if(volElmaras){
    if(ertesites && elmaradErtesitok.length){
      let sikeres = 0, hibas = 0;
      for(const bk of elmaradErtesitok){
        const { data, error: kerr } = await db.functions.invoke("send-email",
          { body:{ booking_id: bk.id, tipus:"program_elmarad" } });
        if(kerr || (data && data.ok === false)) hibas++; else sikeres++;
      }
      await betoltEmailLog();
      await dialog.uzen(
        `A program „elmaradt” állapotba került és archiválva lett; a(z) ${elo} érintett foglalás „lemondott”.\n\nElmaradás-értesítő kiküldve: ${sikeres} db${hibas ? `, sikertelen: ${hibas} db` : ""}.`,
        { cim:"Kész" });
    } else {
      await dialog.uzen(
        `A program „elmaradt” állapotba került és archiválva lett; a(z) ${elo} érintett foglalás „lemondott”. Értesítőt most nem küldünk.`,
        { cim:"Kész" });
    }
  }
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
  if(error){
    return dialog.uzen(/kotelezo|check/i.test(error.message)
      ? "Aktívba állításhoz kell ár, időpont és max létszám. Állítsd vissza „Hamarosan”-ként, majd szerkeszd."
      : "Hiba: " + error.message, { cim:"Hiba" });
  }
  betoltProgramLista();
}

document.getElementById("pClose").addEventListener("click", zarProgModal);
document.getElementById("pMegse").addEventListener("click", zarProgModal);
// Szándékosan NINCS háttér-kattintás / Esc bezárás — csak a gombokkal záródik (nehogy elvesszen a kitöltött adat).

// ===================== NAPTÁR fül (éves nézet — 12 hónap-kártya) =====================
let naptarEv = null;                    // az épp mutatott naptári év
let naptarProgramok = [];               // a workshopok (idoponttal)
let naptarKivalasztott = null;          // a lenyitott program id-je

const HO_NEVEK = ["Január","Február","Március","Április","Május","Június",
  "Július","Augusztus","Szeptember","Október","November","December"];

// Élő (helyet foglaló) létszám egy foglalás-listából: jóváhagyásra vár + jóváhagyott
function eloLetszam(bookings){
  return (bookings || [])
    .filter(b => b.statusz === "jovahagyasra_var" || b.statusz === "jovahagyott")
    .reduce((s, b) => s + (Number(b.letszam) || 0), 0);
}
// Adott programhoz tartozó foglalások (az összes betöltöttből)
function foglalasokProgramhoz(wid){
  return osszesFoglalas.filter(b => b.workshop_id === wid);
}
// Telítettségi szint a program-sor színéhez
function fillSzint(elo, max){
  if(!max || max <= 0) return "nincsmax";
  if(elo >= max)       return "tele";
  if(elo >= max * 0.75) return "majdnem";
  if(elo <= 0)         return "ures";
  return "ok";
}

async function betoltNaptar(){
  const racs = document.getElementById("naptarRacs");
  racs.innerHTML = `<p class="status">Betöltés…</p>`;
  // Friss foglalások (a telítettséghez + drill-downhoz) és a programok (időponttal)
  const { data: bk } = await db
    .from("bookings")
    .select("*, workshops ( cim, idopont, archivalt, statusz )")
    .order("created_at", { ascending: false });
  osszesFoglalas = bk || [];
  const { data: ws } = await db
    .from("workshops")
    .select("id, cim, idopont, statusz, max_letszam, archivalt")
    .not("idopont", "is", null)
    .order("idopont", { ascending: true });
  naptarProgramok = ws || [];
  if(naptarEv === null) naptarEv = new Date().getFullYear();
  renderNaptar();
}

function lepEv(delta){
  naptarEv += delta;
  naptarKivalasztott = null;
  document.getElementById("naptarReszletek").innerHTML = "";
  renderNaptar();
}

function renderNaptar(){
  document.getElementById("hoCimke").textContent = `${naptarEv}`;

  // Az évi programok hónapokra bontva (0–11) + évi összesítő
  const honapok = Array.from({ length:12 }, () => []);
  let evi = { db:0, elo:0, max:0, betelt:0 };
  naptarProgramok.forEach(p => {
    const d = new Date(p.idopont);
    if(d.getFullYear() !== naptarEv) return;
    const elo = eloLetszam(foglalasokProgramhoz(p.id));
    honapok[d.getMonth()].push({ p, elo, max:p.max_letszam || 0, d });
    evi.db++; evi.elo += elo; evi.max += (p.max_letszam || 0);
    if(p.max_letszam && elo >= p.max_letszam) evi.betelt++;
  });
  honapok.forEach(arr => arr.sort((a, b) => a.d - b.d));   // hónapon belül idő szerint

  document.getElementById("naptarOssz").innerHTML = evi.db
    ? `<b>${evi.db}</b> program · <b>${evi.elo}/${evi.max}</b> hely foglalt${evi.betelt ? ` · <b>${evi.betelt}</b> betelt` : ""}`
    : `Ebben az évben nincs időzített program.`;

  const most = new Date();
  const maHo = (most.getFullYear() === naptarEv) ? most.getMonth() : -1;

  let html = `<div class="naptar-ev">`;
  for(let ho = 0; ho < 12; ho++){
    const progs = honapok[ho];
    const kiemelt = (ho === maHo) ? " most" : "";
    const uresCls = progs.length ? "" : " ures";
    const sorok = progs.length
      ? progs.map(r => {
          const szint = fillSzint(r.elo, r.max);
          const elmarad = r.p.statusz === "elmaradt";
          const nap = new Date(r.p.idopont).getDate();
          const val = r.max ? `${r.elo}/${r.max}` : `${r.elo}`;
          return `<button class="ev-prog fill-${szint}${elmarad ? " elmarad" : ""}" data-wid="${r.p.id}" title="${escapeHtml(r.p.cim)}">`
            + `<span class="ev-nap">${nap}.</span>`
            + `<span class="ev-cim">${escapeHtml(r.p.cim)}</span>`
            + `<span class="ev-ar">${val}</span></button>`;
        }).join("")
      : `<span class="ev-nincs">— nincs program —</span>`;
    html += `<div class="ev-honap${kiemelt}${uresCls}">
      <h4>${HO_NEVEK[ho]}</h4>
      <div class="ev-proglista">${sorok}</div>
    </div>`;
  }
  html += `</div>`;
  document.getElementById("naptarRacs").innerHTML = html;

  document.querySelectorAll("#naptarRacs .ev-prog").forEach(ch =>
    ch.addEventListener("click", () => nyitNaptarProgram(ch.dataset.wid)));

  // Ha volt kiválasztott program és még ebben az évben van, tartsuk nyitva; különben zárjuk
  const kivProg = naptarProgramok.find(x => x.id === naptarKivalasztott);
  if(kivProg && new Date(kivProg.idopont).getFullYear() === naptarEv){
    nyitNaptarProgram(naptarKivalasztott);
  } else {
    naptarKivalasztott = null;
    document.getElementById("naptarReszletek").innerHTML = "";
  }
}

function nyitNaptarProgram(wid){
  naptarKivalasztott = wid;
  const p = naptarProgramok.find(x => x.id === wid);
  if(!p) return;
  const bk  = foglalasokProgramhoz(wid);
  const elo = eloLetszam(bk);
  const foN = st => bk.filter(b => b.statusz === st).reduce((s, b) => s + (Number(b.letszam) || 0), 0);
  const jovN = foN("jovahagyott"), varN = foN("jovahagyasra_var");
  const max = p.max_letszam || 0;
  const szabad = max ? Math.max(0, max - elo) : "—";
  const elmarad = p.statusz === "elmaradt";

  // Csak az ÉLŐ foglalások (jóváhagyott → vár), azon belül azonosító szerint
  const rang = { jovahagyott:0, jovahagyasra_var:1 };
  const sorok = bk.filter(b => b.statusz === "jovahagyott" || b.statusz === "jovahagyasra_var")
    .sort((a, b) => (rang[a.statusz] - rang[b.statusz]) || (a.azonosito - b.azonosito));

  const sorokHtml = sorok.length ? sorok.map(b => {
    const st = STAT[b.statusz] || { szoveg:b.statusz, cls:"x" };
    return `<tr>
      <td class="azon" data-cim="Azonosító">${azon(b.azonosito)}</td>
      <td class="kontakt" data-cim="Vendég">${escapeHtml(b.nev || "—")}<small>${escapeHtml(b.telefon || "")}</small><small>${escapeHtml(b.email || "")}</small></td>
      <td class="kozep" data-cim="Fő">${b.letszam}</td>
      <td data-cim="Státusz"><span class="pill ${st.cls}">${st.szoveg}</span></td>
    </tr>`;
  }).join("") : `<tr><td colspan="4" class="halvany kozep">Erre a programra nincs élő (jóváhagyott vagy jóváhagyásra váró) foglalás.</td></tr>`;

  document.getElementById("naptarReszletek").innerHTML = `
    <div class="reszlet-fej">
      <h3>${escapeHtml(p.cim)}${elmarad ? ` <span class="arch-jel elmaradt">elmarad</span>` : ""}</h3>
      <div class="reszlet-meta">${formatDatum(p.idopont)}</div>
    </div>
    <div class="reszlet-szamok">
      <div class="szam-kartya"><b>${elo}${max ? `/${max}` : ""}</b><span>foglalt hely</span></div>
      <div class="szam-kartya"><b>${szabad}</b><span>szabad hely</span></div>
      <div class="szam-kartya"><b>${jovN}</b><span>jóváhagyva (fő)</span></div>
      <div class="szam-kartya"><b>${varN}</b><span>vár (fő)</span></div>
    </div>
    <div class="jelentes-sor"><button type="button" class="btn sm ghost" id="jelentesBtn">📄 Jelentés (PDF)</button></div>
    <table class="tbl reszlet-tabla">
      <thead><tr><th>Azonosító</th><th>Vendég</th><th>Fő</th><th>Státusz</th></tr></thead>
      <tbody>${sorokHtml}</tbody>
    </table>
    <p class="hint">A foglalások kezelése (jóváhagyás, lemondás, szerkesztés) a <b>Foglalások</b> fülön történik.</p>`;
  document.getElementById("jelentesBtn")?.addEventListener("click", () => naptarJelentes(wid));
  document.getElementById("naptarReszletek").scrollIntoView({ behavior:"smooth", block:"nearest" });
}

// Program-jelentés PDF: a program adatai (leírás nélkül) + a jóváhagyott vendégek táblája (elérhetőséggel)
async function naptarJelentes(wid){
  const p = naptarProgramok.find(x => x.id === wid);
  if(!p){ dialog.uzen("A program nem található.", { cim:"Hiba" }); return; }
  const bk = foglalasokProgramhoz(wid);
  const rang = { jovahagyott:0, jovahagyasra_var:1 };
  const sorok = bk.filter(b => b.statusz === "jovahagyott" || b.statusz === "jovahagyasra_var")
    .sort((a, b) => (rang[a.statusz] - rang[b.statusz]) || (a.azonosito - b.azonosito));
  const foSum = st => bk.filter(b => b.statusz === st).reduce((s, b) => s + (Number(b.letszam) || 0), 0);
  const jovN = foSum("jovahagyott"), varN = foSum("jovahagyasra_var");
  const elo = jovN + varN;
  const max = p.max_letszam || 0;
  const szabad = max ? Math.max(0, max - elo) : "—";
  const allapot = { aktiv:"Aktív", hamarosan:"Hamarosan", elmaradt:"Elmaradt" }[p.statusz] || p.statusz;
  const arSor = p.kedvezmenyes_ar
    ? `${HUF(p.kedvezmenyes_ar)} (akciós · eredeti ${HUF(p.ar)})`
    : (p.ar != null ? HUF(p.ar) : "—");
  try{
    await loadScript("https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js");
    await loadScript("https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js");

    const adat = [
      ["Program", p.cim || "—"],
      ["Időpont", formatDatum(p.idopont)],
      ["Időtartam", p.varhato_idotartam || "—"],
      ["Ár", arSor],
      ["Max. létszám", max ? `${max} fő` : "—"],
      ["Állapot", allapot],
      ["Foglalt / szabad hely", `${elo}${max ? `/${max}` : ""} foglalt · ${szabad} szabad`],
      ["Jelentkezők", `${sorok.length} foglalás · ${elo} fő (jóváhagyva ${jovN}, vár ${varN})`]
    ];
    const fej = ["Azonosító","Név","Telefon","E-mail","Fő","Státusz"].map(h => ({ text:h, style:"th" }));
    const vendegBody = [fej];
    if(sorok.length){
      sorok.forEach(b => vendegBody.push([ azon(b.azonosito), b.nev || "—", b.telefon || "—", b.email || "—", String(b.letszam), STAT[b.statusz]?.szoveg ?? b.statusz ]));
      vendegBody.push([ { text:"Összesen (élő)", colSpan:4, alignment:"right", bold:true }, {}, {}, {}, { text:String(elo), bold:true }, {} ]);
    } else {
      vendegBody.push([ { text:"Erre a programra nincs élő (jóváhagyott vagy jóváhagyásra váró) foglalás.", colSpan:6, alignment:"center", italics:true, color:"#777" }, {}, {}, {}, {}, {} ]);
    }

    const doc = {
      pageSize:"A4", pageMargins:[36, 40, 36, 36],
      content: [
        { text:"Kemence Akadémia — Programjelentés", style:"cim" },
        { text:new Date().toLocaleDateString("hu-HU"), style:"alcim" },
        { table:{ widths:["auto","*"], body: adat.map(([k, v]) => [ { text:k, bold:true }, String(v) ]) },
          layout:"noBorders", margin:[0, 0, 0, 14] },
        { text:`Jelentkezők (${elo} fő élő)`, style:"szekcio" },
        { table:{ headerRows:1, widths:["auto","*","auto","*","auto","auto"], body:vendegBody }, layout:"lightHorizontalLines" }
      ],
      defaultStyle:{ fontSize:10 },
      styles:{
        cim:   { fontSize:16, bold:true, margin:[0,0,0,2] },
        alcim: { fontSize:9, color:"#777", margin:[0,0,0,12] },
        szekcio:{ fontSize:12, bold:true, margin:[0,0,0,6] },
        th:    { bold:true, fontSize:9, fillColor:"#f0e6da" }
      }
    };
    const slug = (p.cim || "program").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "program";
    pdfMake.createPdf(doc).download("jelentes-" + slug + "-" + new Date().toISOString().slice(0, 10) + ".pdf");
  }catch(e){ dialog.uzen("A jelentés készítése nem sikerült: " + e.message, { cim:"Hiba" }); }
}

document.getElementById("hoElozo").addEventListener("click", () => lepEv(-1));
document.getElementById("hoKovetkezo").addEventListener("click", () => lepEv(1));
document.getElementById("hoMa").addEventListener("click", () => {
  naptarEv = new Date().getFullYear();
  naptarKivalasztott = null;
  document.getElementById("naptarReszletek").innerHTML = "";
  renderNaptar();
});

// -------------------- Indítás: van-e élő munkamenet? --------------------
(async () => {
  const { data } = await db.auth.getSession();
  if(!data.session){ loginView.hidden = false; }  // az onAuthStateChange kezeli a belépettet
})();
