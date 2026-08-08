// =====================================================================
//  Kemence Akadémia — általános segédek (tiszta függvények)
//  Nincs benne DB- vagy DOM-állapot; a publikus oldal (app.js, foglalas.js)
//  és később az admin is használhatja. Klasszikus script: a globális
//  lexikai scope-ban él, a később betöltött fájlok látják.
// =====================================================================

// -------- Formázás --------
const HUF = n => Number(n).toLocaleString("hu-HU") + " Ft";

function formatDatum(iso){
  if(!iso) return null;
  return new Date(iso).toLocaleString("hu-HU",
    { year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit" });
}
// Rövid dátum a csempékhez, pl. "aug. 16. 10:00"
function formatDatumRovid(iso){
  if(!iso) return "";
  return new Date(iso).toLocaleString("hu-HU",
    { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}
// Lezárult-e az időpont? A NAP számít: a mai nap még foglalható, a korábbiak nem.
function lezarultNap(iso){
  if(!iso) return false;
  const d = new Date(iso), most = new Date();
  const esemenyNap = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const maNap      = new Date(most.getFullYear(), most.getMonth(), most.getDate());
  return esemenyNap < maNap;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,
    c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// Biztonsági HTML-tisztító: csak félkövér/dőlt/aláhúzás/felsorolás/sortörés maradhat (rich text)
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
