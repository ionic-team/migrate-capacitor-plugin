// Matches `project.hasProperty('x') ? rootProject.ext.x` (or the `rootProject.hasProperty` form) with the same `x` on both sides.
const PROPERTY_LOOKUP =
  /(?<![\w.])(?:rootProject|project)\.hasProperty\((['"])(\w+)\1\)(\s*\?\s*rootProject\.ext\.\2\b)/g;

/**
 * Sets which project `hasProperty()` is called on in the plugin's variable lookups.
 * Gradle 9 deprecates `project.hasProperty()` finding a property that is only declared on the root project
 * (an error in Gradle 10), so plugins have to call it on `rootProject`, where the value is read from anyway.
 */
export function setPropertyLookupReceiver(gradleFile: string, receiver: 'project' | 'rootProject'): string {
  return gradleFile.replace(PROPERTY_LOOKUP, `${receiver}.hasProperty($1$2$1)$3`);
}
