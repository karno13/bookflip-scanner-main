import { readOfferNotes } from './offer-workspace.js';
import { readSeries, seriesSummary } from './series.js';
export function installDashboard({ state, showView }) {
  const scanner = document.querySelector('#view-scanner');
  if (!scanner || document.querySelector('#workflowDashboard')) return () => {};
  const panel = document.createElement('section');
  panel.id = 'workflowDashboard';
  panel.className = 'panel workflow-dashboard';
  const heading = document.createElement('h3');
  heading.textContent = 'Pulpit pracy';
  const hint = document.createElement('p');
  hint.textContent = 'Podsumowanie wczytanych danych; liczby ofert mogą nie obejmować całej bazy.';
  const stats = document.createElement('div');
  stats.className = 'workflow-dashboard-stats';
  const links = document.createElement('div');
  links.className = 'workflow-dashboard-links';
  for (const [view,label] of [['review','Weryfikuj książki'],['catalog','Przeglądaj katalog'],['sets','Edytuj zestawy'],['offers','Przejdź do ofert']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary compact';
    button.textContent = label;
    button.addEventListener('click', () => showView(view));
    links.append(button);
  }
  panel.append(heading,hint,stats,links);
  scanner.querySelector('.view-heading')?.after(panel);
  function refresh() {
    const watched = Object.values(readOfferNotes()).filter(item => item?.watched).length;
    const series = seriesSummary(state.catalogWorks || [], readSeries());
    const metrics = [
      ['Oferty wczytane',state.sqliteOffers?.length || 0],
      ['Do weryfikacji (wczytane)',state.reviewJobs?.length || 0],
      ['Dzieła wczytane',state.catalogWorks?.length || 0],
      ['Obserwowane lokalnie',watched],
      ['Serie oznaczone lokalnie',series.length]
    ];
    stats.replaceChildren();
    for (const [name,value] of metrics) {
      const item = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = name;
      const number = document.createElement('strong');
      number.textContent = String(value);
      item.append(label,number);
      stats.append(item);
    }
  }
  refresh();
  return refresh;
}
