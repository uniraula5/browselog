import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const key = Buffer.from((await readFile(new URL('./public-key.txt', import.meta.url), 'utf8'))
  .trim(), 'base64');
const hex = createHash('sha256').update(key).digest('hex').slice(0, 32);
console.log(hex.replace(/[0-9a-f]/g, digit =>
  String.fromCharCode(97 + Number.parseInt(digit, 16))));
