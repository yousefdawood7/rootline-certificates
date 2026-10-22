// Certificate IDs always start with "RL-", then the year, then 8 random characters.
// The alphabet leaves out look-alike characters (0/O, 1/I/L) so IDs are easy to read aloud.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomPart(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function newCertificateId(year = new Date().getFullYear(), isTaken = () => false) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = `RL-${year}-${randomPart(8)}`;
    if (!isTaken(id)) return id;
  }
  throw new Error('Could not generate a unique certificate ID');
}

module.exports = { newCertificateId };
