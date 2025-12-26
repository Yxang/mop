import { IndividualSimUI } from '../individual_sim_ui';
import { Player } from '../player';
import { HandType, ItemLevelState, ItemSlot, ItemType } from '../proto/common';
import { DungeonDifficulty, UIItem as Item } from '../proto/ui';
import { Gear } from '../proto_utils/gear';
import { canEquipItem, getEligibleItemSlots } from '../proto_utils/utils';

import { BossEntry, LootBossKey, LootDifficulty, WeaponSystem } from './types';

const VARIANT_BLACKLIST = ['thunderforged', 'warforged'];

export function makeBossKey(zoneId: number, npcId?: number): LootBossKey {
	return npcId ? `${zoneId}:npc:${npcId}` : `${zoneId}:other`;
}

export function parseBossKey(key: LootBossKey): { zoneId: number; npcId?: number } {
	const parts = key.split(':');
	const zoneId = Number(parts[0]);
	if (parts[1] === 'npc') return { zoneId, npcId: Number(parts[2]) };
	return { zoneId };
}

function isPlainVariant(item: Item, difficulty: LootDifficulty): boolean {
	const desc = (item.nameDescription || '').toLowerCase();
	if (VARIANT_BLACKLIST.some(word => desc.includes(word))) return false;

	if (difficulty === 'heroic') {
		return desc === 'heroic' || desc === '';
	}
	return desc === '';
}

export function getMaxUpgradeStep(item: Item): ItemLevelState {
	const keys = Object.keys(item.scalingOptions || {}).map(k => Number(k));
	const filtered = keys.filter(key => key !== ItemLevelState.ChallengeMode);
	if (!filtered.length) return ItemLevelState.Base;
	return Math.max(...filtered) as ItemLevelState;
}

export function isWeaponItem(item: Item): boolean {
	if (item.type === ItemType.ItemTypeWeapon) return true;
	if (item.handType && item.handType !== HandType.HandTypeUnknown) return true;
	return item.rangedWeaponType > 0;
}

export function getWeaponSystemForGear(gear: Gear, canDualWield2H: boolean): WeaponSystem {
	const mh = gear.getEquippedItem(ItemSlot.ItemSlotMainHand);
	const oh = gear.getEquippedItem(ItemSlot.ItemSlotOffHand);
	if (!mh) return 'two-hand';
	if (mh.item.rangedWeaponType > 0) return 'two-hand';
	if (mh.item.handType === HandType.HandTypeTwoHand && !canDualWield2H) return 'two-hand';
	if (!oh) return 'two-hand';
	return 'dual-wield';
}

export function getBaselineKeyForItem(item: Item, gear: Gear, canDualWield2H: boolean): 'A' | 'B' {
	if (!isWeaponItem(item)) return 'A';
	const systemA = getWeaponSystemForGear(gear, canDualWield2H);
	const itemIsTwoHand = item.handType === HandType.HandTypeTwoHand || item.rangedWeaponType > 0;
	if (itemIsTwoHand) {
		return systemA === 'two-hand' ? 'A' : 'B';
	}
	return systemA === 'dual-wield' ? 'A' : 'B';
}

export function buildBossEntries(simUI: IndividualSimUI<any>): BossEntry[] {
	const db = simUI.sim.db;
	const player = simUI.player;
	const raidZones = new Set(Object.values(Player.RAID_IDS));
	const bossMap = new Map<LootBossKey, BossEntry>();

	const ensureEntry = (key: LootBossKey, zoneId: number, bossName: string): BossEntry => {
		const existing = bossMap.get(key);
		if (existing) return existing;
		const zone = db.getZone(zoneId);
		const entry: BossEntry = {
			key,
			zone: { id: zoneId, name: zone?.name ?? `Zone ${zoneId}` },
			bossName,
			itemsByDifficulty: { normal: [], heroic: [] },
		};
		bossMap.set(key, entry);
		return entry;
	};

	for (const item of db.getAllItems()) {
		const eligibleSlots = getEligibleItemSlots(item, player.canDualWield2H());
		const equippable = eligibleSlots.some(slot => canEquipItem(item, player.getPlayerSpec(), slot));
		if (!equippable) continue;

		const sources = item.sources || [];
		for (const source of sources) {
			if (source.source.oneofKind !== 'drop') continue;
			const drop = source.source.drop;
			if (!drop.zoneId || !raidZones.has(drop.zoneId)) continue;

			if (
				drop.difficulty !== DungeonDifficulty.DifficultyRaid25 &&
				drop.difficulty !== DungeonDifficulty.DifficultyRaid25H &&
				drop.difficulty !== DungeonDifficulty.DifficultyRaid10 &&
				drop.difficulty !== DungeonDifficulty.DifficultyRaid10H
			) {
				continue;
			}

			const difficulty: LootDifficulty =
				drop.difficulty === DungeonDifficulty.DifficultyRaid25H || drop.difficulty === DungeonDifficulty.DifficultyRaid10H
					? 'heroic'
					: 'normal';
			if (!isPlainVariant(item, difficulty)) continue;

			const bossKey = makeBossKey(drop.zoneId, drop.npcId || undefined);
			const npc = drop.npcId ? db.getNpc(drop.npcId) : null;
			const bossName = npc?.name ?? 'Others';
			const entry = ensureEntry(bossKey, drop.zoneId, bossName);

			const existingIds = new Set(entry.itemsByDifficulty[difficulty].map(i => i.id));
			if (!existingIds.has(item.id)) {
				entry.itemsByDifficulty[difficulty].push(item);
			}
		}
	}

	const entries = Array.from(bossMap.values());
	entries.forEach(entry => {
		entry.itemsByDifficulty.normal.sort((a, b) => a.name.localeCompare(b.name));
		entry.itemsByDifficulty.heroic.sort((a, b) => a.name.localeCompare(b.name));
	});

	entries.sort((a, b) => {
		if (a.zone.id !== b.zone.id) return a.zone.name.localeCompare(b.zone.name);
		return a.bossName.localeCompare(b.bossName);
	});

	return entries;
}
