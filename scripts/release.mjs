#!/usr/bin/env node
// Cut a release. The flow deliberately avoids npm's own `version` command and
// keeps the version in sync across metadata.json's "version-name" and package.json's "version".
//
//   node scripts/release.mjs <version|x.y.z|patch|minor|major> [--push] [--dry-run]
//
// The version GNOME Shell and extensions.gnome.org show lives in
// metadata.json's "version-name". On a versioned run the script bumps that
// field, builds the bundle with `gnome-extensions pack`, commits the bump and creates an
// annotated tag v<x.y.z>. Pass --push to also push the commit and tag. The zip
// is then uploaded to extensions.gnome.org by hand. A run without a version
// just builds the current bundle.
//
// Modeled on ~/Code/BetterTrayIcons/scripts/release.mjs.

import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const METADATA_FILE = 'metadata.json';
const PACKAGE_FILE = 'package.json';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const BUMP_TYPES = new Set(['patch', 'minor', 'major']);

// Failures a user can act on print as a clean one-liner; anything else is a
// bug in this script and keeps its stack trace.
class ReleaseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ReleaseError';
    }
}

function fail(message) {
    throw new ReleaseError(message);
}

function report(error) {
    // Not a ReleaseError means this script broke, the stack is the useful part.
    if (!(error instanceof ReleaseError))
        throw error;
    const [first, ...rest] = error.message.split('\n');
    console.error(`✖ Release failed: ${first}`);
    for (const line of rest)
        console.error(`  ${line}`);
    process.exitCode = 1;
}

function parseArgs(args) {
    let version = null;
    let push = false;
    let dryRun = false;

    for (const arg of args) {
        if (arg === '--')
            continue;
        else if (arg === '--push')
            push = true;
        else if (arg === '--dry-run')
            dryRun = true;
        else if (arg.startsWith('-'))
            fail(`unknown option '${arg}'`);
        else if (version)
            fail('give one version or release type');
        else
            version = arg;
    }
    return {version, push, dryRun};
}

function readMetadata() {
    return JSON.parse(readFileSync(METADATA_FILE, 'utf8'));
}

function readCurrentVersion() {
    const version = readMetadata()['version-name'] ?? '';
    if (!VERSION_PATTERN.test(version ?? ''))
        fail(`${METADATA_FILE} holds no usable "version-name"`);
    return version;
}

function bump(current, type) {
    const [major, minor, patch] = current.split('.').map(Number);
    if (type === 'major')
        return `${major + 1}.0.0`;
    if (type === 'minor')
        return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
}

function resolveVersion(requested, current) {
    if (!requested)
        fail('give a version (1.0.0) or a release type (patch, minor, major)');

    const type = requested.toLowerCase();
    if (BUMP_TYPES.has(type))
        return bump(current, type);

    const version = requested.replace(/^v/, '');
    if (!VERSION_PATTERN.test(version))
        fail(`'${requested}' is neither a release type nor a x.y.z version`);
    return version;
}

function assertNewer(version, current) {
    const left = version.split('.').map(Number);
    const right = current.split('.').map(Number);
    const order = (left[0] - right[0]) || (left[1] - right[1]) || (left[2] - right[2]);
    if (order === 0)
        fail(`${version} is already the current version`);
    if (order < 0)
        fail(`${version} is older than the current ${current}`);
    return version;
}

// Every change has to be committed, an untracked file is a missed file too.
function assertCleanTree() {
    const status = git(['status', '--porcelain']).trim();
    if (status)
        fail(`the working tree is not clean, commit or stash first:\n${status}`);
}

function assertTagFree(version) {
    const tag = `v${version}`;
    if (git(['tag', '-l', tag]).trim())
        fail(`tag ${tag} already exists`);
}

function writeMetadata(version) {
    const content = readFileSync(METADATA_FILE, 'utf8');
    const pattern = /("version-name"\s*:\s*")[^"]*(")/;
    if (!pattern.test(content))
        fail(`${METADATA_FILE} has no "version-name" to update`);
    writeFileSync(METADATA_FILE, content.replace(pattern, `$1${version}$2`));
    // A malformed manifest would break every later release, catch it here.
    JSON.parse(readFileSync(METADATA_FILE, 'utf8'));
}

function writePackageVersion(version) {
    const content = readFileSync(PACKAGE_FILE, 'utf8');
    const pattern = /("version"\s*:\s*")[^"]*(")/;
    if (!pattern.test(content))
        fail(`${PACKAGE_FILE} has no "version" to update`);
    writeFileSync(PACKAGE_FILE, content.replace(pattern, `$1${version}$2`));
    // A malformed manifest would break every later release, catch it here.
    JSON.parse(readFileSync(PACKAGE_FILE, 'utf8'));
}

function build() {
    const uuid = readMetadata().uuid;
    execFileSync('node', ['scripts/build.mjs'], {stdio: 'inherit'});
    return `build/${uuid}.shell-extension.zip`;
}

// Cheap, offline checks (schema + metadata) plus the official
// extensions.gnome.org linter (shexli) must pass before a release is cut.
function lint() {
    execFileSync('node', ['scripts/lint.mjs'], {stdio: 'inherit'});
    if (process.env.SKIP_CHECK) {
        console.log('SKIP_CHECK is set: skipping shexli');
        return;
    }
    execFileSync('node', ['scripts/test.mjs'], {stdio: 'inherit'});
}

function pushRelease(version) {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const remote = git(['for-each-ref', '--format=%(upstream:remote)', `refs/heads/${branch}`]).trim() || 'origin';
    git(['push', remote, branch]);
    git(['push', remote, `v${version}`]);
}

function git(args, {quiet = false} = {}) {
    // A quiet call expects to fail (probing for a tag), its stderr is noise.
    const stdio = quiet ? ['ignore', 'pipe', 'ignore'] : 'pipe';
    return execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio});
}

async function main() {
    const {version: requested, push, dryRun} = parseArgs(process.argv.slice(2));
    const current = readCurrentVersion();

    try {
        if (!dryRun)
            assertCleanTree();
        // The official extensions.gnome.org check must pass before a release.
        lint();

        // No version means: just rebuild the current bundle, no bump/commit/tag.
        if (!requested) {
            const bundle = build();
            console.log(`Built ${bundle} (version-name stays ${current}).`);
            return;
        }

        const version = assertNewer(resolveVersion(requested, current), current);
        assertTagFree(version);

        if (dryRun) {
            console.log(`dry run: ${current} -> ${version}, tag v${version}`);
            return;
        }

        writeMetadata(version);
        writePackageVersion(version);
        const bundle = build();
        console.log(`Set version-name to ${version} and built ${bundle}.`);

        git(['add', METADATA_FILE, PACKAGE_FILE]);
        git(['commit', '-m', `Release ${version}`]);
        git(['tag', '-a', `v${version}`, '-m', `Force Activate ${version}`]);

        console.log(`\nReleased ${version}.`);
        console.log(`  bundle: ${bundle}`);
        console.log(`  upload: https://extensions.gnome.org/upload/`);
        if (push)
            pushRelease(version);
        else
            console.log('  next:   git push --follow-tags');
    } catch (error) {
        report(error);
    }
}

await main();
