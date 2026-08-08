// =====================================================================
//  Kemence Akadémia — SCROLL-REVEAL
//  A statikus tartalmi elemek finoman beúsznak, amikor a nézetbe érnek.
//  Progresszív: ha nincs JS/observer, minden látható marad; mozgás-
//  csökkentett módban azonnal megjelenik, animáció nélkül.
// =====================================================================
(function(){
  var VALASZTOK = [
    '.hero-text', '.section-head',
    '.ws-tile', '.elm-item', '.cat', '.step',
    '.about-text', '.about-photo', '.shop-cta'
  ].join(',');

  var celok = Array.prototype.slice.call(document.querySelectorAll(VALASZTOK))
    // A webshop címét NEM revealeljük: a doboz transformja elmozdítaná a
    // benne abszolút pozicionált kemence-rajz igazítási pontját (kiugrana).
    .filter(function(el){ return !(el.classList.contains('section-head') && el.closest('.webshop')); });
  if(!celok.length) return;

  // Kezdő (rejtett) állapot csak akkor, ha tényleg tudunk animálni:
  celok.forEach(function(el){ el.classList.add('reveal'); });

  var keves = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(keves || !('IntersectionObserver' in window)){
    celok.forEach(function(el){ el.classList.add('in'); });
    return;
  }

  // Rácsokban lévő testvérek egymás után ússzanak be (finom lépcső)
  celok.forEach(function(el){
    var szulo = el.parentElement;
    if(szulo && /ws-grid|elmeny-grid|shop-cats|steps|courses-grid/.test(szulo.className)){
      var testverek = Array.prototype.slice.call(szulo.children);
      var idx = testverek.indexOf(el);
      if(idx > 0) el.style.transitionDelay = Math.min(idx * 70, 350) + 'ms';
    }
  });

  var io = new IntersectionObserver(function(sorok){
    sorok.forEach(function(s){
      if(s.isIntersecting){ s.target.classList.add('in'); io.unobserve(s.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  celok.forEach(function(el){ io.observe(el); });
})();
