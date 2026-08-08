// =====================================================================
//  ADMIN — Naptár fül (időpont-alapú: minden alkalom egy esemény)
// =====================================================================
let naptarEv = null;
let naptarHo = null;
let naptarProgramok = [];               // az időpontok (occurrence-ök) a workshop címével
let naptarKivalasztott = null;          // a lenyitott időpont id-je

const HO_NEVEK = ["Január","Február","Március","Április","Május","Június",
  "Július","Augusztus","Szeptember","Október","November","December"];

function eloLetszam(bookings){
  return (bookings || [])
    .filter(b => b.statusz === "jovahagyasra_var" || b.statusz === "jovahagyott")
    .reduce((s, b) => s + (Number(b.letszam) || 0), 0);
}
// Adott IDŐPONThoz tartozó foglalások (az összes betöltöttből)
function foglalasokIdoponthoz(idopont_id){
  return osszesFoglalas.filter(b => b.idopont_id === idopont_id);
}
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
  const { data: bk } = await db.from("bookings").select(BOOKING_SELECT).order("created_at", { ascending: false });
  osszesFoglalas = bk || [];
  const { data: idos } = await db.from("idopontok")
    .select("id, idopont, ar, kedvezmenyes_ar, max_letszam, statusz, workshops ( cim, varhato_idotartam, statusz, archivalt )")
    .order("idopont", { ascending: true });
  naptarProgramok = (idos || []).map(i => ({
    id: i.id, cim: i.workshops?.cim ?? "—", idopont: i.idopont,
    ar: i.ar, kedvezmenyes_ar: i.kedvezmenyes_ar, max_letszam: i.max_letszam,
    varhato_idotartam: i.workshops?.varhato_idotartam, statusz: i.statusz
  }));

  // MÁSODIK eseményforrás: az ELFOGADOTT egyedi ajánlatok (a vegleges_idopont-nál).
  // Ezek nem idopontok-sorok, ezért _ajanlat jelzővel különböztetjük meg (más render + más részletpanel).
  const { data: aj } = await db.from("ajanlatok")
    .select("id, azonosito, vegleges_idopont, vegleges_letszam, vegleges_ar, nev, email, telefon, egyedi_program_id")
    .eq("statusz", "elfogadva");
  const { data: epk } = await db.from("egyedi_programok").select("id, cim");
  const epCim = new Map((epk || []).map(e => [e.id, e.cim]));
  (aj || []).filter(a => a.vegleges_idopont).forEach(a => {
    naptarProgramok.push({
      id: a.id,
      cim: a.egyedi_program_id ? (epCim.get(a.egyedi_program_id) || "Egyedi program") : "Egyedi program",
      idopont: a.vegleges_idopont, max_letszam: a.vegleges_letszam || 0, statusz: "elfogadva",
      _ajanlat: a,
    });
  });

  const most0 = new Date();
  if(naptarEv === null) naptarEv = most0.getFullYear();
  if(naptarHo === null) naptarHo = most0.getMonth();
  renderNaptar();
}

function lepEv(delta){
  if(naptarNezet === "racs"){
    const m = naptarHo + delta;
    naptarEv += Math.floor(m / 12);
    naptarHo  = ((m % 12) + 12) % 12;
  } else {
    naptarEv += delta;
  }
  naptarKivalasztott = null;
  document.getElementById("naptarReszletek").innerHTML = "";
  renderNaptar();
}

function renderNaptar(){
  document.getElementById("hoCimke").textContent = (naptarNezet === "racs")
    ? `${naptarEv}. ${HO_NEVEK[naptarHo]}`
    : `${naptarEv}`;

  const honapok = Array.from({ length:12 }, () => []);
  let evi = { db:0, elo:0, max:0, betelt:0, ajanlat:0 };
  naptarProgramok.forEach(p => {
    const d = new Date(p.idopont);
    if(d.getFullYear() !== naptarEv) return;
    if(p._ajanlat){   // elfogadott egyedi ajánlat — külön esemény, nem számít a foglalás-statokba
      honapok[d.getMonth()].push({ p, elo: p._ajanlat.vegleges_letszam || 0, max: p.max_letszam || 0, d, ajanlat: true });
      evi.ajanlat++;
      return;
    }
    const elo = eloLetszam(foglalasokIdoponthoz(p.id));
    honapok[d.getMonth()].push({ p, elo, max:p.max_letszam || 0, d });
    evi.db++; evi.elo += elo; evi.max += (p.max_letszam || 0);
    if(p.max_letszam && elo >= p.max_letszam) evi.betelt++;
  });
  honapok.forEach(arr => arr.sort((a, b) => a.d - b.d));

  document.getElementById("naptarOssz").innerHTML = (evi.db || evi.ajanlat)
    ? `<b>${evi.db}</b> időpont · <b>${evi.elo}/${evi.max}</b> hely foglalt${evi.betelt ? ` · <b>${evi.betelt}</b> betelt` : ""}${evi.ajanlat ? ` · <b>${evi.ajanlat}</b> egyedi ajánlat` : ""}`
    : `Ebben az évben nincs időzített program.`;

  const most = new Date();
  const maHo = (most.getFullYear() === naptarEv) ? most.getMonth() : -1;

  const html = (naptarNezet === "racs")
    ? naptarHonapHtml(honapok[naptarHo])
    : naptarListaHtml(honapok, maHo);
  document.getElementById("naptarRacs").innerHTML = html;

  document.querySelectorAll("#naptarRacs .ev-prog, #naptarRacs .hn-prog").forEach(ch =>
    ch.addEventListener("click", () => nyitNaptarProgram(ch.dataset.wid)));

  const kivProg = naptarProgramok.find(x => x.id === naptarKivalasztott);
  if(kivProg && new Date(kivProg.idopont).getFullYear() === naptarEv){
    nyitNaptarProgram(naptarKivalasztott);
  } else {
    naptarKivalasztott = null;
    document.getElementById("naptarReszletek").innerHTML = "";
  }
}

function naptarListaHtml(honapok, maHo){
  let html = `<div class="naptar-ev">`;
  for(let ho = 0; ho < 12; ho++){
    const progs = honapok[ho];
    const kiemelt = (ho === maHo) ? " most" : "";
    const uresCls = progs.length ? "" : " ures";
    const sorok = progs.length
      ? progs.map(r => {
          const nap = new Date(r.p.idopont).getDate();
          if(r.ajanlat){
            return `<button class="ev-prog ajanlat" data-wid="${r.p.id}" title="${escapeHtml(r.p.cim)}">`
              + `<span class="ev-nap">${nap}.</span>`
              + `<span class="ev-cim">✨ ${escapeHtml(r.p.cim)}</span>`
              + `<span class="ev-ar">${r.elo} fő</span></button>`;
          }
          const szint = fillSzint(r.elo, r.max);
          const elmarad = r.p.statusz === "elmaradt";
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
  return html + `</div>`;
}

function husvetVasarnap(ev){
  const a = ev % 19, b = Math.floor(ev / 100), c = ev % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l) / 451);
  const ho = Math.floor((h + l - 7*m + 114) / 31), nap = ((h + l - 7*m + 114) % 31) + 1;
  return new Date(ev, ho - 1, nap);
}
function unnepnapok(ev){
  const m = new Map([
    ["0-1", "Újév"], ["2-15", "Nemzeti ünnep"], ["4-1", "Munka ünnepe"],
    ["7-20", "Államalapítás"], ["9-23", "Nemzeti ünnep"], ["10-1", "Mindenszentek"],
    ["11-25", "Karácsony"], ["11-26", "Karácsony 2."],
  ]);
  const h = husvetVasarnap(ev);
  const kulcs = dt => `${dt.getMonth()}-${dt.getDate()}`;
  const eltol = n => { const dt = new Date(h); dt.setDate(dt.getDate() + n); return kulcs(dt); };
  m.set(eltol(-2), "Nagypéntek");
  m.set(kulcs(h), "Húsvét");
  m.set(eltol(1), "Húsvéthétfő");
  m.set(eltol(49), "Pünkösd");
  m.set(eltol(50), "Pünkösdhétfő");
  return m;
}

const NAP_FEJ = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
function naptarHonapHtml(monthProgs){
  const napMap = {};
  (monthProgs || []).forEach(r => {
    const nap = new Date(r.p.idopont).getDate();
    (napMap[nap] || (napMap[nap] = [])).push(r);
  });
  const most = new Date();
  const unnepek = unnepnapok(naptarEv);
  const kezdo = (new Date(naptarEv, naptarHo, 1).getDay() + 6) % 7;
  const napokSzama = new Date(naptarEv, naptarHo + 1, 0).getDate();
  const elozoOsszes = new Date(naptarEv, naptarHo, 0).getDate();

  const kulso = n => `<div class="hn-nap hn-kivul"><span class="hn-datum">${n}</span></div>`;

  let cellak = "";
  for(let i = kezdo - 1; i >= 0; i--) cellak += kulso(elozoOsszes - i);

  for(let nap = 1; nap <= napokSzama; nap++){
    const progs = napMap[nap];
    const oszlop = (kezdo + nap - 1) % 7;
    const hetvege = (oszlop >= 5) ? " hn-hetvege" : "";
    const ma = (naptarEv === most.getFullYear() && naptarHo === most.getMonth() && nap === most.getDate()) ? " hn-ma" : "";
    const unnepNev = unnepek.get(`${naptarHo}-${nap}`);
    const unnep = unnepNev ? " hn-unnep" : "";
    const unnepHtml = unnepNev ? `<span class="hn-unnep-nev">${unnepNev}</span>` : "";
    const progHtml = progs ? progs.map(r => {
      if(r.ajanlat){
        return `<button class="hn-prog ajanlat" data-wid="${r.p.id}" title="${escapeHtml(r.p.cim)}">`
          + `<span class="hn-prog-cim">✨ ${escapeHtml(r.p.cim)}</span>`
          + `<span class="hn-prog-hely">${r.elo} fő</span></button>`;
      }
      const szint = fillSzint(r.elo, r.max);
      const elmarad = r.p.statusz === "elmaradt";
      const hely = r.max ? `${r.elo}/${r.max}` : `${r.elo}`;
      return `<button class="hn-prog fill-${szint}${elmarad ? " elmarad" : ""}" data-wid="${r.p.id}" title="${escapeHtml(r.p.cim)}">`
        + `<span class="hn-prog-cim">${escapeHtml(r.p.cim)}</span>`
        + `<span class="hn-prog-hely">${hely}</span></button>`;
    }).join("") : "";
    cellak += `<div class="hn-nap${hetvege}${ma}${unnep}"><span class="hn-datum">${nap}</span>${unnepHtml}${progHtml}</div>`;
  }

  const zaro = (7 - ((kezdo + napokSzama) % 7)) % 7;
  for(let nap = 1; nap <= zaro; nap++) cellak += kulso(nap);

  return `<div class="honap-nagy">
    <div class="hn-cim">
      <div class="hn-cim-fo"><span class="hn-honap">${HO_NEVEK[naptarHo]}</span><span class="hn-ev">${naptarEv}</span></div>
      <div class="hn-jelmagy"><span class="jm jm-prog">Program</span><span class="jm jm-unnep">Ünnep</span><span class="jm jm-hetv">Hétvége</span></div>
    </div>
    <div class="hn-fej">${NAP_FEJ.map(n => `<span>${n}</span>`).join("")}</div>
    <div class="hn-racs">${cellak}</div>
  </div>`;
}

function nyitNaptarProgram(idopont_id){
  naptarKivalasztott = idopont_id;
  const p = naptarProgramok.find(x => x.id === idopont_id);
  if(!p) return;
  if(p._ajanlat){ nyitNaptarAjanlat(p); return; }   // elfogadott egyedi ajánlat — más részletpanel
  const bk  = foglalasokIdoponthoz(idopont_id);
  const elo = eloLetszam(bk);
  const foN = st => bk.filter(b => b.statusz === st).reduce((s, b) => s + (Number(b.letszam) || 0), 0);
  const jovN = foN("jovahagyott"), varN = foN("jovahagyasra_var");
  const max = p.max_letszam || 0;
  const szabad = max ? Math.max(0, max - elo) : "—";
  const elmarad = p.statusz === "elmaradt";

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
  }).join("") : `<tr><td colspan="4" class="halvany kozep">Erre az időpontra nincs élő (jóváhagyott vagy jóváhagyásra váró) foglalás.</td></tr>`;

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
  document.getElementById("jelentesBtn")?.addEventListener("click", () => naptarJelentes(idopont_id));
  document.getElementById("naptarReszletek").scrollIntoView({ behavior:"smooth", block:"nearest" });
}

// Elfogadott egyedi ajánlat részletpanele (nincs foglalás-lista — a végleges adatok látszanak)
function nyitNaptarAjanlat(p){
  const a = p._ajanlat;
  document.getElementById("naptarReszletek").innerHTML = `
    <div class="reszlet-fej">
      <h3>${escapeHtml(p.cim)} <span class="pill e">Egyedi ajánlat</span></h3>
      <div class="reszlet-meta">${formatDatum(p.idopont)} · ${azonAjanlat(a.azonosito)}</div>
    </div>
    <div class="reszlet-szamok">
      <div class="szam-kartya"><b>${a.vegleges_letszam ?? "—"}</b><span>fő</span></div>
      <div class="szam-kartya"><b>${a.vegleges_ar != null ? HUF(a.vegleges_ar) : "—"}</b><span>összár</span></div>
    </div>
    <table class="tbl reszlet-tabla">
      <thead><tr><th>Vendég</th><th>Telefon</th><th>E-mail</th></tr></thead>
      <tbody><tr>
        <td data-cim="Vendég">${escapeHtml(a.nev || "—")}</td>
        <td data-cim="Telefon">${escapeHtml(a.telefon || "—")}</td>
        <td data-cim="E-mail">${escapeHtml(a.email || "—")}</td>
      </tr></tbody>
    </table>
    <p class="hint">Az egyedi ajánlatok kezelése (módosítás, lemondás, levél) az <b>Ajánlatok</b> fülön történik.</p>`;
  document.getElementById("naptarReszletek").scrollIntoView({ behavior:"smooth", block:"nearest" });
}

async function naptarJelentes(idopont_id){
  const p = naptarProgramok.find(x => x.id === idopont_id);
  if(!p){ dialog.uzen("Az időpont nem található.", { cim:"Hiba" }); return; }
  const bk = foglalasokIdoponthoz(idopont_id);
  const rang = { jovahagyott:0, jovahagyasra_var:1 };
  const sorok = bk.filter(b => b.statusz === "jovahagyott" || b.statusz === "jovahagyasra_var")
    .sort((a, b) => (rang[a.statusz] - rang[b.statusz]) || (a.azonosito - b.azonosito));
  const foSum = st => bk.filter(b => b.statusz === st).reduce((s, b) => s + (Number(b.letszam) || 0), 0);
  const jovN = foSum("jovahagyott"), varN = foSum("jovahagyasra_var");
  const elo = jovN + varN;
  const max = p.max_letszam || 0;
  const szabad = max ? Math.max(0, max - elo) : "—";
  const allapot = { aktiv:"Aktív", elmaradt:"Elmarad" }[p.statusz] || p.statusz;
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
      vendegBody.push([ { text:"Erre az időpontra nincs élő foglalás.", colSpan:6, alignment:"center", italics:true, color:"#777" }, {}, {}, {}, {}, {} ]);
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
  const most = new Date();
  naptarEv = most.getFullYear();
  naptarHo = most.getMonth();
  naptarKivalasztott = null;
  document.getElementById("naptarReszletek").innerHTML = "";
  renderNaptar();
});
