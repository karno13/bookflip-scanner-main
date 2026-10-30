import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanISBN,isbnKeys,isbnValid,normalizeISBN} from './isbn-normalization.mjs';
import {cleanISBN as legacyCleanISBN,extractOfferISBN,isbnKeys as legacyIsbnKeys,isbnValid as legacyIsbnValid} from './isbn.mjs';

const isbn13='9780306406157',isbn10='0306406152',other='9780140328721';

test('normalization module keeps the legacy ISBN exports compatible',()=>{
 assert.equal(cleanISBN('ISBN-13: 978-0-306-40615-7'),isbn13);
 assert.equal(normalizeISBN('978-0-306-40615-7'),isbn13);
 assert.equal(normalizeISBN('978-0-306-40615-8'),null);
 assert.equal(isbnValid(isbn10),true);
 assert.deepEqual(isbnKeys(isbn10),[isbn10,isbn13]);
 assert.equal(legacyCleanISBN('ISBN '+isbn13),cleanISBN('ISBN '+isbn13));
 assert.equal(legacyIsbnValid(isbn13),isbnValid(isbn13));
 assert.deepEqual(legacyIsbnKeys(isbn10),isbnKeys(isbn10));
});

test('structured ISBN is safe for automatic assignment',()=>{
 const result=extractOfferISBN({isbn:isbn13});
 assert.equal(result.status,'valid');
 assert.equal(result.classification,'structured');
 assert.equal(result.isbn,isbn13);
 assert.equal(result.autoAssignable,true);
 assert.equal(result.reviewRequired,false);
});

test('a labelled ISBN in an offer description may be assigned automatically',()=>{
 const result=extractOfferISBN({description:`Stan dobry. ISBN: 978-0-306-40615-7.`});
 assert.equal(result.status,'valid');
 assert.equal(result.classification,'labelled_description');
 assert.equal(result.isbn,isbn13);
 assert.equal(result.observations[0].source,'description');
});

test('an unlabelled ISBN in a description requires review and is not auto-assignable',()=>{
 const result=extractOfferISBN({description:`Stan dobry, numer ${isbn13}, miękka oprawa.`});
 assert.equal(result.status,'review');
 assert.equal(result.classification,'unlabelled_description');
 assert.equal(result.isbn,null);
 assert.equal(result.candidateIsbn,isbn13);
 assert.equal(result.autoAssignable,false);
 assert.equal(result.reviewRequired,true);
});

test('OCR evidence and explicitly uncertain reads require review',()=>{
 const ocr=extractOfferISBN({ocrText:`ISBN ${isbn13}`});
 assert.equal(ocr.status,'review');
 assert.equal(ocr.classification,'ocr');
 assert.equal(ocr.isbn,null);
 const uncertain=extractOfferISBN({isbn:isbn13,isbnReadUncertain:true});
 assert.equal(uncertain.status,'uncertain');
 assert.equal(uncertain.classification,'uncertain');
 assert.equal(uncertain.isbn,null);
});

test('different valid ISBNs are a conflict while ISBN-10 and its ISBN-13 are one value',()=>{
 const conflict=extractOfferISBN({description:`ISBN ${isbn13}; ISBN ${other}`});
 assert.equal(conflict.status,'conflict');
 assert.equal(conflict.reviewRequired,true);
 assert.equal(conflict.autoAssignable,false);
 assert.equal(conflict.isbn,null);
 assert.deepEqual(new Set(conflict.values),new Set([isbn13,other]));
 const equivalent=extractOfferISBN({isbn_10:isbn10,isbn_13:isbn13});
 assert.equal(equivalent.status,'valid');
 assert.deepEqual(equivalent.values,[isbn13]);
});

test('a labelled parameter is structured evidence and invalid checksums are rejected',()=>{
 const parameter=extractOfferISBN({parameters:[{name:'ISBN',value:isbn13}]});
 assert.equal(parameter.classification,'structured');
 assert.equal(parameter.isbn,isbn13);
 const invalid=extractOfferISBN({description:'ISBN: 9780306406158'});
 assert.equal(invalid.status,'invalid');
 assert.equal(invalid.isbn,null);
});
