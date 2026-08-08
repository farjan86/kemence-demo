// =====================================================================
//  Kemence Akadémia — élethű PARÁZS-SZIKRÁK (háttér-réteg)
//  Változatos részecskék: eltérő méret/sebesség/forma; egyedi, VÁLTOZÓ
//  hosszú csóva (van, akinek nincs), + néhány apró LOBOGÓ LÁNG a parázs
//  közé. Kevés, de mozgalmas. prefers-reduced-motion esetén nem indul.
// =====================================================================
(function(){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.querySelector('.szikra-reteg');
  if(!c || !c.getContext) return;
  const ctx = c.getContext('2d');
  const TAU = Math.PI * 2;

  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  function meret(){
    W = window.innerWidth; H = window.innerHeight;
    c.width = W * DPR; c.height = H * DPR;
    c.style.width = W + 'px'; c.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  meret();
  let ujraidozit;
  window.addEventListener('resize', function(){
    clearTimeout(ujraidozit); ujraidozit = setTimeout(meret, 150);
  });

  const rnd = (a, b) => a + Math.random() * (b - a);

  function ujSzikra(elszort){
    const lang = Math.random() < 0.18;                  // ~18% apró lobogó láng
    const orias = !lang && Math.random() < 0.07;        // ~7% kiugróan nagy, erőteljes
    const r = orias ? rnd(3.6, 5.4) : rnd(0.5, lang ? 2.4 : 3.0);
    // Csóva csak a parázsokra — most TÖBB kap csóvát, változó hosszban:
    let csova = 0;
    if(orias){ csova = Math.round(rnd(18, 34)); }        // óriás: hosszú üstökös
    else if(!lang){
      const dob = Math.random();
      if(dob < 0.48) csova = Math.round(rnd(9, 24));     // több hosszú csóva
      else if(dob < 0.88) csova = Math.round(rnd(3, 9)); // több rövid nyom
      // már csak ~12% marad csóva nélkül
    }
    return {
      lang: lang,
      orias: orias,
      x: rnd(0, W),
      y: elszort ? rnd(0, H) : H + rnd(4, 60),
      r: r,
      seb: (orias ? rnd(0.6, 1.5) : rnd(0.55, 2.7)) + r * 0.26,
      amp: rnd(6, 42),
      faz: rnd(0, TAU),
      lengSeb: rnd(0.012, 0.06),
      pislaFaz: rnd(0, TAU),
      pislaSeb: orias ? rnd(0.08, 0.2) : rnd(0.14, 0.5), // óriás stabilabban, erősen izzik
      elet: 0,
      max: orias ? rnd(320, 600) : rnd(110, 420),
      csova: csova,
      hist: []
    };
  }

  const DB = Math.max(10, Math.min(26, Math.round((W * H) / 96000))); // kevesebb szikra
  let szikrak = [];
  for(let i = 0; i < DB; i++) szikrak.push(ujSzikra(true));

  function rajzol(){
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';   // additív izzás

    for(let i = 0; i < szikrak.length; i++){
      const s = szikrak[i];
      s.elet++;
      s.y -= s.seb;
      s.faz += s.lengSeb;
      s.x += Math.sin(s.faz) * s.amp * 0.055;

      const t = s.elet / s.max;
      const fogyo = t < 0.12 ? t / 0.12 : (1 - t) * (1 - t);
      const magassag = 0.45 + 0.55 * (s.y / H);
      const pislako = 0.5 + 0.5 * Math.sin(s.pislaFaz + s.elet * s.pislaSeb);
      const a = Math.max(0, fogyo) * magassag * pislako;

      if(s.y < -18 || s.elet >= s.max || a <= 0.02){ szikrak[i] = ujSzikra(false); continue; }

      // ---- egyedi csóva (izzó, halványuló nyom) ----
      if(s.csova > 0){
        s.hist.push(s.x); s.hist.push(s.y);
        const maxLen = s.csova * 2;
        while(s.hist.length > maxLen){ s.hist.shift(); s.hist.shift(); }
        const pont = s.hist.length / 2;
        for(let h = 0; h < pont - 1; h++){
          const px = s.hist[h * 2], py = s.hist[h * 2 + 1];
          const arany = h / pont;
          const ha = a * arany * arany * 0.6;
          if(ha <= 0.015) continue;
          const hr = s.r * (0.25 + 0.55 * arany);
          const cg = ctx.createRadialGradient(px, py, 0, px, py, hr * 2.4);
          cg.addColorStop(0, 'rgba(255,150,50,' + ha + ')');
          cg.addColorStop(1, 'rgba(210,60,10,0)');
          ctx.fillStyle = cg;
          ctx.beginPath(); ctx.arc(px, py, hr * 2.4, 0, TAU); ctx.fill();
        }
      }

      if(s.lang){
        // ---- apró lobogó láng ----
        const vill = 0.65 + 0.35 * Math.sin(s.pislaFaz + s.elet * 0.42);
        const lh = s.r * 5.5 * vill;     // láng-magasság villódzik
        const lw = s.r * 1.7;
        const lg = ctx.createLinearGradient(s.x, s.y + lw, s.x, s.y - lh);
        lg.addColorStop(0,   'rgba(255,80,20,'  + (a * 0.65) + ')');
        lg.addColorStop(0.45,'rgba(255,165,55,' + a + ')');
        lg.addColorStop(1,   'rgba(255,244,200,0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + lw);
        ctx.quadraticCurveTo(s.x - lw, s.y - lh * 0.35, s.x, s.y - lh);
        ctx.quadraticCurveTo(s.x + lw, s.y - lh * 0.35, s.x, s.y + lw);
        ctx.fill();
        // forró mag a láng tövében
        ctx.fillStyle = 'rgba(255,248,220,' + (a * 0.8) + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.7, 0, TAU); ctx.fill();
      } else {
        // ---- parázs-pont (izzó, forró maggal) ----
        const R = s.r * 2.7;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R);
        g.addColorStop(0,   'rgba(255,238,190,' + a + ')');
        g.addColorStop(0.3, 'rgba(255,140,40,'  + (a * 0.6) + ')');
        g.addColorStop(1,   'rgba(220,60,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,250,232,' + a + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.55, 0, TAU); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(rajzol);
  }
  requestAnimationFrame(rajzol);
})();
