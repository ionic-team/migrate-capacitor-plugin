import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  diffBlockedKeys,
  findInstallScriptKeys,
  formatBlockedScriptsError,
  npmSupportsInstallScripts,
  npmSupportsInstallScriptsIn,
  packageNameFromKey,
  parseBlockedPackages,
} from './install-scripts.ts';

describe('npmSupportsInstallScripts', () => {
  it('rejects npm 11 and older', () => {
    assert.equal(npmSupportsInstallScripts('11.16.0'), false);
    assert.equal(npmSupportsInstallScripts('10.9.9'), false);
  });

  it('accepts npm 12 and newer', () => {
    assert.equal(npmSupportsInstallScripts('12.0.0'), true);
    assert.equal(npmSupportsInstallScripts('12.2.0'), true);
    assert.equal(npmSupportsInstallScripts('13.0.0'), true);
  });

  it('accepts a npm 12 prerelease', () => {
    assert.equal(npmSupportsInstallScripts('12.0.0-pre.3'), true);
  });

  it('ignores the trailing newline npm --version writes', () => {
    assert.equal(npmSupportsInstallScripts('12.2.0\n'), true);
  });

  it('rejects unparseable versions', () => {
    assert.equal(npmSupportsInstallScripts(''), false);
    assert.equal(npmSupportsInstallScripts('not a version'), false);
  });
});

describe('parseBlockedPackages', () => {
  it('returns the pending keys', () => {
    const stdout = JSON.stringify({
      allowScripts: [
        { name: 'esbuild', changes: [{ key: 'esbuild@0.28.0', change: 'pending' }] },
        { name: 'swiftlint', changes: [{ key: 'swiftlint@2.0.0', change: 'pending' }] },
      ],
    });

    assert.deepEqual(parseBlockedPackages(stdout), ['esbuild@0.28.0', 'swiftlint@2.0.0']);
  });

  it('returns every pending version of the same package', () => {
    const stdout = JSON.stringify({
      allowScripts: [
        {
          name: 'esbuild',
          changes: [
            { key: 'esbuild@0.28.0', change: 'pending' },
            { key: 'esbuild@0.27.7', change: 'pending' },
          ],
        },
      ],
    });

    assert.deepEqual(parseBlockedPackages(stdout), ['esbuild@0.28.0', 'esbuild@0.27.7']);
  });

  it('ignores changes that are not pending', () => {
    const stdout = JSON.stringify({
      allowScripts: [
        {
          name: 'swiftlint',
          changes: [
            { key: 'swiftlint@1.0.2', change: 'approved' },
            { key: 'swiftlint@2.0.0', change: 'pending' },
          ],
        },
      ],
    });

    assert.deepEqual(parseBlockedPackages(stdout), ['swiftlint@2.0.0']);
  });

  it('returns an empty list when no package is blocked', () => {
    assert.deepEqual(parseBlockedPackages(JSON.stringify({ allowScripts: [] })), []);
    assert.deepEqual(parseBlockedPackages(JSON.stringify({ allowScripts: [{ name: 'swiftlint' }] })), []);
  });

  it('returns null for unexpected or malformed output', () => {
    assert.equal(parseBlockedPackages('not json'), null);
    assert.equal(parseBlockedPackages(''), null);
    assert.equal(parseBlockedPackages(JSON.stringify({})), null);
    assert.equal(parseBlockedPackages(JSON.stringify({ allowScripts: 'nope' })), null);
  });
});

describe('findInstallScriptKeys', () => {
  it('asks npm for the pending list as JSON', async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const run = async (command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return JSON.stringify({
        allowScripts: [{ name: 'swiftlint', changes: [{ key: 'swiftlint@2.0.0', change: 'pending' }] }],
      });
    };

    assert.deepEqual(await findInstallScriptKeys(run), ['swiftlint@2.0.0']);
    assert.deepEqual(calls, [{ command: 'npm', args: ['install-scripts', 'ls', '--json'] }]);
  });

  it('returns null when the command fails', async () => {
    const run = async () => {
      throw 'Unknown command: "install-scripts"';
    };

    assert.equal(await findInstallScriptKeys(run), null);
  });

  it('returns null when the output cannot be parsed', async () => {
    assert.equal(await findInstallScriptKeys(async () => 'not json'), null);
  });

  it('distinguishes a determined empty list from a failure', async () => {
    assert.deepEqual(await findInstallScriptKeys(async () => JSON.stringify({ allowScripts: [] })), []);
  });
});

describe('npmSupportsInstallScriptsIn', () => {
  it('asks npm for its version', async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const run = async (command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return '12.2.0\n';
    };

    assert.equal(await npmSupportsInstallScriptsIn(run), true);
    assert.deepEqual(calls, [{ command: 'npm', args: ['--version'] }]);
  });

  it('is false on npm 11', async () => {
    assert.equal(await npmSupportsInstallScriptsIn(async () => '11.21.0'), false);
  });

  it('is false when the command fails', async () => {
    assert.equal(
      await npmSupportsInstallScriptsIn(async () => {
        throw 'npm not found';
      }),
      false,
    );
  });
});

// The scenarios below mirror runs against real Capacitor 8 plugins on npm 12.2.0. The
// migration does not touch esbuild, and node_modules survives it, so an esbuild the author
// left pending comes back at the same version. swiftlint is the package the migration itself
// moves, from ^1.0.0 to ^2.0.0.
describe('diffBlockedKeys', () => {
  it('ignores a package the migration does not touch', () => {
    const before = ['esbuild@0.28.0'];
    const after = ['esbuild@0.28.0'];

    assert.deepEqual(diffBlockedKeys(before, after), []);
  });

  it('reports a package the migration newly blocked', () => {
    // swiftlint@1.0.2 was approved, so it is absent from the baseline. The bump to 2.0.0 is
    // a version the author never reviewed.
    const before = ['esbuild@0.28.0'];
    const after = ['esbuild@0.28.0', 'swiftlint@2.0.0'];

    assert.deepEqual(diffBlockedKeys(before, after), ['swiftlint@2.0.0']);
  });

  it('ignores a package the author had already left blocked, bumped to a new version', () => {
    assert.deepEqual(diffBlockedKeys(['swiftlint@1.0.2'], ['swiftlint@2.0.0']), []);
  });

  it('reports everything when nothing was pending beforehand', () => {
    // A fresh clone has no node_modules, so npm reports an empty pending set as the baseline.
    assert.deepEqual(diffBlockedKeys([], ['esbuild@0.28.0', 'swiftlint@2.0.0']), ['esbuild@0.28.0', 'swiftlint@2.0.0']);
  });

  it('matches a scoped package by name', () => {
    const before = ['@swc/core@1.16.17'];
    const after = ['@swc/core@1.16.18', 'swiftlint@2.0.0'];

    assert.deepEqual(diffBlockedKeys(before, after), ['swiftlint@2.0.0']);
  });

  it('ignores a package that stopped being pending', () => {
    assert.deepEqual(diffBlockedKeys(['swiftlint@1.0.2', 'esbuild@0.28.0'], ['esbuild@0.28.0']), []);
  });
});

describe('packageNameFromKey', () => {
  it('drops the version', () => {
    assert.equal(packageNameFromKey('swiftlint@2.0.0'), 'swiftlint');
  });

  it('keeps the scope of a scoped package', () => {
    assert.equal(packageNameFromKey('@swc/core@1.16.18'), '@swc/core');
  });

  it('passes through a key with no version', () => {
    assert.equal(packageNameFromKey('swiftlint'), 'swiftlint');
    assert.equal(packageNameFromKey('@swc/core'), '@swc/core');
  });
});

describe('formatBlockedScriptsError', () => {
  it('names the packages and gives the recovery commands', () => {
    const message = formatBlockedScriptsError(['esbuild@0.28.0', 'swiftlint@2.0.0']);

    assert.equal(
      message,
      [
        'npm blocked the install scripts of 2 packages, so the migration is incomplete:',
        '  esbuild@0.28.0',
        '  swiftlint@2.0.0',
        '',
        'Review those packages, then approve and rebuild them:',
        '  npm install-scripts approve esbuild swiftlint',
        '  npm rebuild',
        '',
        'The migration itself does not need to be run again.',
      ].join('\n'),
    );
  });

  it('uses the singular for one package', () => {
    const message = formatBlockedScriptsError(['swiftlint@2.0.0']);

    assert.match(message, /^npm blocked the install scripts of 1 package, so/);
  });

  it('counts packages, not versions, when several versions are blocked', () => {
    const message = formatBlockedScriptsError(['esbuild@0.28.0', 'esbuild@0.27.7']);

    assert.match(message, /^npm blocked the install scripts of 1 package, so/);
    assert.match(message, /^ {2}esbuild@0\.28\.0$/m);
    assert.match(message, /^ {2}esbuild@0\.27\.7$/m);
    assert.match(message, /^ {2}npm install-scripts approve esbuild$/m);
  });

  it('tells the user the migration does not need to be re-run', () => {
    assert.match(formatBlockedScriptsError(['swiftlint@2.0.0']), /does not need to be run again\.$/);
  });
});
