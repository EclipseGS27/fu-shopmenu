import { MODULE_ID, classLevel, clamp, num, partyCharacters, setting } from './util.mjs';
import { SHOP_TYPES, costOf } from './items.mjs';

/**
 * A merchant is a Project FU stash actor with "merchant" on. What it sells is the items on it. This module keeps
 * its shop settings in flags on that actor; Project FU's own `rates.item` (price multiplier) and
 * `rates.recharge` (zenit per Inventory Point) are used as they are.
 */

export const SHOP_KINDS = {
	general: 'General store',
	weapons: 'Weaponsmith',
	armor: 'Armorer',
	accessories: 'Jeweler / accessories',
	magic: 'Magic shop',
	alchemist: 'Alchemist (Inventory Points)',
	inn: 'Inn',
};

export const DEFAULTS = {
	kind: 'general',
	greeting: 'Welcome! Take a look around.',
	discount: 0, // % off everything, always
	sellRate: 50, // % of the list price the merchant pays
	buysTypes: 'all', // 'all' | 'same' (only what it sells)
	limited: false, // each stocked item can be sold once
	innPrice: 0, // per character, 0 = no inn
	ipRefill: true,
	negotiateDL: 10,
	level: 5,
	stockSize: 8, // rare items picked when restocking (basic items always come too)
	trackZenit: false, // the merchant pays from its own zenit when buying from players
	open: false, // players can open it from the scene controls
};

export function isMerchant(actor) {
	return actor?.type === 'stash' && !!actor.system?.merchant;
}

export function config(actor) {
	const f = actor?.getFlag?.(MODULE_ID, 'config') ?? {};
	const out = { ...DEFAULTS, ...f };
	out.discount = clamp(num(out.discount), 0, 90);
	out.sellRate = clamp(num(out.sellRate, 50), 0, 200);
	out.innPrice = Math.max(0, num(out.innPrice));
	out.negotiateDL = clamp(num(out.negotiateDL, 10), 1, 30);
	out.level = clamp(num(out.level, 5), 1, 60);
	out.stockSize = clamp(num(out.stockSize, 12), 1, 60);
	if (!SHOP_KINDS[out.kind]) out.kind = 'general';
	return out;
}

/** Items on the merchant that it sells */
export function stock(actor) {
	return (actor?.items?.contents ?? []).filter((i) => SHOP_TYPES.has(i.type)).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
}

/** What this buyer agreed with this merchant on this visit: % (negative = markup), set by a negotiation */
export function negotiated(merchant, buyer) {
	const n = merchant?.getFlag?.(MODULE_ID, 'deals')?.[buyer?.id];
	return n ? { pct: num(n.pct), result: n.result ?? '' } : null;
}

/** Discount for having a Merchant in the party (homebrew, world setting) */
export function merchantClassDiscount(buyer) {
	const pct = num(setting('merchantDiscount'));
	if (!pct) return 0;
	const has = [buyer, ...partyCharacters()].some((a) => a && classLevel(a, 'merchant') > 0);
	return has ? pct : 0;
}

/**
 * The price this buyer pays for an item, and why.
 * List price × the merchant's rate (Project FU `rates.item`), minus the shop discount, the Merchant class
 * discount and the negotiated deal (which can be a markup after a fumble).
 */
export function buyPrice(merchant, item, buyer) {
	const cfg = config(merchant);
	const list = costOf(item);
	const rate = num(merchant?.system?.rates?.item, 1);
	const parts = [];
	let pct = 0;
	if (cfg.discount) {
		pct += cfg.discount;
		parts.push(`shop −${cfg.discount}%`);
	}
	const mc = merchantClassDiscount(buyer);
	if (mc) {
		pct += mc;
		parts.push(`Merchant −${mc}%`);
	}
	const deal = negotiated(merchant, buyer);
	if (deal?.pct) {
		pct += deal.pct;
		parts.push(deal.pct > 0 ? `deal −${deal.pct}%` : `bad deal +${-deal.pct}%`);
	}
	pct = clamp(pct, -100, 90);
	const price = Math.max(0, Math.round(list * rate * (1 - pct / 100)));
	return { price, list, rate, pct, parts };
}

/** What the merchant pays for one of the player's items */
export function sellPrice(merchant, item) {
	const cfg = config(merchant);
	return Math.max(0, Math.floor((costOf(item) * cfg.sellRate) / 100));
}

/** Equipped gear (Project FU keeps the item ids in the actor's equipped slots) */
export function isEquipped(item) {
	const eq = item?.parent?.system?.equipped ?? {};
	return Object.values(eq).includes(item.id);
}

/** Whether this merchant buys this kind of item */
export function buysItem(merchant, item) {
	if (!SHOP_TYPES.has(item.type) || costOf(item) <= 0) return false;
	if (isEquipped(item)) return false;
	const cfg = config(merchant);
	if (cfg.buysTypes !== 'same') return true;
	return stock(merchant).some((s) => s.type === item.type);
}

/** Inventory Point refill: missing IP × the merchant's recharge rate */
export function refillCost(merchant, actor) {
	const ip = actor?.system?.resources?.ip;
	if (!ip) return { missing: 0, cost: 0, rate: 0 };
	const missing = Math.max(0, num(ip.max) - num(ip.value));
	const rate = num(merchant?.system?.rates?.recharge, 10);
	return { missing, rate, cost: missing * rate };
}

/** Items the merchant bought from players this visit, which they can buy back for the same price */
export function buyback(merchant) {
	return merchant?.getFlag?.(MODULE_ID, 'buyback') ?? [];
}
