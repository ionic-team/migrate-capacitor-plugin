import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { declaresOtherPackageManager } from './package-manager.ts';

describe('declaresOtherPackageManager', () => {
  it('is false for a plain npm plugin', () => {
    assert.equal(declaresOtherPackageManager({}), false);
    assert.equal(declaresOtherPackageManager({ scripts: { build: 'tsc' } }), false);
  });

  it('detects a corepack packageManager field', () => {
    assert.equal(declaresOtherPackageManager({ packageManager: 'pnpm@9.12.0' }), true);
    assert.equal(declaresOtherPackageManager({ packageManager: 'yarn@4.5.0' }), true);
    assert.equal(declaresOtherPackageManager({ packageManager: 'bun@1.1.30' }), true);
  });

  it('is false when the packageManager field names npm', () => {
    assert.equal(declaresOtherPackageManager({ packageManager: 'npm@11.21.0' }), false);
    assert.equal(declaresOtherPackageManager({ packageManager: ' npm@12.2.0 ' }), false);
  });

  it('detects an only-allow preinstall guard', () => {
    assert.equal(declaresOtherPackageManager({ scripts: { preinstall: 'npx only-allow pnpm' } }), true);
    assert.equal(declaresOtherPackageManager({ scripts: { preinstall: 'npx -y only-allow yarn' } }), true);
  });

  it('is false when only-allow allows npm', () => {
    assert.equal(declaresOtherPackageManager({ scripts: { preinstall: 'npx only-allow npm' } }), false);
  });

  it('ignores an unrelated preinstall script', () => {
    assert.equal(declaresOtherPackageManager({ scripts: { preinstall: 'node ./check-env.js' } }), false);
  });

  it('ignores a non-string or empty packageManager field', () => {
    assert.equal(declaresOtherPackageManager({ packageManager: '' }), false);
    assert.equal(declaresOtherPackageManager({ packageManager: 42 }), false);
  });

  it('prefers the packageManager field over the preinstall guard', () => {
    assert.equal(
      declaresOtherPackageManager({ packageManager: 'npm@12.2.0', scripts: { preinstall: 'npx only-allow pnpm' } }),
      false,
    );
  });
});
