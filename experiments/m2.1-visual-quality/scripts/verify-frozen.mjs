import {resolve} from 'node:path';
import {verifyFrozenEvidence} from '../src/frozen-integrity.mjs';

const frozen = resolve(import.meta.dirname, '..', 'frozen');
const result = await verifyFrozenEvidence(frozen);
process.stdout.write(`M2.1 Frozen Evidence Integrity PASS\n${JSON.stringify(result, null, 2)}\n`);
