import semver from 'semver';

/** Explain the same release checks that gate installation in the catalog UI. */
export function installationBlock(entry, view) {
  if (entry.status !== 'qualified') return 'unavailableRelease';
  if (!semver.satisfies(view.bcVersion, entry.bcVersion, { includePrerelease: true })) return 'incompatibleVersion';
  if (!entry.platforms.includes(view.platform)) return 'unsupportedPlatform';
  if (!entry.artifact) return 'missingDownload';
  if (!['packed-install', 'lifecycle', 'workflow'].every(check => entry.qualification?.[view.platform]?.includes(check))) return 'unverifiedPlatform';
  return undefined;
}
