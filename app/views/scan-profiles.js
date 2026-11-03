// Browser storage is read only for explicit legacy migration; live profiles are in SQLite.
const KEY = 'bookflip-scan-profiles-v1';
function readLegacyProfiles() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter(p =>
      p && typeof p.name === 'string' && Array.isArray(p.queries) &&
      Array.isArray(p.sources)).slice(0,30) : [];
  } catch { return []; }
}
export async function installScanProfiles({ queriesInput, sourceGrid, panel, toast, json }) {
  if (!queriesInput || !sourceGrid || !panel) return;
  if (typeof json !== 'function') throw Error('SCAN_PROFILES_API_REQUIRED');
  let profiles = [];
  const root = document.createElement('div');
  root.className = 'scan-profiles';
  const title = document.createElement('strong');
  title.textContent = 'Profile skanowania (SQLite)';
  const picker = document.createElement('select');
  picker.setAttribute('aria-label','Wybierz profil skanowania');
  const name = document.createElement('input');
  name.placeholder = 'Nazwa profilu';
  name.maxLength = 60;
  name.setAttribute('aria-label','Nazwa nowego profilu');
  const load = document.createElement('button');
  load.type = 'button';
  load.className = 'button secondary compact';
  load.textContent = 'Wczytaj profil';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'button secondary compact';
  save.textContent = 'Zapisz profil';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button secondary compact';
  remove.textContent = 'Usuń profil';
  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'button secondary compact';
  importButton.textContent = 'Importuj lokalne profile';
  const buttons = document.createElement('div');
  buttons.className = 'scan-profile-actions';
  buttons.append(load,save,remove,importButton);
  root.append(title,picker,name,buttons);
  panel.prepend(root);
  function refresh(selected = '') {
    picker.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Wybierz profil';
    picker.append(empty);
    for (const item of profiles) {
      const option = document.createElement('option');
      option.value = item.name;
      option.textContent = item.name;
      picker.append(option);
    }
    picker.value = selected;
    importButton.hidden = readLegacyProfiles().length === 0;
  }
  async function reload(selected = '') {
    const response = await json('/api/scan-profiles');
    profiles = response.items || [];
    refresh(selected);
  }
  save.addEventListener('click', async () => {
    const profileName = name.value.trim();
    if (!profileName) return toast('Wpisz nazwę profilu.');
    const queries = [...new Set(queriesInput.value.split(/[\n,]/).map(x => x.trim()).filter(Boolean))].slice(0,10);
    const sources = [...sourceGrid.querySelectorAll('input:checked')].map(input => input.value);
    if (!queries.length || !sources.length) return toast('Profil wymaga fraz i wybranych źródeł.');
    save.disabled = true;
    try {
      await json('/api/scan-profiles/'+encodeURIComponent(profileName), {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({queries,sources}),
      });
      await reload(profileName);
      toast('Zapisano profil w SQLite.');
    } catch(error) {toast('Błąd zapisu profilu: '+error.message);}
    finally {save.disabled=false;}
  });
  load.addEventListener('click', () => {
    const profile = profiles.find(p => p.name === picker.value);
    if (!profile) return;
    queriesInput.value = profile.queries.join('\n');
    const available = [...sourceGrid.querySelectorAll('input[type="checkbox"]')];
    available.forEach(input => {input.checked = profile.sources.includes(input.value);});
    const missing = profile.sources.filter(id => !available.some(input => input.value === id));
    toast(missing.length ? 'Wczytano profil. Niedostępne źródła: '+missing.join(', ') : 'Wczytano profil.');
  });
  remove.addEventListener('click', async () => {
    if (!picker.value) return;
    remove.disabled=true;
    try {
      await json('/api/scan-profiles/'+encodeURIComponent(picker.value),{method:'DELETE'});
      await reload();
      toast('Usunięto profil z SQLite.');
    } catch(error) {toast('Błąd usuwania profilu: '+error.message);}
    finally {remove.disabled=false;}
  });
  importButton.addEventListener('click', async () => {
    const legacy = readLegacyProfiles();
    if (!legacy.length || !confirm('Zaimportować profile do SQLite? Istniejące profile nie będą nadpisane.')) return;
    importButton.disabled=true;
    let created=0,skipped=0,failed=0;
    try {
      for (const item of legacy) {
        try {
          const outcome = await json('/api/scan-profiles/import',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:item.name,queries:item.queries,sources:item.sources}),
          });
          if (outcome.created) created++; else skipped++;
        } catch {failed++;}
      }
      await reload();
      toast(`Import: ${created} nowych, ${skipped} pominiętych, ${failed} błędnych. Dane lokalne zachowano.`);
    } catch(error) {toast('Błąd odczytu profili: '+error.message);}
    finally {importButton.disabled=false;}
  });
  await reload();
}
