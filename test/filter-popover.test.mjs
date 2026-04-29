// Unit tests for US-109e: filter popovers dismiss on outside pointerdown.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function compilePure() {
  const result = spawnSync(
    "npx",
    [
      "esbuild",
      "src/view/filter-popover.ts",
      "--bundle=false",
      "--format=esm",
      "--platform=node",
      "--outdir=test/.compiled/view",
      "--loader:.ts=ts",
    ],
    { cwd: process.cwd(), stdio: "pipe", encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error("esbuild compile failed:\n" + result.stderr);
  }
}

compilePure();
const { shouldCloseFilterPopoverOnPointerDown } = await import("../test/.compiled/view/filter-popover.js");

test("US-109e: outside pointerdown closes an open filter popover", () => {
  assert.equal(
    shouldCloseFilterPopoverOnPointerDown({
      isOpen: true,
      isInsideFilterControls: false,
    }),
    true,
  );
});

test("US-109e: clicks inside filter controls keep the popover open", () => {
  assert.equal(
    shouldCloseFilterPopoverOnPointerDown({
      isOpen: true,
      isInsideFilterControls: true,
    }),
    false,
  );
});

test("US-109e: closed popovers ignore outside pointerdown", () => {
  assert.equal(
    shouldCloseFilterPopoverOnPointerDown({
      isOpen: false,
      isInsideFilterControls: false,
    }),
    false,
  );
});
