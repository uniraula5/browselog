import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const testMode = process.argv.includes('--test');
const configName = testMode ? 'config.test.json' : 'config.local.json';
let config;
try {
  config = JSON.parse(await readFile(path.join(root, configName), 'utf8'));
} catch {
  throw new Error(`Create ${configName} from config.example.json before building.`);
}
for (const name of ['projectId', 'apiKey', 'webOAuthClientId']) {
  if (!config[name] || String(config[name]).startsWith('YOUR_')) {
    throw new Error(`${configName} needs a real ${name}.`);
  }
}
const publicKey = (await readFile(path.join(root, 'scripts/public-key.txt'), 'utf8')).trim();
const target = process.env.BROWSELOG_BUILD_DIR
  ? path.resolve(process.env.BROWSELOG_BUILD_DIR) : path.join(root, 'dist');
await rm(target, { recursive: true, force: true });
await mkdir(target);
await cp(path.join(root, 'src'), target, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
manifest.key = publicKey;
if (testMode) {
  for (const url of [config.authUrl, config.tokenUrl, config.firestoreUrl]) {
    if (url) manifest.host_permissions.push(`${new URL(url).origin}/*`);
  }
}
await writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const runtimeConfig = {
  projectId: config.projectId, apiKey: config.apiKey,
  webOAuthClientId: config.webOAuthClientId,
  ...(testMode ? {
    authUrl: config.authUrl, tokenUrl: config.tokenUrl,
    firestoreUrl: config.firestoreUrl
  } : {})
};
await writeFile(path.join(target, 'config.js'),
  `export const firebaseConfig = ${JSON.stringify(runtimeConfig, null, 2)};\n`);
console.log(`Built BrowseLog in ${target}`);
