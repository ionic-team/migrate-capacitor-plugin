import { major, valid } from 'semver';

export type CommandRunner = (command: string, args: readonly string[]) => Promise<string>;

export function npmSupportsInstallScripts(version: string): boolean {
  const cleanVersion = valid(version.trim());
  if (!cleanVersion) {
    return false;
  }
  return major(cleanVersion) >= 12;
}

export async function npmSupportsInstallScriptsIn(run: CommandRunner): Promise<boolean> {
  try {
    return npmSupportsInstallScripts(await run('npm', ['--version']));
  } catch {
    return false;
  }
}

// Returns null when the pending set could not be determined, which is deliberately
// distinct from an empty array: treating "unknown" as "nothing pending" would make the
// before/after diff collapse back into the absolute set.
export async function findInstallScriptKeys(run: CommandRunner): Promise<string[] | null> {
  try {
    return parseBlockedPackages(await run('npm', ['install-scripts', 'ls', '--json']));
  } catch {
    return null;
  }
}

// The JSON shape is undocumented, so anything we do not recognise is reported as null
// (unknown) rather than as an empty list.
export function parseBlockedPackages(stdout: string): string[] | null {
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed?.allowScripts)) {
    return null;
  }

  const blocked: string[] = [];
  for (const entry of parsed.allowScripts) {
    if (!Array.isArray(entry?.changes)) {
      continue;
    }
    for (const change of entry.changes) {
      if (change?.change === 'pending' && typeof change.key === 'string') {
        blocked.push(change.key);
      }
    }
  }

  return blocked;
}

// Compared by package name, not by `name@version`. The migration rewrites dependency ranges
// — swiftlint, rollup, typescript, prettier and the @ionic/* configs all move — so a package
// the author already reviewed and left pending comes back under a new version it was never
// asked about. Diffing exact keys would report that as newly blocked when nothing changed
// but the number.
export function diffBlockedKeys(before: string[], after: string[]): string[] {
  const seen = new Set(before.map(packageNameFromKey));
  return after.filter((key) => !seen.has(packageNameFromKey(key)));
}

export function packageNameFromKey(key: string): string {
  const separator = key.lastIndexOf('@');
  return separator > 0 ? key.slice(0, separator) : key;
}

export function formatBlockedScriptsError(blocked: string[]): string {
  const names = [...new Set(blocked.map(packageNameFromKey))];
  const plural = names.length === 1 ? 'package' : 'packages';

  return [
    `npm blocked the install scripts of ${names.length} ${plural}, so the migration is incomplete:`,
    ...blocked.map((key) => `  ${key}`),
    '',
    'Review those packages, then approve and rebuild them:',
    `  npm install-scripts approve ${names.join(' ')}`,
    '  npm rebuild',
    '',
    'The migration itself does not need to be run again.',
  ].join('\n');
}
