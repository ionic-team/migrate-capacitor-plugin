export function migratePackageSwift(text: string, iOSVersion: string): string {
  text = text.replace(/\[\.iOS\(\.v(\d+)\)\]/, (platforms, version) =>
    Number(version) < Number(iOSVersion) ? `[.iOS(.v${iOSVersion})]` : platforms,
  );
  // when Cordova is the last product, the comma before it has to go too
  text = text.replace(/,\n[ \t]*\.product\(name:\s*"Cordova",\s*package:\s*"capacitor-swift-pm"\)(?=\s*\])/, '');
  text = text.replace(/^[ \t]*\.product\(name:\s*"Cordova",\s*package:\s*"capacitor-swift-pm"\),?\n?/m, '');
  text = text.replaceAll('capacitor-swift-pm', 'capacitor');
  // the version is replaced up to the first ")", so unwrap .upToNextMajor(from:) first
  return text.replace(
    /(\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor\.git",\s*)\.upToNextMajor\((from:\s*"[^"]*")\)/,
    '$1$2',
  );
}
