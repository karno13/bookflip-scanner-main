// Parsers extracted from karno13/nextjs-boilerplate, archiwum-scanner/runtime/scanner.mjs.
// Transport, user data, catalog and credentials are not copied.
const clean=s=>String(s).replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(+n,1114111))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
function baseOffer(b,title,url,source,price,currency,condition,checked){if(!Number.isFinite(price)||price<=0||price>100000||currency!=='PLN'||!url.startsWith('https://')||!b.accept(clean(title)))return null;return{id:source+':'+url,title:clean(title),url,source,price,currency,condition,checked,available:true};}
function parseAllegroListing(html, book, checked) {
	const products = [];
	let listing = false;
	const visit = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			node.forEach(visit);
			return;
		}
		const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
		if (types.includes("ItemList")) listing = true;
		if (types.some((type) => ["Product", "Book"].includes(type))) products.push(node);
		for (const key of [
			"@graph",
			"itemListElement",
			"item"
		]) visit(node[key]);
	};
	for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) try {
		visit(JSON.parse(script[1]));
	} catch {}
	const empty = /class=["'][^"']*mlc-no-offers-to-show/.test(html);
	if (!products.length && !listing && !empty) throw Error("Nie potwierdzono danych ofert w odpowiedzi źródła. Sprawdź wyszukiwanie ręcznie.");
	const offers = [];
	for (const product of products) for (const data of Array.isArray(product.offers) ? product.offers : [product.offers]) {
		if (!data || data["@type"] === "AggregateOffer" || data.priceCurrency !== "PLN") continue;
		let url;
		try {
			url = new URL(data.url || product.url);
		} catch {
			continue;
		}
		if (url.protocol !== "https:" || url.hostname !== "allegrolokalnie.pl" || url.port || url.username || url.password || !/^\/oferta\/[^/]+$/.test(url.pathname)) continue;
		const condition = /UsedCondition/.test(data.itemCondition || product.itemCondition || "") ? "used" : /NewCondition/.test(data.itemCondition || product.itemCondition || "") ? "new" : "unknown";
		const offer = baseOffer(book, clean(product.name || ""), url.href, "Allegro Lokalnie", Number(data.price), "PLN", condition, checked, true);
		if (!offer) continue;
		const availability = String(data.availability || "");
		offer.available = /InStock|LimitedAvailability/.test(availability);
		offer.availabilityKnown = /InStock|LimitedAvailability|OutOfStock|Discontinued|SoldOut/.test(availability);
		offer.image = typeof product.image === "string" ? product.image : product.image?.url || null;
		offers.push(offer);
	}
	return [...new Map(offers.map((offer) => [offer.url, offer])).values()];
}

function objectAt(text, start) {
	let depth = 0, inString = false, escaped = false;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (c === "\\") escaped = true;
			else if (c === "\"") inString = false;
			continue;
		}
		if (c === "\"") inString = true;
		else if (c === "{") depth++;
		else if (c === "}" && --depth === 0) try {
			return JSON.parse(text.slice(start, i + 1));
		} catch {
			return null;
		}
	}
	return null;
}

function rscText(html) {
	const chunks = [];
	for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) try {
		const p = JSON.parse(m[1]);
		if (p[0] === 1 && typeof p[1] === "string") chunks.push(p[1]);
	} catch {}
	return chunks.join("");
}

function parseVinted(html, b, checked) {
	const out = [];
	const data = rscText(html);
	if (!/"productItem":\s*\{/.test(data) && !/"items":\s*\{\s*"items":\s*\[\s*\]/.test(data)) throw Error("Nie rozpoznano danych wyników Vinted; źródło nie zostało potwierdzone.");
	for (const m of data.matchAll(/"productItem":\s*\{/g)) {
		const p = objectAt(data, m.index + m[0].length - 1);
		if (!p || typeof p.title !== "string" || typeof p.url !== "string" || !/^\/items\/\d+/.test(p.url)) continue;
		const amount = p.priceWithDiscount?.amount ?? p.price?.amount;
		const currency = p.priceWithDiscount?.currencyCode ?? p.price?.currencyCode;
		if (typeof amount !== "string" && typeof amount !== "number") continue;
		const state = p.itemBox?.secondLine || "";
		const condition = /nowy|new with|new without/i.test(state) ? "new" : /dobry|zadowalaj|very good|good|satisfactory/i.test(state) ? "used" : "unknown";
		const languageAttribute = Array.isArray(p.attributes) ? p.attributes.find(attribute => /(?:język|language)/i.test(String(attribute?.name || attribute?.key || attribute?.title || ""))) : null;
		const languageValue = languageAttribute?.value?.title || languageAttribute?.value?.name || languageAttribute?.value || languageAttribute?.values?.[0]?.title || languageAttribute?.values?.[0]?.name || languageAttribute?.values?.[0];
		const metadata = {language: p.language || p.languageCode || languageValue};
		if (!b.accept(p.title, metadata)) continue;
		const o = baseOffer(b, p.title, "https://www.vinted.pl" + p.url, "Vinted", Number(amount), currency || "PLN", condition, checked, true);
		if (!o) continue;
		if (/magyar|hungarian|rész|français|francais|deutsch|german|italiano|espa[nñ]ol/i.test(p.title)) continue;
		const fee = p.serviceFee?.amount;
		const feeCurrency = p.serviceFee?.currencyCode;
		if (fee != null && feeCurrency === currency && Number.isFinite(Number(fee)) && Number(fee) >= 0) o.buyerFee = Number(fee);
		o.languageVerified = false;
		o.available = p.isSold !== true && p.isClosed !== true;
		out.push(o);
	}
	return Array.from(new Map(out.map((o) => [o.id, o])).values());
}

function parseOlx(html, b, checked) {
	const out = [];
	for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) try {
		const node = JSON.parse(m[1]);
		for (const o of node.offers?.offers || []) {
			const r = baseOffer(b, o.name || "", o.url || "", "OLX", +o.price, o.priceCurrency || "PLN", /UsedCondition/.test(o.itemCondition) ? "used" : /NewCondition/.test(o.itemCondition) ? "new" : "unknown", checked);
			if (r) out.push(r);
		}
	} catch {}
	return out;
}
export {parseVinted,parseAllegroListing,parseOlx,rscText,objectAt};
