import test from "node:test";
import assert from "node:assert/strict";
import { repositoryMatches, repositorySlug } from "../lib/update-policy.mjs";

test("更新源只接受与设置一致的 GitHub origin", () => {
  assert.equal(repositorySlug("git@github.com:DeraDream/vpsMonitor.git"), "deradream/vpsmonitor");
  assert.equal(repositoryMatches("DeraDream/vpsMonitor", "https://github.com/DeraDream/vpsMonitor.git"), true);
  assert.equal(repositoryMatches("other/repository", "git@github.com:DeraDream/vpsMonitor.git"), false);
  assert.equal(repositoryMatches("DeraDream/vpsMonitor", "https://gitlab.com/DeraDream/vpsMonitor.git"), false);
});
