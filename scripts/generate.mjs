import { MODULE_ID, num, setting } from './util.mjs';
import { costOf } from './items.mjs';
import { config } from './merchant.mjs';

/**
 * Level-appropriate stock from Project FU's own compendiums: every basic item of the shop's kinds, plus a pick of
 * rare items priced up to the level's ceiling (300 + level × "rare price per level", 60 by default: 600 zenit at
 * level 5, 1500 at 20, everything by level 34).
 */

const PACKS = { basic: 'projectfu.basic-equipment', rare: 'projectfu.rare-equipment', consumables: 'projectfu.consumables' };

/** Which item types each kind of shop carries */
const KIND_TYPES = {
	general: ['weapon', 'armor', 'shield', 'accessory'],
	weapons: ['weapon'],
	armor: ['armor', 'shield'],
	accessories: ['accessory'],
	magic: ['accessory', 'weapon'],
	alchemist: [],
	inn: [],
};

export const rareCeiling = (lvl) => 300 + Math.max(1, num(lvl, 1)) * num(setting('rarePerLevel'), 60);

async function packDocs(id) {
	const pack = game.packs.get(id);
	if (!pack) return [];
	try {
		return await pack.getDocuments();
	} catch (err) {
		console.warn(`${MODULE_ID} | could not read ${id}`, err);
		return [];
	}
}

/** Random pick of n, weighted toward pricier items (closer to the level's best) */
function weightedPick(list, n) {
	const pool = [...list];
	const out = [];
	while (pool.length && out.length < n) {
		const total = pool.reduce((s, d) => s + Math.max(1, costOf(d)), 0);
		let r = Math.random() * total;
		let i = 0;
		for (; i < pool.length - 1; i++) {
			r -= Math.max(1, costOf(pool[i]));
			if (r <= 0) break;
		}
		out.push(pool.splice(i, 1)[0]);
	}
	return out;
}

const isArcane = (d) => d.type === 'weapon' && (d.system?.category?.value === 'arcane' || d.system?.damageType?.value !== 'physical');

/** Build a stock list for a merchant (documents from the compendiums, not yet created) */
export async function buildStock(merchant, { level, size } = {}) {
	const cfg = config(merchant);
	const lvl = level ?? cfg.level;
	const count = size ?? cfg.stockSize;
	const types = KIND_TYPES[cfg.kind] ?? KIND_TYPES.general;
	if (!types.length) return [];
	const ceiling = rareCeiling(lvl);
	const [basic, rare] = await Promise.all([packDocs(PACKS.basic), packDocs(PACKS.rare)]);
	let basics = basic.filter((d) => types.includes(d.type) && costOf(d) > 0);
	let rares = rare.filter((d) => types.includes(d.type) && costOf(d) <= ceiling);
	if (cfg.kind === 'magic') {
		basics = basics.filter((d) => d.type === 'accessory' || isArcane(d));
		rares = rares.filter((d) => d.type === 'accessory' || isArcane(d));
	}
	// basic items are sold everywhere that deals in them; `count` is how many rare items join them
	return [...basics, ...weightedPick(rares, count)];
}

/** Replace what a merchant generated before (anything the GM added by hand stays) with a fresh stock */
export async function restock(merchant, opts = {}) {
	if (!game.user.isGM) return;
	const docs = await buildStock(merchant, opts);
	const old = merchant.items.filter((i) => i.getFlag(MODULE_ID, 'generated')).map((i) => i.id);
	if (old.length) await merchant.deleteEmbeddedDocuments('Item', old);
	// what the GM stocked by hand is not offered a second time
	const handStocked = new Set(merchant.items.filter((i) => !i.getFlag(MODULE_ID, 'generated')).map((i) => `${i.type}|${i.name}`));
	const data = docs.filter((d) => !handStocked.has(`${d.type}|${d.name}`)).map((d) => {
		const o = game.items.fromCompendium ? game.items.fromCompendium(d) : d.toObject();
		o.flags ??= {};
		o.flags[MODULE_ID] = { generated: true };
		return o;
	});
	if (data.length) await merchant.createEmbeddedDocuments('Item', data);
	await merchant.setFlag(MODULE_ID, 'buyback', []);
	await merchant.unsetFlag(MODULE_ID, 'deals');
	ui.notifications.info(`${merchant.name}: ${data.length} items in stock (rare items up to ${rareCeiling(opts.level ?? config(merchant).level)} zenit).`);
}
