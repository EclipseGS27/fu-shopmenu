import { MODULE_ID, SOCKET, activeParty, esc, level, money, num, postChat, windsOfTrade, zenitOf } from './util.mjs';
import { categoryOf, cloneData, costOf } from './items.mjs';
import { buyPrice, buyback, buysItem, config, isEquipped, isMerchant, refillCost, sellPrice } from './merchant.mjs';

/**
 * Every purchase, sale, refill and inn stay runs on the GM's client, which can change the merchant, the party and
 * every character. Players send a request over the socket and wait for the answer. Prices are worked out again
 * on the GM's side, so a player's window can never set its own price.
 */

const pending = new Map();
let seq = 0;

/** Run a shop operation: directly as the GM, otherwise through the active GM */
export async function request(op, payload) {
	if (game.user.isGM) return execute(op, payload, game.user.id);
	if (!game.users.activeGM) return { ok: false, message: 'The GM needs to be online to trade.' };
	const reqId = `${game.user.id}.${++seq}`;
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(reqId);
			resolve({ ok: false, message: 'The GM did not answer. Try again.' });
		}, 15000);
		pending.set(reqId, (res) => {
			clearTimeout(timer);
			resolve(res);
		});
		game.socket.emit(SOCKET, { type: 'tx', op, payload, reqId, userId: game.user.id });
	});
}

export function onSocket(msg) {
	if (msg?.type === 'tx' && game.users.activeGM?.isSelf) {
		execute(msg.op, msg.payload, msg.userId).then((res) => game.socket.emit(SOCKET, { type: 'txResult', reqId: msg.reqId, userId: msg.userId, res }));
	} else if (msg?.type === 'txResult' && msg.userId === game.user.id) {
		pending.get(msg.reqId)?.(msg.res);
		pending.delete(msg.reqId);
	}
}

/* ------------------------------------------------------------------ */

const fail = (message) => ({ ok: false, message });

async function execute(op, p, userId) {
	try {
		const user = game.users.get(userId);
		const merchant = p?.merchant ? await fromUuid(p.merchant) : null;
		if (!isMerchant(merchant)) return fail('That merchant is gone.');
		if (!user?.isGM && !config(merchant).open && !merchant.testUserPermission(user, 'OBSERVER')) return fail('This shop is closed.');
		const fn = OPS[op];
		if (!fn) return fail(`Unknown shop action "${op}".`);
		return await fn(merchant, p, user);
	} catch (err) {
		console.error(`${MODULE_ID} | ${op}`, err);
		return fail(err.message ?? String(err));
	}
}

async function actorFor(uuid, user, what = 'character') {
	const a = uuid ? await fromUuid(uuid) : null;
	if (!a) throw new Error(`No ${what} chosen.`);
	if (!user.isGM && !a.testUserPermission(user, 'OWNER')) throw new Error(`You don't control ${a.name}.`);
	return a;
}

/** Whose zenit pays: the character's own, or the party's */
async function payerFor(p, buyer) {
	if (p.payer === 'party') {
		const party = activeParty();
		if (!party) throw new Error('There is no active party to pay from.');
		return party;
	}
	return buyer;
}

async function receiverFor(p, buyer) {
	if (p.deliver === 'party') {
		const party = activeParty();
		if (!party) throw new Error('There is no active party stash.');
		return party;
	}
	return buyer;
}

async function addZenit(actor, n) {
	if (!n) return;
	await actor.update({ 'system.resources.zenit.value': Math.max(0, zenitOf(actor) + n) });
}

async function pay(payer, merchant, price) {
	if (zenitOf(payer) < price) throw new Error(`${payer.name} has ${money(zenitOf(payer))}, ${money(price)} needed.`);
	await addZenit(payer, -price);
	if (config(merchant).trackZenit) await addZenit(merchant, price);
}

const speaker = (actor) => ChatMessage.getSpeaker({ actor });

const OPS = {
	async buy(merchant, p, user) {
		const buyer = await actorFor(p.buyer, user);
		const item = merchant.items.get(p.item);
		if (!item) return fail('That item is no longer for sale.');
		const qty = Math.max(1, Math.min(9, num(p.qty, 1)));
		if (config(merchant).limited && qty > 1) return fail('There is only one of those.');
		const { price } = buyPrice(merchant, item, buyer);
		const total = price * qty;
		const payer = await payerFor(p, buyer);
		const to = await receiverFor(p, buyer);
		await pay(payer, merchant, total);
		const data = Array.from({ length: qty }, () => {
			const d = cloneData(item);
			if (d.flags?.[MODULE_ID]) delete d.flags[MODULE_ID];
			return d;
		});
		await to.createEmbeddedDocuments('Item', data);
		if (config(merchant).limited) await item.delete();
		await postChat(`<p><b>${esc(buyer.name)}</b> buys <b>${esc(item.name)}</b>${qty > 1 ? ` ×${qty}` : ''} from ${esc(merchant.name)} for <b>${money(total)}</b>${payer !== buyer ? ` (party funds)` : ''}${to !== buyer ? `, sent to the party stash` : ''}.</p>`, speaker(buyer));
		return { ok: true, message: `Bought ${item.name}${qty > 1 ? ` ×${qty}` : ''} for ${money(total)}.`, cue: 'buy' };
	},

	async sell(merchant, p, user) {
		const seller = await actorFor(p.seller, user);
		const item = seller.items.get(p.item);
		if (!item) return fail('That item is gone.');
		if (isEquipped(item)) return fail(`Unequip ${item.name} first.`);
		if (!buysItem(merchant, item)) return fail(`${merchant.name} doesn't buy that.`);
		const price = sellPrice(merchant, item);
		if (config(merchant).trackZenit && zenitOf(merchant) < price) return fail(`${merchant.name} can't afford it (${money(zenitOf(merchant))} on hand).`);
		const data = cloneData(item);
		await item.delete();
		await addZenit(seller, price);
		if (config(merchant).trackZenit) await addZenit(merchant, -price);
		const list = buyback(merchant).slice(-19);
		list.push({ data, price, seller: seller.name, sellerId: seller.id, at: Date.now() });
		await merchant.setFlag(MODULE_ID, 'buyback', list);
		await postChat(`<p><b>${esc(seller.name)}</b> sells <b>${esc(item.name)}</b> to ${esc(merchant.name)} for <b>${money(price)}</b>.</p>`, speaker(seller));
		return { ok: true, message: `Sold ${item.name} for ${money(price)}.`, cue: 'sell' };
	},

	async buyback(merchant, p, user) {
		const buyer = await actorFor(p.buyer, user);
		const list = buyback(merchant);
		const i = num(p.index, -1);
		const entry = list[i];
		if (!entry) return fail('That item was already bought back.');
		const payer = await payerFor(p, buyer);
		const to = await receiverFor(p, buyer);
		await pay(payer, merchant, entry.price);
		await to.createEmbeddedDocuments('Item', [entry.data]);
		list.splice(i, 1);
		await merchant.setFlag(MODULE_ID, 'buyback', list);
		await postChat(`<p><b>${esc(buyer.name)}</b> buys back <b>${esc(entry.data.name)}</b> for <b>${money(entry.price)}</b>.</p>`, speaker(buyer));
		return { ok: true, message: `Bought back ${entry.data.name}.`, cue: 'buy' };
	},

	async refill(merchant, p, user) {
		if (!config(merchant).ipRefill) return fail(`${merchant.name} doesn't restock supplies.`);
		const actor = await actorFor(p.actor, user);
		const { missing, cost } = refillCost(merchant, actor);
		if (!missing) return fail(`${actor.name}'s Inventory Points are full.`);
		const payer = await payerFor(p, actor);
		await pay(payer, merchant, cost);
		await actor.update({ 'system.resources.ip.value': num(actor.system.resources.ip.max) });
		await postChat(`<p><b>${esc(actor.name)}</b> restocks <b>${missing} Inventory Points</b> for <b>${money(cost)}</b>.</p>`, speaker(actor));
		return { ok: true, message: `${actor.name}: +${missing} IP for ${money(cost)}.`, cue: 'buy' };
	},

	async inn(merchant, p, user) {
		const cfg = config(merchant);
		if (!cfg.innPrice) return fail(`${merchant.name} has no rooms.`);
		const actors = [];
		for (const u of p.actors ?? []) {
			const a = await fromUuid(u);
			if (a) actors.push(a);
		}
		if (!actors.length) return fail('Nobody chosen to stay.');
		const payerChar = await actorFor(p.payerActor ?? p.actors[0], user);
		const payer = await payerFor(p, payerChar);
		const cost = cfg.innPrice * actors.length;
		await pay(payer, merchant, cost);
		for (const a of actors) {
			if (typeof a.rest === 'function') await a.rest(false);
			else await a.update({ 'system.resources.hp.value': a.system.resources.hp.max, 'system.resources.mp.value': a.system.resources.mp.max });
		}
		await postChat(`<p>${actors.map((a) => `<b>${esc(a.name)}</b>`).join(', ')} rest at ${esc(merchant.name)} (<b>${money(cost)}</b>${payer.type === 'party' ? ', party funds' : ''}): Hit Points and Mind Points fully restored.</p>`, speaker(payerChar));
		return { ok: true, message: `Rested for ${money(cost)}.`, cue: 'rest' };
	},

	/** Merchant class, Winds of Trade: 2 Trade Points for a rare item worth up to level × 30 zenit */
	async trade(merchant, p, user) {
		const buyer = await actorFor(p.buyer, user);
		const wot = windsOfTrade(buyer);
		if (!wot) return fail(`${buyer.name} doesn't have Winds of Trade.`);
		if (wot.current < 2) return fail(`${buyer.name} has ${wot.current} Trade Points, 2 needed.`);
		const item = merchant.items.get(p.item);
		if (!item) return fail('That item is no longer for sale.');
		const cap = level(buyer) * 30;
		if (costOf(item) > cap) return fail(`${item.name} is worth more than ${money(cap)} (level × 30).`);
		if (categoryOf(item) === 'consumable') return fail('Winds of Trade makes materials and rare items, not consumables.');
		const to = await receiverFor(p, buyer);
		await wot.item.update({ 'system.rp.current': wot.current - 2 });
		await to.createEmbeddedDocuments('Item', [cloneData(item)]);
		if (config(merchant).limited) await item.delete();
		await postChat(`<p><b>${esc(buyer.name)}</b> spends <b>2 Trade Points</b> (Winds of Trade) and comes away with <b>${esc(item.name)}</b>.</p>`, speaker(buyer));
		return { ok: true, message: `${item.name} for 2 Trade Points.`, cue: 'buy' };
	},

	/**
	 * Haggle: a Check with two of the buyer's Attributes against the merchant's Difficulty, rolled here so the
	 * result can't be made up. Success: 10% off (15% with 5 over the Difficulty). Critical: 20% off.
	 * Failure: no deal. Fumble: 10% markup. Once per buyer per visit (the GM's restock or "New visit" clears it).
	 */
	async deal(merchant, p, user) {
		const buyer = await actorFor(p.buyer, user);
		const deals = foundry.utils.deepClone(merchant.getFlag(MODULE_ID, 'deals') ?? {});
		if (deals[buyer.id] && !user.isGM) return fail(`${buyer.name} already haggled here.`);
		const [a, b] = HAGGLE_PAIRS[p.pair] ?? HAGGLE_PAIRS.insWlp;
		const die = (k) => Math.max(6, num(buyer.system?.attributes?.[k]?.current, 8));
		const roll = await new Roll(`1d${die(a)} + 1d${die(b)}`).evaluate();
		const [d1, d2] = roll.dice.map((d) => d.total);
		const dl = config(merchant).negotiateDL;
		const crit = d1 === d2 && d1 >= 6;
		const fumble = d1 === 1 && d2 === 1;
		let pct = 0;
		let result = 'No deal';
		if (fumble) [pct, result] = [-10, 'Fumble: the merchant takes offense (+10%)'];
		else if (crit) [pct, result] = [20, 'Critical: 20% off'];
		else if (roll.total >= dl + 5) [pct, result] = [15, '15% off'];
		else if (roll.total >= dl) [pct, result] = [10, '10% off'];
		deals[buyer.id] = { pct, result };
		await merchant.setFlag(MODULE_ID, 'deals', deals);
		await roll.toMessage({ speaker: speaker(buyer), flavor: `<b>Haggling with ${esc(merchant.name)}</b> 【${a.toUpperCase()} + ${b.toUpperCase()}】 vs Difficulty ${dl}: ${esc(result)}` });
		return { ok: true, message: `${buyer.name}: ${result}.`, cue: pct > 0 ? 'buy' : 'error' };
	},
};

export const HAGGLE_PAIRS = {
	insWlp: ['ins', 'wlp'],
	insIns: ['ins', 'ins'],
	wlpWlp: ['wlp', 'wlp'],
	dexIns: ['dex', 'ins'],
	migWlp: ['mig', 'wlp'],
};
