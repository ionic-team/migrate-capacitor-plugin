import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { migratePackageSwift } from './package-swift.ts';

describe('migratePackageSwift', () => {
  it('raises the iOS platform and removes Cordova when it is the last product', () => {
    const before = `let package = Package(
    name: "Plugin",
    platforms: [.iOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "Plugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ])
    ]
)`;
    const after = `let package = Package(
    name: "Plugin",
    platforms: [.iOS(.v16)],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "Plugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor")
            ])
    ]
)`;
    assert.equal(migratePackageSwift(before, '16'), after);
  });

  it('keeps a newer iOS platform and unwraps only the Capacitor .upToNextMajor', () => {
    const before = `let package = Package(
    name: "Plugin",
    platforms: [.iOS(.v17)],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", .upToNextMajor(from: "8.0.0")),
        .package(url: "https://github.com/AzureAD/microsoft-authentication-library-for-objc.git", .upToNextMajor(from: "1.9.0"))
    ],
    targets: [
        .target(
            name: "Plugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "MSAL", package: "microsoft-authentication-library-for-objc")
            ])
    ]
)`;
    const after = `let package = Package(
    name: "Plugin",
    platforms: [.iOS(.v17)],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor.git", from: "8.0.0"),
        .package(url: "https://github.com/AzureAD/microsoft-authentication-library-for-objc.git", .upToNextMajor(from: "1.9.0"))
    ],
    targets: [
        .target(
            name: "Plugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor"),
                .product(name: "MSAL", package: "microsoft-authentication-library-for-objc")
            ])
    ]
)`;
    assert.equal(migratePackageSwift(before, '16'), after);
  });
});
