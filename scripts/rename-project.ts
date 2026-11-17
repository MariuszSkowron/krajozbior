// Renames the template to a real project: identifiers, database role and
// database names, package name, cookie prefix and the name shown in the UI.
//
// Run once, right after creating a repository from the template:
//   npm run rename-project -- my_app "My App"
// (slug: lowercase letters, digits, underscores; then the display name.)
// Afterwards delete scripts/rename-project.ts, scripts/lib/rename-project.ts and
// tests/scripts/rename-project.test.ts, and the `rename-project` npm script.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as prettier from "prettier";

import { RenameInputError, renameProject } from "./lib/rename-project";

// The new name changes line lengths, so the renamed files are formatted again
// with the repository's Prettier settings (otherwise `npm run format:check` fails).
async function formatFiles(root: string, files: readonly string[]) {
  for (const file of files) {
    const path = join(root, file);
    const info = await prettier.getFileInfo(path, { ignorePath: join(root, ".prettierignore") });

    if (info.ignored || info.inferredParser === null) {
      continue;
    }

    const options = (await prettier.resolveConfig(path)) ?? {};
    const source = readFileSync(path, "utf8");
    const formatted = await prettier.format(source, { ...options, filepath: path });

    if (formatted !== source) {
      writeFileSync(path, formatted);
    }
  }
}

async function main() {
  const [slug, displayName, ...rest] = process.argv.slice(2);

  if (slug === undefined || displayName === undefined || rest.length > 0) {
    throw new RenameInputError('Usage: npm run rename-project -- <slug> "<Display Name>"');
  }

  const root = process.cwd();
  const { changedFiles, lockfileUpdated } = renameProject(root, slug, displayName);

  await formatFiles(root, changedFiles);

  for (const file of changedFiles) {
    console.log(`Renamed: ${file}`);
  }
  console.log(
    `Done: ${changedFiles.length} files${lockfileUpdated ? ", package-lock.json name fields" : ""}.`,
  );
  console.log("Run npm run check before committing.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
