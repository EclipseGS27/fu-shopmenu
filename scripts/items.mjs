import { num } from './util.mjs';

/** Item types a shop can stock, grouped the way the shop lists them */
export const CATEGORIES = [
	['weapon', 'Weapons', ['weapon', 'customWeapon']],
	['armor', 'Armor', ['armor']],
	['shield', 'Shields', ['shield']],
	['accessory', 'Accessories', ['accessory']],
	['consumable', 'Items', ['consumable']],
	['other', 'Other', ['treasure', 'basic', 'material']],
];
export const SHOP_TYPES = new Set(CATEGORIES.flatMap(([, , t]) => t));
export const categoryOf = (item) => CATEGORIES.find(([, , t]) => t.includes(item?.type))?.[0] ?? 'other';

/** The item's list price in zenit (Project FU keeps it on system.cost.value, or system.cost for a few types) */
export function costOf(item) {
	const c = item?.system?.cost;
	if (c && typeof c === 'object') return Math.max(0, num(c.value));
	return Math.max(0, num(c));
}

/** Consumables are paid in Inventory Points, not bought; a shop can still sell their recipes or refills */
export const ipCostOf = (item) => num(item?.system?.ipCost?.value);

const ATTR = { dex: 'DEX', ins: 'INS', mig: 'MIG', wlp: 'WLP' };

/** The numbers worth comparing, and a one-line description of the item */
export function statsOf(item) {
	const s = item?.system ?? {};
	switch (item?.type) {
		case 'weapon':
		case 'customWeapon': {
			const a = s.attributes ?? {};
			const p = ATTR[a.primary?.value ?? a.primary] ?? '';
			const q = ATTR[a.secondary?.value ?? a.secondary] ?? '';
			const acc = num(s.accuracy?.value ?? s.accuracy);
			const dmg = num(s.damage?.value ?? s.damage);
			const type = s.damageType?.value ?? s.damage?.type ?? 'physical';
			return {
				line: `【${p} + ${q}】${acc ? ` ${acc > 0 ? '+' : ''}${acc}` : ''} · HR + ${dmg} ${type}${s.category?.value ? ` · ${s.category.value}` : ''}${s.hands?.value ? ` · ${String(s.hands.value).replace('-', ' ')}` : ''}`,
				nums: { accuracy: acc, damage: dmg, def: num(s.def?.value), mdef: num(s.mdef?.value), init: num(s.init?.value) },
				martial: !!s.isMartial?.value,
			};
		}
		case 'armor':
		case 'shield':
		case 'accessory': {
			const def = num(s.def?.value);
			const mdef = num(s.mdef?.value);
			const init = num(s.init?.value);
			const defA = s.def?.attribute ? `${ATTR[s.def.attribute] ?? s.def.attribute} die${def ? ` + ${def}` : ''}` : `+${def}`;
			const mdefA = s.mdef?.attribute ? `${ATTR[s.mdef.attribute] ?? s.mdef.attribute} die${mdef ? ` + ${mdef}` : ''}` : `+${mdef}`;
			const parts = [];
			if (item.type !== 'accessory' || def) parts.push(`DEF ${defA}`);
			if (item.type !== 'accessory' || mdef) parts.push(`M.DEF ${mdefA}`);
			if (init) parts.push(`INIT ${init > 0 ? '+' : ''}${init}`);
			return { line: parts.join(' · '), nums: { def, mdef, init, defAttr: s.def?.attribute ?? null, mdefAttr: s.mdef?.attribute ?? null }, martial: !!s.isMartial?.value };
		}
		case 'consumable':
			return { line: `${ipCostOf(item)} IP · ${s.summary?.value ?? ''}`, nums: {}, martial: false };
		default:
			return { line: s.summary?.value ?? '', nums: {}, martial: false };
	}
}

export const quality = (item) => item?.system?.quality?.value || '';

/** Which equipped slot this item would take on that actor (main hand for weapons) */
function slotFor(item) {
	switch (item?.type) {
		case 'weapon':
		case 'customWeapon':
			return 'mainHand';
		case 'shield':
			return 'offHand';
		case 'armor':
			return 'armor';
		case 'accessory':
			return 'accessory';
	}
	return null;
}

export function equippedFor(actor, item) {
	const slot = slotFor(item);
	if (!slot || !actor) return null;
	const id = actor.system?.equipped?.[slot];
	const cur = id ? actor.items.get(id) : null;
	return cur && cur.type !== 'basic' ? cur : null;
}

/**
 * Compare an item with what the actor has equipped in its slot.
 * Returns rows of { label, now, then, diff } for the numbers that differ or matter.
 */
export function compare(actor, item) {
	const cur = equippedFor(actor, item);
	const a = statsOf(item).nums;
	const b = cur ? statsOf(cur).nums : {};
	const keys = item.type === 'weapon' || item.type === 'customWeapon' ? ['accuracy', 'damage', 'def', 'mdef', 'init'] : ['def', 'mdef', 'init'];
	const label = { accuracy: 'Accuracy', damage: 'Damage', def: 'DEF', mdef: 'M.DEF', init: 'INIT' };
	const rows = [];
	for (const k of keys) {
		const then = num(a[k]);
		const now = num(b[k]);
		if (!then && !now && !['damage', 'def', 'mdef'].includes(k)) continue;
		rows.push({ key: k, label: label[k], now, then, diff: then - now });
	}
	// armor with a DEX die vs a flat bonus: say so rather than pretend the numbers compare
	const note = a.defAttr !== undefined && (a.defAttr ?? null) !== (b.defAttr ?? null) && cur ? `DEF uses ${a.defAttr ? `the ${a.defAttr.toUpperCase()} die` : 'a flat score'} instead of ${b.defAttr ? `the ${b.defAttr.toUpperCase()} die` : 'a flat score'}.` : '';
	return { current: cur, rows, note };
}

/** Can this character use martial gear? (a class or skill that grants it; Project FU marks it on classes) */
export function canUseMartial(actor, item) {
	if (!statsOf(item).martial) return true;
	const classes = (actor?.items?.contents ?? []).filter((i) => i.type === 'class');
	const b = (c) => c.system?.benefits?.martials ?? {};
	const kind = item.type === 'weapon' || item.type === 'customWeapon' ? (item.system?.type?.value === 'ranged' ? 'ranged' : 'melee') : item.type === 'shield' ? 'shields' : item.type;
	return classes.some((c) => !!b(c)[kind]?.value);
}

/** Item data ready to create on another actor: a fresh copy, unequipped */
export function cloneData(item) {
	const data = item.toObject();
	delete data._id;
	delete data.folder;
	delete data.sort;
	data.flags ??= {};
	data.flags.core ??= {};
	return data;
}
