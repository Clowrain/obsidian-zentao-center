import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("release metadata is ready for Obsidian community plugin submission", async () => {
  const [manifest, pkg, versions] = await Promise.all([
    readJson("manifest.json"),
    readJson("package.json"),
    readJson("versions.json"),
  ]);

  assert.equal(manifest.id, "task-center");
  assert.doesNotMatch(manifest.id, /obsidian/i);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  assert.equal(manifest.name, "Task Center");
  assert.equal(manifest.author, "CorrectRoadH");
  assert.equal(manifest.isDesktopOnly, false);
});

test("local lint gate mirrors Obsidian review bot required rules", async () => {
  const { default: eslintConfig } = await import("../eslint.config.mjs");
  const srcOverride = eslintConfig.find((entry) =>
    Array.isArray(entry.files) && entry.files.includes("src/**/*.ts")
  );

  assert.equal(srcOverride?.rules?.["@typescript-eslint/require-await"], "error");
  assert.equal(srcOverride?.rules?.["obsidianmd/ui/sentence-case"], undefined);
});
