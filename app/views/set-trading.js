import {money,groszeToZloty,moneyFromZloty,safeOfferHref} from '../core/formatters.js';
import {markDirty,confirmDiscard,amountInput,readAmount,watchForm} from '../core/ux.js';
export function mountSetTrading({active,target,json,refresh,toast,openOfferDrawer}) {
  const request=(method,path,body)=>json(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const section=document.createElement('section');section.className='set-trading trading-only';target.append(section);
  const details=document.createElement('button');details.type='button';details.className='button secondary';details.textContent='Szczegóły oferty i decyzja zakupowa';details.addEventListener('click',()=>openOfferDrawer(active.offerId));
  const link=document.createElement('a');link.href=safeOfferHref(active.url);link.target='_blank';link.rel='noreferrer';link.className='button secondary';link.textContent='Otwórz ogłoszenie';section.append(details,link);
  const confirmation=document.createElement('label');const check=document.createElement('input');check.type='checkbox';check.checked=active.compositionConfirmed;check.disabled=Boolean(active.unknownItems?.length)||!active.editions.length;confirmation.append(check,document.createTextNode(' Potwierdzam pełny skład zestawu'));
  check.addEventListener('change',async()=>{check.disabled=true;try{await request('PUT','/api/set-details/'+encodeURIComponent(active.offerId),{confirmed:check.checked});toast('Zapisano stan potwierdzenia składu.');}catch(error){check.checked=!check.checked;toast('Nie zapisano potwierdzenia. Najpierw rozpoznaj wszystkie pozycje.');}finally{check.disabled=Boolean(active.unknownItems?.length)||!active.editions.length;}});section.append(confirmation);
  const heading=document.createElement('h4');heading.textContent='Książki jeszcze nierozpoznane';section.append(heading);
  for(const item of active.unknownItems||[]) {
    const row=document.createElement('div');row.className='sets-member';const label=document.createElement('span');label.textContent=item.title+' · '+item.quantity+' egz.';const remove=document.createElement('button');remove.type='button';remove.className='button secondary';remove.textContent='Usuń po rozpoznaniu';remove.addEventListener('click',async()=>{if(!await confirmDiscard())return;try{await request('DELETE','/api/set-unknown/'+encodeURIComponent(active.offerId)+'/'+encodeURIComponent(item.id));await refresh(active.offerId);}catch(error){toast('Nie usunięto pozycji. Spróbuj ponownie.');}});row.append(label,remove);section.append(row);
  }
  const form=document.createElement('form');form.className='set-unknown-form';const title=document.createElement('input');title.placeholder='Opis nierozpoznanej książki';title.setAttribute('aria-label','Opis nierozpoznanej książki');title.maxLength=300;title.required=true;const count=document.createElement('input');Object.assign(count,{type:'number',min:'1',max:'10000',step:'1',value:'1'});count.setAttribute('aria-label','Liczba nierozpoznanych egzemplarzy');const add=document.createElement('button');add.type='submit';add.className='button secondary';add.textContent='Dodaj nierozpoznaną pozycję';form.append(title,count,add);section.append(form);
  const savedUnknown=watchForm('set-unknown',[title,count]);
  form.addEventListener('submit',async event=>{event.preventDefault();add.disabled=true;try{await request('POST','/api/set-unknown/'+encodeURIComponent(active.offerId),{title:title.value,quantity:Number(count.value)});savedUnknown();if(await confirmDiscard())await refresh(active.offerId);}catch(error){toast('Nie zapisano nierozpoznanej pozycji. Sprawdź opis i ilość.');}finally{add.disabled=false;}});
  const costDetails=document.createElement('details');costDetails.className='set-cost-disclosure';const costSummary=document.createElement('summary');costSummary.textContent='Koszt zakupu i kalkulator pakietu';costDetails.append(costSummary);section.append(costDetails);const costs=document.createElement('section');costs.className='set-costs';const costTitle=document.createElement('h4');costTitle.textContent='Koszt zakupu i scenariusz odsprzedaży pakietu';costs.append(costTitle);costDetails.append(costs);
  async function mountCosts() {
    try {
      const [saved,defaults]=await Promise.all([json('/api/offer-scenarios/'+encodeURIComponent(active.offerId)),json('/api/trading-defaults')]);
      if(!costs.isConnected)return;
      const fields={};const labels={purchase:'Planowana cena zakupu (zł)',shipping:'Dostawa (zł)',other:'Inne koszty (zł)',resale:'Zakładana odsprzedaż całego pakietu (zł)',actualPurchase:'Faktyczna cena zakupu (zł)'};
      const complete=!active.unknownItems?.length&&active.editions.length>0&&active.editions.every(item=>item.resalePrice!==null);
      const total=complete?active.editions.reduce((sum,item)=>sum+item.quantity*item.resalePrice,0):null;
      for(const [key,label] of Object.entries(labels)) {
        const value=saved.updatedAt?saved[key]:key==='purchase'?groszeToZloty(active.currentPrice):key==='resale'?total:defaults[key];
        const field=amountInput(label,key,value);fields[key]=field.querySelector('input');costs.append(field);
      }
      const sum=document.createElement('p');sum.textContent=total===null?'Uzupełnij ceny wszystkich składników i rozpoznaj nieznane pozycje, aby uzyskać sumę odsprzedaży.':'Suma założeń dla składników: '+moneyFromZloty(total);costs.append(sum);
      if(total!==null){const use=document.createElement('button');use.type='button';use.className='button secondary';use.textContent='Użyj sumy cen składników';use.addEventListener('click',()=>{fields.resale.value=total;markDirty('set-costs');calculate();});costs.append(use);}
      const output=document.createElement('output');output.className='scenario-result';costs.append(output);
      function calculate(){const values=['purchase','shipping','other','resale'].map(key=>readAmount(fields[key]));if(values.some(value=>value===null||!Number.isFinite(value)||value<0)){output.textContent='Uzupełnij cztery kwoty scenariusza. Wynik nie jest potwierdzoną ceną sprzedaży.';return;}const cost=values[0]+values[1]+values[2];output.textContent='Pełny koszt: '+moneyFromZloty(cost)+' · hipotetyczny wynik: '+moneyFromZloty(values[3]-cost)+' przed podatkiem.';}
      const savedCosts=watchForm('set-costs',Object.values(fields));
      Object.values(fields).forEach(input=>input.addEventListener('input',calculate));calculate();
      const save=document.createElement('button');save.type='button';save.className='button primary';save.textContent='Zapisz scenariusz pakietu';const status=document.createElement('p');status.setAttribute('role','status');costs.append(save,status);
      save.addEventListener('click',async()=>{save.disabled=true;try{await request('PUT','/api/offer-scenarios/'+encodeURIComponent(active.offerId),Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,readAmount(input)])));savedCosts();status.textContent='Zapisano scenariusz. Ceny są Twoimi założeniami.';}catch(error){status.textContent='Nie zapisano. Sprawdź kwoty.';}finally{save.disabled=false;}});
    }catch(error){costs.append(document.createTextNode('Nie udało się odczytać scenariusza. Wybierz zestaw ponownie.'));}
  }
  void mountCosts();
}
