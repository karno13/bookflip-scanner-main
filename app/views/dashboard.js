import { allSavedOfferNotes } from './offer-workspace.js';
import {json} from '../core/api.js';
export function installDashboard({ state, showView }) {
  const scanner = document.querySelector('#view-scanner');
  if (!scanner || document.querySelector('#workflowDashboard')) return () => {};
  const panel = document.createElement('section');
  panel.id = 'workflowDashboard';
  panel.className = 'panel workflow-dashboard';
  const heading = document.createElement('h3');
  heading.textContent = 'Następne kroki zakupowe';
  const hint = document.createElement('p');
  hint.textContent = 'Weryfikuj towar i obserwuj oferty przed zakupem.';
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
  scanner.append(panel);
  async function refresh() {
    let summary;
    try{summary=await json('/api/trading-summary');}catch(error){hint.textContent='Nie udało się odświeżyć podsumowania. Użyj Odśwież.';return;}
    const watched=summary.watched,atTarget=summary.atTarget;
    const metrics = [
      ['Wymaga decyzji',summary.review],
      ['Obserwowane',watched],['Osiągnęły cenę docelową',atTarget]
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
