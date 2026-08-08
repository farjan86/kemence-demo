// =====================================================================
//  Kemence Akadémia — FOGLALÁSI ABLAK
//  Az idopontIndex-ből (app.js) kiválasztott IDŐPONTRA ír foglalást.
//  Segédek: util.js (validáció, telefon, dátum). A lista frissítése:
//  betoltProgramok() (app.js).
// =====================================================================

const modal     = document.getElementById("foglalasModal");
const formEl    = document.getElementById("foglalasForm");
const errEl     = document.getElementById("mErr");
const submitBtn = document.getElementById("mSubmit");

let aktualisIdopont    = null;   // a kiválasztott időpont (a program címével együtt)
let emailFigyelmeztetve = false; // hogy a domain-javaslat után másodszorra elmenjen

function nyitFoglalas(idopont_id){
  const rec = idopontIndex[idopont_id];   // idopontIndex: app.js
  if(!rec) return;
  const { program, ido } = rec;
  const maxElerve = (ido.max_foglalasok != null) && ((ido.foglalasok_szama || 0) >= ido.max_foglalasok);
  const kevesMint = (ido.min_letszam != null) && (ido.szabad_helyek < ido.min_letszam);
  // Nem foglalható időpontra ne nyíljon foglalás
  if(lezarultNap(ido.idopont) || ido.idopont_statusz === "elmaradt" || ido.szabad_helyek <= 0 || maxElerve || kevesMint) return;

  aktualisIdopont = { ...ido, cim: program.cim };

  document.getElementById("mTitle").textContent = program.cim;
  const datum = formatDatum(ido.idopont);
  const ar = ido.kedvezmenyes_ar ?? ido.ar;
  const csoportos = (ido.min_letszam != null) || (ido.max_foglalasok != null);
  document.getElementById("mMeta").innerHTML =
    `${datum ? "<b>"+datum+"</b> · " : ""}${HUF(ar)} / fő${csoportos ? "" : ` · ${ido.max_letszam - ido.szabad_helyek}/${ido.max_letszam} foglalt`}`;

  // Csoportos alkalom jelzése + a létszám alsó határa
  const note = document.getElementById("mCsoportos");
  if(note){
    if(csoportos){
      const reszek = [];
      if(ido.max_foglalasok != null) reszek.push(`legfeljebb ${ido.max_foglalasok} foglalás tehető`);
      if(ido.min_letszam != null)    reszek.push(`legalább ${ido.min_letszam} fős foglalás szükséges`);
      note.textContent = "Csoportos alkalom: " + reszek.join(", ") + ".";
      note.hidden = false;
    } else note.hidden = true;
  }
  formEl.letszam.min = ido.min_letszam || 1;

  // alaphelyzet
  formEl.reset(); errEl.hidden = true; emailFigyelmeztetve = false;
  formEl.querySelectorAll(".bad").forEach(el => el.classList.remove("bad"));
  document.getElementById("mFormWrap").hidden = false;
  document.getElementById("mSuccess").hidden = true;
  modal.hidden = false;
  formEl.nev.focus();
}

function zarFoglalas(){ modal.hidden = true; aktualisIdopont = null; }

function hiba(uzenet, mezo){
  errEl.textContent = uzenet; errEl.hidden = false;
  if(mezo){ mezo.classList.add("bad"); mezo.focus(); }
}

// Beküldés
formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  if(!aktualisIdopont) return;
  errEl.hidden = true;
  formEl.querySelectorAll(".bad").forEach(el => el.classList.remove("bad"));

  const nev        = formEl.nev.value.trim();
  const email      = formEl.email.value.trim();
  const telefon    = tisztitTelefon(formEl.telefon.value);   // normalizált (+36..)
  const letszam    = parseInt(formEl.letszam.value, 10);
  const megjegyzes = formEl.megjegyzes.value.trim();

  // Ellenőrzések — hibás adattal nem küldhető el
  if(lezarultNap(aktualisIdopont.idopont))
    return hiba("Erre az időpontra már nem lehet foglalni (lezárult). Frissítsd az oldalt.");
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
  if(aktualisIdopont.min_letszam != null && letszam < aktualisIdopont.min_letszam)
    return hiba(`Erre az időpontra legalább ${aktualisIdopont.min_letszam} fős foglalás szükséges.`, formEl.letszam);
  if(letszam > aktualisIdopont.szabad_helyek)
    return hiba(`Csak ${aktualisIdopont.szabad_helyek} szabad hely van.`, formEl.letszam);

  submitBtn.disabled = true; submitBtn.textContent = "Küldés…";

  // A statusz alapból "jovahagyasra_var" (az adatbázis állítja be)
  const { error } = await db.from("bookings").insert({   // db: app.js
    idopont_id: aktualisIdopont.idopont_id,
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
  betoltProgramok();   // betoltProgramok: app.js
});

// Ha az e-mailt módosítják, a figyelmeztetés nullázódik
formEl.email.addEventListener("input", () => { emailFigyelmeztetve = false; });

// Ablak bezárása
document.getElementById("mClose").addEventListener("click", zarFoglalas);
document.getElementById("mDone").addEventListener("click", zarFoglalas);
// Nincs háttér-kattintás bezárás (szövegkijelöléskor is elsülne). Esc marad.
document.addEventListener("keydown", (e) => { if(e.key === "Escape" && !modal.hidden) zarFoglalas(); });
