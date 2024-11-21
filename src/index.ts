import { existsSync, readFileSync, pathExists, readJSON, writeFileSync, writeJSON } from 'fs-extra';
import { join, resolve } from 'path';
import { rimraf } from 'rimraf';

import { logger } from './log';
import { runCommand } from './subprocess';

const coreVersion = '^6.0.0';
const gradleVersion = '8.2.1';
const AGPVersion = '8.2.1';
const gmsVersion = '4.4.0';
const kotlinVersion = '1.9.10';
const eslintVersion = '^8.57.0';
const ionicEslintVersion = '^0.4.0';
const variables = {
  minSdkVersion: 22,
  compileSdkVersion: 34,
  targetSdkVersion: 34,
  androidxActivityVersion: '1.8.0',
  androidxAppCompatVersion: '1.6.1',
  androidxCoordinatorLayoutVersion: '1.2.0',
  androidxCoreVersion: '1.12.0',
  androidxFragmentVersion: '1.6.2',
  firebaseMessagingVersion: '23.3.1',
  playServicesLocationVersion: '21.1.0',
  androidxBrowserVersion: '1.7.0',
  androidxMaterialVersion: '1.10.0',
  androidxExifInterfaceVersion: '1.3.6',
  androidxCoreKTXVersion: '1.12.0',
  googleMapsPlayServicesVersion: '18.2.0',
  googleMapsUtilsVersion: '3.8.2',
  googleMapsKtxVersion: '5.0.0',
  googleMapsUtilsKtxVersion: '5.0.0',
  kotlinxCoroutinesVersion: '1.7.3',
  coreSplashScreenVersion: '1.0.1',
  androidxWebkitVersion: '1.9.0',
  junitVersion: '4.13.2',
  androidxJunitVersion: '1.1.5',
  androidxEspressoCoreVersion: '3.5.1',
};

process.on('unhandledRejection', (error) => {
  process.stderr.write(`ERR: ${error}\n`);
  process.exit(1);
});

export const run = async (): Promise<void> => {
  const dir = process.cwd();
  const opts = { cwd: dir, stdio: 'inherit' } as const;
  const packageJson = join(dir, 'package.json');

  const pluginJSON = await readJSON(packageJson);

  for (const dep of ['@capacitor/ios', '@capacitor/android', '@capacitor/core', '@capacitor/cli']) {
    if (pluginJSON.devDependencies?.[dep]) {
      pluginJSON.devDependencies[dep] = coreVersion;
    }
    if (pluginJSON.dependencies?.[dep]) {
      pluginJSON.dependencies[dep] = coreVersion;
    }
    if (pluginJSON.peerDependencies?.[dep]) {
      pluginJSON.peerDependencies[dep] = coreVersion;
    }
  }
  if (pluginJSON.devDependencies?.['@ionic/eslint-config']) {
    pluginJSON.devDependencies['@ionic/eslint-config'] = ionicEslintVersion;
    if (pluginJSON.devDependencies?.['eslint']) {
      pluginJSON.devDependencies['eslint'] = eslintVersion;
    }
  }

  if (pluginJSON.version.startsWith('5.')) {
    pluginJSON.version = '6.0.0';
  }

  await writeJSON(packageJson, pluginJSON, { spaces: 2 });

  rimraf.sync(join(dir, 'node_modules/@capacitor'));
  rimraf.sync(join(dir, 'package-lock.json'));

  try {
    await runCommand('npm', ['install'], {
      ...opts,
      cwd: dir,
    });
  } catch (e: any) {
    logger.warn('npm install failed, please, install the dependencies using your package manager of choice');
  }

  if (pluginJSON.capacitor?.android?.src) {
    const androidDir = resolve(dir, pluginJSON.capacitor.android.src);
    if (await pathExists(androidDir)) {
      logger.info('Updating Android files');

      updateGradleProperties(join(androidDir, 'gradle.properties'));
      const variablesAndClasspaths = {
        variables: variables,
        'com.android.tools.build:gradle': AGPVersion,
        'com.google.gms:google-services': gmsVersion,
      };
      await updateBuildGradle(join(androidDir, 'build.gradle'), variablesAndClasspaths);

      await movePackageFromManifestToBuildGradle(
        join(androidDir, 'src', 'main', 'AndroidManifest.xml'),
        join(androidDir, 'build.gradle'),
      );

      updateGradleWrapper(join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties'));

      logger.info('Updating gradle files');
      await runCommand(
        './gradlew',
        ['wrapper', '--distribution-type', 'all', '--gradle-version', gradleVersion, '--warning-mode', 'all'],
        {
          ...opts,
          cwd: androidDir,
        },
      );
    }
  }

  logger.info('Plugin migrated to Capacitor 6!');
};

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
  gradleFile = setAllStringIn(gradleFile, `sourceCompatibility JavaVersion.`, `\n`, `VERSION_17`);
  gradleFile = setAllStringIn(gradleFile, `targetCompatibility JavaVersion.`, `\n`, `VERSION_17`);

  const neededDeps: { [key: string]: string } = {
    'com.android.tools.build:gradle': variablesAndClasspaths['com.android.tools.build:gradle'],
    'com.google.gms:google-services': variablesAndClasspaths['com.google.gms:google-services'],
  };

  for (const dep of Object.keys(neededDeps)) {
    if (gradleFile.includes(`classpath '${dep}`)) {
      const semver = await import('semver');
      const firstIndex = gradleFile.indexOf(dep) + dep.length + 1;
      const existingVersion = '' + gradleFile.substring(firstIndex, gradleFile.indexOf("'", firstIndex));
      if (semver.gte(neededDeps[dep], existingVersion)) {
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
      depString = `${dep} project.hasProperty('${dep}') ? rootProject.ext.${dep} : `;
      depValueString = depValue.toString();
      endString = '\n';
    }
    if (gradleFile.includes(depString) && typeof depValueString === 'string') {
      const semver = await import('semver');
      const firstIndex = gradleFile.indexOf(depString) + depString.length;
      const existingVersion = '' + gradleFile.substring(firstIndex, gradleFile.indexOf(endString, firstIndex));
      if (
        (semver.valid(depValueString) && semver.gte(depValueString, existingVersion)) ||
        (!semver.valid(depValueString) && (depValue as number) > Number(existingVersion))
      ) {
        gradleFile = setAllStringIn(gradleFile, depString, endString, depValueString);
        logger.info(`Set ${dep} = ${depValueString}.`);
      }
    }
  }
  gradleFile = setAllStringIn(
    gradleFile,
    `ext.kotlin_version = `,
    `\n`,
    `project.hasProperty("kotlin_version") ? rootProject.ext.kotlin_version : '${kotlinVersion}'`,
  );

  gradleFile = setAllStringIn(
    gradleFile,
    `implementation "org.jetbrains.kotlin:kotlin-stdlib`,
    `"`,
    `:$kotlin_version`,
  );

  const compileSdk = `compileSdkVersion project.hasProperty`;
  if (gradleFile.includes(compileSdk)) {
    logger.info('Replacing deprecated compileSdkVersion from build.gradle');
    gradleFile = gradleFile.replace(compileSdk, `compileSdk project.hasProperty`);
  }

  writeFileSync(filename, gradleFile, 'utf-8');
}

async function updateGradleWrapper(filename: string) {
  const txt = readFile(filename);
  if (!txt) {
    return;
  }
  logger.info('Updating gradle wrapper file');
  const replaced = setAllStringIn(
    txt,
    'distributionUrl=',
    '\n',
    // eslint-disable-next-line no-useless-escape
    `https\\://services.gradle.org/distributions/gradle-${gradleVersion}-all.zip`,
  );
  writeFileSync(filename, replaced, 'utf-8');
}

function readFile(filename: string): string | undefined {
  try {
    if (!existsSync(filename)) {
      logger.error(`Unable to find ${filename}. Try updating it manually`);
      return;
    }
    return readFileSync(filename, 'utf-8');
  } catch (err) {
    logger.error(`Unable to read ${filename}. Verify it is not already open. ${err}`);
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

async function movePackageFromManifestToBuildGradle(manifestFilename: string, buildGradleFilename: string) {
  const manifestText = readFile(manifestFilename);
  const buildGradleText = readFile(buildGradleFilename);

  if (!manifestText) {
    logger.error(`Could not read ${manifestFilename}. Check its permissions and if it exists.`);
    return;
  }

  if (!buildGradleText) {
    logger.error(`Could not read ${buildGradleFilename}. Check its permissions and if it exists.`);
    return;
  }
  const namespaceExists = new RegExp(/\s+namespace\s+/).test(buildGradleText);
  if (namespaceExists) {
    return;
  }
  let packageName: string;
  const manifestRegEx = new RegExp(/package="([^"]+)"/);
  const manifestResults = manifestRegEx.exec(manifestText);

  if (manifestResults === null) {
    logger.error(`Unable to update Android Manifest. Package not found.`);
    return;
  } else {
    packageName = manifestResults[1];
  }

  let manifestReplaced = manifestText;

  manifestReplaced = manifestReplaced.replace(manifestRegEx, '');
  manifestReplaced = manifestReplaced.replace(` \n`, '\n');

  if (manifestText == manifestReplaced) {
    logger.error(`Unable to update Android Manifest: no changes were detected in Android Manifest file`);
    return;
  }

  let buildGradleReplaced = buildGradleText;
  buildGradleReplaced = setAllStringIn(buildGradleText, 'android {', '\n', `\n    namespace "${packageName}"`);

  if (buildGradleText == buildGradleReplaced) {
    logger.error(`Unable to update buildGradleText: no changes were detected in Android Manifest file`);
    return;
  }

  logger.info('Moving package from AndroidManifest.xml to build.gradle');

  writeFileSync(manifestFilename, manifestReplaced, 'utf-8');
  writeFileSync(buildGradleFilename, buildGradleReplaced, 'utf-8');
}

async function updateGradleProperties(filename: string) {
  const txt = readFile(filename);
  if (!txt?.includes('android.enableJetifier=true')) {
    return;
  }
  logger.info('Remove android.enableJetifier=true from gradle.properties');
  const lines = txt.split('\n');
  let linesToKeep = '';
  for (const line of lines) {
    // check for enableJetifier
    const jetifierMatch = line.match(/android\.enableJetifier\s*=\s*true/) || [];
    const commentMatch = line.match(/# Automatically convert third-party libraries to use AndroidX/) || [];

    if (jetifierMatch.length == 0 && commentMatch.length == 0) {
      linesToKeep += line + '\n';
    }
  }
  writeFileSync(filename, linesToKeep, { encoding: 'utf-8' });
}
