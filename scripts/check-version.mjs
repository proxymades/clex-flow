import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').split(/\n\[/)[0];
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8').replace(/\r\n/g, '\n');
const lockedVersion = cargoLock.match(/\[\[package\]\]\nname = "clex-flow"\nversion = "([^"]+)"/)?.[1];
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
for (const [file, version] of Object.entries({ 'package-lock.json': lock.version, 'package-lock root': lock.packages[''].version, 'tauri.conf.json': tauri.version, 'Cargo.toml': cargoVersion, 'Cargo.lock': lockedVersion })) {
  assert.equal(version, pkg.version, `${file}: version mismatch`);
}
const event = process.env.GITHUB_EVENT_PATH ? readJson(process.env.GITHUB_EVENT_PATH) : {};
if (event.release) {
  assert.equal(event.release.tag_name, `v${pkg.version}`, 'Release tag must match the checked-out application');
  if (pkg.version === '0.1.0') assert.equal(event.release.prerelease, true, 'The first 0.1.0 release must be a Pre-release');
}
console.log(`Version verified: ${pkg.version}${event.release ? ` / ${event.release.tag_name}` : ''}`);
