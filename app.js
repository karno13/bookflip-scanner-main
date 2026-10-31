/* BookFlip Pages DEMO. Deliberately no fetch(), backend calls, storage writes or real scanning. */
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const set=(s,v)=>{const n=$(s);if(n)n.textContent=v};
const books=[
 {title:'Xenos',author:'Dan Abnett',isbn:'9781784966871',publisher:'Black Library',price:49,source:'Vinted'},
 {title:'Horus Rising',author:'Dan Abnett',isbn:'9781849707435',publisher:'Black Library',price:65,source:'OLX'},
 {title:'The Infinite and The Divine',author:'Robert Rath',isbn:'9781789998328',publisher:'Black Library',price:79,source:'Allegro Lokalnie'},
 {title:'Eisenhorn: The Omnibus',author:'Dan Abnett',isbn:'9781784966895',publisher:'Black Library',price:99,source:'Vinted'}];
const sources=['Allegro Lokalnie','OLX','Vinted','Empik','Sprzedajemy.pl','Tezeusz','Allegro'];
function navigate(name){if(!['scanner','review','catalog','offers','settings'].includes(name))name='scanner';$$('.view').forEach(n=>{n.hidden=n.id!=='view-'+name;n.classList.toggle('active',!n.hidden)});$$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===name));set('#viewTitle',({scanner:'Skaner',review:'Do weryfikacji',catalog:'Katalog',offers:'Oferty',settings:'Ustawienia'})[name]);history.replaceState(null,'',name==='scanner'?location.pathname:location.pathname+'?view='+name)}
$$('.nav-item').forEach(n=>n.addEventListener('click',()=>navigate(n.dataset.view)));
$('#sourceGrid').innerHTML=sources.map((s,i)=>'<label class="source-option"><input type="checkbox" '+(i<3?'checked':'')+'><span>'+esc(s)+'</span></label>').join('');
$('#toggleSources').onclick=()=>{const a=$$('#sourceGrid input'),v=a.some(n=>!n.checked);a.forEach(n=>n.checked=v)};
$('#startSearch').onclick=()=>alert('To tylko demonstracja wyglądu. Skanowanie jest wyłączone.');
$('#queries').placeholder='Np. Warhammer 40k (skanowanie wyłączone)';
set('#connectionLabel','Tryb demonstracyjny');set('#databaseStatus','SQLite wyłączone — DEMO');set('#scanStateBadge','Podgląd');
set('#statFound','—');set('#statNew','—');set('#statUpdated','—');set('#statPriceChanges','—');set('#statErrors','—');
$('#sourceStatusBody').innerHTML='<tr><td colspan="6" class="empty-cell">Podgląd statyczny — bez rzeczywistych skanów.</td></tr>';
$('#goToOffers').disabled=false;$('#goToOffers').onclick=()=>navigate('offers');
set('#catalogWorks',books.length);set('#catalogEditions',books.length);set('#catalogIncomplete','—');
set('#reviewNavCount','2 demo');set('#reviewCount','2 przykłady');set('#offersNavCount','4 demo');
function catalog(){
  const q=$('#catalogSearch').value.toLocaleLowerCase('pl');
  const list=books.filter(b=>(b.title+' '+b.author+' '+b.isbn).toLocaleLowerCase('pl').includes(q));
  $('#catalogList').innerHTML=list.map((b,i)=>'<button class="catalog-row" type="button" data-demo-book="'+i+'"><span class="catalog-book-title"><span class="book-spine" aria-hidden="true">▤</span><span class="catalog-book-copy"><strong>'+esc(b.title)+'</strong><small>'+esc(b.author)+'</small><small class="catalog-isbn">'+esc(b.isbn)+'</small></span></span><span>1</span><span>1</span><span><span class="status-pill neutral">Demo</span></span></button>').join('')||'<div class="empty-detail">Brak wyników</div>';
  $$('[data-demo-book]').forEach(n=>n.onclick=()=>{const b=list[Number(n.dataset.demoBook)];$('#catalogDetail').innerHTML='<section class="detail-section"><div class="comparison-candidate"><span class="book-spine" aria-hidden="true">▤</span><span class="candidate-body"><b>'+esc(b.title)+'</b><small>'+esc(b.author)+'</small><small>Wydawca: '+esc(b.publisher)+'</small><small>ISBN wydania: '+esc(b.isbn)+'</small><small>1 wydanie · 1 oferta demonstracyjna</small></span></div><p class="inline-note">Przykładowe dane, bez połączenia z SQLite.</p></section>'});
}
$('#catalogSearch').oninput=catalog;catalog();
const review=[{title:'Nieznane wydanie Warhammer',reason:'Brak potwierdzonego ISBN'},{title:'Konflikt identyfikatorów',reason:'Niejednoznaczne ISBN w opisie'}];
$('#reviewList').innerHTML=review.map((r,i)=>'<button class="review-item" type="button" data-demo-review="'+i+'"><span class="book-spine" aria-hidden="true">▤</span><span><strong>'+esc(r.title)+'</strong><small>Oferta demonstracyjna · wymaga decyzji</small></span></button>').join('');
$$('[data-demo-review]').forEach(n=>n.onclick=()=>{let i=Number(n.dataset.demoReview),r=review[i],candidate=books[i];$('#reviewDetail').innerHTML='<section class="detail-section"><span class="status-pill warning">Wymaga sprawdzenia</span><h3>'+esc(r.title)+'</h3><p>'+esc(r.reason)+'</p></section><section class="detail-section review-comparison"><h4>Proponowane wydanie — przykład</h4><div class="comparison-candidate"><span class="book-spine" aria-hidden="true">▤</span><span class="candidate-body"><b>'+esc(candidate.title)+'</b><small>Autor: '+esc(candidate.author)+'</small><small>Wydawca: '+esc(candidate.publisher)+'</small><small>ISBN: '+esc(candidate.isbn)+'</small></span></div><div class="verification-fact verification-unknown">Przykład porównania ISBN. W prawdziwej aplikacji wynik zależy od danych oferty.</div></section><section class="detail-section"><h4>Decyzja</h4><p class="inline-note">Zatwierdzanie i zapis decyzji są wyłączone w publicznym podglądzie.</p></section>'});
function offers(){let q=$('#offerSearch').value.toLocaleLowerCase('pl'),list=books.filter(b=>(b.title+' '+b.source).toLocaleLowerCase('pl').includes(q));$('#offersTableBody').innerHTML=list.map(b=>'<tr><td>'+esc(b.title)+'</td><td>'+esc(b.source)+'</td><td>'+b.price+',00 zł</td><td>'+esc(b.isbn)+'</td><td>Przykładowe wydanie</td><td>Demo</td><td>—</td></tr>').join('');set('#offerTotal',list.length+' oferty demonstracyjne')}
$('#offerSearch').oninput=offers;offers();
$('#openCatalogForm').onclick=()=>alert('Zapisywanie jest wyłączone w publicznym podglądzie.');
$('#runDiagnostics').onclick=()=>set('#diagnosticResults','Statyczny podgląd — brak serwera i API.');
$('#settingsSources').innerHTML=sources.map(s=>'<span><b>'+esc(s)+'</b><small>Lista demonstracyjna</small></span>').join('');
set('#settingsDatabaseCopy','SQLite nie jest podłączone do GitHub Pages.');
set('#settingsDatabaseStats','Brak dostępu do danych lokalnych.');
$$('.nav-item').forEach(n=>n.setAttribute('aria-label',n.textContent.trim()));
navigate(new URLSearchParams(location.search).get('view')||'scanner');

/* Mobile offer cards intentionally use illustrative dataset; no API calls. */
function demoMobileOffers(){const node=$('#offersMobileList');if(!node)return;const q=$('#offerSearch').value.toLocaleLowerCase('pl');const list=books.filter(b=>(b.title+' '+b.source).toLocaleLowerCase('pl').includes(q));node.innerHTML=list.map(b=>'<button class="mobile-offer" type="button" data-demo-title="'+esc(b.title)+'"><span class="book-spine" aria-hidden="true">▤</span><span class="mobile-offer-copy"><strong>'+esc(b.title)+'</strong><small>'+esc(b.source)+' · '+esc(b.isbn)+'</small><small class="mobile-offer-match">Wydanie demonstracyjne</small></span><span class="mobile-offer-price"><b>'+b.price+',00 zł</b><small>Demo</small></span></button>').join('');node.querySelectorAll('button').forEach(b=>b.onclick=()=>alert('Podgląd statyczny: '+b.dataset.demoTitle));}
$('#offerSearch').addEventListener('input',demoMobileOffers);demoMobileOffers();

/* BookFlip 3.1 static preview: independent, read-only illustration of filters and comparison. */
const demoOfferSource=$('#scannerOfferSource'),demoOfferSearch=$('#scannerOfferSearch');
function demoScannerOffers(){
  if(!demoOfferSource||!demoOfferSearch)return;
  const source=demoOfferSource.value,needle=demoOfferSearch.value.trim().toLocaleLowerCase('pl');
  const matches=books.filter(b=>(!source||b.source===source)&&(!needle||(b.title+' '+b.author+' '+b.isbn+' '+b.source).toLocaleLowerCase('pl').includes(needle)));
  set('#scannerOfferCount','Pokazano '+matches.length+' z '+matches.length+' przykładów');
  $('#scannerOfferList').innerHTML=matches.map(b=>'<button type="button" class="scanner-offer-row" data-example="'+esc(b.title)+'"><span class="book-spine" aria-hidden="true">▤</span><span class="scanner-offer-copy"><strong>'+esc(b.title)+'</strong><small>'+esc(b.source)+' · '+esc(b.isbn)+'</small><small>Przykładowa oferta</small></span><span class="scanner-offer-price">'+b.price+',00 zł</span></button>').join('')||'<div class="empty-detail">Brak pasujących przykładowych ofert.</div>';
  $$('#scannerOfferList [data-example]').forEach(b=>b.onclick=()=>alert('Demonstracja — '+b.dataset.example+'. Brak lokalnego API.'));
}
if(demoOfferSource&&demoOfferSearch){demoOfferSource.innerHTML='<option value="">Wszystkie źródła</option>'+[...new Set(books.map(x=>x.source))].map(v=>'<option>'+esc(v)+'</option>').join('');demoOfferSource.onchange=demoScannerOffers;demoOfferSearch.oninput=demoScannerOffers;demoScannerOffers();}
$('#scannerBrowseOffers').onclick=()=>navigate('offers');
