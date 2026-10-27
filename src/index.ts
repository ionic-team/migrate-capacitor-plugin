import {
  existsSync,
  moveSync,
  readFileSync,
  pathExists,
  readJSON,
  removeSync,
  writeFileSync,
  writeJSON,
} from 'fs-extra';
import { join, resolve } from 'path';
import { rimraf } from 'rimraf';
import { coerce, gte, lt, valid } from 'semver';

import {
  diffBlockedKeys,
  findInstallScriptKeys,
  formatBlockedScriptsError,
  npmSupportsInstallScriptsIn,
} from './install-scripts';
import type { CommandRunner } from './install-scripts';
import { logger } from './log';
import { declaresOtherPackageManager } from './package-manager';
import { runCommand } from './subprocess';

const coreVersion = '9.0.0-alpha.8';
const coreNPMVersion = coreVersion.includes('-') ? 'next' : `^${coreVersion}`;
const gradleVersion = '9.8.2';
const AGPVersion = '9.4.1';
const gmsVersion = '4.5.0';
const docgenVersion = '^0.3.1';
const eslintVersion = '^10.0.0';
const ionicEslintVersion = '^0.5.0';
const ionicPrettierVersion = '^4.0.0';

// Flat config has no equivalent of .eslintignore, so its entries move into the config.
// Keep them: a plugin that excluded docs/ or website/ should not start linting them.
function eslintIgnoresFrom(eslintIgnorePath: string): string[] {
  const entries = existsSync(eslintIgnorePath)
    ? readFileSync(eslintIgnorePath, 'utf-8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
    : ['build', 'dist', 'example-app'];
  // the example app has its own lint setup, and eslint 10 no longer reads its .eslintrc
  if (!entries.some((entry) => entry.includes('example-app'))) {
    entries.push('example-app');
  }

  return entries.map((entry) => {
    if (entry.endsWith('/**')) {
      return entry;
    }
    const bare = entry.replace(/\/$/, '');
    const name = bare.split('/').pop() ?? bare;
    // a dot anywhere but the front means it is a file, not a directory
    if (name.indexOf('.') > 0) {
      return bare;
    }
    return bare.includes('/') ? `${bare}/**` : `**/${bare}/**`;
  });
}

function existingFlatConfig(dir: string): string | undefined {
  return ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts']
    .map((ext) => `eslint.config.${ext}`)
    .find((file) => existsSync(join(dir, file)));
}

// @ionic/eslint-config already depends on these. Plugins on the shared config often list them too,
// and their older majors only support eslint 9 or lower, which makes npm install fail.
const bundledByIonicEslintConfig = [
  'eslint-plugin-import',
  'eslint-config-prettier',
  '@typescript-eslint/parser',
  '@typescript-eslint/eslint-plugin',
];

function eslintConfigCjsFor(ignores: string[]): string {
  const lines = ignores.map((entry) => `      '${entry}',`).join('\n');
  return `const ionic = require('@ionic/eslint-config/recommended');

module.exports = [
  {
    ignores: [
${lines}
      // the old lint script passed --ext ts, which flat config ignores
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  ...ionic,
];
`;
}
const ionicSwiftlintVersion = '^2.0.0';
const prettierJavaVersion = '^2.7.7';
const prettierVersion = '^3.6.2';
const rimrafVersion = '^6.1.0';
const rollupVersion = '^4.53.2';
const typesNodeVersion = '^24.10.1';
const typeScriptVersion = '^5.9.3';
const iOSVersion = '16';
let updatePrettierJava = false;
const variables = {
  minSdkVersion: 26,
  compileSdkVersion: 37,
  androidxActivityVersion: '1.13.0',
  androidxAppCompatVersion: '1.8.0',
  androidxCoordinatorLayoutVersion: '1.3.0',
  androidxCoreVersion: '1.19.1',
  androidxFragmentVersion: '1.9.1',
  firebaseMessagingVersion: '25.0.1',
  playServicesLocationVersion: '21.4.0',
  androidxBrowserVersion: '1.10.0',
  androidxMaterialVersion: '1.14.0',
  androidxExifInterfaceVersion: '1.4.2',
  coreSplashScreenVersion: '1.2.0',
  androidxWebkitVersion: '1.17.1',
  junitVersion: '4.13.2',
  androidxJunitVersion: '1.3.0',
  androidxEspressoCoreVersion: '3.7.0',
  googleMapsPlayServicesVersion: '20.0.0',
  googleMapsUtilsVersion: '5.0.0',
  googleMapsKtxVersion: '6.0.1',
  googleMapsUtilsKtxVersion: '6.0.1',
  kotlinxCoroutinesVersion: '1.11.0',
};

// AGP 9 changed the defaults of these properties and Android Studio's AGP Upgrade Assistant
// writes them into gradle.properties as compatibility shims. Capacitor apps need none of them,
// most are deprecated and will be removed in AGP 10, and some (android.builtInKotlin,
// android.sdk.defaultTargetSdkToCompileSdkIfUnset) break a Capacitor 9 build.
const agpMigrationAssistantProperties = [
  'android.builtInKotlin',
  'android.defaults.buildfeatures.resvalues',
  'android.dependency.useConstraints',
  'android.enableAppCompileTimeRClass',
  'android.newDsl',
  'android.r8.optimizedResourceShrinking',
  'android.r8.strictFullModeForKeepRules',
  'android.sdk.defaultTargetSdkToCompileSdkIfUnset',
  'android.uniquePackageNames',
  'android.usesSdkInManifest.disallowed',
];

process.on('unhandledRejection', (error) => {
  process.stderr.write(`ERR: ${error}\n`);
  process.exit(1);
});

export const run = async (): Promise<void> => {
  const dir = process.cwd();
  const opts = { cwd: dir, stdio: 'inherit' } as const;
  const packageJson = join(dir, 'package.json');
  const prettierIgnore = join(dir, '.prettierignore');
  const gitIgnore = join(dir, '.gitignore');

  const pluginJSON = await readJSON(packageJson);

  for (const dep of ['@capacitor/ios', '@capacitor/android', '@capacitor/core', '@capacitor/cli']) {
    if (pluginJSON.devDependencies?.[dep]) {
      pluginJSON.devDependencies[dep] = coreNPMVersion;
    }
    if (pluginJSON.dependencies?.[dep]) {
      pluginJSON.dependencies[dep] = coreNPMVersion;
    }
    if (pluginJSON.peerDependencies?.[dep]) {
      pluginJSON.peerDependencies[dep] = `>=${coreVersion}`;
    }
  }
  let eslintUpdated = false;
  if (pluginJSON.devDependencies?.['@ionic/eslint-config']) {
    updateIfOlder(pluginJSON, '@ionic/eslint-config', ionicEslintVersion);
    updateIfOlder(pluginJSON, 'eslint', eslintVersion);
    delete pluginJSON.eslintConfig;
    // a hand-written flat config may use these directly, so only drop them when the shared config replaces it
    if (!existingFlatConfig(dir)) {
      for (const dep of bundledByIonicEslintConfig) {
        delete pluginJSON.devDependencies[dep];
      }
    }
    if (pluginJSON.scripts?.['eslint']) {
      pluginJSON.scripts['eslint'] = pluginJSON.scripts['eslint'].replace(' --ext ts', '');
    }
    eslintUpdated = true;
  }
  updateIfOlder(pluginJSON, '@ionic/swiftlint-config', ionicSwiftlintVersion);
  updateIfOlder(pluginJSON, 'swiftlint', ionicSwiftlintVersion);
  updateIfOlder(pluginJSON, 'rimraf', rimrafVersion);
  updateIfOlder(pluginJSON, 'rollup', rollupVersion);
  updateIfOlder(pluginJSON, 'typescript', typeScriptVersion);
  updateIfOlder(pluginJSON, '@types/node', typesNodeVersion);
  let prettierUpdatedFromV2 = false;
  if (pluginJSON.devDependencies?.['@ionic/prettier-config']) {
    const existingPrettierVersion = pluginJSON.devDependencies?.['prettier'];
    if (existingPrettierVersion) {
      const cleanVersion = coerce(existingPrettierVersion);
      if (cleanVersion && lt(cleanVersion, '3.0.0')) {
        prettierUpdatedFromV2 = true;
      }
    }
    updateIfOlder(pluginJSON, '@ionic/prettier-config', ionicPrettierVersion);
    updateIfOlder(pluginJSON, 'prettier', prettierVersion);
    updateIfOlder(pluginJSON, 'prettier-plugin-java', prettierJavaVersion);
    updatePrettierJava = true;
  }

  updateIfOlder(pluginJSON, '@capacitor/docgen', docgenVersion);

  if (pluginJSON.version?.startsWith('7.')) {
    pluginJSON.version = '8.0.0';
  }

  await writeJSON(packageJson, pluginJSON, { spaces: 2 });

  let packageJsonText = readFileSync(packageJson, 'utf-8');
  if (packageJsonText.includes('rollup.config.js')) {
    packageJsonText = packageJsonText.replace('rollup.config.js', 'rollup.config.mjs');
    moveSync(join(dir, 'rollup.config.js'), join(dir, 'rollup.config.mjs'));
  }

  if (updatePrettierJava) {
    if (!packageJsonText.includes('--plugin=prettier-plugin-java')) {
      packageJsonText = packageJsonText.replace(
        '"prettier \\"**/*.{css,html,ts,js,java}\\"',
        '"prettier \\"**/*.{css,html,ts,js,java}\\" --plugin=prettier-plugin-java',
      );
    }
    let prettierIgnoreText = readFile(prettierIgnore);
    const gitIgnoreText = readFile(gitIgnore);
    if (gitIgnoreText && prettierIgnoreText) {
      if (gitIgnoreText.includes('build')) {
        prettierIgnoreText = prettierIgnoreText.replace(`build\n`, '');
      }
      if (gitIgnoreText.includes('dist')) {
        prettierIgnoreText = prettierIgnoreText.replace(`dist\n`, '');
      }
      if (!prettierIgnoreText || prettierIgnoreText === `\n`) {
        removeSync(prettierIgnore);
      } else {
        writeFileSync(prettierIgnore, prettierIgnoreText, 'utf-8');
      }
    }
  }

  writeFileSync(packageJson, packageJsonText, 'utf-8');

  if (eslintUpdated) {
    const ignores = eslintIgnoresFrom(join(dir, '.eslintignore'));
    // ESLint 10 reads neither of these, so leaving them behind is just dead config
    const stale = ['.eslintignore', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml'];
    for (const file of stale.map((name) => join(dir, name))) {
      if (existsSync(file)) {
        removeSync(file);
      }
    }
    const existingConfig = existingFlatConfig(dir);
    if (existingConfig) {
      // a hand-written flat config may still load the 0.4 eslintrc export through FlatCompat
      logger.warn(
        `${existingConfig} already exists and was left as is. @ionic/eslint-config/recommended is now a flat config array, so spread it into the config instead of loading it through FlatCompat.`,
      );
    } else {
      writeFileSync(join(dir, 'eslint.config.cjs'), eslintConfigCjsFor(ignores), 'utf-8');
    }
  }

  const runInDir: CommandRunner = (command, args) => runCommand(command, args, { cwd: dir });

  // Take the baseline before anything is removed or reinstalled: `npm install-scripts ls`
  // enumerates the tree on disk, so this is the last point at which it still reports what was
  // already pending before this migration started.
  const supportsInstallScripts = await npmSupportsInstallScriptsIn(runInDir);
  const baselineBlocked = supportsInstallScripts ? await findInstallScriptKeys(runInDir) : null;
  if (supportsInstallScripts && baselineBlocked === null) {
    logger.warn('Could not read the blocked install scripts of this plugin, skipping the check');
  }

  // start from a clean tree: npm treats what is already installed as the starting point, and an
  // installed eslint 8 with @ionic/eslint-config 0.4 blocks the move to eslint 10 and 0.5
  rimraf.sync(join(dir, 'node_modules'));
  rimraf.sync(join(dir, 'package-lock.json'));

  let installError: string | undefined;
  let blockedPackages: string[] = [];
  try {
    await runCommand('npm', ['install'], {
      ...opts,
      cwd: dir,
    });
    if (baselineBlocked !== null) {
      const blockedAfterInstall = await findInstallScriptKeys(runInDir);
      if (blockedAfterInstall === null) {
        logger.warn('Could not read the blocked install scripts after installing, skipping the check');
      } else {
        // Only report what this migration made pending. Packages that were already pending
        // are the repo's own allowScripts policy, not something the migration broke.
        blockedPackages = diffBlockedKeys(baselineBlocked, blockedAfterInstall);
      }
    }
  } catch (e: any) {
    logger.warn('npm install failed, please, install the dependencies using your package manager of choice');
    // A repo that declares pnpm, yarn or bun fails `npm install` on purpose, so that is not
    // evidence of an incomplete migration.
    if (!declaresOtherPackageManager(pluginJSON)) {
      installError = String(e);
    }
  }

  if (pluginJSON.capacitor?.android?.src) {
    const androidDir = resolve(dir, pluginJSON.capacitor.android.src);
    if (await pathExists(androidDir)) {
      logger.info('Updating Android files');

      logger.info('Updating gradle files');
      const buildGradle = join(androidDir, 'build.gradle');

      let gradleText = readFileSync(buildGradle, 'utf-8');
      gradleText = gradleText.replace(/\s*jcenter\(\)/g, '');
      gradleText = gradleText.replace(`proguard-android.txt`, `proguard-android-optimize.txt`);
      writeFileSync(buildGradle, gradleText, { encoding: 'utf-8' });

      // gradle.properties
      await updateGradleProperties(join(androidDir, 'gradle.properties'));
      const gradleWrapperPath = join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');

      const gradleWrapperVersion = getGradleWrapperVersion(gradleWrapperPath);
      const outdatedGradle = gte(gradleVersion, gradleWrapperVersion);

      if (outdatedGradle) {
        await updateFile(
          gradleWrapperPath,
          'services.gradle.org/distributions/gradle-',
          '.zip',
          `${gradleVersion}-all`,
        );

        await runCommand(
          './gradlew',
          ['wrapper', '--distribution-type', 'all', '--gradle-version', gradleVersion, '--warning-mode', 'all'],
          {
            ...opts,
            cwd: androidDir,
          },
        );
        // run twice as first run only updates the properties file
        await runCommand(
          './gradlew',
          ['wrapper', '--distribution-type', 'all', '--gradle-version', gradleVersion, '--warning-mode', 'all'],
          {
            ...opts,
            cwd: androidDir,
          },
        );
      }

      const variablesAndClasspaths = {
        variables: variables,
        'com.android.tools.build:gradle': AGPVersion,
        'com.google.gms:google-services': gmsVersion,
      };
      await updateBuildGradle(buildGradle, variablesAndClasspaths);
      await shipProguardRules(dir, pluginJSON.capacitor.android.src, buildGradle);
    }
  }

  if (pluginJSON.capacitor?.ios?.src) {
    const iosDir = resolve(dir, pluginJSON.capacitor.ios.src);
    if (await pathExists(iosDir)) {
      logger.info('Updating iOS files');
      await updateFile(
        join(iosDir, 'Plugin.xcodeproj', 'project.pbxproj'),
        'IPHONEOS_DEPLOYMENT_TARGET = ',
        ';',
        `${iOSVersion}.0`,
      );
      const packageSwift = join(dir, 'Package.swift');
      await updateFile(join(iosDir, 'Podfile'), `platform :ios, '`, `'`, `${iOSVersion}.0`);
      await updateFile(packageSwift, '[.iOS(.v', ')],', iOSVersion);
      await updateFile(
        packageSwift,
        '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git",',
        ')',
        ` from: "${coreVersion}"`,
      );
      let packageSwiftText = readFileSync(packageSwift, 'utf-8');
      packageSwiftText = packageSwiftText.replace(
        /^[ \t]*\.product\(name:\s*"Cordova",\s*package:\s*"capacitor-swift-pm"\),?\n?/m,
        '',
      );
      packageSwiftText = packageSwiftText.replaceAll('capacitor-swift-pm', 'capacitor');
      writeFileSync(packageSwift, packageSwiftText, { encoding: 'utf-8' });
      await updatePodspec(dir, pluginJSON);
    }
  }

  if (eslintUpdated) {
    logger.info('');
    logger.info('⚠️  Note: ESLint has been updated to v10 and @ionic/eslint-config to v0.5.0, which uses flat config.');
    logger.info(
      'An eslint.config.cjs file was added; .eslintignore and the eslintConfig block in package.json were removed.',
    );
    logger.info(
      'Running lint may surface new reports; see https://github.com/ionic-team/eslint-config#migrating-from-04-or-earlier',
    );
  }

  if (prettierUpdatedFromV2) {
    logger.info('');
    logger.info('⚠️  Note: Prettier has been updated from v2 to v3.');
    logger.info(
      'We recommend running your formatting and linting scripts to ensure your codebase is formatted correctly.',
    );
    logger.info('');
  }

  if (installError) {
    throw `The plugin files were migrated, but npm install failed, so the migration is incomplete.\nInstall the dependencies using your package manager of choice.\nThe migration itself does not need to be run again.\n\nnpm install said:\n${installError}`;
  }

  if (blockedPackages.length > 0) {
    throw `The plugin files were migrated, but ${formatBlockedScriptsError(blockedPackages)}`;
  }

  logger.info('Plugin migrated to Capacitor 9!');
};

// Rules in android/proguard-rules.pro only reach apps through consumerProguardFiles and the published files.
async function shipProguardRules(dir: string, androidSrc: string, buildGradle: string): Promise<void> {
  const rulesFile = join(dir, androidSrc, 'proguard-rules.pro');
  const gradleText = readFile(buildGradle);
  if (!existsSync(rulesFile) || !gradleText) {
    return;
  }
  let changed = false;
  let wired = gradleText;
  if (!wired.includes('consumerProguardFiles')) {
    wired = wired.replace(/(defaultConfig\s*\{(\r?\n))([ \t]*)/, `$1$3consumerProguardFiles "proguard-rules.pro"$2$3`);
    if (wired === gradleText) {
      logger.warn(`Unable to add consumerProguardFiles to ${buildGradle}. Add it so ${rulesFile} reaches apps.`);
      return;
    }
    writeFileSync(buildGradle, wired, 'utf-8');
    changed = true;
  }
  if (!/consumerProguardFiles.*proguard-rules\.pro/.test(wired)) {
    return;
  }

  const packageJson = join(dir, 'package.json');
  const pluginJSON = await readJSON(packageJson);
  const entry = `${androidSrc}/proguard-rules.pro`;
  if (pluginJSON.files && ![entry, androidSrc, `${androidSrc}/`].some((file) => pluginJSON.files.includes(file))) {
    pluginJSON.files.push(entry);
    await writeJSON(packageJson, pluginJSON, { spaces: 2 });
    changed = true;
  }

  const rules = readFileSync(rulesFile, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'));
  if (changed && rules.length) {
    logger.warn(`${entry} now ships to apps. Review these rules before publishing:\n${rules.join('\n')}`);
  }
}

async function updateGradleProperties(filename: string): Promise<void> {
  const txt = readFile(filename);
  if (!txt) {
    return;
  }

  const replaced = removeAGPMigrationProperties(txt);
  if (replaced !== txt) {
    writeFileSync(filename, replaced, 'utf-8');
  }
}

function removeAGPMigrationProperties(txt: string): string {
  return txt
    .split('\n')
    .filter((line) => {
      const property = line.split('=')[0].trim();
      if (!agpMigrationAssistantProperties.includes(property)) {
        return true;
      }
      logger.info(`Removed ${property} from gradle.properties.`);
      return false;
    })
    .join('\n');
}

function updatePodspec(dir: string, pluginJSON: any) {
  const podspecFile = pluginJSON.files.find((file: string) => file.includes('.podspec'));
  let txt = readFile(join(dir, podspecFile));
  if (!txt) {
    return false;
  }
  txt = txt.replace('s.ios.deployment_target  =', 's.ios.deployment_target =');
  const prevIOS = Number(iOSVersion) - 1;
  txt = txt.replace(`s.ios.deployment_target = '${prevIOS}.0'`, `s.ios.deployment_target = '${iOSVersion}.0'`);
  writeFileSync(podspecFile, txt, { encoding: 'utf-8' });
}

async function updateBuildGradle(
  filename: string,
  variablesAndClasspaths: {
    variables: any;
    'com.android.tools.build:gradle': string;
    'com.google.gms:google-services': string;
  },
) {
  let gradleFile = readFile(filename);
  if (!gradleFile) {
    return;
  }
  gradleFile = gradleFile.replaceAll(' =  ', ' = ');
  logger.info('Updating build.gradle');
  gradleFile = gradleFile.replaceAll('androidxCoreKTXVersion', 'androidxCoreVersion');

  gradleFile = setAllStringIn(gradleFile, `sourceCompatibility JavaVersion.`, `\n`, `VERSION_21`);
  gradleFile = setAllStringIn(gradleFile, `targetCompatibility JavaVersion.`, `\n`, `VERSION_21`);

  const neededDeps: { [key: string]: string } = {
    'com.android.tools.build:gradle': variablesAndClasspaths['com.android.tools.build:gradle'],
    'com.google.gms:google-services': variablesAndClasspaths['com.google.gms:google-services'],
  };

  for (const dep of Object.keys(neededDeps)) {
    if (gradleFile.includes(`classpath '${dep}`)) {
      const firstIndex = gradleFile.indexOf(dep) + dep.length + 1;
      const existingVersion = '' + gradleFile.substring(firstIndex, gradleFile.indexOf("'", firstIndex));
      if (gte(neededDeps[dep], existingVersion)) {
        gradleFile = setAllStringIn(gradleFile, `classpath '${dep}:`, `'`, neededDeps[dep]);
        logger.info(`Set ${dep} = ${neededDeps[dep]}.`);
      }
    }
  }

  for (const [dep, depValue] of Object.entries(variablesAndClasspaths.variables)) {
    let depString = `${dep} = project.hasProperty('${dep}') ? rootProject.ext.${dep} : '`;
    let depValueString = depValue;
    let endString = `'`;
    if (typeof depValue === 'number') {
      depString = `project.hasProperty('${dep}') ? rootProject.ext.${dep} : `;
      depValueString = depValue.toString();
      endString = '\n';
    }
    if (gradleFile.includes(depString) && typeof depValueString === 'string') {
      const firstIndex = gradleFile.indexOf(depString) + depString.length;
      const existingVersion = '' + gradleFile.substring(firstIndex, gradleFile.indexOf(endString, firstIndex));
      if (
        (valid(depValueString) && gte(depValueString, existingVersion)) ||
        (!valid(depValueString) && (depValue as number) > Number(existingVersion))
      ) {
        gradleFile = setAllStringIn(gradleFile, depString, endString, depValueString);
        logger.info(`Set ${dep} = ${depValueString}.`);
      }
    }
  }

  gradleFile = updateDeprecatedPropertySyntax(gradleFile);
  gradleFile = updateKotlinOptions(gradleFile);
  gradleFile = gradleFile.replace(
    /^\s*ext\.kotlin_version = project\.hasProperty\("kotlin_version"\) \? rootProject\.ext\.kotlin_version : '\d+\.\d+\.\d+'\n?/m,
    '',
  );
  gradleFile = gradleFile.replace(
    /^\s*ext \{\n\s*kotlin_version = project\.hasProperty\("kotlin_version"\) \? rootProject\.ext\.kotlin_version : '[\d.]+'\n\s*\}\n?/gm,
    '',
  );
  gradleFile = gradleFile.replace(
    /^\s*classpath "org\.jetbrains\.kotlin:kotlin-gradle-plugin:\$kotlin_version"\n?/m,
    '',
  );
  if (!gradleFile.includes(`project.extensions.findByName('kotlin')`)) {
    gradleFile = gradleFile.replace(`apply plugin: 'kotlin-android'\n`, '');
  } else {
    gradleFile = gradleFile.replace(
      /\s*if\s*\(\s*project\.extensions\.findByName\('kotlin'\)\s*==\s*null\s*\)\s*\{\s*apply\s+plugin:\s*'kotlin-android'\s*\}*/gm,
      '',
    );
  }

  gradleFile = gradleFile.replace(`apply plugin: 'org.jetbrains.kotlin.android'\n`, '');
  gradleFile = gradleFile.replace(
    /^\s*implementation "org\.jetbrains\.kotlin:kotlin-stdlib:\$kotlin_version"\n?/gm,
    '',
  );
  gradleFile = gradleFile.replace(
    /^\s*targetSdkVersion project\.hasProperty\('targetSdkVersion'\) \? rootProject\.ext\.targetSdkVersion : \d+\n?/m,
    '',
  );
  gradleFile = gradleFile.replace(
    `implementation "androidx.core:core-ktx:$androidxCoreVersion"`,
    `implementation "androidx.core:core:$androidxCoreVersion"`,
  );
  if (gradleFile.includes(`androidx.core:core-ktx:1`)) {
    gradleFile = setAllStringIn(gradleFile, `androidx.core:core`, `'`, `:${variables.androidxCoreVersion}`);
  }

  writeFileSync(filename, gradleFile, 'utf-8');
}

function updateDeprecatedPropertySyntax(gradleFile: string): string {
  const propertiesToUpdate = ['namespace', 'compileSdk', 'url', 'abortOnError'];

  let result = gradleFile;

  for (const prop of propertiesToUpdate) {
    const regex = new RegExp(`\\b(${prop})[ \\t]+([^=\\t{:])`, 'g');
    result = result.replace(regex, '$1 = $2');
  }

  return result;
}

function updateKotlinOptions(gradleFile: string): string {
  const kotlinOptionsRegex = /kotlinOptions\s*\{\s*jvmTarget\s*=\s*['"](\d+\.?\d*)['"][\s\S]*?\}/;
  const match = kotlinOptionsRegex.exec(gradleFile);

  if (!match) {
    return gradleFile;
  }

  const jvmTargetValue = `JVM_21`;

  let result = gradleFile;

  if (!result.includes('import org.jetbrains.kotlin.gradle.dsl.JvmTarget')) {
    const firstNonCommentLine = result.split('\n').findIndex((line) => {
      if (!line) return false;
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    });
    const lines = result.split('\n');
    if (firstNonCommentLine >= 0) {
      lines.splice(firstNonCommentLine, 0, 'import org.jetbrains.kotlin.gradle.dsl.JvmTarget', '');
      result = lines.join('\n');
    }
  }

  result = result.replace(/\n\s*kotlinOptions\s*\{[\s\S]*?\}\s*\n/g, '\n');

  const kotlinBlockRegex = /\nkotlin\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/;
  const kotlinBlockMatch = kotlinBlockRegex.exec(result);

  const compilerOptionsBlock = `    compilerOptions {\n        jvmTarget = JvmTarget.${jvmTargetValue}\n    }`;

  if (kotlinBlockMatch) {
    // Kotlin block exists, add compilerOptions to it if not already present
    if (!kotlinBlockMatch[0].includes('compilerOptions')) {
      const kotlinBlockContent = kotlinBlockMatch[1];
      const existingContent = kotlinBlockContent.trimEnd();
      const newKotlinBlock = `\nkotlin {${existingContent}\n${compilerOptionsBlock}\n}`;
      result = result.replace(kotlinBlockRegex, newKotlinBlock);
    }
  } else {
    // No kotlin block exists, create one after the android block
    const androidBlockRegex = /android\s*\{[\s\S]*?\n\}/;
    const androidMatch = androidBlockRegex.exec(result);

    if (androidMatch) {
      const insertPosition = androidMatch.index + androidMatch[0].length;
      const kotlinBlock = `\n\nkotlin {\n${compilerOptionsBlock}\n}`;
      result = result.slice(0, insertPosition) + kotlinBlock + result.slice(insertPosition);
    }
  }

  logger.info('Updated kotlinOptions to compilerOptions for Kotlin 2');

  return result;
}

function readFile(filename: string): string | undefined {
  try {
    if (!existsSync(filename)) {
      logger.warn(`Unable to find ${filename}.`);
      return;
    }
    return readFileSync(filename, 'utf-8');
  } catch (err) {
    logger.warn(`Unable to read ${filename}. Verify it is not already open. ${err}`);
  }
}

function setAllStringIn(data: string, start: string, end: string, replacement: string): string {
  let position = 0;
  let result = data;
  let replaced = true;
  while (replaced) {
    const foundIdx = result.indexOf(start, position);

    if (foundIdx == -1) {
      replaced = false;
    } else {
      const idx = foundIdx + start.length;
      position = idx + replacement.length;
      result = result.substring(0, idx) + replacement + result.substring(result.indexOf(end, idx));
    }
  }
  return result;
}

async function updateFile(
  filename: string,
  textStart: string,
  textEnd: string,
  replacement?: string,
  skipIfNotFound?: boolean,
): Promise<boolean> {
  const path = filename;
  let txt = readFile(path);
  if (!txt) {
    return false;
  }
  if (txt.includes(textStart)) {
    if (replacement) {
      txt = setAllStringIn(txt, textStart, textEnd, replacement);
      writeFileSync(path, txt, { encoding: 'utf-8' });
    } else {
      // Replacing in code so we need to count the number of brackets to find the end of the function in swift
      const lines = txt.split('\n');
      let replaced = '';
      let keep = true;
      let brackets = 0;
      for (const line of lines) {
        if (line.includes(textStart)) {
          keep = false;
        }
        if (!keep) {
          brackets += (line.match(/{/g) || []).length;
          brackets -= (line.match(/}/g) || []).length;
          if (brackets == 0) {
            keep = true;
          }
        } else {
          replaced += line + '\n';
        }
      }
      writeFileSync(path, replaced, { encoding: 'utf-8' });
    }
    return true;
  } else if (!skipIfNotFound) {
    logger.warn(`Unable to find "${textStart}" in ${filename}. Try updating it manually`);
  }

  return false;
}

function getGradleWrapperVersion(filename: string): string {
  const txt = readFile(filename);
  if (!txt) {
    return '0.0.0';
  }
  const version = txt.substring(txt.indexOf('gradle-') + 7, txt.indexOf('.zip', txt.indexOf('gradle-')));
  const semverVersion = coerce(version)?.version;
  return semverVersion ? semverVersion : '0.0.0';
}

function updateIfOlder(pluginJSON: any, dependency: string, version: string) {
  const existingVersion = pluginJSON.devDependencies?.[dependency];
  if (existingVersion) {
    const cleanVersion = coerce(existingVersion);
    const cleanNewVersion = coerce(version);
    if (cleanVersion && cleanNewVersion && lt(cleanVersion, cleanNewVersion)) {
      pluginJSON.devDependencies[dependency] = version;
    }
  }
}
