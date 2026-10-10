/** Public preview revision allocation. */

/**
 * Reject revisions that would be hidden by an existing public preview release.
 * @param {number} revision Requested integer catalog revision.
 * @param {Array<{tag_name: string}>} releases Existing GitHub releases, including reserved drafts.
 * @returns {number} The validated revision; release creation still arbitrates concurrent tag allocation.
 */
export function validatePublicRevision(revision, releases) {
  if (!Number.isSafeInteger(revision) || revision < 2) throw Error('Invalid public catalog revision');
  const highest = releases.reduce((maximum, release) => {
    const match = /^extensions-preview-(\d+)$/.exec(release.tag_name);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 1);
  if (revision <= highest) throw Error(`Public catalog revision must increase above ${highest}`);
  return revision;
}
