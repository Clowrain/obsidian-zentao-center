// US-826~830: Zentao finish confirmation modal.
// Prompts user to fill consumed hours, real started, finished date, etc.

import { App, Modal, Setting, ButtonComponent, Notice } from "obsidian";
import type { ZentaoClient } from "./client";
import type { EffectiveTask } from "../task-tree";
import { todayISO } from "../dates";
import { t as tr } from "../i18n";

export interface ZentaoFinishOptions {
	realStarted: string | null;    // YYYY-MM-DD HH:mm
	finishedDate: string;          // YYYY-MM-DD HH:mm
	currentConsumed: string;       // hours
	assignedTo: string;            // account
	comment: string;               // optional
}

export interface ZentaoFinishModalResult {
	confirmed: boolean;
	options?: ZentaoFinishOptions;
}

export class ZentaoFinishModal extends Modal {
	private result: ZentaoFinishModalResult = { confirmed: false };
	private options: ZentaoFinishOptions;
	private client: ZentaoClient;
	private task: EffectiveTask;
	private zentaoAccount: string;
	private onSubmit: (result: ZentaoFinishModalResult) => void;

	constructor(
		app: App,
		client: ZentaoClient,
		task: EffectiveTask,
		zentaoAccount: string,
		onSubmit: (result: ZentaoFinishModalResult) => void,
	) {
		super(app);
		this.client = client;
		this.task = task;
		this.zentaoAccount = zentaoAccount;
		this.onSubmit = onSubmit;

		// Initialize options with defaults
		const now = new Date();
		const finishedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

		// Use task's start date or today as default realStarted
		const realStartedDefault = task.start
			? `${task.start} 09:00`
			: `${todayISO()} 09:00`;

		// Use task's estimate as default consumed, convert minutes to hours (minimum 0.5)
		const consumedDefault = task.estimate ? (task.estimate / 60).toFixed(1) : "1";

		this.options = {
			realStarted: realStartedDefault,
			finishedDate,
			currentConsumed: consumedDefault,
			assignedTo: "",  // Optional - don't send if empty
			comment: "",
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("zentao-finish-modal");

		// Title
		contentEl.createEl("h2", { text: tr("zentao.finishModal.title") });
		contentEl.createEl("p", { text: tr("zentao.finishModal.subtitle", { title: this.task.title }) });

		// Form fields
		new Setting(contentEl)
			.setName(tr("zentao.finishModal.realStarted"))
			.setDesc(tr("zentao.finishModal.realStartedDesc"))
			.addText((text) => {
				text.setValue(this.options.realStarted ?? "")
					.setPlaceholder("YYYY-MM-DD HH:mm")
					.onChange((value) => {
						this.options.realStarted = value || null;
					});
			});

		new Setting(contentEl)
			.setName(tr("zentao.finishModal.finishedDate"))
			.setDesc(tr("zentao.finishModal.finishedDateDesc"))
			.addText((text) => {
				text.setValue(this.options.finishedDate)
					.setPlaceholder("YYYY-MM-DD HH:mm")
					.onChange((value) => {
						this.options.finishedDate = value;
					});
			});

		new Setting(contentEl)
			.setName(tr("zentao.finishModal.consumed"))
			.setDesc(tr("zentao.finishModal.consumedDesc"))
			.addText((text) => {
				text.setValue(this.options.currentConsumed)
					.setPlaceholder("1")
					.onChange((value) => {
						this.options.currentConsumed = value;
					});
			});

		new Setting(contentEl)
			.setName(tr("zentao.finishModal.comment"))
			.setDesc(tr("zentao.finishModal.commentDesc"))
			.addTextArea((text) => {
				text.setValue(this.options.comment)
					.setPlaceholder(tr("zentao.finishModal.commentPlaceholder"))
					.onChange((value) => {
						this.options.comment = value;
					});
			});

		// Buttons
		const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

		new ButtonComponent(buttonRow)
			.setButtonText(tr("zentao.finishModal.cancel"))
			.onClick(() => {
				this.result = { confirmed: false };
				this.close();
			});

		new ButtonComponent(buttonRow)
			.setButtonText(tr("zentao.finishModal.confirm"))
			.setCta()
			.onClick(async () => {
				this.result = { confirmed: true, options: this.options };
				this.close();
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.onSubmit(this.result);
	}
}