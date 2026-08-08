// =====================================================================
//  ADMIN — általános segédek (tiszta függvények + konstansok)
//  Nincs benne közös mutálható állapot; minden admin-modul használhatja.
// =====================================================================

// -------- Formázás --------
function formatDatum(iso){
  if(!iso) return "—";
  return new Date(iso).toLocaleString("hu-HU",
    { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}
const HUF = n => Number(n).toLocaleString("hu-HU") + " Ft";
function isoToLocalInput(iso){
  if(!iso) return "";
  const d = new Date(iso), pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A foglalás időpontja / programja (a bookings → idopontok → workshops join alapján)
const idoOf  = b => b?.idopontok || null;              // időpont (idopont, ar, max_letszam, statusz, workshop_id)
const progOf = b => b?.idopontok?.workshops || null;   // program (cim, eloado, statusz, archivalt)

// Időállapot egy időpont alapján (közeledő / ma / múltbéli)
function masodlagos(iso){
  if(!iso) return null;
  const most = new Date(), d = new Date(iso);
  if(most.toDateString() === d.toDateString()) return { kulcs:"ma",       szoveg:"Ma" };
  return d > most ? { kulcs:"kozeledo", szoveg:"Jövőbeli" } : { kulcs:"multbeli", szoveg:"Múltbéli" };
}

// -------- Státusz megjelenítés + műveletek --------
const STAT = {
  jovahagyasra_var: { szoveg:"Jóváhagyásra vár", cls:"o" },
  jovahagyott:      { szoveg:"Jóváhagyott",      cls:"g" },
  elutasitott:      { szoveg:"Elutasított",      cls:"r" },
  lemondott:        { szoveg:"Lemondott",        cls:"x" },
};
function muveletek(statusz){
  switch(statusz){
    case "jovahagyasra_var": return [
      { cimke:"Jóváhagyás", uj:"jovahagyott", stilus:"" },
      { cimke:"Elutasítás", uj:"elutasitott", stilus:"ghost" },
      { cimke:"Vendég lemondta",   uj:"lemondott",   stilus:"ghost" } ];
    case "jovahagyott": return [
      { cimke:"Vendég lemondta",               uj:"lemondott",        stilus:"ghost" },
      { cimke:"Jóváhagyás visszavonása", uj:"jovahagyasra_var", stilus:"ghost" } ];
    default: return [];
  }
}
const EMAIL_CIMKE = {
  visszaigazolas:  "Visszaigazolás (foglaláskor)",
  csapat_ertesito: "Csapat-értesítő",
  jovahagyas:      "Jóváhagyás",
  elutasitas:      "Elutasítás",
  lemondas:        "Lemondás",
  program_elmarad: "Program elmarad",
  emlekezteto:     "Emlékeztető",
};

// -------- Validáció --------
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
function tisztitTelefon(v){
  let s = v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if(s.startsWith("06"))      s = "+36" + s.slice(2);
  else if(s.startsWith("36")) s = "+"  + s;
  return s;
}
const telefonOk = s => /^\+?\d{8,15}$/.test(s);

// -------- HTML --------
function escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
// Biztonsági rich-text tisztító: csak félkövér/dőlt/aláhúzás/felsorolás/sortörés maradhat
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

// -------- Külső könyvtár betöltése igény szerint (export/PDF) --------
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

// -------- Drag-and-drop sorrend (SortableJS igény szerint betöltve) --------
// A `container` közvetlen, [data-id]-s gyerekeit húzhatóvá teszi a `.drag-fogo`
// fogantyúval; ejtéskor az új sorrendet a `tabla` `sorrend` oszlopába menti
// (0-tól indexelve). Sikeres mentés után felvillantja a `jelzoEl`-t (ha van).
// Hiba a lista működését nem töri: legfeljebb húzás nélkül marad.
async function sortableSorrend(container, tabla, jelzoEl){
  if(!container) return;
  try { await loadScript("https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"); }
  catch(_){ return; }
  if(typeof Sortable === "undefined") return;
  Sortable.create(container, {
    animation: 150,
    handle: ".drag-fogo",
    ghostClass: "sortable-ghost",
    onEnd: async () => {
      const idk = [...container.querySelectorAll(":scope > [data-id]")].map(el => el.dataset.id);
      const eredmenyek = await Promise.all(
        idk.map((id, i) => db.from(tabla).update({ sorrend: i }).eq("id", id))
      );
      const rossz = eredmenyek.find(r => r.error);
      if(rossz){ dialog.uzen("A sorrend mentése nem sikerült: " + rossz.error.message, { cim:"Hiba" }); return; }
      if(jelzoEl){ jelzoEl.hidden = false; setTimeout(() => { jelzoEl.hidden = true; }, 1600); }
    }
  });
}

// A foglalások közös SELECT-je (időpont + program az idopont_id join mentén)
const BOOKING_SELECT =
  "*, idopontok ( id, idopont, ar, kedvezmenyes_ar, max_letszam, statusz, workshop_id, workshops ( cim, eloado, archivalt, statusz ) )";
