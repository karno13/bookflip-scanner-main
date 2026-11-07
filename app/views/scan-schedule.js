// Automatic recurring scan of one saved profile. Settings live in SQLite; the server runs the scans
// while the app is open, using the same endpoint and limits as a manual scan.
export async function mountScanSchedule({ panel, json, toast, escapeHtml }) {
  if (!panel) return;
  const root = document.createElement('details');
  root.className = 'scan-schedule';
  root.innerHTML = `<summary>Automatyczny skan</summary>
    <div class="scan-schedule-body">
      <label class="field"><span>Profil do skanowania</span><select id="scheduleProfile" aria-label="Profil do automatycznego skanu"></select></label>
      <label class="field"><span>Co ile godzin</span><input id="scheduleHours" type="number" min="1" max="168" step="1" value="24" inputmode="numeric"></label>
      <label class="check"><input id="scheduleEnabled" type="checkbox"> Skanuj automatycznie, gdy aplikacja jest uruchomiona</label>
      <button id="scheduleSave" class="button secondary compact" type="button">Zapisz harmonogram</button>
      <p id="scheduleStatus" class="inline-note" role="status" aria-live="polite"></p>
    </div>`;
  panel.append(root);
  const $ = (selector) => root.querySelector(selector);

  const describe = (schedule) => {
    if (!schedule.enabled) return 'Automatyczny skan jest wyłączony.';
    const last = schedule.lastRunAt
      ? `Ostatni: ${new Date(schedule.lastRunAt).toLocaleString('pl-PL')} (${schedule.lastResult === 'ok' ? 'udany' : schedule.lastResult || 'brak wyniku'}).`
      : 'Jeszcze się nie odbył.';
    const next = schedule.nextRunAt ? ` Następny: ${new Date(Math.max(schedule.nextRunAt, Date.now())).toLocaleString('pl-PL')}.` : '';
    return last + next;
  };

  async function load() {
    try {
      const [profiles, schedule] = await Promise.all([json('/api/scan-profiles'), json('/api/scan-schedule')]);
      const items = Array.isArray(profiles) ? profiles : profiles.items || [];
      $('#scheduleProfile').innerHTML =
        '<option value="">Wybierz profil</option>' +
        items.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
      $('#scheduleProfile').value = schedule.profile || '';
      $('#scheduleHours').value = schedule.everyHours;
      $('#scheduleEnabled').checked = schedule.enabled;
      $('#scheduleStatus').textContent = items.length
        ? describe(schedule)
        : 'Najpierw zapisz profil wyszukiwania, aby móc go skanować automatycznie.';
    } catch (error) {
      $('#scheduleStatus').textContent = 'Nie udało się wczytać harmonogramu: ' + error.message;
    }
  }

  $('#scheduleSave').addEventListener('click', async () => {
    const button = $('#scheduleSave');
    button.disabled = true;
    try {
      const saved = await json('/api/scan-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: $('#scheduleEnabled').checked,
          profile: $('#scheduleProfile').value,
          everyHours: Number($('#scheduleHours').value),
        }),
      });
      $('#scheduleStatus').textContent = describe(saved);
      toast('Zapisano harmonogram skanowania.');
    } catch (error) {
      toast(
        error.message === 'SCHEDULE_PROFILE_NOT_FOUND'
          ? 'Wybierz zapisany profil.'
          : error.message === 'INVALID_SCHEDULE_INTERVAL'
            ? 'Podaj liczbę godzin od 1 do 168.'
            : 'Nie zapisano harmonogramu: ' + error.message,
      );
    } finally {
      button.disabled = false;
    }
  });
  root.addEventListener('toggle', () => {
    if (root.open) void load();
  });
}
