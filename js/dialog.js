// =====================================================================
//  Saját felugró ablak — a böngésző alert()/confirm() helyett.
//  Használat (Promise-alapú):
//    const ok = await dialog.megerosit("Biztos?", { veszelyes:true });
//    await dialog.uzen("Kész.");
//  Mindkét oldal (publikus + admin) ezt használja.
// =====================================================================
(function(){
  const overlay = document.createElement("div");
  overlay.className = "dlg-overlay";
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="dlg-card" role="dialog" aria-modal="true" aria-labelledby="dlgCim">' +
      '<h3 id="dlgCim"></h3>' +
      '<p id="dlgSzoveg"></p>' +
      '<div class="dlg-actions" id="dlgActions"></div>' +
    '</div>';

  function csatol(){ if(!overlay.isConnected && document.body) document.body.appendChild(overlay); }
  if(document.body) csatol(); else document.addEventListener("DOMContentLoaded", csatol);

  const q = sel => overlay.querySelector(sel);
  let aktivResolve = null;

  function zar(ertek){
    overlay.hidden = true;
    q("#dlgActions").innerHTML = "";
    const r = aktivResolve; aktivResolve = null;
    if(r) r(ertek);
  }

  function nyit(opts){
    csatol();
    return new Promise(resolve => {
      aktivResolve = resolve;
      const cim = q("#dlgCim");
      cim.textContent = opts.cim || "";
      cim.hidden = !opts.cim;
      q("#dlgSzoveg").textContent = opts.szoveg || "";

      const act = q("#dlgActions");
      act.innerHTML = "";
      opts.gombok.forEach(g => {
        const b = document.createElement("button");
        b.className = "dlg-btn " + (g.stilus || "ghost");
        b.textContent = g.cimke;
        b.addEventListener("click", () => zar(g.ertek));
        act.appendChild(b);
      });

      overlay.hidden = false;
      const first = act.querySelector(".primary,.danger") || act.querySelector(".dlg-btn");
      if(first) first.focus();
    });
  }

  // Háttérre kattintás / Esc → negatív válasz (mint a Mégse)
  overlay.addEventListener("click", e => { if(e.target === overlay && aktivResolve) zar(false); });
  document.addEventListener("keydown", e => { if(e.key === "Escape" && !overlay.hidden && aktivResolve) zar(false); });

  window.dialog = {
    // Megerősítés (Mégse / OK) → Promise<boolean>
    megerosit(szoveg, opts = {}){
      return nyit({
        cim: opts.cim || "Megerősítés",
        szoveg,
        gombok: [
          { cimke: opts.megseCimke || "Mégse",   ertek:false, stilus:"ghost" },
          { cimke: opts.okCimke   || "Rendben",  ertek:true,  stilus: opts.veszelyes ? "danger" : "primary" },
        ],
      });
    },
    // Üzenet (csak OK) → Promise<void>
    uzen(szoveg, opts = {}){
      return nyit({
        cim: opts.cim || "Üzenet",
        szoveg,
        gombok: [ { cimke: opts.okCimke || "Rendben", ertek:true, stilus:"primary" } ],
      });
    },
    // Több gombos választás → a megnyomott gomb "ertek" mezője (háttér/Esc → false)
    // gombok: [{ cimke, ertek, stilus }]
    valaszt(szoveg, gombok, opts = {}){
      return nyit({ cim: opts.cim || "Válassz", szoveg, gombok });
    },
  };
})();
