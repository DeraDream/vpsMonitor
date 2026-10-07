export function repositorySlug(remote) {
  const value = String(remote || "").trim().replace(/\.git$/, "");
  const match = value.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
  return match ? match[1].toLowerCase() : null;
}
export function repositoryMatches(configured, originUrl) {
  const expected = String(configured || "").trim().replace(/\.git$/, "").toLowerCase();
  return Boolean(expected && repositorySlug(originUrl) === expected);
}
