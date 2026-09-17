#!/usr/bin/env bash
#
# Release helper for the Force Activate GNOME Shell extension: checks that the
# tree follows the extensions.gnome.org format, bumps the version name, builds
# and verifies the release bundle.
#
# Force Activate 扩展的发布脚本：检查项目是否符合 extensions.gnome.org 的格式要求，
# 更新版本号，打包并校验发布产物。
#
# Usage / 用法:
#   ./release.sh [VERSION] [--tag] [--no-build]
#
# SPDX-License-Identifier: GPL-2.0-or-later
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Check the extension format and build a release bundle.

Usage: ./release.sh [VERSION] [OPTIONS]

  VERSION            version to release, for example 1.1.0. When given it is
                     written to "version-name" in metadata.json, otherwise the
                     current value is used.

Options:
  -t, --tag          create the annotated git tag v<VERSION> after a
                     successful build
  -n, --no-build     run the format checks only, do not touch metadata.json
                     and do not build anything
  -h, --help         show this help

Examples:
  ./release.sh --no-build        # checks only, safe to run in CI
  ./release.sh                   # build the bundle for the current version
  ./release.sh 1.1.0 --tag       # bump, build and tag v1.1.0
EOF
}

VERSION=""
MAKE_TAG=0
DO_BUILD=1

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        -t|--tag) MAKE_TAG=1 ;;
        -n|--no-build) DO_BUILD=0 ;;
        --) shift; break ;;
        -*) die "unknown option: $1 (try --help)" ;;
        *) [ -z "$VERSION" ] || die 'only one version may be given'
           VERSION="$1" ;;
    esac
    shift
done

for tool in python3 make; do
    command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done

# The extension directory is the one holding metadata.json; its name is the uuid.
SRC_DIR="$(dirname "$(find . -maxdepth 2 -name metadata.json -not -path './build/*' -print -quit)")"
[ -n "$SRC_DIR" ] && [ "$SRC_DIR" != "." ] || die 'no extension directory containing metadata.json found'
SRC_DIR="${SRC_DIR#./}"
UUID="$(basename "$SRC_DIR")"
BUNDLE="build/$UUID.shell-extension.zip"

CURRENT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version-name", ""))' "$SRC_DIR/metadata.json")"
if [ -n "$VERSION" ]; then
    VERSION="${VERSION#v}"
    printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$' \
        || die "version '$VERSION' is not a semver-like version such as 1.1.0"
fi
RELEASE_VERSION="${VERSION:-$CURRENT}"
[ -n "$RELEASE_VERSION" ] || die 'nothing to release: pass a VERSION or set version-name in metadata.json'

info "checking $SRC_DIR against the extensions.gnome.org format"
python3 - "$SRC_DIR" <<'PY' || die 'format check failed (see the errors above)'
import json
import os
import re
import sys

src = sys.argv[1]
errors = []
warnings = []


def read(path):
    try:
        with open(path, encoding='utf-8') as fh:
            return fh.read()
    except OSError:
        return None


meta_path = os.path.join(src, 'metadata.json')
raw = read(meta_path)
meta = None
if raw is None:
    errors.append(f'missing {meta_path}')
else:
    try:
        meta = json.loads(raw)
    except ValueError as exc:
        errors.append(f'{meta_path} is not valid JSON: {exc}')
    else:
        if not isinstance(meta, dict):
            errors.append(f'{meta_path} must contain a JSON object')
            meta = None

if meta is not None:
    for key in ('uuid', 'name', 'description', 'shell-version'):
        if not meta.get(key):
            errors.append(f'metadata.json: required key "{key}" is missing or empty')

    uuid = meta.get('uuid', '')
    if uuid and uuid != src:
        errors.append(f'metadata.json: uuid "{uuid}" does not match the directory name "{src}"')
    if uuid:
        # Same character set extensions.gnome.org accepts.
        if not re.fullmatch(r'[0-9A-Za-z._@-]+', uuid):
            errors.append(f'metadata.json: uuid "{uuid}" may only contain letters, digits, ".", "_", '
                          '"@" and "-"')
        if re.search(r'[.@]gnome\.org$', uuid):
            errors.append('metadata.json: "gnome.org" cannot be used as the uuid namespace')
        if '@' in uuid:
            local, _, namespace = uuid.partition('@')
            if not local or not namespace:
                errors.append(f'metadata.json: uuid "{uuid}" has an empty part around "@"')
            elif '.' not in namespace:
                warnings.append(
                    f'metadata.json: uuid namespace "{namespace}" does not look like a domain or '
                    'account; reviewers expect something like "your-name.github.io"')
        else:
            warnings.append(
                'metadata.json: the uuid has no "@namespace" part; extensions.gnome.org accepts it '
                'but its review guidelines recommend "extension-id@namespace", for example '
                '"force-activate@your-name.github.io"')

    if 'version' in meta:
        errors.append('metadata.json: the "version" key is deprecated '
                      '(extensions.gnome.org fills it in on upload)')

    modes = meta.get('session-modes')
    if modes is not None:
        allowed = {'user', 'unlock-dialog'}
        if not isinstance(modes, list):
            errors.append('metadata.json: "session-modes" must be an array')
        else:
            unknown = [mode for mode in modes if mode not in allowed]
            if unknown:
                errors.append(f'metadata.json: unsupported session-modes entries: {unknown}')
            if modes == ['user']:
                warnings.append('metadata.json: "session-modes" must be omitted when only "user" is used')

    url = meta.get('url', '')
    if not url:
        warnings.append('metadata.json: no "url"; reviewers expect a link to the source repository')
    elif not re.match(r'^https?://', url):
        warnings.append(f'metadata.json: "url" "{url}" is not an http(s) URL')

    versions = meta.get('shell-version')
    if versions is not None and not isinstance(versions, list):
        errors.append('metadata.json: "shell-version" must be an array')
    elif isinstance(versions, list):
        for version in versions:
            if not isinstance(version, str) or not re.fullmatch(r'\d+(\.(alpha|beta))?', version):
                errors.append(f'metadata.json: shell-version entry {version!r} must look like "45" or "46.alpha"')

    domain = meta.get('gettext-domain')
    has_locale = os.path.isdir(os.path.join(src, 'locale'))
    if has_locale and not domain:
        warnings.append('locale/ exists but metadata.json has no "gettext-domain"')
    if domain and not has_locale:
        warnings.append(f'gettext-domain "{domain}" is set but there is no locale/ directory')

    schema_id = meta.get('settings-schema')
    schema_dir = os.path.join(src, 'schemas')
    schema_files = sorted(f for f in os.listdir(schema_dir) if f.endswith('.gschema.xml')) \
        if os.path.isdir(schema_dir) else []

    if schema_id and not os.path.isdir(schema_dir):
        errors.append('metadata.json declares "settings-schema" but there is no schemas/ directory')
    if schema_id and os.path.isdir(schema_dir) and f'{schema_id}.gschema.xml' not in schema_files:
        errors.append(f'schemas/: expected {schema_id}.gschema.xml, because schema file names must '
                      'match the schema id')
    if not schema_id and schema_files:
        warnings.append('schemas/ contains a schema but metadata.json has no "settings-schema"')

    for name in schema_files:
        text = read(os.path.join(schema_dir, name)) or ''
        for schema in re.findall(r'<schema\b[^>]*>', text):
            declared_id = re.search(r'\bid="([^"]+)"', schema)
            declared_path = re.search(r'\bpath="([^"]+)"', schema)
            if declared_id:
                if not declared_id.group(1).startswith('org.gnome.shell.extensions'):
                    errors.append(f'schemas/{name}: schema id "{declared_id.group(1)}" must be based on '
                                  '"org.gnome.shell.extensions"')
                if schema_id and declared_id.group(1) != schema_id:
                    errors.append(f'schemas/{name}: schema id "{declared_id.group(1)}" does not match '
                                  f'"settings-schema" ("{schema_id}") in metadata.json')
            if declared_path and not declared_path.group(1).startswith('/org/gnome/shell/extensions'):
                errors.append(f'schemas/{name}: schema path "{declared_path.group(1)}" must be based on '
                              '"/org/gnome/shell/extensions"')

entry = os.path.join(src, 'extension.js')
if not os.path.isfile(entry):
    errors.append('extension.js is required')
else:
    text = read(entry) or ''
    if 'imports.' in text or re.search(r'\bfunction\s+init\s*\(', text):
        errors.append('extension.js: legacy pre-45 style (init()/imports.*) is not supported')
    elif not re.search(r'export\s+default\s+class\s+\w+\s+extends\s+Extension\b', text):
        warnings.append('extension.js: expected "export default class X extends Extension"')
    for module in ('Gtk', 'Gdk', 'Adw'):
        if re.search(rf"gi://{module}\b", text):
            errors.append(f'extension.js: {module} must not be imported into the Shell process')

prefs = os.path.join(src, 'prefs.js')
if not os.path.isfile(prefs):
    warnings.append('no prefs.js: the extension will not offer a preferences window')
else:
    text = read(prefs) or ''
    if 'ExtensionPreferences' not in text:
        warnings.append('prefs.js: expected a class extending ExtensionPreferences')
    for module in ('St', 'Clutter', 'Meta', 'Shell'):
        if re.search(rf"gi://{module}\b", text):
            errors.append(f'prefs.js: {module} must not be imported into the preferences process')

if not os.path.isfile('LICENSE') and not os.path.isfile(os.path.join(src, 'LICENSE')):
    warnings.append('no LICENSE file: GNOME Shell derivatives must use a GPL-compatible license')

for message in warnings:
    print(f'    warning: {message}')
for message in errors:
    print(f'    error: {message}')
print(f'    {len(errors)} error(s), {len(warnings)} warning(s)')
sys.exit(1 if errors else 0)
PY

info 'compiling the GSettings schema and validating metadata'
make validate

if [ "$DO_BUILD" -eq 0 ]; then
    info "checks passed for $UUID $RELEASE_VERSION (nothing built, --no-build)"
    exit 0
fi

if [ -n "$VERSION" ] && [ "$VERSION" != "$CURRENT" ]; then
    info "setting version-name to $VERSION in $SRC_DIR/metadata.json"
    python3 - "$SRC_DIR/metadata.json" "$VERSION" <<'PY'
import json
import sys

path, version = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as fh:
    data = json.load(fh)

data['version-name'] = version

with open(path, 'w', encoding='utf-8') as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write('\n')
PY
fi

info 'building the release bundle'
make zip

[ -f "$BUNDLE" ] || die "expected bundle $BUNDLE was not created"

info 'inspecting the bundle'
python3 - "$BUNDLE" "$UUID" "$SRC_DIR" <<'PY' || die 'the bundle does not follow the extensions.gnome.org layout'
import json
import os
import sys
import zipfile

bundle, uuid, src = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(bundle) as archive:
    names = archive.namelist()

errors = []
required = ['metadata.json', 'extension.js']
with open(os.path.join(src, 'metadata.json'), encoding='utf-8') as fh:
    meta = json.load(fh)
if meta.get('settings-schema'):
    required.append(f"schemas/{meta['settings-schema']}.gschema.xml")

for name in required:
    if name not in names:
        errors.append(f'missing {name} at the archive root')
if any(name.startswith(f'{uuid}/') for name in names):
    errors.append('the archive contains a top-level directory; every file must sit at the root')

forbidden = []
for name in names:
    base = os.path.basename(name)
    if name == uuid or base in {'Makefile', 'install.sh', 'release.sh', '.gitignore', '.gitattributes'}:
        forbidden.append(name)
    elif base.startswith(('README', 'LICENSE', 'CHANGELOG')):
        forbidden.append(name)
    elif base.endswith(('.po', '.pot', '.compiled', '.pyc', '.ts', '.map')):
        forbidden.append(name)
    elif any(part in name for part in ('.git/', '__pycache__', 'node_modules')):
        forbidden.append(name)
if forbidden:
    errors.append(f'files that do not belong in a release bundle: {forbidden}')

for error in errors:
    print(f'    error: {error}')
for name in names:
    print(f'    {name}')
print(f'    {len(names)} file(s), {os.path.getsize(bundle)} bytes, {len(errors)} error(s)')
sys.exit(1 if errors else 0)
PY

info 'writing the checksum'
(cd build && sha256sum "$(basename "$BUNDLE")" > "$(basename "$BUNDLE").sha256")
cat "build/$(basename "$BUNDLE").sha256"

if [ "$MAKE_TAG" -eq 1 ]; then
    command -v git >/dev/null 2>&1 || die '--tag needs git'
    git rev-parse --git-dir >/dev/null 2>&1 || die '--tag needs a git repository'
    git rev-parse -q --verify "refs/tags/v$RELEASE_VERSION" >/dev/null && \
        die "tag v$RELEASE_VERSION already exists"
    if [ -n "$(git status --porcelain)" ]; then
        warn 'the working tree is dirty; the tag points at HEAD, not at these changes'
    fi
    info "creating the annotated tag v$RELEASE_VERSION"
    git tag -a "v$RELEASE_VERSION" -m "Force Activate $RELEASE_VERSION"
fi

cat <<EOF

$(printf '\033[1;32m==>\033[0m') ready to publish
    extension: $UUID
    version:   $RELEASE_VERSION
    bundle:    $BUNDLE
    checksum:  build/$(basename "$BUNDLE").sha256

Next steps / 后续步骤:
    1. upload the bundle at https://extensions.gnome.org/upload/
    2. describe what changed in the version's release notes
    3. push the tag and the bundle if you want them in the repository / 需要的话推送 tag
EOF
