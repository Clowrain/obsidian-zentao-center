import { App, ButtonComponent, Notice, PluginSettingTab, Setting, FuzzySuggestModal } from "obsidian";
import { t as tr } from "./i18n";
import type TaskCenterPlugin from "./main";
import { restoreBuiltinQueryPresets, visibleQueryPresets } from "./saved-views";
import { DEFAULT_ZENTAO_SETTINGS, ZENTAO_PASSWORD_KEY } from "./zentao/types";
import { ZentaoClient } from "./zentao/client";
import { decrypt } from "./zentao/crypto";
import { generateWeeklyReport } from "./zentao/weekly-report";

const SKILL_INSTALL_COMMAND = "npx skills add CorrectRoadH/obsidian-zentao-center";

export class TaskCenterSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: TaskCenterPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName(tr("settings.header")).setHeading();

    // US-118: removed legacy Inbox path / grouping tag settings. Quick Add
    // writes only to Obsidian Daily Notes; tags are ordinary markdown data
    // surfaced through filters and saved views.

    new Setting(containerEl)
      .setName(tr("settings.defaultSavedView.name"))
      .setDesc(tr("settings.defaultSavedView.desc"))
      .addDropdown((dd) => {
        dd.addOption("", tr("settings.defaultSavedView.none"));
        for (const view of visibleQueryPresets(this.plugin.settings.queryPresets)) {
          dd.addOption(view.id, view.name);
        }
        return dd
          .setValue(this.plugin.settings.defaultSavedViewId ?? "")
          .onChange(async (v) => {
            this.plugin.settings.defaultSavedViewId = v || null;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(tr("settings.restoreBuiltins.name"))
      .setDesc(tr("settings.restoreBuiltins.desc"))
      .addButton((btn) =>
        btn
          .setButtonText(tr("settings.restoreBuiltins.action"))
          .onClick(async () => {
            this.plugin.settings.queryPresets = restoreBuiltinQueryPresets(this.plugin.settings.queryPresets, {
              today: tr("tab.today"),
              week: tr("tab.week"),
              month: tr("tab.month"),
              todo: tr("tab.todo"),
              completed: tr("tab.completed"),
              dropped: tr("tab.dropped"),
              unscheduled: tr("tab.unscheduled"),
            });
            const visible = visibleQueryPresets(this.plugin.settings.queryPresets);
            if (
              this.plugin.settings.defaultSavedViewId
              && !visible.some((view) => view.id === this.plugin.settings.defaultSavedViewId)
            ) {
              this.plugin.settings.defaultSavedViewId = visible[0]?.id ?? null;
            }
            if (
              this.plugin.settings.lastSavedViewId
              && !visible.some((view) => view.id === this.plugin.settings.lastSavedViewId)
            ) {
              this.plugin.settings.lastSavedViewId = visible[0]?.id ?? null;
            }
            await this.plugin.saveSettings();
            await this.plugin.refreshOpenViews();
            this.display();
            new Notice(tr("settings.restoreBuiltins.name"));
          }),
      );

    new Setting(containerEl)
      .setName(tr("settings.manageTabs.name"))
      .setDesc(tr("settings.manageTabs.desc"))
      .addButton((btn) =>
        btn
          .setButtonText(tr("settings.manageTabs.action"))
          .onClick(async () => {
            await this.plugin.openManageTabs();
          }),
      );

    new Setting(containerEl)
      .setName(tr("settings.weekStart.name"))
      .setDesc(tr("settings.weekStart.desc"))
      .addDropdown((dd) =>
        dd
          .addOption("1", tr("settings.weekStart.mon"))
          .addOption("0", tr("settings.weekStart.sun"))
          .setValue(this.plugin.settings.weekStartsOn.toString())
          .onChange(async (v) => {
            this.plugin.settings.weekStartsOn = v === "0" ? 0 : 1;
            await this.plugin.saveSettings();
          }),
      );

    // US-110: "open board on startup" toggle. Default off — the board
    // costs a vault scan on first open and we don't want to slow Obsidian
    // launch unless the user opted in. Wired in main.ts:onload via the
    // `app.workspace.onLayoutReady → activateView` callback.
    // see USER_STORIES.md
    new Setting(containerEl)
      .setName(tr("settings.openOnStartup.name"))
      .setDesc(tr("settings.openOnStartup.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.openOnStartup).onChange(async (v) => {
          this.plugin.settings.openOnStartup = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(tr("settings.stampCreated.name"))
      .setDesc(tr("settings.stampCreated.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.stampCreated).onChange(async (v) => {
          this.plugin.settings.stampCreated = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(tr("settings.taskFormatFlavor.name"))
      .setDesc(tr("settings.taskFormatFlavor.desc"))
      .addDropdown((dd) =>
        dd
          .addOption("tasks", tr("settings.taskFormatFlavor.tasks"))
          .addOption("dataview", tr("settings.taskFormatFlavor.dataview"))
          .setValue(this.plugin.settings.taskFormatFlavor)
          .onChange(async (value) => {
            this.plugin.settings.taskFormatFlavor = value === "dataview" ? "dataview" : "tasks";
            await this.plugin.saveSettings();
            await this.plugin.refreshOpenViews();
          }),
      );

    // US-510: mobile-specific settings. Always rendered so cross-device
    // syncs (desktop user configuring their phone behaviour) work; the
    // values are no-ops on desktop. Heading is shown unconditionally.
    // The mobileForceLayout toggle below also implements US-502 (force
    // narrow layout regardless of viewport width).
    // see USER_STORIES.md
    {
      new Setting(containerEl).setName(tr("settings.mobileHeader")).setHeading();

      new Setting(containerEl)
        .setName(tr("settings.mobileForceLayout.name"))
        .setDesc(tr("settings.mobileForceLayout.desc"))
        .addToggle((tg) =>
          tg.setValue(this.plugin.settings.mobileForceLayout).onChange(async (v) => {
            this.plugin.settings.mobileForceLayout = v;
            await this.plugin.saveSettings();
            // Tell the open board (if any) to re-evaluate its layout class
            // immediately, no leaf reopen required.
            this.plugin.refreshOpenViews().catch(() => {/* ignore */});
          }),
        );
    }

    const skillInstall = new Setting(containerEl)
      .setName(tr("settings.skillInstall.name"))
      .setDesc(tr("settings.skillInstall.desc"));
    skillInstall.settingEl.dataset.skillInstall = "true";
    skillInstall.descEl.empty();
    skillInstall.descEl.createSpan({ text: tr("settings.skillInstall.desc") });
    skillInstall.descEl.createEl("code", {
      text: SKILL_INSTALL_COMMAND,
      cls: "task-center-settings-command",
    });

    // ── Zentao Integration (US-801~808) ──
    this.renderZentaoSettings(containerEl);

    new Setting(containerEl).setName(tr("settings.cliHeader")).setHeading();
    const cliHelp = containerEl.createDiv({ cls: "setting-item-description" });
    cliHelp.createEl("p", { text: tr("settings.cliHelp") });
    const pre = cliHelp.createEl("pre");
    pre.setText(
      [
        "obsidian task-center:list scheduled=today",
        "obsidian task-center:list scheduled=unscheduled tag='#tag'",
        "obsidian task-center:query-list format=json",
        "obsidian task-center:query-show id=preset-week",
        "obsidian task-center:query-run id=preset-today view=week anchor=2026-05-04",
        "obsidian task-center:query-save dsl='{\"name\":\"工作\",\"filters\":{\"tags\":[\"#work\"]},\"view\":{\"type\":\"list\"}}'",
        "obsidian task-center:query-update id=sv-alpha dsl='{\"name\":\"工作周\",\"view\":{\"type\":\"week\"}}'",
        "obsidian task-center:schedule ref=Tasks/Inbox.md:L42 date=2026-04-25",
        "obsidian task-center:done ref=Tasks/Inbox.md:L42 at=2026-04-23",
        "obsidian task-center:add text=\"处理示例任务\" tag=\"#tag\" scheduled=2026-04-26",
        "obsidian task-center:stats days=7 group=象限",
      ].join("\n"),
    );
    cliHelp.createEl("p", { text: tr("settings.cliAiNote") });
  }

  // ── Zentao Integration Settings (US-801~808) ──

  private renderZentaoSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("禅道连接").setHeading();

    const zentao = this.plugin.settings.zentao;

    // Hold a reference so the text-input onChange callbacks can update the button state
    let testBtn: ButtonComponent | null = null;

    const updateTestBtnState = (): void => {
      const zs = this.plugin.settings.zentao;
      testBtn?.setDisabled(!zs?.serverUrl || !zs?.account);
    };

    // Server URL
    new Setting(containerEl)
      .setName("服务器地址")
      .setDesc("格式：https://zentao.example.com，不带 /api.php")
      .addText((txt) =>
        txt
          .setPlaceholder("https://zentao.example.com")
          .setValue(zentao?.serverUrl ?? "")
          .onChange(async (v) => {
            this.ensureZentao();
            this.plugin.settings.zentao!.serverUrl = v.trim();
            await this.plugin.saveSettings();
            updateTestBtnState();
          }),
      );

    // Account
    new Setting(containerEl)
      .setName("账号")
      .addText((txt) =>
        txt
          .setPlaceholder("Account")
          .setValue(zentao?.account ?? "")
          .onChange(async (v) => {
            this.ensureZentao();
            this.plugin.settings.zentao!.account = v.trim();
            await this.plugin.saveSettings();
            updateTestBtnState();
          }),
      );

    // Password (US-831: stored in Obsidian SecretStorage)
    new Setting(containerEl)
      .setName("密码")
      .setDesc("安全存储于 Obsidian 钥匙串，不以明文保存")
      .addText((txt) => {
        txt
          .setPlaceholder("••••••••")
          .setValue("") // Never pre-fill password for security
          .onChange(async (v) => {
            if (!v) return;
            this.ensureZentao();
            // US-831: Store password in Obsidian SecretStorage
            await this.app.secretStorage.setSecret(ZENTAO_PASSWORD_KEY, v);
            // Clear legacy encrypted fields after migration
            this.plugin.settings.zentao!.encryptedPassword = "";
            this.plugin.settings.zentao!.encryptionIv = "";
            await this.plugin.saveSettings();
          });
        txt.inputEl.type = "password";
      });

    // Test connection
    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("验证服务器地址、账号和密码是否正确")
      .addButton((btn) => {
        btn
          .setButtonText("测试连接")
          .setDisabled(!zentao?.serverUrl || !zentao?.account);
        testBtn = btn;
        btn.onClick(async () => {
            const zs = this.plugin.settings.zentao;
            if (!zs?.serverUrl || !zs?.account) return;
            btn.setButtonText("连接中…").setDisabled(true);
            try {
              const password = await this.getZentaoPassword();
              const client = new ZentaoClient(zs.serverUrl, zs.account, () => Promise.resolve(password));
              const result = await client.testConnection();
              if (result.ok) {
                new Notice("连接成功");
              } else {
                new Notice(`连接失败：${result.error}`);
              }
            } catch (e) {
              new Notice(`连接失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
              btn.setButtonText("测试连接").setDisabled(false);
            }
          });
      });

    // Sync mode
    new Setting(containerEl)
      .setName("同步模式")
      .setDesc("选择如何拉取禅道任务")
      .addDropdown((dd) =>
        dd
          .addOption("assignedtome", "全部指派给我的")
          .addOption("manual", "手动选择执行")
          .setValue(zentao?.syncMode ?? "assignedtome")
          .onChange(async (v) => {
            this.ensureZentao();
            this.plugin.settings.zentao!.syncMode = v as "manual" | "assignedtome";
            await this.plugin.saveSettings();
            this.display(); // Refresh to show/hide execution list
          }),
      );

    // Execution list (only for manual mode)
    if (zentao?.syncMode === "manual") {
      const execContainer = containerEl.createDiv({ cls: "setting-item-description" });

      if (zentao.executionListCache && zentao.executionListCache.length > 0) {
        const selectedIds = new Set(zentao.selectedExecutionIds);
        for (const exec of zentao.executionListCache) {
          new Setting(execContainer)
            .setName(exec.name)
            .setDesc(`${exec.projectName} · ${exec.status} · ${exec.begin} ~ ${exec.end}`)
            .addToggle((tg) =>
              tg.setValue(selectedIds.has(exec.id)).onChange(async (v) => {
                this.ensureZentao();
                if (v) {
                  this.plugin.settings.zentao!.selectedExecutionIds.push(exec.id);
                } else {
                  this.plugin.settings.zentao!.selectedExecutionIds =
                    this.plugin.settings.zentao!.selectedExecutionIds.filter((id) => id !== exec.id);
                }
                await this.plugin.saveSettings();
              }),
            );
        }
      } else {
        execContainer.createEl("p", { text: "暂无执行，点击下方「刷新执行列表」" });
      }

      new Setting(containerEl)
        .setName("刷新执行列表")
        .addButton((btn) =>
          btn.setButtonText("刷新").onClick(async () => {
            const zs = this.plugin.settings.zentao;
            if (!zs?.serverUrl) {
              new Notice("请先填写服务器地址");
              return;
            }
            btn.setButtonText("加载中…").setDisabled(true);
            try {
              const password = await this.getZentaoPassword();
              const client = new ZentaoClient(zs.serverUrl, zs.account, () => Promise.resolve(password));
              const projects = await client.getProjects();
              const executions = await client.getExecutions();
              const projectMap = new Map(projects.map((p) => [p.id, p.name]));
              this.ensureZentao();
              this.plugin.settings.zentao!.executionListCache = executions.map((e) => ({
                id: e.id,
                project: e.project,
                projectName: projectMap.get(e.project) ?? "未知项目",
                name: e.name,
                status: e.status,
                begin: e.begin,
                end: e.end,
              }));
              this.plugin.settings.zentao!.executionListCacheTime = Date.now();
              await this.plugin.saveSettings();
              this.display();
              new Notice(`已加载 ${executions.length} 个执行`);
            } catch (e) {
              new Notice(`刷新失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
              btn.setButtonText("刷新").setDisabled(false);
            }
          }),
        );
    }

    // Sync target
    new Setting(containerEl)
      .setName("同步目标")
      .setDesc("禅道任务写入哪里")
      .addDropdown((dd) =>
        dd
          .addOption("daily-note", "Daily note（写入当天日记）")
          .addOption("specified-file", "Specified file（写入指定文件）")
          .addOption("project-folder", "Project folder（按项目分文件）")
          .setValue(zentao?.syncTarget ?? "project-folder")
          .onChange(async (v) => {
            this.ensureZentao();
            this.plugin.settings.zentao!.syncTarget = v as "daily-note" | "specified-file" | "project-folder";
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    // Specified file path (only when target is specified-file)
    if (zentao?.syncTarget === "specified-file") {
      new Setting(containerEl)
        .setName("目标文件")
        .setDesc(zentao.specifiedFilePath || "未选择")
        .addButton((btn) =>
          btn.setButtonText("选择文件").onClick(() => {
            new FileSuggestModal(this.app, (path: string) => {
              this.ensureZentao();
              this.plugin.settings.zentao!.specifiedFilePath = path;
              this.plugin.saveSettings().then(() => this.display()).catch(() => {});
            }).open();
          }),
        );
    }

    // Project folder (only when target is project-folder)
    if (zentao?.syncTarget === "project-folder") {
      new Setting(containerEl)
        .setName("项目目录")
        .setDesc("任务将写入 {目录}/{项目名}.md，如 ZentaoTasks/运维.md")
        .addText((txt) =>
          txt
            .setPlaceholder("ZentaoTasks")
            .setValue(zentao?.projectFolder ?? "ZentaoTasks")
            .onChange(async (v) => {
              this.ensureZentao();
              this.plugin.settings.zentao!.projectFolder = v.trim() || "ZentaoTasks";
              await this.plugin.saveSettings();
            }),
        );

      // US-833: Weekly report folder
      new Setting(containerEl)
        .setName("周报目录")
        .setDesc("周报将写入 {目录}/{YYYY-MM-DD（第N周）}.md")
        .addText((txt) =>
          txt
            .setPlaceholder("WeeklyReports")
            .setValue(zentao?.weeklyReportFolder ?? "WeeklyReports")
            .onChange(async (v) => {
              this.ensureZentao();
              this.plugin.settings.zentao!.weeklyReportFolder = v.trim() || "WeeklyReports";
              await this.plugin.saveSettings();
            }),
        );
    }

    // Clear config
    new Setting(containerEl)
      .setName("清除禅道配置")
      .setDesc("清除所有禅道连接配置（不删除已同步的任务）")
      .addButton((btn) =>
        btn
          .setButtonText("清除配置")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.zentao = null;
            await this.plugin.saveSettings();
            this.display();
            new Notice("禅道配置已清除");
          }),
      );
  }

  /** Ensure zentao settings object exists (create default if null). */
  private ensureZentao(): void {
    if (!this.plugin.settings.zentao) {
      this.plugin.settings.zentao = { ...DEFAULT_ZENTAO_SETTINGS };
    }
  }

  /** Get the Zentao password from SecretStorage, with legacy migration. */
  private async getZentaoPassword(): Promise<string> {
    // US-831: First try SecretStorage
    const secretPassword = await this.app.secretStorage.getSecret(ZENTAO_PASSWORD_KEY);
    if (secretPassword) return secretPassword;

    // Legacy migration: if SecretStorage is empty but we have encrypted password, migrate it
    const zs = this.plugin.settings.zentao;
    if (zs?.encryptedPassword) {
      let password = "";
      if (zs.encryptionIv) {
        // Decrypt legacy AES-256-GCM password
        const vaultPath = (this.app.vault.adapter as unknown as { basePath?: string }).basePath ?? "";
        password = await decrypt(zs.encryptedPassword, zs.encryptionIv, vaultPath);
      } else {
        // Unencrypted fallback (shouldn't happen in normal use)
        password = zs.encryptedPassword;
      }

      if (password) {
        // Migrate to SecretStorage
        await this.app.secretStorage.setSecret(ZENTAO_PASSWORD_KEY, password);
        // Clear legacy fields
        zs.encryptedPassword = "";
        zs.encryptionIv = "";
        await this.plugin.saveSettings();
        console.log("[zentao] Password migrated to SecretStorage");
        return password;
      }
    }

    return "";
  }

  private async generateWeeklyReport(): Promise<void> {
    const zs = this.plugin.settings.zentao;
    if (!zs?.serverUrl || !zs.account) {
      new Notice("请先完成禅道连接配置");
      return;
    }

    try {
      const password = await this.getZentaoPassword();
      if (!password) {
        new Notice("请先填写禅道密码");
        return;
      }

      const client = new ZentaoClient(zs.serverUrl, zs.account, () => Promise.resolve(password));
      const result = await generateWeeklyReport(
        client,
        zs,
        this.app,
        {
          taskFormatFlavor: this.plugin.settings.taskFormatFlavor,
          serverUrl: zs.serverUrl,
        },
        this.plugin.settings.weekStartsOn,
      );

      new Notice(`周报已生成：${result.path}`);
    } catch (e) {
      new Notice(`生成周报失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// ── File Suggest Modal ──

class FileSuggestModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private onSelect: (path: string) => void,
  ) {
    super(app);
    this.setPlaceholder("选择 Markdown 文件…");
  }

  getItems(): string[] {
    const files = this.app.vault.getMarkdownFiles();
    return files.map((f) => f.path);
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onSelect(item);
  }
}
