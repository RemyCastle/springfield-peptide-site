// Run: node workers/supplier-sync/test/notecodes.test.mjs
import assert from 'node:assert/strict';
import { noteOrderCodes } from '../src/jobs.js';

// A code in the note means "only this order" for hands-free auto-match.
assert.deepEqual(noteOrderCodes('Thanks! k7m2q9x4b1'), ['K7M2Q9X4B1']);
assert.deepEqual(noteOrderCodes('PEP-20260722-0009'), ['PEP-20260722-0009']);
// Ordinary words are not codes, so name + amount matching still applies.
assert.deepEqual(noteOrderCodes('for peptides, thank you'), []);
assert.deepEqual(noteOrderCodes(''), []);
console.log('ok: payment note order codes');
