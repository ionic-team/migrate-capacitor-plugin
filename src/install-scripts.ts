import { major, valid } from 'semver';

export function npmSupportsInstallScripts(version: string): boolean {
  const cleanVersion = valid(version.trim());
  if (!cleanVersion) {
    return false;
  }
  return major(cleanVersion) >= 12;
}

export function parseBlockedPackages(stdout: string): string[] {
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed?.allowScripts)) {
    return [];
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

export function packageNameFromKey(key: string): string {
  const separator = key.lastIndexOf('@');
  return separator > 0 ? key.slice(0, separator) : key;
}

export function formatBlockedScriptsError(blocked: string[]): string {
  const names = [...new Set(blocked.map(packageNameFromKey))];
  const plural = blocked.length === 1 ? 'package' : 'packages';

  return [
    `npm blocked the install scripts of ${blocked.length} ${plural}, so the migration is incomplete:`,
    ...blocked.map((key) => `  ${key}`),
    '',
    'Review those packages, then approve and rebuild them:',
    `  npm install-scripts approve ${names.join(' ')}`,
    '  npm rebuild',
  ].join('\n');
}
