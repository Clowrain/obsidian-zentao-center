import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import esbuild from "esbuild";

const compiledPath = "test/.compiled/main-lifecycle.bundle.js";

function stubModule(contents) {
  return {
    contents,
    loader: "js",
  };
}

async function compile() {
  mkdirSync("test/.compiled", { recursive: true });
  await esbuild.build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: compiledPath,
    plugins: [
      {
        name: "main-lifecycle-stubs",
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({
            path: "obsidian",
            namespace: "main-lifecycle-stub",
          }));
          build.onResolve({ filter: /^\.\/(types|settings|view|cli|cache|status-bar|dep-health|quickadd|i18n|dates|parser|writer|platform)$/ }, (args) => ({
            path: args.path,
            namespace: "main-lifecycle-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "main-lifecycle-stub" }, (args) => {
            switch (args.path) {
              case "obsidian":
                return stubModule(`
                  export class Plugin {
                    constructor(app) {
                      this.app = app;
                      this._commands = [];
                      this._ribbons = [];
                      this._events = [];
                      this._settingsTabs = [];
                    }
                    async loadData() { return {}; }
                    registerEvent(ref) { this._events.push(ref); }
                    addRibbonIcon(icon, title, callback) { this._ribbons.push({ icon, title, callback }); }
                    addCommand(command) { this._commands.push(command); }
                    addSettingTab(tab) { this._settingsTabs.push(tab); }
                    addStatusBarItem() { return { empty() {}, remove() {}, createSpan() { return this; }, setText() {}, addClass() {}, setAttr() {} }; }
                    registerView(type, creator) {
                      this.app.__viewCreators ??= new Map();
                      if (this.app.__viewCreators.has(type)) {
                        throw new Error('Attempting to register an existing view type "' + type + '"');
                      }
                      this.app.__viewCreators.set(type, creator);
                    }
                  }
                  export class Notice { constructor() {} }
                  export class WorkspaceLeaf {}
                `);
              case "./types":
                return stubModule(`
                  export const VIEW_TYPE_TASK_CENTER = "task-center-board";
                  export const DEFAULT_SETTINGS = { openOnStartup: false };
                `);
              case "./settings":
                return stubModule("export class TaskCenterSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }");
              case "./view":
                return stubModule("export class TaskCenterView { constructor(leaf, plugin) { this.leaf = leaf; this.plugin = plugin; } }");
              case "./cli":
                return stubModule(`
                  export class TaskCenterApi { constructor(app, cache) { this.app = app; this.cache = cache; } }
                  export function formatList() { return ""; }
                  export function formatShow() { return ""; }
                  export function formatStats() { return ""; }
                  export function formatAgentBrief() { return ""; }
                  export function formatReviewSummary() { return ""; }
                  export function formatOkWrite() { return ""; }
                  export function formatAdd() { return ""; }
                `);
              case "./cache":
                return stubModule("export class TaskCache { constructor(app) { this.app = app; } bind() { return []; } dispose() {} async forFlush() {} }");
              case "./status-bar":
                return stubModule("export class StatusBar { constructor(el, cache, options) { this.el = el; this.cache = cache; this.options = options; } refresh() {} flush() {} dispose() {} }");
              case "./dep-health":
                return stubModule("export class DepHealthBanner { constructor(el, app, options) { this.el = el; this.app = app; this.options = options; } refresh() {} dispose() {} }");
              case "./quickadd":
                return stubModule("export class QuickAddModal { constructor(app, api, onAdd, settings) {} open() {} }");
              case "./i18n":
                return stubModule("export function t(key) { return key; }");
              case "./dates":
                return stubModule("export function todayISO() { return '2026-04-29'; }");
              case "./parser":
                return stubModule("export function parseDurationToMinutes() { return null; }");
              case "./writer":
                return stubModule("export class TaskWriterError extends Error {}");
              case "./platform":
                return stubModule("export function __setTestForceMobile() {}");
              default:
                throw new Error(`Unhandled stub module: ${args.path}`);
            }
          });
        },
      },
    ],
  });
}

function makeAppWithExistingTaskCenterView() {
  const app = {
    __viewCreators: new Map([["task-center-board", () => ({})]]),
    workspace: {
      onLayoutReady(callback) {
        app.__layoutCallbacks.push(callback);
      },
      on(event, callback) {
        return { event, callback };
      },
      getLeavesOfType() {
        return [];
      },
    },
    __layoutCallbacks: [],
  };
  return app;
}

test("plugin onload tolerates a stale task-center-board view registration", async () => {
  await compile();
  const { default: TaskCenterPlugin } = await import(`../${compiledPath}?t=${Date.now()}`);
  const app = makeAppWithExistingTaskCenterView();
  const plugin = new TaskCenterPlugin(app);

  await assert.doesNotReject(
    () => plugin.onload(),
    /Attempting to register an existing view type "task-center-board"/,
  );
  assert.ok(plugin.api, "plugin should keep loading the GUI/API after a stale view registration");
});
