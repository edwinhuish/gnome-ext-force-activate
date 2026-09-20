import {rmSync} from 'node:fs';

// `pnpm clean` used to call `rm -rf`, which pnpm's safe-delete guards when it
// would delete a lot of files (the .shexli-venv venv). Deleting via Node's fs
// avoids that prompt and is consistent with the other scripts/ helpers.
const targets = ['build', '.shexli-venv', 'schemas/gschemas.compiled'];
for (const t of targets)
    rmSync(t, {recursive: true, force: true});
console.log(`cleaned: ${targets.join(', ')}`);
