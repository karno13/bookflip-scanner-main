// Saved scan profiles are local preferences, not a scan scheduler.
const KEY = 'bookflip-scan-profiles-v1';
function readProfiles() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter(p => p && typeof p.name === 'string' && Array.isArray(p.queries) && Array.isArray(p.sources)).slice(0, 30) : [];
  } catch { return []; }
}
export function installScanProfiles({ queriesInput, sourceGrid, panel, toast }) {
  if (!queriesInput || !sourceGrid || !panel) return;
  const root = document.createElement('div');
  root.className = 'scan-profiles';
  const title = document.createElement('strong');
  title.textContent = 'Zapisane profile skanowania';
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', 'Wybierz profil skanowania');
  const name = document.createElement('input');
  name.placeholder = 'Nazwa profilu';
  name.maxLength = 60;
  name.setAttribute('aria-label', 'Nazwa nowego profilu');
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
  const buttons = document.createElement('div');
  buttons.className = 'scan-profile-actions';
  buttons.append(load, save, remove);
  root.append(title, picker, name, buttons);
  panel.prepend(root);
  function refresh(selected = '') {
    picker.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Wybierz profil';
    picker.append(empty);
    for (const p of readProfiles()) {
      const option = document.createElement('option');
      option.value = p.name;
      option.textContent = p.name;
      picker.append(option);
    }
    picker.value = selected;
  }
  save.addEventListener('click', () => {
    const profileName = name.value.trim();
    if (!profileName) return toast('Wpisz nazwę profilu.');
    const queries = [...new Set(queriesInput.value.split(/[\n,]/).map(s => s.trim()).filter(Boolean))].slice(0, 10);
    const sources = [...sourceGrid.querySelectorAll('input:checked')].map(input => input.value);
    if (!queries.length || !sources.length) return toast('Profil wymaga fraz i wybranych źródeł.');
    const profiles = readProfiles().filter(p => p.name !== profileName);
    if (profiles.length >= 30) return toast('Limit: 30 profili.');
    profiles.push({ name: profileName, queries, sources });
    try { localStorage.setItem(KEY, JSON.stringify(profiles)); refresh(profileName); toast('Zapisano profil skanowania.'); }
    catch { toast('Nie udało się zapisać profilu.'); }
  });
  load.addEventListener('click', () => {
    const profile = readProfiles().find(p => p.name === picker.value);
    if (!profile) return;
    queriesInput.value = profile.queries.join('\n');
    const available = [...sourceGrid.querySelectorAll('input[type="checkbox"]')];
    available.forEach(input => { input.checked = profile.sources.includes(input.value); });
    const missing = profile.sources.filter(id => !available.some(input => input.value === id));
    toast(missing.length ? 'Wczytano profil. Niedostępne źródła: ' + missing.join(', ') : 'Wczytano profil.');
  });
  remove.addEventListener('click', () => {
    if (!picker.value) return;
    const profiles = readProfiles().filter(p => p.name !== picker.value);
    try { localStorage.setItem(KEY, JSON.stringify(profiles)); refresh(); toast('Usunięto profil.'); }
    catch { toast('Nie udało się usunąć profilu.'); }
  });
  refresh();
}
