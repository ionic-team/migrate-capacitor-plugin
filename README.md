# Migrate Capacitor Plugin

Migrate a Capacitor 8 plugin to Capacitor 9.

## Usage

```
npx @capacitor/plugin-migration-v8-to-v9@latest
```

## Blocked install scripts

npm 12 blocks the install scripts of dependencies that are not listed in `allowScripts`,
and still exits successfully. When that happens the plugin files are migrated but the
dependency tree is incomplete, so the migration exits with an error naming the packages:

```
The plugin files were migrated, but npm blocked the install scripts of 1 package, so the migration is incomplete:
  swiftlint@2.0.0

Review those packages, then approve and rebuild them:
  npm install-scripts approve swiftlint
  npm rebuild

The migration itself does not need to be run again.
```

Review each package before approving it. Only packages that this migration made pending
are reported — anything already covered by your own `allowScripts` policy before the
migration ran is left alone.

## Failed installs

The migration runs `npm install` after rewriting your files. If that fails, the plugin
files are still migrated but the dependency tree is incomplete, so the migration exits
non-zero and prints npm's own error.

Plugins that declare another package manager are exempt: a `packageManager` field naming
pnpm, yarn or bun, or an `only-allow` preinstall guard, makes `npm install` fail by
design. In that case the migration warns, finishes, and exits successfully — install the
dependencies with your own package manager afterwards.
