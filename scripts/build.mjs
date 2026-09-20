#!/usr/bin/env node
// Build the extensions.gnome.org-compatible ZIP. The extension manifest
// (metadata.json) lives at the repo root alongside extension.js/prefs.js, so
// stage just those files plus schemas/ into a throwaway directory and pack that
// -- this keeps build artefacts (node_modules, .shexli-venv, build/) out of the
// bundle and avoids gnome-extensions choking on the repo-root working tree.
//
// SPDX-License-Identifier: GPL-2.0-or-later

import {execFileSync} from 'node:child_process';
import {readFileSync, mkdtempSync, mkdirSync, rmSync, cpSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const {uuid} = JSON.parse(readFileSync(join(ROOT, 'metadata.json'), 'utf8'));
const schema = join(ROOT, 'schemas', 'org.gnome.shell.extensions.force-activate.gschema.xml');
const outDir = join(ROOT, 'build');
mkdirSync(outDir, {recursive: true});

const stage = mkdtempSync(join(tmpdir(), 'force-activate-stage-'));
try {
    for (const f of ['metadata.json', 'extension.js', 'prefs.js'])
        cpSync(join(ROOT, f), join(stage, f));
    cpSync(join(ROOT, 'schemas'), join(stage, 'schemas'), {recursive: true});
    execFileSync('gnome-extensions', ['pack', '--force', '--out-dir', outDir, '--schema', schema, stage], {stdio: 'inherit'});
} finally {
    rmSync(stage, {recursive: true, force: true});
}

console.log(`Built ${join(outDir, `${uuid}.shell-extension.zip`)}`);
