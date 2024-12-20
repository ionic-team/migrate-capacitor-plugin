import { existsSync, readFileSync, pathExists, readJSON, writeFileSync, writeJSON } from 'fs-extra';
import { join, resolve } from 'path';
import { rimraf } from 'rimraf';

import { logger } from './log';
import { runCommand } from './subprocess';

const coreVersion = 'next';
const gradleVersion = '8.11.1';
const AGPVersion = '8.7.2';
const gmsVersion = '4.4.2';
const kotlinVersion = '1.9.25';
const eslintVersion = '^8.57.0';
const ionicEslintVersion = '^0.4.0';
const ionicSwiftlintVersion = '^2.0.0';
const rimrafVersion = '^6.0.1';
const variables = {
  minSdkVersion: 23,
  compileSdkVersion: 35,
  targetSdkVersion: 35,
  androidxActivityVersion: '1.9.2',
  androidxAppCompatVersion: '1.7.0',
  androidxCoordinatorLayoutVersion: '1.2.0',
  androidxCoreVersion: '1.15.0',
  androidxFragmentVersion: '1.8.4',
  firebaseMessagingVersion: '24.1.0',
  playServicesLocationVersion: '21.3.0',
  androidxBrowserVersion: '1.8.0',
  androidxMaterialVersion: '1.12.0',
  androidxExifInterfaceVersion: '1.3.7',
  coreSplashScreenVersion: '1.0.1',
  androidxWebkitVersion: '1.12.1',
  junitVersion: '4.13.2',
  androidxJunitVersion: '1.2.1',
  androidxEspressoCoreVersion: '3.6.1',
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
  if (pluginJSON.devDependencies?.['@ionic/swiftlint-config']) {
    pluginJSON.devDependencies['@ionic/swiftlint-config'] = ionicSwiftlintVersion;
  }
  if (pluginJSON.devDependencies?.['swiftlint']) {
    pluginJSON.devDependencies['swiftlint'] = ionicSwiftlintVersion;
  }
  if (pluginJSON.devDependencies?.['rimraf']) {
    pluginJSON.devDependencies['rimraf'] = rimrafVersion;
  }

  if (pluginJSON.version.startsWith('6.')) {
    pluginJSON.version = '7.0.0';
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

      logger.info('Updating gradle files');
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

      const variablesAndClasspaths = {
        variables: variables,
        'com.android.tools.build:gradle': AGPVersion,
        'com.google.gms:google-services': gmsVersion,
      };
      await updateBuildGradle(join(androidDir, 'build.gradle'), variablesAndClasspaths);
    }
  }

  if (pluginJSON.capacitor?.ios.src) {
    const iosDir = resolve(dir, pluginJSON.capacitor.ios.src);
    if (await pathExists(iosDir)) {
      logger.info('Updating iOS files');
      await updateFile(
        join(iosDir, 'Plugin.xcodeproj', 'project.pbxproj'),
        'IPHONEOS_DEPLOYMENT_TARGET = ',
        ';',
        '14.0',
      );
      await updateFile(join(iosDir, 'Podfile'), `platform :ios, '`, `'`, '14.0');
      await updateFile(join(dir, 'Package.swift'), '[.iOS(.v', ')],', '14');
      await updatePodspec(dir, pluginJSON);
    }
  }

  logger.info('Plugin migrated to Capacitor 7!');
};

function updatePodspec(dir: string, pluginJSON: any) {
  const podspecFile = pluginJSON.files.find((file: string) => file.includes('.podspec'));
  let txt = readFile(join(dir, podspecFile));
  if (!txt) {
    return false;
  }
  txt = txt.replace('s.ios.deployment_target  =', 's.ios.deployment_target =');
  txt = txt.replace(`s.ios.deployment_target = '13.0'`, `s.ios.deployment_target = '14.0'`);
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
  gradleFile = setAllStringIn(gradleFile, `sourceCompatibility JavaVersion.`, `\n`, `VERSION_21`);
  gradleFile = setAllStringIn(gradleFile, `targetCompatibility JavaVersion.`, `\n`, `VERSION_21`);

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
      depString = `project.hasProperty('${dep}') ? rootProject.ext.${dep} : `;
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

  writeFileSync(filename, gradleFile, 'utf-8');
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
