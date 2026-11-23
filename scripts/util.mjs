export const MODULE_ID = 'fu-shopmenu';
export const SOCKET = `module.${MODULE_ID}`;
export const SYSTEM = 'projectfu';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const num = (v, d = 0) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : d;
};
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const setting = (key) => {
	try {
		return game.settings.get(MODULE_ID, key);
	} catch {
		return undefined;
	}
};

/** Project FU lets the world rename its currency */
export function currency() {
	try {
		const key = game.settings.get(SYSTEM, 'optionRenameCurrency') || 'FU.Zenit';
		return game.i18n.localize(key);
	} catch {
		return 'Zenit';
	}
}
export const money = (n) => `${Math.round(num(n)).toLocaleString()} ${currency()}`;

export const zenitOf = (actor) => num(actor?.system?.resources?.zenit?.value);

/** The world's active Party actor (Project FU setting), if any */
export function activeParty() {
	try {
		const id = game.settings.get(SYSTEM, 'activeParty');
		const p = id ? game.actors.get(id) : null;
		if (p) return p;
	} catch {
		/* older system */
	}
	return game.actors.find((a) => a.type === 'party') ?? null;
}

/** The Player Characters in the active party (falls back to every character with a player owner) */
export function partyCharacters() {
	const party = activeParty();
	const ids = party?.system?.characters ?? [];
	const out = [];
	for (const id of ids) {
		const a = fromUuidSync?.(id) ?? game.actors.get(id);
		if (a) out.push(a);
	}
	if (out.length) return out;
	return game.actors.filter((a) => a.type === 'character' && a.hasPlayerOwner);
}

/** Characters this user may shop as: owned ones, or all party characters for the GM */
export function shoppers() {
	const list = partyCharacters();
	return game.user.isGM ? list : list.filter((a) => a.isOwner);
}

export function level(actor) {
	return num(actor?.system?.level?.value, 1);
}

/** A class item of this kind on the actor (Project FU class fuid, e.g. "merchant") */
export function classLevel(actor, fuid) {
	const c = (actor?.items?.contents ?? []).find((i) => i.type === 'class' && (i.system?.fuid === fuid || i.name.toLowerCase() === fuid));
	return c ? num(c.system?.level?.value, 1) : 0;
}

/** The Merchant's Winds of Trade skill, which holds the Trade Points */
export function windsOfTrade(actor) {
	const s = (actor?.items?.contents ?? []).find((i) => i.type === 'skill' && i.system?.fuid === 'winds-of-trade');
	if (!s) return null;
	return { item: s, current: num(s.system?.rp?.current), max: num(s.system?.rp?.max), sl: num(s.system?.level?.value, 1) };
}

export function postChat(html, speaker) {
	return ChatMessage.create({ speaker: speaker ?? ChatMessage.getSpeaker(), content: `<div class="fush-chat">${html}</div>` });
}
