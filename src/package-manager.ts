export interface PackageManagerFields {
  packageManager?: unknown;
  scripts?: Record<string, unknown>;
}

// A repo that declares pnpm, yarn or bun expects `npm install` to fail: corepack's
// `packageManager` field and an `only-allow` preinstall guard are both deliberate
// refusals, not a broken dependency tree.
export function declaresOtherPackageManager(pkg: PackageManagerFields): boolean {
  const packageManager = pkg?.packageManager;
  if (typeof packageManager === 'string' && packageManager.trim() !== '') {
    return !packageManager.trim().startsWith('npm@');
  }

  const preinstall = pkg?.scripts?.['preinstall'];
  if (typeof preinstall === 'string' && preinstall.includes('only-allow')) {
    return !/only-allow\s+npm\b/.test(preinstall);
  }

  return false;
}
