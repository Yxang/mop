import { ref } from 'tsx-vanilla';

import { IndividualSimUI } from '../../individual_sim_ui';
import { Player } from '../../player';
import { HandType, ItemLevelState, ItemSlot } from '../../proto/common';
import { UIItem as Item } from '../../proto/ui';
import { EquippedItem } from '../../proto_utils/equipped_item';
import { Gear } from '../../proto_utils/gear';
import { getEligibleItemSlots } from '../../proto_utils/utils';
import { RequestTypes } from '../../sim_signal_manager';
import { SimTab } from '../sim_tab';
import { TypedEvent } from '../../typed_event';
import { getEmptySlotIconUrl, createGemContainer } from '../gear_picker/utils';
import SelectorModal, { SelectorModalTabs } from '../gear_picker/selector_modal';
import { RelativeStatCap } from '../suggest_reforges_action';
import Toast from '../toast';

import { BaselineEntry, BossEntry, CacheEntry, LootBossKey, LootDifficulty, LootUpgradeRow } from '../../loot_upgrades/types';
import { buildBossEntries, getBaselineKeyForItem, getMaxUpgradeStep, getWeaponSystemForGear, isWeaponItem } from '../../loot_upgrades/utils';
import {
	clearBossCache,
	getBaselineFromCache,
	getBossItemsFromCache,
	getLootConfigHash,
	putBaselineCache,
	putItemCache,
	removeCacheEntry,
} from '../../loot_upgrades/cache';
import { toCsv } from '../../loot_upgrades/csv';

export class LootUpgradesTab extends SimTab {
	readonly simUI: IndividualSimUI<any>;
	readonly player: Player<any>;

	private readonly leftPanel: HTMLElement;
	private readonly rightPanel: HTMLElement;

	private readonly bossSelect: HTMLSelectElement;
	private readonly difficultySelect: HTMLSelectElement;
	private readonly oneHandPrefSelect: HTMLSelectElement;

	private readonly baselineStatusElems: Record<string, HTMLElement> = {};
	private readonly progressBar: HTMLDivElement;
	private readonly progressLabel: HTMLElement;
	private readonly currentItemLabel: HTMLElement;

	private readonly tableBody: HTMLElement;
	private readonly tableEmpty: HTMLElement;

	private readonly altWeaponContainer: HTMLElement;
	private readonly altWeaponHelp: HTMLElement;

	private readonly selectorModal: SelectorModal;

	private bossEntries: BossEntry[] = [];
	private selectedBossKey: LootBossKey | null = null;
	private selectedDifficulty: LootDifficulty = 'normal';
	private oneHandPreference: 'mh' | 'oh' = 'mh';

	private baselineCache = new Map<string, BaselineEntry>();
	private rows = new Map<string, LootUpgradeRow>();
	private rowElems = new Map<string, HTMLElement>();

	private altWeaponGear: Gear = new Gear({});
	private readonly altWeaponChangeEmitter = new TypedEvent<void>('AltWeaponChange');

	private isRunning = false;
	private cancelRequested = false;
	private currentConfigHash: string | null = null;

	constructor(parentElem: HTMLElement, simUI: IndividualSimUI<any>) {
		super(parentElem, simUI, { identifier: 'loot-upgrades-tab', title: 'Loot Upgrades' });
		this.simUI = simUI;
		this.player = simUI.player;

		const bossSelectRef = ref<HTMLSelectElement>();
		const difficultySelectRef = ref<HTMLSelectElement>();
		const oneHandPrefRef = ref<HTMLSelectElement>();
		const progressRef = ref<HTMLDivElement>();
		const progressBarRef = ref<HTMLDivElement>();
		const progressLabelRef = ref<HTMLDivElement>();
		const currentItemLabelRef = ref<HTMLDivElement>();
		const tableBodyRef = ref<HTMLTableSectionElement>();
		const tableEmptyRef = ref<HTMLDivElement>();
		const altWeaponContainerRef = ref<HTMLDivElement>();
		const altWeaponHelpRef = ref<HTMLParagraphElement>();

		this.leftPanel = document.createElement('div');
		this.leftPanel.classList.add('loot-upgrades-left', 'tab-panel-left');

		this.rightPanel = document.createElement('div');
		this.rightPanel.classList.add('loot-upgrades-right', 'tab-panel-right');

		this.contentContainer.appendChild(this.leftPanel);
		this.contentContainer.appendChild(this.rightPanel);

		this.selectorModal = new SelectorModal(this.simUI.rootElem, this.simUI, this.player);

		this.leftPanel.appendChild(
			<>
				<div className="content-block loot-upgrades-controls">
					<div className="content-block-body">
						<div className="input-root">
							<label className="form-label">Boss</label>
							<select ref={bossSelectRef} className="form-select"></select>
						</div>
						<div className="input-root">
							<label className="form-label">Difficulty</label>
							<select ref={difficultySelectRef} className="form-select">
								<option value="normal">Normal (25)</option>
								<option value="heroic">Heroic (25H)</option>
							</select>
						</div>
						<div className="input-root">
							<label className="form-label">1H Replace Slot</label>
							<select ref={oneHandPrefRef} className="form-select">
								<option value="mh">Main Hand</option>
								<option value="oh">Off Hand</option>
							</select>
						</div>
					</div>
				</div>
				<div className="content-block loot-upgrades-alt-weapons">
					<div className="content-block-header">
						<h6 className="content-block-title">Alternate Weapons (Baseline B)</h6>
					</div>
					<div className="content-block-body">
						<div ref={altWeaponContainerRef} className="loot-upgrades-alt-weapon-pickers"></div>
						<p ref={altWeaponHelpRef} className="text-muted small mb-0"></p>
					</div>
				</div>
				<div className="content-block loot-upgrades-baselines">
					<div className="content-block-header">
						<h6 className="content-block-title">Baselines</h6>
					</div>
					<div className="content-block-body">
						<div className="loot-upgrades-baseline-actions"></div>
						<div className="loot-upgrades-baseline-status"></div>
					</div>
				</div>
				<div className="content-block loot-upgrades-actions">
					<div className="content-block-body">
						<div className="btn-group w-100 mb-2" role="group">
							<button className="btn btn-primary loot-upgrades-run-all">Sim All Drops</button>
							<button className="btn btn-outline-secondary loot-upgrades-cancel">Cancel</button>
						</div>
						<div className="btn-group w-100" role="group">
							<button className="btn btn-outline-primary loot-upgrades-export">Export CSV</button>
							<button className="btn btn-outline-danger loot-upgrades-clear">Clear Boss Cache</button>
						</div>
					</div>
				</div>
				<div ref={progressRef} className="loot-upgrades-progress">
					<div className="progress">
						<div ref={progressBarRef} className="progress-bar" role="progressbar"></div>
					</div>
					<div ref={progressLabelRef} className="small mt-1"></div>
					<div ref={currentItemLabelRef} className="small text-muted"></div>
				</div>
			</>,
		);

		this.rightPanel.appendChild(
			<>
				<div className="loot-upgrades-table-header d-flex align-items-center justify-content-between">
					<h6 className="mb-0">Results</h6>
				</div>
				<div className="loot-upgrades-table-wrapper">
					<table className="table table-striped table-sm loot-upgrades-table">
						<thead>
							<tr>
								<th>Item</th>
								<th>Slot</th>
								<th>Baseline</th>
								<th>Status</th>
								<th className="text-end">Baseline DPS</th>
								<th className="text-end">New DPS</th>
								<th className="text-end">Delta</th>
								<th></th>
							</tr>
						</thead>
						<tbody ref={tableBodyRef}></tbody>
					</table>
					<div ref={tableEmptyRef} className="text-muted small">Select a boss to see drops.</div>
				</div>
			</>,
		);

		this.bossSelect = bossSelectRef.value!;
		this.difficultySelect = difficultySelectRef.value!;
		this.oneHandPrefSelect = oneHandPrefRef.value!;
		this.progressBar = progressBarRef.value!;
		this.progressLabel = progressLabelRef.value!;
		this.currentItemLabel = currentItemLabelRef.value!;
		this.tableBody = tableBodyRef.value!;
		this.tableEmpty = tableEmptyRef.value!;
		this.altWeaponContainer = altWeaponContainerRef.value!;
		this.altWeaponHelp = altWeaponHelpRef.value!;

		this.wireEvents();
		this.buildAltWeaponPickers();

		this.simUI.sim.waitForInit().then(() => {
			this.refreshBossEntries();
		});

		this.buildBaselineControls();

		this.player.gearChangeEmitter.on(() => {
			this.updateAltWeaponHelp();
			this.reloadBossRows();
		});
	}

	protected buildTabContent(): void {
		// All UI is constructed in constructor using tsx fragments.
	}

	private wireEvents() {
		this.bossSelect.addEventListener('change', () => this.onBossChanged());
		this.difficultySelect.addEventListener('change', () => this.onDifficultyChanged());
		this.oneHandPrefSelect.addEventListener('change', () => {
			this.oneHandPreference = this.oneHandPrefSelect.value === 'oh' ? 'oh' : 'mh';
			this.reloadBossRows();
		});

		this.leftPanel.querySelector('.loot-upgrades-run-all')?.addEventListener('click', () => this.runAll());
		this.leftPanel.querySelector('.loot-upgrades-cancel')?.addEventListener('click', () => this.cancelRuns());
		this.leftPanel.querySelector('.loot-upgrades-export')?.addEventListener('click', () => this.exportCsv());
		this.leftPanel.querySelector('.loot-upgrades-clear')?.addEventListener('click', () => this.clearBossCache());
	}

	private buildBaselineControls() {
		const actionsContainer = this.leftPanel.querySelector('.loot-upgrades-baseline-actions');
		const statusContainer = this.leftPanel.querySelector('.loot-upgrades-baseline-status');
		if (!actionsContainer || !statusContainer) return;

		const baselineButtons: Array<{ key: string; label: string; baselineKey: 'A' | 'B'; autoReforge: boolean }> = [
			{ key: 'A-noreforge', label: 'Sim A (No Reforge)', baselineKey: 'A', autoReforge: false },
			{ key: 'A-reforge', label: 'Sim A (Auto Reforge)', baselineKey: 'A', autoReforge: true },
			{ key: 'B-noreforge', label: 'Sim B (No Reforge)', baselineKey: 'B', autoReforge: false },
			{ key: 'B-reforge', label: 'Sim B (Auto Reforge)', baselineKey: 'B', autoReforge: true },
		];

		const buttonGroup = document.createElement('div');
		buttonGroup.classList.add('d-flex', 'flex-column', 'gap-2', 'mb-2');
		baselineButtons.forEach(({ key, label, baselineKey, autoReforge }) => {
			const button = document.createElement('button');
			button.className = 'btn btn-outline-primary loot-upgrades-baseline-btn';
			button.textContent = label;
			button.addEventListener('click', () => this.runBaseline(baselineKey, autoReforge));
			buttonGroup.appendChild(button);

			const status = document.createElement('div');
			status.classList.add('small', 'text-muted');
			status.textContent = `${key}: Not run`;
			this.baselineStatusElems[key] = status;
			statusContainer.appendChild(status);
		});

		actionsContainer.appendChild(buttonGroup);
	}

	private refreshBossEntries() {
		this.bossEntries = buildBossEntries(this.simUI);
		this.populateBossSelect();
	}

	private populateBossSelect() {
		this.bossSelect.innerHTML = '';
		if (!this.bossEntries.length) {
			this.bossSelect.appendChild(<option value="">No raid boss drops found</option>);
			return;
		}

		let currentZoneId: number | null = null;
		let currentOptGroup: HTMLOptGroupElement | null = null;

		this.bossEntries.forEach(entry => {
			if (entry.zone.id !== currentZoneId) {
				currentZoneId = entry.zone.id;
				currentOptGroup = document.createElement('optgroup');
				currentOptGroup.label = entry.zone.name;
				this.bossSelect.appendChild(currentOptGroup);
			}
			const option = document.createElement('option');
			option.value = entry.key;
			option.textContent = entry.bossName;
			currentOptGroup!.appendChild(option);
		});

		this.bossSelect.selectedIndex = 0;
		this.onBossChanged();
	}

	private onBossChanged() {
		const selected = this.bossSelect.value;
		if (!selected) {
			this.selectedBossKey = null;
			this.resetTable();
			return;
		}
		this.selectedBossKey = selected;
		this.reloadBossRows();
	}

	private onDifficultyChanged() {
		this.selectedDifficulty = this.difficultySelect.value === 'heroic' ? 'heroic' : 'normal';
		this.reloadBossRows();
	}

	private resetTable() {
		this.rows.clear();
		this.rowElems.clear();
		this.tableBody.innerHTML = '';
		this.tableEmpty.textContent = 'Select a boss to see drops.';
		this.tableEmpty.classList.remove('hide');
	}

	private async reloadBossRows() {
		await this.syncConfigHash();
		if (!this.selectedBossKey) {
			this.resetTable();
			return;
		}

		this.tableBody.innerHTML = '';
		this.rowElems.clear();
		this.rows.clear();

		const bossEntry = this.bossEntries.find(entry => entry.key === this.selectedBossKey);
		if (!bossEntry) {
			this.tableEmpty.classList.remove('hide');
			return;
		}

		const drops = bossEntry.itemsByDifficulty[this.selectedDifficulty];
		if (!drops.length) {
			this.tableEmpty.textContent = 'No drops found for this boss/difficulty.';
			this.tableEmpty.classList.remove('hide');
			return;
		}

		this.tableEmpty.classList.add('hide');

		const bossCacheEntries = await getBossItemsFromCache(this.selectedBossKey, this.selectedDifficulty, this.simUI, this.altWeaponGear);
		const cachedByKey = new Map<string, CacheEntry>();
		bossCacheEntries.forEach(entry => {
			if (entry.itemId == null || entry.slot == null) return;
			cachedByKey.set(`${entry.itemId}-${entry.slot}`, entry);
		});

		for (const item of drops) {
			const row = this.makeRow(item);
			const cached = cachedByKey.get(`${item.id}-${row.slot}`);
			if (cached) {
				row.status = 'Cached';
				row.baselineDps = cached.baselineDps;
				row.newDps = cached.newDps;
				row.deltaDps = cached.deltaDps;
				row.baselineKey = cached.baselineKey;
			}
			this.rows.set(row.key, row);
			const rowElem = this.buildRowElem(row);
			this.tableBody.appendChild(rowElem);
			this.rowElems.set(row.key, rowElem);
		}
	}

	private async syncConfigHash(): Promise<string> {
		const hash = await getLootConfigHash(this.simUI, this.altWeaponGear);
		if (hash !== this.currentConfigHash) {
			this.currentConfigHash = hash;
			this.baselineCache.clear();
			this.resetBaselineStatus();
		}
		return hash;
	}

	private makeRow(item: Item): LootUpgradeRow {
		const upgradeStep = getMaxUpgradeStep(item);
		const slot = this.pickItemSlot(item);
		return {
			key: `${item.id}-${slot}`,
			item,
			slot,
			upgradeStep,
			status: 'Not run',
			baselineKey: this.getBaselineKeyForItem(item),
		};
	}

	private pickItemSlot(item: Item): ItemSlot {
		const slots = getEligibleItemSlots(item, this.player.canDualWield2H());
		if (slots.length === 1) return slots[0];

		// Rings/trinkets: default to first slot.
		if (!isWeaponItem(item)) return slots[0];

		// Weapons: honor preference for 1H items that can go in both slots.
		if (item.handType === HandType.HandTypeOneHand && slots.includes(ItemSlot.ItemSlotOffHand) && slots.includes(ItemSlot.ItemSlotMainHand)) {
			return this.oneHandPreference === 'oh' ? ItemSlot.ItemSlotOffHand : ItemSlot.ItemSlotMainHand;
		}

		return slots[0];
	}

	private getBaselineKeyForItem(item: Item): 'A' | 'B' {
		return getBaselineKeyForItem(item, this.player.getGear(), this.player.canDualWield2H());
	}

	private buildRowElem(row: LootUpgradeRow): HTMLElement {
		const tr = document.createElement('tr');
		tr.dataset.key = row.key;

		const itemLink = document.createElement('a');
		itemLink.href = '#';
		itemLink.className = 'loot-upgrades-item-link';
		itemLink.textContent = row.item.name;
		itemLink.addEventListener('click', evt => evt.preventDefault());

		const equippedItem = new EquippedItem({ item: row.item, challengeMode: this.player.getChallengeModeEnabled() }).withUpgrade(row.upgradeStep);
		equippedItem.asActionId().fillAndSet(itemLink, true, false);

		const itemCell = document.createElement('td');
		itemCell.appendChild(itemLink);

		const slotCell = document.createElement('td');
		slotCell.textContent = ItemSlot[row.slot];

		const baselineCell = document.createElement('td');
		baselineCell.textContent = row.baselineKey;

		const statusCell = document.createElement('td');
		statusCell.textContent = row.status;

		const baselineDpsCell = document.createElement('td');
		baselineDpsCell.className = 'text-end';
		baselineDpsCell.textContent = row.baselineDps != null ? row.baselineDps.toFixed(2) : '-';

		const newDpsCell = document.createElement('td');
		newDpsCell.className = 'text-end';
		newDpsCell.textContent = row.newDps != null ? row.newDps.toFixed(2) : '-';

		const deltaCell = document.createElement('td');
		deltaCell.className = 'text-end';
		deltaCell.textContent = row.deltaDps != null ? row.deltaDps.toFixed(2) : '-';

		const actionsCell = document.createElement('td');
		actionsCell.className = 'text-end';
		const runBtn = document.createElement('button');
		runBtn.className = 'btn btn-sm btn-outline-primary me-1';
		runBtn.textContent = 'Sim';
		runBtn.addEventListener('click', () => this.runSingle(row.key));

		const removeBtn = document.createElement('button');
		removeBtn.className = 'btn btn-sm btn-outline-danger';
		removeBtn.textContent = 'Remove';
		removeBtn.addEventListener('click', () => this.removeCache(row.key));

		actionsCell.appendChild(runBtn);
		actionsCell.appendChild(removeBtn);

		tr.appendChild(itemCell);
		tr.appendChild(slotCell);
		tr.appendChild(baselineCell);
		tr.appendChild(statusCell);
		tr.appendChild(baselineDpsCell);
		tr.appendChild(newDpsCell);
		tr.appendChild(deltaCell);
		tr.appendChild(actionsCell);

		return tr;
	}

	private updateRowElem(row: LootUpgradeRow) {
		const tr = this.rowElems.get(row.key);
		if (!tr) return;

		const cells = Array.from(tr.children) as HTMLTableCellElement[];
		if (cells.length < 7) return;
		cells[2].textContent = row.baselineKey;
		cells[3].textContent = row.status;
		cells[4].textContent = row.baselineDps != null ? row.baselineDps.toFixed(2) : '-';
		cells[5].textContent = row.newDps != null ? row.newDps.toFixed(2) : '-';
		cells[6].textContent = row.deltaDps != null ? row.deltaDps.toFixed(2) : '-';
	}

	private buildAltWeaponPickers() {
		this.altWeaponContainer.innerHTML = '';
		const slots: ItemSlot[] = [ItemSlot.ItemSlotMainHand, ItemSlot.ItemSlotOffHand];
		for (const slot of slots) {
			const wrapper = document.createElement('div');
			wrapper.classList.add('loot-upgrades-alt-weapon');
			const button = document.createElement('a');
			button.href = '#';
			button.classList.add('icon-picker-button');
			button.style.backgroundImage = `url('${getEmptySlotIconUrl(slot)}')`;

			const socketsContainer = document.createElement('div');
			socketsContainer.classList.add('item-picker-sockets-container');
			button.appendChild(socketsContainer);

			wrapper.appendChild(button);
			this.altWeaponContainer.appendChild(wrapper);

			const update = () => {
				const item = this.altWeaponGear.getEquippedItem(slot);
				button.style.backgroundImage = `url('${getEmptySlotIconUrl(slot)}')`;
				button.removeAttribute('data-wowhead');
				button.classList.remove('active');
				socketsContainer.replaceChildren();

				if (item) {
					item.asActionId().fillAndSet(button, true, true);
					this.player.setWowheadData(item, button);
					button.classList.add('active');
					socketsContainer.replaceChildren(
						<>
							{item.allSocketColors().map((socketColor, gemIdx) => {
								const gemContainer = createGemContainer(socketColor, item.gems[gemIdx], gemIdx);
								if (gemIdx === item.numPossibleSockets - 1 && item.couldHaveExtraSocket()) {
									const updateProfession = () => {
										gemContainer.classList[this.player.isBlacksmithing() ? 'remove' : 'add']('hide');
									};
									this.player.professionChangeEmitter.on(updateProfession);
									updateProfession();
								}
								return gemContainer;
							})}
						</>,
					);
				}
			};

			button.addEventListener('click', event => {
				event.preventDefault();
				this.selectorModal.openTab(slot, SelectorModalTabs.Items, {
					equipItem: (eventID, newItem) => {
						this.altWeaponGear = this.altWeaponGear.withEquippedItem(slot, newItem, this.player.canDualWield2H());
						this.altWeaponChangeEmitter.emit(eventID);
					},
					getEquippedItem: () => this.altWeaponGear.getEquippedItem(slot),
					changeEvent: this.altWeaponChangeEmitter,
				});
			});

			this.altWeaponChangeEmitter.on(update);
			update();
		}

		this.updateAltWeaponHelp();
		this.altWeaponChangeEmitter.on(() => this.updateAltWeaponHelp());
		this.altWeaponChangeEmitter.on(() => this.reloadBossRows());
	}

	private updateAltWeaponHelp() {
		const systemA = getWeaponSystemForGear(this.player.getGear(), this.player.canDualWield2H());
		const systemB = systemA === 'two-hand' ? 'dual-wield' : 'two-hand';
		this.altWeaponHelp.textContent = `Required: ${systemB === 'two-hand' ? '2H weapon' : 'Main Hand + Off Hand'}.`;
	}

	private validateAltWeapons(): { valid: boolean; message?: string } {
		const systemA = getWeaponSystemForGear(this.player.getGear(), this.player.canDualWield2H());
		const systemB = systemA === 'two-hand' ? 'dual-wield' : 'two-hand';
		const mh = this.altWeaponGear.getEquippedItem(ItemSlot.ItemSlotMainHand);
		const oh = this.altWeaponGear.getEquippedItem(ItemSlot.ItemSlotOffHand);

		if (systemB === 'two-hand') {
			if (!mh) return { valid: false, message: 'Alternate weapon (2H) is required.' };
			if (mh.item.handType !== HandType.HandTypeTwoHand && mh.item.rangedWeaponType === 0) {
				return { valid: false, message: 'Alternate main hand must be a 2H weapon.' };
			}
			if (oh) return { valid: false, message: 'Off hand must be empty for 2H baseline.' };
			return { valid: true };
		}

		if (!mh || !oh) return { valid: false, message: 'Alternate main hand and off hand are required.' };
		if (mh.item.handType === HandType.HandTypeTwoHand) return { valid: false, message: 'Alternate main hand must be 1H.' };
		if (oh.item.handType === HandType.HandTypeTwoHand) return { valid: false, message: 'Alternate off hand must be 1H or offhand.' };

		return { valid: true };
	}

	private getBaselineGear(baselineKey: 'A' | 'B'): Gear {
		if (baselineKey === 'A') return this.player.getGear();
		let gear = this.player.getGear();
		const mh = this.altWeaponGear.getEquippedItem(ItemSlot.ItemSlotMainHand);
		const oh = this.altWeaponGear.getEquippedItem(ItemSlot.ItemSlotOffHand);
		gear = gear.withEquippedItem(ItemSlot.ItemSlotMainHand, mh, this.player.canDualWield2H());
		gear = gear.withEquippedItem(ItemSlot.ItemSlotOffHand, oh, this.player.canDualWield2H());
		return gear;
	}

	private async runAll() {
		if (this.isRunning) return;
		if (!this.selectedBossKey) {
			new Toast({ variant: 'info', body: 'Select a boss first.' });
			return;
		}

		if (!this.requireAltWeapons()) return;

		this.cancelRequested = false;
		this.isRunning = true;
		this.updateProgress(0, 0, '');

		try {
			await this.syncConfigHash();
			await this.simUI.sim.signalManager.abortType(RequestTypes.All);
			const tasks = Array.from(this.rows.values()).filter(row => row.status !== 'Cached');
			if (!tasks.length) {
				new Toast({ variant: 'info', body: 'All items are cached.' });
				return;
			}

			let completed = 0;
			for (const row of tasks) {
				if (this.cancelRequested) break;
				this.updateProgress(completed, tasks.length, row.item.name);
				await this.runItemSim(row);
				completed += 1;
				this.updateProgress(completed, tasks.length, '');
			}
		} finally {
			this.isRunning = false;
			this.cancelRequested = false;
		}
	}

	private async runSingle(key: string) {
		if (this.isRunning) return;
		const row = this.rows.get(key);
		if (!row) return;
		if (!this.requireAltWeapons()) return;

		this.cancelRequested = false;
		this.isRunning = true;
		this.updateProgress(0, 1, row.item.name);
		try {
			await this.syncConfigHash();
			await this.simUI.sim.signalManager.abortType(RequestTypes.All);
			await this.runItemSim(row);
			this.updateProgress(1, 1, '');
		} finally {
			this.isRunning = false;
			this.cancelRequested = false;
		}
	}

	private cancelRuns() {
		if (!this.isRunning) return;
		this.cancelRequested = true;
		this.simUI.sim.signalManager.abortType(RequestTypes.RaidSim).catch(console.error);
	}

	private updateProgress(completed: number, total: number, currentItem: string) {
		const percent = total ? Math.round((completed / total) * 100) : 0;
		this.progressBar.style.width = `${percent}%`;
		this.progressBar.textContent = total ? `${percent}%` : '';
		this.progressLabel.textContent = total ? `${completed} / ${total}` : '';
		this.currentItemLabel.textContent = currentItem ? `Running: ${currentItem}` : '';
	}

	private async runItemSim(row: LootUpgradeRow) {
		row.status = 'Running';
		this.updateRowElem(row);

		const baselineKey = row.baselineKey;
		const baselineResult = await this.ensureBaseline(baselineKey, true);
		if (!baselineResult) {
			row.status = 'Error';
			this.updateRowElem(row);
			return;
		}

		row.baselineDps = baselineResult.dps;

		const originalGear = this.player.getGear();
		const originalReforgeSettings = this.simUI.reforger?.toProto();

		try {
			let gear = this.getBaselineGear(baselineKey);
			gear = gear.withEquippedItem(row.slot, this.makeEquippedItem(row.item, row.upgradeStep), this.player.canDualWield2H());
			await this.player.setGearAsync(TypedEvent.nextEventID(), gear);

			const reforgeOk = await this.applyAutoReforge();
			if (!reforgeOk) throw new Error('Auto reforge failed');

			const simResult = await this.simUI.sim.runRaidSim(TypedEvent.nextEventID(), () => {}, { silent: true });
			if (!simResult || !('getFirstPlayer' in simResult)) throw new Error('Sim failed');
			const dps = simResult.getFirstPlayer()!.dps.avg;
			row.newDps = dps;
			row.deltaDps = dps - baselineResult.dps;
			row.status = 'Done';

			await putItemCache(this.simUI, this.altWeaponGear, row, baselineResult.dps, this.selectedBossKey!, this.selectedDifficulty);
		} catch (error) {
			console.error(error);
			row.status = 'Error';
		} finally {
			if (originalReforgeSettings && this.simUI.reforger) {
				this.simUI.reforger.fromProto(TypedEvent.nextEventID(), originalReforgeSettings);
			}
			await this.player.setGearAsync(TypedEvent.nextEventID(), originalGear);
			this.updateRowElem(row);
		}
	}

	private makeEquippedItem(item: Item, upgradeStep: ItemLevelState): EquippedItem {
		return new EquippedItem({ item, challengeMode: this.player.getChallengeModeEnabled() }).withUpgrade(upgradeStep);
	}

	private async ensureBaseline(baselineKey: 'A' | 'B', autoReforge: boolean): Promise<BaselineEntry | null> {
		const configHash = await this.syncConfigHash();
		const cacheKey = `${configHash}|${baselineKey}-${autoReforge ? 'reforge' : 'noreforge'}`;
		const cachedLocal = this.baselineCache.get(cacheKey);
		if (cachedLocal) return cachedLocal;

		const cached = await getBaselineFromCache(this.simUI, this.altWeaponGear, baselineKey, autoReforge);
		if (cached) {
			this.baselineCache.set(cacheKey, cached);
			this.updateBaselineStatus(`${baselineKey}-${autoReforge ? 'reforge' : 'noreforge'}`, cached.dps);
			return cached;
		}

		const originalGear = this.player.getGear();
		const originalReforgeSettings = this.simUI.reforger?.toProto();

		try {
			const gear = this.getBaselineGear(baselineKey);
			await this.player.setGearAsync(TypedEvent.nextEventID(), gear);
			if (autoReforge) {
				const ok = await this.applyAutoReforge();
				if (!ok) throw new Error('Auto reforge failed');
			}

			const simResult = await this.simUI.sim.runRaidSim(TypedEvent.nextEventID(), () => {}, { silent: true });
			if (!simResult || !('getFirstPlayer' in simResult)) throw new Error('Sim failed');
			const dps = simResult.getFirstPlayer()!.dps.avg;
			const entry: BaselineEntry = { baselineKey, autoReforge, dps };
			this.baselineCache.set(cacheKey, entry);
			this.updateBaselineStatus(`${baselineKey}-${autoReforge ? 'reforge' : 'noreforge'}`, dps);
			await putBaselineCache(this.simUI, this.altWeaponGear, entry);
			return entry;
		} catch (error) {
			console.error(error);
			new Toast({ variant: 'error', body: 'Baseline sim failed.' });
			return null;
		} finally {
			if (originalReforgeSettings && this.simUI.reforger) {
				this.simUI.reforger.fromProto(TypedEvent.nextEventID(), originalReforgeSettings);
			}
			await this.player.setGearAsync(TypedEvent.nextEventID(), originalGear);
		}
	}

	private async runBaseline(baselineKey: 'A' | 'B', autoReforge: boolean) {
		if (this.isRunning) return;
		if (!this.requireAltWeapons()) return;

		this.cancelRequested = false;
		this.isRunning = true;
		this.updateProgress(0, 1, `Baseline ${baselineKey} ${autoReforge ? 'reforge' : 'no reforge'}`);
		try {
			await this.syncConfigHash();
			await this.simUI.sim.signalManager.abortType(RequestTypes.All);
			const entry = await this.ensureBaseline(baselineKey, autoReforge);
			if (entry) {
				this.rows.forEach(row => {
					if (row.baselineKey === baselineKey && row.baselineDps == null) {
						row.baselineDps = entry.dps;
						this.updateRowElem(row);
					}
				});
			}
			this.updateProgress(1, 1, '');
		} finally {
			this.isRunning = false;
			this.cancelRequested = false;
		}
	}

	private async applyAutoReforge(): Promise<boolean> {
		if (!this.simUI.reforger) return true;

		const reforger = this.simUI.reforger;
		const playerPhase = this.simUI.sim.getPhase() >= 2;
		reforger.setIncludeGems(TypedEvent.nextEventID(), true);
		reforger.setIncludeEOTBPGemSocket(TypedEvent.nextEventID(), playerPhase);

		if (RelativeStatCap.hasRoRo(this.player) && reforger.relativeStatCapStat !== -1) {
			reforger.relativeStatCap = new RelativeStatCap(reforger.relativeStatCapStat, this.player, this.player.getClass());
		}

		try {
			await reforger.optimizeReforges(true);
			return true;
		} catch (error) {
			try {
				reforger.setIncludeGems(TypedEvent.nextEventID(), false);
				await reforger.optimizeReforges(true);
				return true;
			} catch (_err) {
				return false;
			}
		}
	}

	private async removeCache(key: string) {
		const row = this.rows.get(key);
		if (!row) return;
		await removeCacheEntry(this.simUI, this.altWeaponGear, row, this.selectedBossKey!, this.selectedDifficulty);
		row.status = 'Not run';
		row.newDps = undefined;
		row.deltaDps = undefined;
		row.baselineDps = undefined;
		this.updateRowElem(row);
	}

	private async clearBossCache() {
		if (!this.selectedBossKey) return;
		await clearBossCache(this.simUI, this.altWeaponGear, this.selectedBossKey, this.selectedDifficulty);
		await this.reloadBossRows();
	}

	private async exportCsv() {
		if (!this.selectedBossKey) return;
		const rows = Array.from(this.rows.values());
		const csv = await toCsv(this.simUI, rows, this.selectedBossKey, this.selectedDifficulty, this.altWeaponGear);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `loot-upgrades-${this.selectedBossKey}-${this.selectedDifficulty}.csv`;
		link.click();
		URL.revokeObjectURL(url);
	}

	private updateBaselineStatus(key: string, dps?: number) {
		const elem = this.baselineStatusElems[key];
		if (!elem) return;
		elem.textContent = dps != null ? `${key}: ${dps.toFixed(2)}` : `${key}: Not run`;
	}

	private requireAltWeapons(): boolean {
		const altValidation = this.validateAltWeapons();
		if (!altValidation.valid) {
			new Toast({ variant: 'error', body: altValidation.message || 'Alternate weapon set is incomplete.' });
			return false;
		}
		return true;
	}

	private resetBaselineStatus() {
		Object.keys(this.baselineStatusElems).forEach(key => {
			this.updateBaselineStatus(key, undefined);
		});
	}
}
