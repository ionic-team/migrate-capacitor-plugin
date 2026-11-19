import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setPropertyLookupReceiver } from './property-lookup.ts';

describe('setPropertyLookupReceiver', () => {
  const legacy = `ext {
    junitVersion = project.hasProperty('junitVersion') ? rootProject.ext.junitVersion : '4.13.2'
}

buildscript {
    ext.kotlin_version = project.hasProperty("kotlin_version") ? rootProject.ext.kotlin_version : '2.2.20'
}

android {
    compileSdk = project.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 37
    defaultConfig {
        minSdkVersion project.hasProperty('minSdkVersion') ? rootProject.ext.minSdkVersion : 26
    }
}`;
  const migrated = `ext {
    junitVersion = rootProject.hasProperty('junitVersion') ? rootProject.ext.junitVersion : '4.13.2'
}

buildscript {
    ext.kotlin_version = rootProject.hasProperty("kotlin_version") ? rootProject.ext.kotlin_version : '2.2.20'
}

android {
    compileSdk = rootProject.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 37
    defaultConfig {
        minSdkVersion rootProject.hasProperty('minSdkVersion') ? rootProject.ext.minSdkVersion : 26
    }
}`;

  it('moves variable lookups to rootProject', () => {
    assert.equal(setPropertyLookupReceiver(legacy, 'rootProject'), migrated);
  });

  it('is idempotent', () => {
    assert.equal(setPropertyLookupReceiver(migrated, 'rootProject'), migrated);
  });

  it('moves them back to project', () => {
    assert.equal(setPropertyLookupReceiver(migrated, 'project'), legacy);
  });

  it('leaves other hasProperty calls alone', () => {
    const other = [
      `def flag = project.hasProperty('myFlag') ? project.myFlag : false`,
      `x = project.hasProperty('a') ? rootProject.ext.b : 1`,
      `if (subproject.hasProperty('x') ? rootProject.ext.x : 1) {}`,
      `return hasProperty('NEXUS_USERNAME') ? NEXUS_USERNAME : ""`,
    ].join('\n');
    assert.equal(setPropertyLookupReceiver(other, 'rootProject'), other);
  });
});
