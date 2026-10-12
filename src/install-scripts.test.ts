import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatBlockedScriptsError,
  npmSupportsInstallScripts,
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

  it('returns nothing when no package is blocked', () => {
    assert.deepEqual(parseBlockedPackages(JSON.stringify({ allowScripts: [] })), []);
  });

  it('returns nothing for unexpected or malformed output', () => {
    assert.deepEqual(parseBlockedPackages('not json'), []);
    assert.deepEqual(parseBlockedPackages(''), []);
    assert.deepEqual(parseBlockedPackages(JSON.stringify({})), []);
    assert.deepEqual(parseBlockedPackages(JSON.stringify({ allowScripts: 'nope' })), []);
    assert.deepEqual(parseBlockedPackages(JSON.stringify({ allowScripts: [{ name: 'swiftlint' }] })), []);
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
      ].join('\n'),
    );
  });

  it('uses the singular for one package', () => {
    const message = formatBlockedScriptsError(['swiftlint@2.0.0']);

    assert.match(message, /^npm blocked the install scripts of 1 package, so/);
  });

  it('lists a package once in the approve command when several versions are blocked', () => {
    const message = formatBlockedScriptsError(['esbuild@0.25.12', 'esbuild@0.21.5']);

    assert.match(message, /^ {2}npm install-scripts approve esbuild$/m);
  });
});
