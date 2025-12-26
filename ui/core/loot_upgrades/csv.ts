import { IndividualSimUI } from '../individual_sim_ui';
import { ItemSlot } from '../proto/common';
import { Gear } from '../proto_utils/gear';

import { getLootConfigHash } from './cache';
import { LootBossKey, LootDifficulty, LootUpgradeRow } from './types';
import { parseBossKey } from './utils';

function applyAltWeapons(baseGear: Gear, altWeaponGear: Gear, canDualWield2H: boolean): Gear {
	let gear = baseGear;
	const mh = altWeaponGear.getEquippedItem(ItemSlot.ItemSlotMainHand);
	const oh = altWeaponGear.getEquippedItem(ItemSlot.ItemSlotOffHand);
	gear = gear.withEquippedItem(ItemSlot.ItemSlotMainHand, mh, canDualWield2H);
	gear = gear.withEquippedItem(ItemSlot.ItemSlotOffHand, oh, canDualWield2H);
	return gear;
}

export async function toCsv(
	simUI: IndividualSimUI<any>,
	rows: LootUpgradeRow[],
	bossKey: LootBossKey,
	difficulty: LootDifficulty,
	altWeaponGear: Gear,
): Promise<string> {
	const db = simUI.sim.db;
	const { zoneId, npcId } = parseBossKey(bossKey);
	const zoneName = db.getZone(zoneId)?.name ?? `Zone ${zoneId}`;
	const bossName = npcId ? db.getNpc(npcId)?.name ?? `NPC ${npcId}` : 'Others';
	const configHash = await getLootConfigHash(simUI, altWeaponGear);
	const iterations = simUI.sim.getIterations();

	const header = [
		'instance',
		'boss',
		'difficulty',
		'itemId',
		'itemName',
		'slot',
		'ilvl',
		'baselineKey',
		'baselineDps',
		'newDps',
		'deltaDps',
		'replacedItemId',
		'replacedItemName',
		'configHash',
		'iterations',
		'timestamp',
		'status',
	].join(',');

	const lines = [header];

	rows.forEach(row => {
		const baseGear = row.baselineKey === 'B'
			? applyAltWeapons(simUI.player.getGear(), altWeaponGear, simUI.player.canDualWield2H())
			: simUI.player.getGear();
		const replaced = baseGear.getEquippedItem(row.slot);

		const ilvl = row.item.scalingOptions?.[row.upgradeStep]?.ilvl ?? row.item.ilvl;
		const cols = [
			zoneName,
			bossName,
			difficulty,
			row.item.id,
			`"${row.item.name}"`,
			ItemSlot[row.slot],
			ilvl,
			row.baselineKey,
			row.baselineDps ?? '',
			row.newDps ?? '',
			row.deltaDps ?? '',
			replaced?.item.id ?? '',
			replaced?.item.name ? `"${replaced.item.name}"` : '',
			configHash,
			iterations,
			new Date().toISOString(),
			row.status,
		];
		lines.push(cols.join(','));
	});

	return lines.join('\n');
}
