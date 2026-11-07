// Reads structured facts from an offer's own detail page. Only machine-readable markup of the
// product itself is trusted (schema.org JSON-LD and labelled attribute rows). Free text, image
// URLs and "recommended offers" blocks are never scanned: they routinely contain other books'
// ISBNs (verified on Allegro Lokalnie) and would attach the wrong edition.
import { cleanISBN, isbnValid } from './isbn-normalization.mjs';

const decode = (value) =>
  String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function jsonLdBlocks(html) {
  const blocks = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        blocks.push(node);
        if (Array.isArray(node?.['@graph'])) blocks.push(...node['@graph']);
      }
    } catch {
      // Malformed block: ignore, others may still be valid.
    }
  }
  return blocks;
}

const typesOf = (node) => [].concat(node?.['@type'] ?? []).map(String);
const isBookProduct = (node) => {
  const types = typesOf(node);
  return types.includes('Book') || (types.includes('Product') && ('isbn' in node || 'gtin13' in node || 'gtin' in node));
};

function bookIsbn(value) {
  const cleaned = cleanISBN(value);
  if (!cleaned || !isbnValid(cleaned)) return null;
  // A valid EAN-13 that is not 978/979 is a non-book barcode (games, DVDs): not an ISBN.
  if (cleaned.length === 13 && !/^97[89]/.test(cleaned)) return null;
  return cleaned;
}

const names = (value) =>
  [].concat(value ?? []).map((item) => decode(typeof item === 'string' ? item : item?.name)).filter(Boolean);

function attributeRows(html) {
  const rows = {};
  for (const match of html.matchAll(
    /<span class="single-product__attribute-item">\s*([^<:]+):\s*<span class="single-product__attribute-value">([\s\S]*?)<\/span>\s*<\/span>/gi,
  )) {
    const label = decode(match[1]).toLowerCase();
    const value = decode(match[2].replace(/<[^>]*>/g, ' ').replace(/»/g, ''));
    if (label && value && !(label in rows)) rows[label] = value;
  }
  return rows;
}

export function parseProductDetail(html) {
  const text = String(html ?? '');
  const node = jsonLdBlocks(text).find(isBookProduct) ?? null;
  const rows = attributeRows(text);
  const isbn =
    bookIsbn(node?.isbn) ?? bookIsbn(node?.gtin13) ?? bookIsbn(node?.gtin) ?? bookIsbn(rows.isbn) ?? bookIsbn(rows.ean) ?? null;
  const publisher = names(node?.publisher)[0] ?? rows['wydawnictwo'] ?? null;
  const year = String(node?.datePublished ?? rows['rok wydania'] ?? '').match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1] ?? null;
  const pages = Number(node?.numberOfPages ?? rows['ilość stron']) || null;
  return {
    isbn,
    isbnSource: isbn ? (node ? 'json-ld' : 'attribute') : null,
    title: node?.name ? decode(node.name) : null,
    authors: names(node?.author),
    publisher,
    year: year ? Number(year) : null,
    pages,
    language: rows['język wydania'] ?? null,
    binding: rows['rodzaj okładki'] ?? null,
    condition: rows['stan'] ?? null,
  };
}

// Sources whose detail page exposes the product's own structured data.
export const DETAIL_SOURCES = new Set(['Tezeusz.pl']);
