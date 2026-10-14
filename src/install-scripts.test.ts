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
        { name: 'fsevents', changes: [{ key: 'fsevents@2.3.3', change: 'pending' }] },
        { name: 'swiftlint', changes: [{ key: 'swiftlint@2.0.0', change: 'pending' }] },
      ],
    });

    assert.deepEqual(parseBlockedPackages(stdout), ['fsevents@2.3.3', 'swiftlint@2.0.0']);
  });

  it('returns every pending version of the same package', () => {
    const stdout = JSON.stringify({
      allowScripts: [
        {
          name: 'esbuild',
          changes: [
            { key: 'esbuild@0.25.12', change: 'pending' },
            { key: 'esbuild@0.21.5', change: 'pending' },
          ],
        },
      ],
    });

    assert.deepEqual(parseBlockedPackages(stdout), ['esbuild@0.25.12', 'esbuild@0.21.5']);
  });

  it('ignores changes that are not pending', () => {
    const stdout = JSON.stringify({
      allowScripts: [
        {
          name: 'swiftlint',
          changes: [
            { key: 'swiftlint@2.0.0', change: 'approved' },
            { key: 'swiftlint@2.1.0', change: 'pending' },
          ],
        },
      ],
    });

    assert.deepEqual(parseBlockedPackages(stdout), ['swiftlint@2.1.0']);
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

describe('diffBlockedKeys', () => {
  it('ignores a package that was already pending before the migration', () => {
    const before = ['esbuild@0.25.12'];
    const after = ['esbuild@0.25.12'];

    assert.deepEqual(diffBlockedKeys(before, after), []);
  });

  it('reports a package the migration itself installed', () => {
    const before = ['esbuild@0.25.12'];
    const after = ['esbuild@0.25.12', 'swiftlint@2.0.0'];

    assert.deepEqual(diffBlockedKeys(before, after), ['swiftlint@2.0.0']);
  });

  it('reports everything when nothing was pending beforehand', () => {
    assert.deepEqual(diffBlockedKeys([], ['fsevents@2.3.3', 'swiftlint@2.0.0']), ['fsevents@2.3.3', 'swiftlint@2.0.0']);
  });

  it('reports a new version of a package that was already pending', () => {
    assert.deepEqual(diffBlockedKeys(['swiftlint@1.9.0'], ['swiftlint@2.0.0']), ['swiftlint@2.0.0']);
  });

  it('ignores a package that stopped being pending', () => {
    assert.deepEqual(diffBlockedKeys(['swiftlint@1.9.0', 'esbuild@0.25.12'], ['esbuild@0.25.12']), []);
  });
});

describe('packageNameFromKey', () => {
  it('drops the version', () => {
    assert.equal(packageNameFromKey('swiftlint@2.0.0'), 'swiftlint');
  });

  it('keeps the scope of a scoped package', () => {
    assert.equal(packageNameFromKey('@capacitor/core@9.0.0-alpha.7'), '@capacitor/core');
  });

  it('passes through a key with no version', () => {
    assert.equal(packageNameFromKey('swiftlint'), 'swiftlint');
    assert.equal(packageNameFromKey('@capacitor/core'), '@capacitor/core');
  });
});

describe('formatBlockedScriptsError', () => {
  it('names the packages and gives the recovery commands', () => {
    const message = formatBlockedScriptsError(['fsevents@2.3.3', 'swiftlint@2.0.0']);

    assert.equal(
      message,
      [
        'npm blocked the install scripts of 2 packages, so the migration is incomplete:',
        '  fsevents@2.3.3',
        '  swiftlint@2.0.0',
        '',
        'Review those packages, then approve and rebuild them:',
        '  npm install-scripts approve fsevents swiftlint',
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
    const message = formatBlockedScriptsError(['esbuild@0.25.12', 'esbuild@0.21.5']);

    assert.match(message, /^npm blocked the install scripts of 1 package, so/);
    assert.match(message, /^ {2}esbuild@0\.25\.12$/m);
    assert.match(message, /^ {2}esbuild@0\.21\.5$/m);
    assert.match(message, /^ {2}npm install-scripts approve esbuild$/m);
  });

  it('tells the user the migration does not need to be re-run', () => {
    assert.match(formatBlockedScriptsError(['swiftlint@2.0.0']), /does not need to be run again\.$/);
  });
});
