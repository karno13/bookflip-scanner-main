const labels = {
  queued:'W kolejce',running:'Identyfikacja w toku',retry_wait:'Oczekuje na ponowienie',review_required:'Wymaga decyzji',failed:'Błąd identyfikacji',completed:'Zakończona',
  manual:'Potwierdzone ręcznie',verified:'Zweryfikowane',unverified:'Niezweryfikowane',historical_unverified:'Dane historyczne',
  watching:'Obserwowana',check:'Do sprawdzenia',negotiating:'Negocjowana',bought:'Kupiona',rejected:'Odrzucona',
  missing_isbn:'Brak ISBN',invalid_isbn:'Niepoprawny ISBN',operator_correction:'Ponownie otwarte do poprawienia',
  multiple_conflicting_isbn:'Sprzeczne numery ISBN',offer_catalog_conflict:'Dane oferty nie pasują do wydania',offer_metadata_conflict:'Dane oferty nie pasują do metadanych',
  metadata_sources_conflict:'Źródła podają różne dane',insufficient_offer_context:'Za mało danych do przypisania',
  isbn_not_found_in_metadata_sources:'ISBN nie występuje w źródłach',metadata_invalid_or_incomplete:'Niepełne dane wydania',
  metadata_source_temporary_error:'Źródło metadanych chwilowo niedostępne',approved:'Zatwierdzone wydanie',excluded:'Odrzucona oferta',not_book:'To nie jest książka',requeued:'Ponowiona identyfikacja',proposal_rejected:'Odrzucona propozycja',
};
export function statusLabel(value) { return labels[value] || (value ? 'Wymaga sprawdzenia' : 'Brak danych'); }
const dirtyScopes = new Set();
const discardHandlers = new Map();
export function markDirty(scope, dirty=true) { if(dirty) dirtyScopes.add(scope); else dirtyScopes.delete(scope); }
export function hasUnsavedChanges() { return dirtyScopes.size>0; }
export function allowDiscard() {
  if(!hasUnsavedChanges()) return true;
  if(!confirm('Masz niezapisane zmiany. Odrzucić je i kontynuować?')) return false;
  for(const scope of dirtyScopes) discardHandlers.get(scope)?.();
  dirtyScopes.clear(); return true;
}
export function watchForm(scope,controls) {
  const value=control=>control.type==='checkbox'?control.checked:control.value;
  let baseline=controls.map(value);
  const reset=()=>controls.forEach((control,index)=>{
    if(control.type==='checkbox')control.checked=baseline[index];else control.value=baseline[index];
  });
  discardHandlers.set(scope,reset);
  const update=()=>markDirty(scope,controls.some((control,index)=>value(control)!==baseline[index]));
  controls.forEach(control=>control.addEventListener('input',update));
  return ()=>{baseline=controls.map(value);if(discardHandlers.get(scope)===reset)markDirty(scope,false);};
}
if(typeof window!=='undefined') window.addEventListener('beforeunload',event=>{
  if(hasUnsavedChanges()) { event.preventDefault(); event.returnValue=''; }
});
export function readAmount(input) { return input.value.trim()==='' ? null : Number(input.value); }
export function amountInput(label,name,value=null) {
  const field=document.createElement('label'); field.className='field';
  const span=document.createElement('span'); span.textContent=label;
  const input=document.createElement('input'); Object.assign(input,{name,type:'number',min:'0',step:'0.01',value:value??''}); input.inputMode='decimal';
  field.append(span,input); return field;
}
