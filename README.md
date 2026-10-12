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
```

Review each package before approving it. The migration itself does not need to be run
again.