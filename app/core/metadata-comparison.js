// Read-only presentation of bibliographic metadata returned by BN and Open Library.
export function metadataComparisonMarkup(response, escapeHtml) {
  const fieldLabels = [
    ['title', 'Tytuł'], ['authors', 'Autorzy'], ['publisher', 'Wydawca'],
    ['publicationYear', 'Rok'], ['language', 'Język'], ['binding', 'Oprawa'],
  ];
  const fields = [response?.bn, response?.openLibrary];
  const cell = (source, field) => {
    const record = source?.records?.[0];
    const value = record?.[field];
    const formatted = Array.isArray(value) ? value.join(', ') : String(value ?? '—');
    return escapeHtml(formatted);
  };
  const rows = fieldLabels.map(([field, label]) =>
    `<tr><th scope="row">${label}</th><td>${cell(fields[0], field)}</td><td>${cell(fields[1], field)}</td></tr>`,
  ).join('');
  const provider = (source) => {
    const duration = Number(source?.timing?.durationMs);
    const seconds = Number.isFinite(duration) && duration >= 0 ? `${Math.round(duration)} ms` : 'czas niedostępny';
    const origin = source?.timing?.cached ? 'cache' : 'sieć';
    return `${escapeHtml(source?.status || 'brak danych')} · ${seconds} · ${origin}`;
  };
  const conflicts = response?.comparison?.conflicts || [];
  const comparison = response?.comparison?.status || 'nieustalone';
  const conflictLine = conflicts.length
    ? `<p class="inline-note"><strong>Konflikty:</strong> ${escapeHtml(conflicts.map((item) => item.field || item.type || 'nieznane').join(', '))}</p>`
    : '';
  return `<div class="metadata-comparison"><p><strong>Porównanie:</strong> ${escapeHtml(comparison)}</p><table><thead><tr><th scope="col">Pole</th><th scope="col">Biblioteka Narodowa<small>${provider(fields[0])}</small></th><th scope="col">Open Library<small>${provider(fields[1])}</small></th></tr></thead><tbody>${rows}</tbody></table>${conflictLine}<p class="inline-note">Wynik informacyjny. Przypisanie wymaga osobnego zatwierdzenia.</p></div>`;
}
