#!/usr/bin/env node
// Lint the extension: compile/validate the GSettings schema and validate
// metadata.json. The official extensions.gnome.org linter (shexli) is split out
// into scripts/test.mjs and run via `pnpm test`.
//
// SPDX-License-Identifier: GPL-2.0-or-later

import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_DIR = join(ROOT, 'schemas');

function info(message) {
    console.log(`\x1b[34m==>\x1b[0m ${message}`);
}

// Compile/validate the GSettings schema. --dry-run validates without writing a
// compiled file, which must not be shipped (EGO-P-006).
info('compiling and validating the GSettings schema');
execFileSync('glib-compile-schemas', ['--strict', '--dry-run', SCHEMA_DIR], {stdio: 'inherit'});

// Validate metadata.json.
info('validating metadata.json');
JSON.parse(readFileSync(join(ROOT, 'metadata.json'), 'utf8'));
console.log('OK: metadata.json parses, GSettings schema compiles');
