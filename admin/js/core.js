// =====================================================================
//  ADMIN — mag: DB, belépés, nézet-/fülváltás, közös állapot, adatbetöltők
//  A közös (több modul által használt) állapot ITT él (db, beall,
//  osszesFoglalas, programok, emailLogMap, naptarNezet).
// =====================================================================
const db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const loginView = document.getElementById("loginView");
const adminView = document.getElementById("adminView");
const loginForm = document.getElementById("loginForm");
const loginErr  = document.getElementById("loginErr");

// -------- Közös állapot --------
let beall = { azonosito_elotag: "F-", azonosito_kezdo: 100,
              ajanlat_azonosito_elotag: "A-", ajanlat_azonosito_kezdo: 100 };
let naptarNezet = "lista";              // admin naptár nézet ('lista' | 'racs')
let emailLogMap = new Map();            // booking_id → [{tipus, elkuldve}]
let programok = [];                     // workshops + idopontok (a foglalás-áthelyezéshez)
let osszesFoglalas = [];                // az összes foglalás (foglalás-lista + naptár)

// Azonosító-formátum: elotag + (belső sorszám + kezdő - 1)
function azon(azonosito){
  return beall.azonosito_elotag + (Number(azonosito) + Number(beall.azonosito_kezdo) - 1);
}
// Ajánlat-azonosító (külön előtag + kezdőszám, hogy ne keveredjen a foglaláséval)
function azonAjanlat(azonosito){
  return beall.ajanlat_azonosito_elotag + (Number(azonosito) + Number(beall.ajanlat_azonosito_kezdo) - 1);
}

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
  frissitNezet(data.session);
});

document.getElementById("logoutBtn").addEventListener("click", () => db.auth.signOut());

function frissitNezet(session){
  if(session){
    loginView.hidden = true;
    adminView.hidden = false;
    document.getElementById("whoami").textContent = session.user.email;
    betoltFoglalasok();   // foglalasok.js
  } else {
    adminView.hidden = true;
    loginView.hidden = false;
  }
}
db.auth.onAuthStateChange((_event, session) => frissitNezet(session));

// -------------------- Közös adatbetöltők --------------------
// Beállítások (azonosító-formátum + naptár nézet)
async function betoltBeallitasok(){
  const { data } = await db.from("settings")
    .select("azonosito_elotag, azonosito_kezdo, naptar_nezet, ajanlat_azonosito_elotag, ajanlat_azonosito_kezdo")
    .eq("id", 1).maybeSingle();
  if(data){
    beall.azonosito_elotag = data.azonosito_elotag ?? "F-";
    beall.azonosito_kezdo  = data.azonosito_kezdo ?? 100;
    beall.ajanlat_azonosito_elotag = data.ajanlat_azonosito_elotag ?? "A-";
    beall.ajanlat_azonosito_kezdo  = data.ajanlat_azonosito_kezdo ?? 100;
    naptarNezet = data.naptar_nezet ?? "lista";
  }
}
// Kiküldött e-mailek naplója (booking_id → lista)
async function betoltEmailLog(){
  const { data } = await db.from("email_log")
    .select("booking_id, tipus, elkuldve").order("elkuldve", { ascending: false });   // friss elöl (esetleges sor-limitnél a legutóbbiak maradjanak)
  // Helyi listába építünk, és csak a VÉGÉN cseréljük ki a globálisat — így párhuzamos
  // (pl. több auth-esemény által indított) betöltésnél sem halmozódnak a sorok.
  const map = new Map();
  (data || []).forEach(l => {
    if(l.tipus === "csapat_ertesito") return;   // belső levél a csapatnak — ne látszódjon a foglalásnál
    if(!map.has(l.booking_id)) map.set(l.booking_id, []);
    map.get(l.booking_id).push(l);
  });
  emailLogMap = map;
}
// A programok (workshops) + időpontjaik (a foglalás-áthelyezéshez)
async function betoltProgramok(){
  const { data: ws } = await db.from("workshops").select("id, cim, statusz, archivalt");
  const { data: idos } = await db.from("idopontok")
    .select("id, workshop_id, idopont, ar, kedvezmenyes_ar, max_letszam, min_letszam, max_foglalasok, statusz")
    .order("idopont", { ascending: true });
  const byWs = new Map();
  (idos || []).forEach(i => { if(!byWs.has(i.workshop_id)) byWs.set(i.workshop_id, []); byWs.get(i.workshop_id).push(i); });
  programok = (ws || []).map(w => ({ ...w, idopontok: byWs.get(w.id) || [] }));
}

// -------------------- Fülváltás --------------------
let beallToltve = false;
document.querySelectorAll(".tab").forEach(t =>
  t.addEventListener("click", () => valtTab(t.dataset.tab)));
function valtTab(nev){
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === nev));
  document.querySelectorAll(".tab-panel").forEach(p => p.hidden = (p.dataset.panel !== nev));
  if(nev === "beallitasok" && !beallToltve){
    beallToltve = true;
    betoltBeallitasokUrlap();   // beallitasok.js
    betoltSablonok();           // beallitasok.js
    betoltAjSablonok();         // beallitasok.js — ajánlati sablonok
  }
  if(nev === "foglalasok"){ betoltFoglalasok(); }    // foglalasok.js — mindig friss (más fülön történt törlés után is)
  if(nev === "programok"){ betoltProgramLista(); }   // programok.js
  if(nev === "egyediprogramok"){ betoltEgyediProgramLista(); }   // egyediprogramok.js
  if(nev === "ajanlatok"){ betoltAjanlatok(); }      // ajanlatok.js
  if(nev === "naptar"){ betoltNaptar(); }            // naptar.js
}

// -------------------- Indítás: van-e élő munkamenet? --------------------
(async () => {
  const { data } = await db.auth.getSession();
  if(!data.session){ loginView.hidden = false; }
})();
