const trackingParameters = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'yclid',
]);

function isTrackingParameter(name) {
  return trackingParameters.has(name.toLowerCase()) || /^utm_/i.test(name);
}

export function normalizeOfferUrl(raw) {
  const url = new URL(raw);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  for (const name of [...url.searchParams.keys()])
    if (isTrackingParameter(name)) url.searchParams.delete(name);
  url.searchParams.sort();
  return url.href;
}

export function offerExternalId(offer = {}) {
  for (const value of [
    offer.externalOfferId,
    offer.offerId,
    offer.externalId,
    offer.itemId,
    offer.productId,
  ]) {
    const id = String(value ?? '').trim();
    if (id && id.length <= 300) return id;
  }
  return null;
}

export function sourceOfferId(source, rawUrl, explicitExternalId = null) {
  const url = normalizeOfferUrl(rawUrl),
    path = new URL(url).pathname;
  let external = String(explicitExternalId ?? '').trim() || null;
  if (!external) {
    if (source === 'Vinted') external = path.match(/^\/items\/(\d+)/i)?.[1] || null;
    else if (source === 'Empik') external = path.match(/,p(\d+),ksiazka-p$/i)?.[1] || null;
    else if (source === 'Allegro') external = path.match(/-(\d+)$/)?.[1] || null;
    else if (source === 'OLX') external = path.match(/-ID([\w]+)\.html$/i)?.[1] || null;
  }
  return `${source}:${external || url}`;
}

export function identifyOffer(offer) {
  if (!offer?.source || !offer?.url) throw Error('INVALID_OFFER_IDENTITY');
  const url = normalizeOfferUrl(offer.url),
    externalId = offerExternalId(offer);
  return {
    id: sourceOfferId(offer.source, url, externalId),
    source: offer.source,
    externalId,
    url,
  };
}
