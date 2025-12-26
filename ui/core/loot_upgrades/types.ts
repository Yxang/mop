import { ItemLevelState, ItemSlot } from '../proto/common';
import { UIItem as Item } from '../proto/ui';

export type LootDifficulty = 'normal' | 'heroic';
export type WeaponSystem = 'two-hand' | 'dual-wield';
export type LootBossKey = string;

export interface BossEntry {
	key: LootBossKey;
	zone: { id: number; name: string };
	bossName: string;
	itemsByDifficulty: Record<LootDifficulty, Item[]>;
}

export interface BaselineEntry {
	baselineKey: 'A' | 'B';
	autoReforge: boolean;
	dps: number;
}

export interface LootUpgradeRow {
	key: string;
	item: Item;
	slot: ItemSlot;
	upgradeStep: ItemLevelState;
	baselineKey: 'A' | 'B';
	status: 'Not run' | 'Running' | 'Done' | 'Cached' | 'Error';
	baselineDps?: number;
	newDps?: number;
	deltaDps?: number;
}

export interface CacheEntry {
	id: string;
	kind: 'baseline' | 'item';
	configHash: string;
	bossKey?: LootBossKey;
	difficulty?: LootDifficulty;
	baselineKey: 'A' | 'B';
	autoReforge: boolean;
	itemId?: number;
	itemName?: string;
	slot?: ItemSlot;
	upgradeStep?: ItemLevelState;
	baselineDps: number;
	newDps?: number;
	deltaDps?: number;
	timestamp: number;
	iterations: number;
	version: number;
	bossConfig?: string;
	baselineConfig?: string;
}
