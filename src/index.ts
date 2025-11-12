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

import { logger } from './log';
import { runCommand } from './subprocess';

const coreVersion = 'next';
const gradleVersion = '8.14.3';
const AGPVersion = '8.13.0';
const gmsVersion = '4.4.4';
const kotlinVersion = '2.2.20';
const docgenVersion = '^0.3.0';
const eslintVersion = '^8.57.0';
const ionicEslintVersion = '^0.4.0';
const ionicPrettierVersion = '^4.0.0';
const ionicSwiftlintVersion = '^2.0.0';
const prettierJavaVersion = '^2.6.6';
const prettierVersion = '^3.4.2';
const rimrafVersion = '^6.0.1';
const rollupVersion = '^4.30.1';
let updatePrettierJava = false;
const variables = {
  minSdkVersion: 24,
  compileSdk: 36,
  targetSdkVersion: 36,
  androidxActivityVersion: '1.11.0',
  androidxAppCompatVersion: '1.7.1',
  androidxCoordinatorLayoutVersion: '1.3.0',
  androidxCoreVersion: '1.17.0',
  androidxFragmentVersion: '1.8.9',
  firebaseMessagingVersion: '24.1.0',
  playServicesLocationVersion: '21.3.0',
  androidxBrowserVersion: '1.8.0',
  androidxMaterialVersion: '1.12.0',
  androidxExifInterfaceVersion: '1.3.7',
  coreSplashScreenVersion: '1.0.1',
  androidxWebkitVersion: '1.14.0',
  junitVersion: '4.13.2',
  androidxJunitVersion: '1.3.0',
  androidxEspressoCoreVersion: '3.7.0',
};

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
  if (pluginJSON.devDependencies?.['rollup']) {
    pluginJSON.devDependencies['rollup'] = rollupVersion;
  }

  if (pluginJSON.devDependencies?.['@ionic/prettier-config']) {
    pluginJSON.devDependencies['@ionic/prettier-config'] = ionicPrettierVersion;
    pluginJSON.devDependencies['prettier'] = prettierVersion;
    pluginJSON.devDependencies['prettier-plugin-java'] = prettierJavaVersion;
    updatePrettierJava = true;
  }

  if (pluginJSON.devDependencies?.['@capacitor/docgen']) {
    pluginJSON.devDependencies['@capacitor/docgen'] = docgenVersion;
  }

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

  if (pluginJSON.capacitor?.ios?.src) {
    const iosDir = resolve(dir, pluginJSON.capacitor.ios.src);
    if (await pathExists(iosDir)) {
      logger.info('Updating iOS files');
      await updateFile(
        join(iosDir, 'Plugin.xcodeproj', 'project.pbxproj'),
        'IPHONEOS_DEPLOYMENT_TARGET = ',
        ';',
        '15.0',
      );
      await updateFile(join(iosDir, 'Podfile'), `platform :ios, '`, `'`, '15.0');
      await updateFile(join(dir, 'Package.swift'), '[.iOS(.v', ')],', '15');
      await updateFile(
        join(dir, 'Package.swift'),
        '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git",',
        ')',
        ` from: "${coreVersion}"`,
      );
      await updatePodspec(dir, pluginJSON);
    }
  }

  logger.info('Plugin migrated to Capacitor 8!');
};

function updatePodspec(dir: string, pluginJSON: any) {
  const podspecFile = pluginJSON.files.find((file: string) => file.includes('.podspec'));
  let txt = readFile(join(dir, podspecFile));
  if (!txt) {
    return false;
  }
  txt = txt.replace('s.ios.deployment_target  =', 's.ios.deployment_target =');
  txt = txt.replace(`s.ios.deployment_target = '14.0'`, `s.ios.deployment_target = '15.0'`);
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
  gradleFile = gradleFile.replace(/\bcompileSdkVersion\b/g, 'compileSdk');
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

  gradleFile = updateDeprecatedPropertySyntax(gradleFile);
  gradleFile = updateKotlinOptions(gradleFile);

  writeFileSync(filename, gradleFile, 'utf-8');
}

function updateDeprecatedPropertySyntax(gradleFile: string): string {
  const propertiesToUpdate = [
    'namespace',
    'compileSdk',
    'testInstrumentationRunner',
    'versionName',
    'versionCode',
    'url',
    'abortOnError',
    'warningsAsErrors',
    'lintConfig',
    'minifyEnabled',
    'debugSymbolLevel',
    'path',
    'version',
    'baseline',
    'sourceCompatibility',
    'targetCompatibility',
  ];

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

  const jvmTargetValue = match[1];
  const enumValue = `JVM_${jvmTargetValue.replace('.', '_')}`;

  let result = gradleFile;

  if (!result.includes('import org.jetbrains.kotlin.gradle.dsl.JvmTarget')) {
    const firstNonCommentLine = result.split('\n').findIndex((line) => {
      if (!line) return false;
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    });
    const lines = result.split('\n');
    if (firstNonCommentLine >= 0) {
      lines.splice(firstNonCommentLine, 0, 'import org.jetbrains.kotlin.gradle.dsl.JvmTarget');
      result = lines.join('\n');
    }
  }

  result = result.replace(kotlinOptionsRegex, '');
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n');

  const kotlinBlockRegex = /\nkotlin\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/;
  const kotlinBlockMatch = kotlinBlockRegex.exec(result);

  const compilerOptionsBlock = `    compilerOptions {\n        jvmTarget = JvmTarget.${enumValue}\n    }`;

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

  logger.info('Updated kotlinOptions to compilerOptions for Kotlin 2.2.0');

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
