#!/usr/bin/env node
// Run the official extensions.gnome.org linter (shexli) against the extension.
// Split out of scripts/lint.mjs so `pnpm lint` stays the cheap, offline
// schema/metadata check and shexli runs via `pnpm test`.
//
// SPDX-License-Identifier: GPL-2.0-or-later

import {execFileSync} from 'node:child_process';
import {existsSync, rmSync, cpSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_DIR = join(ROOT, 'schemas');
const VENV = join(ROOT, '.shexli-venv');

function run(file, args, opts = {}) {
    execFileSync(file, args, {stdio: 'inherit', ...opts});
}

function info(message) {
    console.log(`\x1b[34m==>\x1b[0m ${message}`);
}

// A stale compiled schema would be flagged by shexli (EGO-P-006) and must not be
// shipped, so drop any leftover before staging.
rmSync(join(SCHEMA_DIR, 'gschemas.compiled'), {force: true});

info('installing shexli and linting src (the official extensions.gnome.org check)');
if (!existsSync(join(VENV, 'bin', 'python')))
    run('python3', ['-m', 'venv', VENV]);
const venvBin = join(VENV, 'bin');
const env = {
    ...process.env,
    PATH: `${venvBin}${process.env.PATH ? `:${process.env.PATH}` : ''}`,
    VIRTUAL_ENV: VENV,
};
run(join(venvBin, 'python'), ['-m', 'pip', 'install', '-U', 'shexli'], {env});
// shexli checks the whole extension package, so stage src/ + schemas/ into a
// throwaway directory (the same files `gnome-extensions pack` ships) and lint
// that. Mirrors BetterTrayIcons' CI, which runs `shexli` on the built bundle.
const stage = join(ROOT, 'build', '.shexli-stage');
rmSync(stage, {recursive: true, force: true});
mkdirSync(stage, {recursive: true});
for (const f of ['metadata.json', 'extension.js', 'prefs.js'])
    cpSync(join(ROOT, f), join(stage, f));
cpSync(SCHEMA_DIR, join(stage, 'schemas'), {recursive: true});
run(join(venvBin, 'python'), ['-m', 'shexli', stage], {env});
rmSync(stage, {recursive: true, force: true});
