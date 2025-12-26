import { IndividualSimUI } from '../individual_sim_ui';
import { CURRENT_API_VERSION } from '../constants/other';
import { IndividualSimSettings } from '../proto/ui';
import { Gear } from '../proto_utils/gear';

import { BaselineEntry, CacheEntry, LootBossKey, LootDifficulty, LootUpgradeRow } from './types';

const DB_NAME = 'wowsims-mop-loot-upgrades';
const STORE_NAME = 'lootUpgrades';
const DB_VERSION = 1;

const baselineId = (configHash: string, baselineKey: 'A' | 'B', autoReforge: boolean) =>
	`baseline|${configHash}|${baselineKey}|${autoReforge ? 'R' : 'N'}`;

const itemId = (configHash: string, bossKey: LootBossKey, difficulty: LootDifficulty, row: LootUpgradeRow) =>
	`item|${configHash}|${bossKey}|${difficulty}|${row.item.id}|${row.slot}|${row.upgradeStep}|${row.baselineKey}`;

const bossConfigKey = (configHash: string, bossKey: LootBossKey, difficulty: LootDifficulty) =>
	`${configHash}|${bossKey}|${difficulty}`;

const baselineConfigKey = (configHash: string, baselineKey: 'A' | 'B', autoReforge: boolean) =>
	`${configHash}|${baselineKey}|${autoReforge ? 'R' : 'N'}`;

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				store.createIndex('byBossConfig', 'bossConfig', { unique: false });
				store.createIndex('byBaselineConfig', 'baselineConfig', { unique: false });
			}
		};
	});
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function getLootConfigHash(simUI: IndividualSimUI<any>, altWeaponGear: Gear): Promise<string> {
	const settingsJson = IndividualSimSettings.toJsonString(simUI.toProto());
	const payload = JSON.stringify({ settings: settingsJson, altWeapons: altWeaponGear.asSpec() });
	return await sha256(payload);
}

async function sha256(text: string): Promise<string> {
	if (window.crypto?.subtle) {
		const encoder = new TextEncoder();
		const data = encoder.encode(text);
		const hash = await window.crypto.subtle.digest('SHA-256', data);
		return Array.from(new Uint8Array(hash))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
	}

	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		const chr = text.charCodeAt(i);
		hash = (hash << 5) - hash + chr;
		hash |= 0;
	}
	return `fallback-${hash}`;
}

export async function getBaselineFromCache(
	simUI: IndividualSimUI<any>,
	altWeaponGear: Gear,
	baselineKey: 'A' | 'B',
	autoReforge: boolean,
): Promise<BaselineEntry | null> {
	const db = await openDb();
	const configHash = await getLootConfigHash(simUI, altWeaponGear);
	const id = baselineId(configHash, baselineKey, autoReforge);
	const tx = db.transaction(STORE_NAME, 'readonly');
	const store = tx.objectStore(STORE_NAME);
	const entry = await requestToPromise(store.get(id));
	if (!entry) return null;
	return { baselineKey, autoReforge, dps: (entry as CacheEntry).baselineDps };
}

export async function putBaselineCache(
	simUI: IndividualSimUI<any>,
	altWeaponGear: Gear,
	entry: BaselineEntry,
): Promise<void> {
	const db = await openDb();
	const configHash = await getLootConfigHash(simUI, altWeaponGear);
	const id = baselineId(configHash, entry.baselineKey, entry.autoReforge);
	const cacheEntry: CacheEntry = {
		id,
		kind: 'baseline',
		configHash,
		baselineKey: entry.baselineKey,
		autoReforge: entry.autoReforge,
		baselineDps: entry.dps,
		timestamp: Date.now(),
		iterations: simUI.sim.getIterations(),
		version: CURRENT_API_VERSION,
		baselineConfig: baselineConfigKey(configHash, entry.baselineKey, entry.autoReforge),
	};
	const tx = db.transaction(STORE_NAME, 'readwrite');
	const store = tx.objectStore(STORE_NAME);
	store.put(cacheEntry);
}

export async function getBossItemsFromCache(
	bossKey: LootBossKey,
	difficulty: LootDifficulty,
	simUI: IndividualSimUI<any>,
	altWeaponGear: Gear,
): Promise<CacheEntry[]> {
	const db = await openDb();
	const configHash = await getLootConfigHash(simUI, altWeaponGear);
	const tx = db.transaction(STORE_NAME, 'readonly');
	const index = tx.objectStore(STORE_NAME).index('byBossConfig');
	const entries = await requestToPromise(index.getAll(bossConfigKey(configHash, bossKey, difficulty)));
	return (entries as CacheEntry[]).filter(entry => entry.kind === 'item');
}

export async function putItemCache(
	simUI: IndividualSimUI<any>,
	altWeaponGear: Gear,
	row: LootUpgradeRow,
	baselineDps: number,
	bossKey: LootBossKey,
	difficulty: LootDifficulty,
): Promise<void> {
	const db = await openDb();
	const configHash = await getLootConfigHash(simUI, altWeaponGear);
	const id = itemId(configHash, bossKey, difficulty, row);
	const cacheEntry: CacheEntry = {
		id,
		kind: 'item',
		configHash,
		bossKey,
		difficulty,
		baselineKey: row.baselineKey,
		autoReforge: true,
		itemId: row.item.id,
		itemName: row.item.name,
		slot: row.slot,
		upgradeStep: row.upgradeStep,
		baselineDps,
		newDps: row.newDps,
		deltaDps: row.deltaDps,
		timestamp: Date.now(),
		iterations: simUI.sim.getIterations(),
		version: CURRENT_API_VERSION,
		bossConfig: bossConfigKey(configHash, bossKey, difficulty),
	};
	const tx = db.transaction(STORE_NAME, 'readwrite');
	const store = tx.objectStore(STORE_NAME);
	store.put(cacheEntry);
}

export async function removeCacheEntry(
	simUI: IndividualSimUI<any>,
	altWeaponGear: Gear,
	row: LootUpgradeRow,
	bossKey: LootBossKey,
	difficulty: LootDifficulty,
): Promise<void> {
	const db = await openDb();
	const configHash = await getLootConfigHash(simUI, altWeaponGear);
	const id = itemId(configHash, bossKey, difficulty, row);
	const tx = db.transaction(STORE_NAME, 'readwrite');
	const store = tx.objectStore(STORE_NAME);
	store.delete(id);
}

export async function clearBossCache(
	simUI: IndividualSimUI<any>,
	altWeaponGear: Gear,
	bossKey: LootBossKey,
	difficulty: LootDifficulty,
): Promise<void> {
	const db = await openDb();
	const configHash = await getLootConfigHash(simUI, altWeaponGear);
	const targetKey = bossConfigKey(configHash, bossKey, difficulty);
	const tx = db.transaction(STORE_NAME, 'readwrite');
	const store = tx.objectStore(STORE_NAME);
	const index = store.index('byBossConfig');
	const cursorRequest = index.openCursor(IDBKeyRange.only(targetKey));

	await new Promise<void>((resolve, reject) => {
		cursorRequest.onerror = () => reject(cursorRequest.error);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve();
				return;
			}
			cursor.delete();
			cursor.continue();
		};
	});
}
