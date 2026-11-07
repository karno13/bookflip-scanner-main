import { openDetailView } from '../core/detail-navigation.js';
import { amountInput, readAmount, statusLabel, markDirty,watchForm } from '../core/ux.js';
import { confirmDialog } from '../core/dialogs.js';
export function installTradingControls({state,$,json,toast,showView,loadCatalogData,loadCatalogStatus,openOfferDrawer,onOfferFilters,onCatalogFilters}) {
  const write=(path,body,method='PUT')=>json(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let settingsLoaded=false;
  let savedDefaults=()=>{};
  for(const input of ['#catalogLanguage','#catalogPublisher','#catalogYear','#catalogBinding']) $(input).addEventListener('input',onCatalogFilters);
  for(const input of ['#offerScan','#offerScanChange']) $(input).addEventListener('change',onOfferFilters);
  for(const input of ['#offerMinPrice','#offerMaxPrice']) $(input).addEventListener('input',onOfferFilters);
  $('#offerQuickViews').querySelectorAll('[data-purchase-view]').forEach(button=>button.addEventListener('click',()=>{
    state.offerView=button.dataset.purchaseView;
    $('#offerQuickViews').querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    onOfferFilters();
  }));
  // Presentation only: turns the run summary into scannable tiles and highlights the likely next step.
  function renderScanResultCard(run, failed) {
    const tiles = [
      ['Znalezione oferty', run.found, ''],
      ['Nowe oferty', run.newOffers, run.newOffers ? 'good' : ''],
      ['Zmiany cen', run.priceChanges, run.priceChanges ? 'warn' : ''],
      ['Problemy ze źródłami', failed, failed ? 'bad' : ''],
    ];
    const stats = $('#scanResultStats');
    stats.replaceChildren(...tiles.map(([label, value, tone]) => {
      const tile = document.createElement('div');
      tile.className = 'scan-result-tile' + (tone ? ' is-' + tone : '');
      tile.setAttribute('role', 'listitem');
      const number = document.createElement('strong');
      number.textContent = String(value ?? 0);
      const caption = document.createElement('span');
      caption.textContent = label;
      tile.append(number, caption);
      return tile;
    }));
    const prefer = run.newOffers > 0 ? '#scanNewResults' : '#scanAllResults';
    for (const id of ['#scanAllResults', '#scanNewResults']) {
      $(id).className = 'button ' + (id === prefer ? 'primary' : 'secondary');
    }
    const queue = state.catalogPages?.jobs?.total;
    $('#scanReviewResults').textContent = Number.isFinite(queue) && queue > 0 ? 'Do weryfikacji (' + queue + ')' : 'Do weryfikacji';
  }
  async function refreshRuns() {
    const response=await json('/api/scan-runs'); state.scanRuns=response.items || [];
    const selected=$('#offerScan').value;
    const empty=document.createElement('option');empty.value='';empty.textContent='Wszystkie skany';
    $('#offerScan').replaceChildren(empty);
    for(const run of state.scanRuns) {
      const option=document.createElement('option');option.value=run.at;
      option.textContent=new Date(run.at).toLocaleString('pl-PL')+' · '+run.found+' ofert'+(run.indexed?'':' · brak szczegółów starego skanu');option.disabled=!run.indexed;$('#offerScan').append(option);
    }
    $('#offerScan').value=selected;
    const run=state.scanRuns[0];
    if(run?.indexed) {
      $('#scanResults').hidden=false;
      const failed=run.errors?.length||0;
      $('#scanResultSummary').textContent=`Ostatni zapisany skan: ${run.found} ofert · ${run.newOffers} nowych · ${run.priceChanges} zmian cen${failed?' · '+failed+' zadań z problemami — wyniki mogą być niepełne':''}`;
      $('#retryFailedScan').hidden=!failed || !run.context;
      renderScanResultCard(run, failed);
    }
  }
  async function showResults(change='',review=false) {
    await refreshRuns();const run=state.scanRuns[0];if(!run?.indexed) return toast('Brak skanu ze szczegółowymi wynikami. Uruchom nowy skan.');
    if(review) {
      state.reviewOffer='';
      state.reviewScan=run.at;
      $('#reviewScanScope').hidden=false;
      $('#reviewScanScope').textContent='Weryfikacja wyników skanu '+new Date(run.at).toLocaleString('pl-PL')+'. ';
      const clear=document.createElement('button');clear.type='button';clear.textContent='Pokaż wszystkie zadania';clear.className='button secondary';
      clear.addEventListener('click',async()=>{state.reviewScan='';$('#reviewScanScope').hidden=true;await loadCatalogData();});
      $('#reviewScanScope').append(clear);showView('review');await loadCatalogData();return;
    }
    $('#offerScan').value=run.at;$('#offerScanChange').value=change;state.offerView='all';state.offerPage=1;
    $('#offerStatus').value='';$('#offerSource').value='';$('#offerSearch').value='';$('#offerMinPrice').value='';$('#offerMaxPrice').value='';
    $('#offerQuickViews').querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.purchaseView==='all')));
    showView('offers');await loadCatalogData();
  }
  $('#scanAllResults').addEventListener('click',()=>void showResults().catch(error=>toast(error.message)));
  $('#scanNewResults').addEventListener('click',()=>void showResults('new').catch(error=>toast(error.message)));
  $('#scanPriceResults').addEventListener('click',()=>void showResults('price').catch(error=>toast(error.message)));
  $('#scanReviewResults').addEventListener('click',()=>void showResults('',true).catch(error=>toast(error.message)));
  document.addEventListener('bookflip-review-offer',async event=>{
    try {
      state.reviewOffer=event.detail.offerId;state.reviewScan='';await loadCatalogData();
      state.selectedReviewId=event.detail.jobId;state.reviewDetail=await json('/api/offers/'+encodeURIComponent(event.detail.offerId));
      $('#reviewScanScope').hidden=false;$('#reviewScanScope').textContent='Weryfikacja wybranej oferty. ';
      const clear=document.createElement('button');clear.type='button';clear.className='button secondary';clear.textContent='Pokaż całą kolejkę';
      clear.addEventListener('click',async()=>{state.reviewOffer='';$('#reviewScanScope').hidden=true;await loadCatalogData();});$('#reviewScanScope').append(clear);
      showView('review');
      openDetailView('review');
    }catch(error){toast('Nie udało się otworzyć zadania. Oferta może już być przetworzona.');}
  });
  // The scanner listens for exact source/query pairs, never a Cartesian retry.
  $('#retryFailedScan').addEventListener('click',()=>{
    const run=state.scanRuns[0];
    if(run?.errors?.length) document.dispatchEvent(new CustomEvent('bookflip-retry-scan',{detail:run.errors.map(row=>({source:row.source,query:row.query}))}));
  });
  document.addEventListener('bookflip-scan-complete',()=>{void refreshRuns().catch(error=>toast(error.message));});
  $('#mobileMore').addEventListener('click',()=>$('#moreDialog').showModal());
  $('#closeMore').addEventListener('click',()=>$('#moreDialog').close());
  document.querySelectorAll('[data-more-view]').forEach(button=>button.addEventListener('click',()=>{$('#moreDialog').close();showView(button.dataset.moreView);}));
  const defaultFields=['shipping','other'].map((key,i)=>amountInput(i?'Inne koszty (zł)':'Dostawa (zł)',key));
  $('#defaultCostFields').append(...defaultFields);
  $('#saveTradingDefaults').addEventListener('click',async()=>{
    const button=$('#saveTradingDefaults');button.disabled=true;
    try {await write('/api/trading-defaults',Object.fromEntries(defaultFields.map(field=>[field.querySelector('input').name,readAmount(field.querySelector('input'))])));savedDefaults();$('#defaultsResult').textContent='Zapisano domyślne koszty.';}
    catch(error){$('#defaultsResult').textContent='Nie zapisano kosztów. Wpisz poprawne kwoty do dwóch miejsc po przecinku.';}
    finally{button.disabled=false;}
  });
  async function refreshData() {
    const data=await json('/api/data/overview');$('#dataLocation').textContent='Plik danych: '+data.databasePath;
    if(!$('#copyDataLocation')) {
      const copy=document.createElement('button');copy.id='copyDataLocation';copy.type='button';copy.className='button secondary';copy.textContent='Kopiuj lokalizację danych';
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(data.databasePath);$('#backupResult').textContent='Skopiowano lokalizację danych.';}catch(error){$('#backupResult').textContent='Nie udało się skopiować. Zaznacz i skopiuj ścieżkę powyżej.';}});$('#dataLocation').after(copy);
    }
    $('#lastBackup').textContent=data.lastBackupAt?'Ostatnia lokalna kopia: '+new Date(data.lastBackupAt).toLocaleString('pl-PL'):'Brak lokalnych kopii zapasowych. Utwórz pierwszą kopię.';
  }
  $('#createBackup').addEventListener('click',async()=>{
    const button=$('#createBackup');button.disabled=true;$('#backupResult').textContent='Tworzenie i sprawdzanie kopii…';
    try{const result=await write('/api/data/backup',{},'POST');$('#backupResult').textContent='Kopia utworzona: '+result.path+'. Przenieś dodatkową kopię na inny dysk.';await refreshData();}
    catch(error){$('#backupResult').textContent='Nie udało się utworzyć kopii. Sprawdź wolne miejsce i prawa zapisu.';}
    finally{button.disabled=false;}
  });
  async function refreshSettings() {
    try {
      const [health]=await Promise.all([json('/api/source-health'),refreshData()]);
      $('#settingsSources').replaceChildren();
      for(const source of state.sources) {
        const row=health.items.find(item=>item.source===source);
        const item=document.createElement('span'),title=document.createElement('b'),copy=document.createElement('small');title.textContent=source;
        copy.textContent=row ? `${row.status==='ok'?'Ostatnia próba udana':'Ostatnia próba z problemami'} · sukces: ${row.last_success_at?new Date(row.last_success_at).toLocaleString('pl-PL'):'brak'} · błąd: ${row.last_error_at?new Date(row.last_error_at).toLocaleString('pl-PL'):'brak'}` : 'Dostępny w programie; jeszcze nie sprawdzono działania.';
        item.append(title,copy);$('#settingsSources').append(item);
      }
      if(!settingsLoaded) {
        const defaults=await json('/api/trading-defaults');defaultFields.forEach(field=>{const input=field.querySelector('input');input.value=defaults[input.name]??'';});savedDefaults=watchForm('defaults',defaultFields.map(field=>field.querySelector('input')));settingsLoaded=true;
      }
    } catch(error){toast('Nie udało się odświeżyć ustawień. Spróbuj ponownie.');}
  }
  async function refreshDecisions() {
    try {
      const response=await json('/api/review-decisions');const parent=$('#reviewDecisionHistory');parent.replaceChildren();
      for(const row of response.items) {
        const item=document.createElement('div');item.className='decision-history-row';
        const label=document.createElement('span');label.textContent=row.title+' · '+statusLabel(row.action)+' · '+new Date(row.createdAt).toLocaleString('pl-PL');
        const reopen=document.createElement('button');reopen.type='button';reopen.className='button secondary';reopen.textContent=row.revisionId?'Otwarto ponownie':'Popraw decyzję';reopen.disabled=Boolean(row.revisionId);
        reopen.addEventListener('click',async()=>{
          if(!(await confirmDialog('Otworzyć ofertę do ponownej weryfikacji? Poprzednia decyzja pozostanie w historii. Aktualne przypisanie tej decyzji zostanie wycofane.', { title: 'Ponowna weryfikacja', confirmLabel: 'Otwórz ponownie', danger: true }))) return;
          reopen.disabled=true;
          try {const result=await write('/api/review-decisions/'+encodeURIComponent(row.id)+'/reopen',{},'POST');state.reviewScan='';await loadCatalogData();state.selectedReviewId=result.jobId;showView('review');await refreshDecisions();await loadCatalogStatus();}
          catch(error){reopen.disabled=false;toast('Nie można poprawić tej decyzji: istnieje nowsza zmiana lub zadanie jest w toku.');}
        });item.append(label,reopen);parent.append(item);
      }
      if(!response.items.length) parent.textContent='Nie podjęto jeszcze ręcznych decyzji.';
    }catch(error){$('#reviewDecisionHistory').textContent='Nie udało się odczytać historii decyzji.';}
  }
  $('#reviewDecisionHistory').closest('details').addEventListener('toggle',event=>{if(event.currentTarget.open) void refreshDecisions();});
  return {refreshRuns,refreshSettings,refreshDecisions,showResults,openOfferDrawer};
}
