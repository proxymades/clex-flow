import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/check-version.mjs', import.meta.url));
const files = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];

for (const [name, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  for (const mismatch of [false, true]) {
    test(`version check ${mismatch ? 'rejects a mismatched Cargo.lock' : 'accepts consistent versions'} with ${name} line endings`, () => {
      const root = mkdtempSync(join(tmpdir(), 'clex-version-check-'));
      try {
        mkdirSync(join(root, 'src-tauri'));
        for (const file of files) {
          let contents = readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
          if (mismatch && file === 'src-tauri/Cargo.lock') {
            const changed = contents.replace(/(\[\[package\]\]\nname = "clex-flow"\nversion = ")[^"]+(")/, '$1999.0.0$2');
            assert.notEqual(changed, contents, 'Fixture must actually change the application version');
            contents = changed;
          }
          writeFileSync(join(root, file), contents.replace(/\n/g, newline));
        }
        const env = { ...process.env };
        delete env.GITHUB_EVENT_PATH;
        const result = spawnSync(process.execPath, [script], { cwd: root, env, encoding: 'utf8' });
        assert.ifError(result.error);
        if (mismatch) {
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, /Cargo\.lock: version mismatch/);
        } else {
          assert.equal(result.status, 0, result.stderr);
          assert.match(result.stdout, /Version verified:/);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
