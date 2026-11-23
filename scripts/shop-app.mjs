import { MODULE_ID, activeParty, esc, level, money, num, partyCharacters, shoppers, windsOfTrade, zenitOf } from './util.mjs';
import { CATEGORIES, canUseMartial, categoryOf, compare, costOf, quality, statsOf } from './items.mjs';
import { SHOP_KINDS, buyPrice, buyback, buysItem, config, isEquipped, negotiated, refillCost, sellPrice, stock } from './merchant.mjs';
import { HAGGLE_PAIRS, request } from './transactions.mjs';
import { sfx } from './sfx.mjs';

const { ApplicationV2 } = foundry.applications.api;

const TABS = [
	['buy', 'Buy'],
	['sell', 'Sell'],
	['buyback', 'Buy back'],
	['services', 'Services'],
];

const PAIR_LABEL = { insWlp: 'INS + WLP (persuade)', insIns: 'INS + INS (appraise)', wlpWlp: 'WLP + WLP (stand firm)', dexIns: 'DEX + INS (sleight of hand)', migWlp: 'MIG + WLP (intimidate)' };

/** One window per merchant per client */
const open = new Map();

export function openShop(merchant) {
	if (!merchant) return;
	let app = open.get(merchant.uuid);
	if (!app) {
		app = new ShopApp(merchant);
		open.set(merchant.uuid, app);
	}
	app.render({ force: true });
	app.bringToFront?.();
	return app;
}

export function rerenderShops(doc) {
	for (const app of open.values()) if (app.rendered && app.concerns(doc)) app.scheduleRender();
}

export class ShopApp extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		classes: ['fush-shop'],
		window: { title: 'Shop', icon: 'fa-solid fa-store', resizable: true },
		position: { width: 1020, height: 680 },
	};

	constructor(merchant, options = {}) {
		super(options);
		this.merchant = merchant;
		this.state = { tab: 'buy', cat: 'all', sel: null, buyer: null, payer: 'self', deliver: 'self', qty: 1, pair: 'insWlp', search: '', seller: null, inn: null };
		this._timer = null;
	}

	get title() {
		return this.merchant?.name ?? 'Shop';
	}

	/** Re-render when the merchant, the buyer or the party changes */
	concerns(doc) {
		const actor = doc?.documentName === 'Actor' ? doc : doc?.parent;
		if (!actor) return false;
		return actor === this.merchant || actor === this.buyer || actor === activeParty() || partyCharacters().includes(actor);
	}

	scheduleRender() {
		clearTimeout(this._timer);
		this._timer = setTimeout(() => this.render(), 60);
	}

	get buyer() {
		const list = shoppers();
		const want = list.find((a) => a.id === this.state.buyer);
		const def = list.find((a) => a.id === game.user.character?.id) ?? list[0] ?? null;
		return want ?? def;
	}

	async close(options) {
		open.delete(this.merchant.uuid);
		return super.close(options);
	}

	/* -------------------------------------------------------------- */
	/*  Render                                                         */
	/* -------------------------------------------------------------- */

	async _renderHTML() {
		const m = this.merchant;
		const cfg = config(m);
		const buyer = this.buyer;
		const st = this.state;
		const party = activeParty();
		const tabs = TABS.filter(([id]) => id !== 'services' || cfg.innPrice || cfg.ipRefill).map(([id, label]) => `<button type="button" class="tab ${st.tab === id ? 'on' : ''}" data-act="tab" data-id="${id}">${label}${id === 'buyback' && buyback(m).length ? ` <small>${buyback(m).length}</small>` : ''}</button>`);
		const buyerOpts = shoppers()
			.map((a) => `<option value="${a.id}" ${a === buyer ? 'selected' : ''}>${esc(a.name)}</option>`)
			.join('');
		const wot = windsOfTrade(buyer);
		const deal = negotiated(m, buyer);

		let body = '';
		if (!buyer) body = `<div class="empty">You have no character to shop with. Ask the GM to give you one, or to add yours to the active party.</div>`;
		else if (st.tab === 'buy') body = await this.#buyTab(buyer);
		else if (st.tab === 'sell') body = await this.#sellTab(buyer);
		else if (st.tab === 'buyback') body = this.#buybackTab(buyer);
		else body = this.#servicesTab(buyer);

		const div = document.createElement('div');
		div.className = 'fush-body';
		div.innerHTML = `
			<header class="fush-head">
				<img class="portrait" src="${esc(m.img)}" alt="">
				<div class="who">
					<div class="kicker">${esc(SHOP_KINDS[cfg.kind])}${cfg.discount ? ` · ${cfg.discount}% off today` : ''}</div>
					<div class="name">${esc(m.name)}</div>
					<div class="greet">“${esc(cfg.greeting)}”</div>
				</div>
				<div class="wallet">
					<label class="row">Shopping as <select data-act="buyer">${buyerOpts}</select></label>
					<div class="money"><span><small>${esc(buyer?.name ?? '')}</small><b>${money(zenitOf(buyer))}</b></span>${party ? `<span><small>Party</small><b>${money(zenitOf(party))}</b></span>` : ''}${wot ? `<span class="tp" data-tooltip="Winds of Trade"><small>Trade Points</small><b>${wot.current}/${wot.max}</b></span>` : ''}</div>
					<div class="toggles">
						${party ? `<span class="seg"><small>Pay with</small><button type="button" data-act="payer" data-id="self" class="${st.payer === 'self' ? 'on' : ''}">Own</button><button type="button" data-act="payer" data-id="party" class="${st.payer === 'party' ? 'on' : ''}">Party funds</button></span>
						<span class="seg"><small>Send to</small><button type="button" data-act="deliver" data-id="self" class="${st.deliver === 'self' ? 'on' : ''}">Bag</button><button type="button" data-act="deliver" data-id="party" class="${st.deliver === 'party' ? 'on' : ''}">Party stash</button></span>` : ''}
					</div>
				</div>
			</header>
			<nav class="fush-tabs">${tabs.join('')}<span class="sp"></span>
				${buyer ? `<span class="haggle">${deal ? `<em class="${deal.pct > 0 ? 'good' : deal.pct < 0 ? 'bad' : ''}">${esc(deal.result)}</em>` : `<select data-act="pair">${Object.keys(HAGGLE_PAIRS).map((k) => `<option value="${k}" ${st.pair === k ? 'selected' : ''}>${PAIR_LABEL[k]}</option>`).join('')}</select><button type="button" data-act="haggle" data-tooltip="Roll a Check against Difficulty ${cfg.negotiateDL}. Once per visit.">Haggle</button>`}</span>` : ''}
				${game.user.isGM ? `<button type="button" class="gm" data-act="setup" data-tooltip="Shop setup"><i class="fa-solid fa-gear"></i></button>` : ''}
			</nav>
			<section class="fush-main">${body}</section>`;
		return div;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
		this.#listen(content);
	}

	#catChips(items) {
		const counts = {};
		for (const i of items) counts[categoryOf(i)] = (counts[categoryOf(i)] ?? 0) + 1;
		const chips = [['all', 'All'], ...CATEGORIES.filter(([id]) => counts[id]).map(([id, label]) => [id, label])];
		return `<div class="chips">${chips.map(([id, label]) => `<button type="button" data-act="cat" data-id="${id}" class="${this.state.cat === id ? 'on' : ''}">${label}${id !== 'all' ? ` <small>${counts[id]}</small>` : ''}</button>`).join('')}<input type="search" data-act="search" placeholder="Search" value="${esc(this.state.search)}"></div>`;
	}

	#filter(items) {
		const q = this.state.search.trim().toLowerCase();
		return items.filter((i) => (this.state.cat === 'all' || categoryOf(i) === this.state.cat) && (!q || i.name.toLowerCase().includes(q)));
	}

	/** Better / worse / same than what the buyer has on, for the list */
	#verdict(buyer, item) {
		if (!['weapon', 'customWeapon', 'armor', 'shield', 'accessory'].includes(item.type)) return '';
		const c = compare(buyer, item);
		if (!c.current) return '<i class="vd new" data-tooltip="Nothing equipped there">NEW</i>';
		const score = c.rows.reduce((s, r) => s + Math.sign(r.diff) * (r.key === 'damage' ? 2 : 1), 0);
		if (score > 0) return '<i class="vd up" data-tooltip="Better than what you have equipped">▲</i>';
		if (score < 0) return '<i class="vd down" data-tooltip="Worse than what you have equipped">▼</i>';
		return '<i class="vd eq" data-tooltip="About the same as what you have equipped">=</i>';
	}

	async #detail(buyer, item, actions) {
		if (!item) return `<aside class="detail empty">Pick an item to see it here${this.state.tab === 'buy' ? ', compared with what you have equipped' : ''}.</aside>`;
		const s = statsOf(item);
		const q = quality(item);
		const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
		const desc = item.system?.description ? await TE.enrichHTML(item.system.description, { relativeTo: item }) : '';
		let cmp = '';
		if (['weapon', 'customWeapon', 'armor', 'shield', 'accessory'].includes(item.type) && this.state.tab !== 'sell') {
			const c = compare(buyer, item);
			const rows = c.rows.map((r) => `<tr><th>${r.label}</th><td>${r.now}</td><td class="arrow">→</td><td>${r.then}</td><td class="d ${r.diff > 0 ? 'up' : r.diff < 0 ? 'down' : ''}">${r.diff > 0 ? `+${r.diff}` : r.diff || '—'}</td></tr>`).join('');
			cmp = `<div class="cmp"><div class="cap">Compared with ${c.current ? `<b>${esc(c.current.name)}</b> (equipped)` : 'nothing equipped'}</div><table>${rows}</table>${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}${!canUseMartial(buyer, item) ? `<p class="warn">Martial: ${esc(buyer.name)} has no class that grants this kind of gear.</p>` : ''}</div>`;
		}
		return `<aside class="detail">
			<div class="top"><img src="${esc(item.img)}" alt=""><div><div class="nm">${esc(item.name)}</div><div class="ln">${esc(s.line)}</div>${q ? `<div class="q">${esc(q)}</div>` : ''}</div></div>
			${cmp}
			<div class="desc">${desc}</div>
			<div class="acts">${actions}</div>
		</aside>`;
	}

	async #buyTab(buyer) {
		const m = this.merchant;
		const cfg = config(m);
		const all = stock(m);
		if (!all.length) return `<div class="empty">${esc(m.name)} has nothing for sale right now.${game.user.isGM ? ' Open the setup (gear) to restock.' : ''}</div>`;
		const items = this.#filter(all);
		const payerZ = this.state.payer === 'party' ? zenitOf(activeParty()) : zenitOf(buyer);
		const rows = items
			.map((i) => {
				const p = buyPrice(m, i, buyer);
				const poor = p.price > payerZ;
				return `<button type="button" class="row ${this.state.sel === i.id ? 'on' : ''} ${poor ? 'poor' : ''}" data-act="sel" data-id="${i.id}"><img src="${esc(i.img)}" alt=""><span class="l">${esc(i.name)}</span>${this.#verdict(buyer, i)}<span class="p">${p.pct ? `<s>${money(p.list * p.rate)}</s>` : ''}${money(p.price)}</span></button>`;
			})
			.join('');
		const item = all.find((i) => i.id === this.state.sel);
		let actions = '';
		if (item) {
			const p = buyPrice(m, item, buyer);
			const wot = windsOfTrade(buyer);
			const canTrade = wot && wot.current >= 2 && costOf(item) <= level(buyer) * 30 && categoryOf(item) !== 'consumable';
			actions = `${p.parts.length ? `<div class="why">${money(p.list * p.rate)} · ${esc(p.parts.join(' · '))}</div>` : ''}
				${cfg.limited ? '' : `<label class="qty">Qty <input type="number" min="1" max="9" value="${this.state.qty}" data-act="qty"></label>`}
				<button type="button" class="cta" data-act="buy" data-id="${item.id}">Buy for ${money(p.price * (cfg.limited ? 1 : this.state.qty))}</button>
				${wot ? `<button type="button" class="cta alt" data-act="trade" data-id="${item.id}" ${canTrade ? '' : 'disabled'} data-tooltip="Winds of Trade: 2 Trade Points for a rare item worth up to ${money(level(buyer) * 30)}">2 Trade Points</button>` : ''}`;
		}
		return `<div class="list">${this.#catChips(all)}<div class="rows">${rows || '<div class="empty">Nothing matches.</div>'}</div></div>${await this.#detail(buyer, item, actions)}`;
	}

	/** The buyer's own items the merchant would buy, plus the party stash's */
	#sellables(buyer) {
		const party = activeParty();
		const from = [buyer, ...(party && party.isOwner ? [party] : [])];
		const out = [];
		for (const a of from) for (const i of a.items) if (buysItem(this.merchant, i) || (costOf(i) > 0 && isEquipped(i))) out.push(i);
		return out;
	}

	async #sellTab(buyer) {
		const m = this.merchant;
		const all = this.#sellables(buyer);
		if (!all.length) return `<div class="empty">Nothing ${esc(m.name)} would buy from ${esc(buyer.name)}.</div>`;
		const items = this.#filter(all);
		const rows = items
			.map((i) => {
				const eq = isEquipped(i);
				const stash = i.parent?.type === 'party';
				return `<button type="button" class="row ${this.state.sel === i.id ? 'on' : ''} ${eq ? 'poor' : ''}" data-act="sel" data-id="${i.id}"><img src="${esc(i.img)}" alt=""><span class="l">${esc(i.name)}${stash ? ' <small class="tag">stash</small>' : ''}${eq ? ' <small class="tag">equipped</small>' : ''}</span><span class="p">${money(sellPrice(m, i))}</span></button>`;
			})
			.join('');
		const item = all.find((i) => i.id === this.state.sel);
		let actions = '';
		if (item) {
			actions = isEquipped(item) ? `<div class="why">Unequip it first to sell it.</div>` : `<div class="why">${config(m).sellRate}% of ${money(costOf(item))}. You can buy it back for the same price before the shop restocks.</div><button type="button" class="cta" data-act="sell" data-id="${item.id}" data-owner="${item.parent.uuid}">Sell for ${money(sellPrice(m, item))}</button>`;
		}
		return `<div class="list">${this.#catChips(all)}<div class="rows">${rows || '<div class="empty">Nothing matches.</div>'}</div></div>${await this.#detail(buyer, item, actions)}`;
	}

	#buybackTab() {
		const list = buyback(this.merchant);
		if (!list.length) return `<div class="empty">Nothing to buy back. Items you sell here can be bought back for the price you got, until the shop restocks.</div>`;
		const rows = list
			.map((e, i) => `<div class="row static"><img src="${esc(e.data.img)}" alt=""><span class="l">${esc(e.data.name)} <small class="tag">sold by ${esc(e.seller)}</small></span><span class="p">${money(e.price)}</span><button type="button" class="cta sm" data-act="buyback" data-id="${i}">Buy back</button></div>`)
			.reverse()
			.join('');
		return `<div class="list wide"><div class="rows">${rows}</div></div>`;
	}

	#servicesTab(buyer) {
		const m = this.merchant;
		const cfg = config(m);
		const party = partyCharacters();
		let html = '';
		if (cfg.ipRefill) {
			const rows = party
				.filter((a) => a.isOwner || game.user.isGM)
				.map((a) => {
					const r = refillCost(m, a);
					const ip = a.system?.resources?.ip;
					return `<div class="row static"><img src="${esc(a.img)}" alt=""><span class="l">${esc(a.name)} <small class="tag">${num(ip?.value)} / ${num(ip?.max)} IP</small></span><span class="p">${r.missing ? money(r.cost) : 'full'}</span><button type="button" class="cta sm" data-act="refill" data-id="${a.uuid}" ${r.missing ? '' : 'disabled'}>Restock ${r.missing || ''} IP</button></div>`;
				})
				.join('');
			html += `<div class="svc"><h3>Restock supplies</h3><p class="note">Refill Inventory Points at ${money(num(m.system?.rates?.recharge, 10))} per point.</p><div class="rows">${rows}</div></div>`;
		}
		if (cfg.innPrice) {
			const picked = this.state.inn ?? party.map((a) => a.uuid);
			const rows = party.map((a) => `<label class="row static"><input type="checkbox" data-act="innPick" value="${a.uuid}" ${picked.includes(a.uuid) ? 'checked' : ''}><img src="${esc(a.img)}" alt=""><span class="l">${esc(a.name)} <small class="tag">HP ${num(a.system?.resources?.hp?.value)}/${num(a.system?.resources?.hp?.max)} · MP ${num(a.system?.resources?.mp?.value)}/${num(a.system?.resources?.mp?.max)}</small></span></label>`).join('');
			html += `<div class="svc"><h3>Stay the night</h3><p class="note">${money(cfg.innPrice)} per person. Everyone staying recovers all Hit Points and Mind Points (a rest, without Inventory Points).</p><div class="rows">${rows}</div><button type="button" class="cta" data-act="inn" ${picked.length ? '' : 'disabled'}>Rest for ${money(cfg.innPrice * picked.length)}</button></div>`;
		}
		return `<div class="list wide services">${html}</div>`;
	}

	/* -------------------------------------------------------------- */
	/*  Events                                                         */
	/* -------------------------------------------------------------- */

	#listen(root) {
		root.querySelectorAll('[data-act]').forEach((el) => {
			const act = el.dataset.act;
			if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) {
				el.addEventListener(act === 'search' ? 'input' : 'change', (ev) => this.#onChange(act, ev.currentTarget));
			} else if (el.tagName === 'INPUT') {
				el.addEventListener('change', (ev) => this.#onChange(act, ev.currentTarget));
			} else {
				el.addEventListener('click', (ev) => this.#onClick(act, ev.currentTarget));
				if (act === 'sel') el.addEventListener('mouseenter', () => sfx('cursor'));
			}
		});
	}

	#onChange(act, el) {
		const st = this.state;
		switch (act) {
			case 'buyer':
				st.buyer = el.value;
				return this.render();
			case 'pair':
				st.pair = el.value;
				return;
			case 'qty':
				st.qty = Math.max(1, Math.min(9, num(el.value, 1)));
				return this.render();
			case 'search':
				st.search = el.value;
				clearTimeout(this._search);
				this._search = setTimeout(() => this.render().then(() => this.element?.querySelector('input[type=search]')?.focus()), 200);
				return;
			case 'innPick': {
				const all = partyCharacters().map((a) => a.uuid);
				const cur = new Set(st.inn ?? all);
				if (el.checked) cur.add(el.value);
				else cur.delete(el.value);
				st.inn = [...cur];
				return this.render();
			}
		}
	}

	async #run(op, payload) {
		const res = await request(op, { merchant: this.merchant.uuid, ...payload });
		if (res?.ok) {
			sfx(res.cue ?? 'confirm');
			ui.notifications.info(res.message);
		} else {
			sfx('error');
			ui.notifications.warn(res?.message ?? 'That did not work.');
		}
		this.render();
		return res;
	}

	async #onClick(act, el) {
		const st = this.state;
		const buyer = this.buyer;
		const base = { buyer: buyer?.uuid, payer: st.payer, deliver: st.deliver };
		switch (act) {
			case 'tab':
				sfx('confirm');
				st.tab = el.dataset.id;
				st.sel = null;
				st.cat = 'all';
				return this.render();
			case 'cat':
				st.cat = el.dataset.id;
				return this.render();
			case 'sel':
				sfx('confirm');
				st.sel = el.dataset.id;
				st.qty = 1;
				return this.render();
			case 'payer':
			case 'deliver':
				st[act] = el.dataset.id;
				return this.render();
			case 'buy':
				return this.#run('buy', { ...base, item: el.dataset.id, qty: st.qty });
			case 'trade':
				return this.#run('trade', { ...base, item: el.dataset.id });
			case 'sell': {
				const owner = await fromUuid(el.dataset.owner);
				const item = owner?.items.get(el.dataset.id);
				if (!item) return;
				const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: 'Sell' }, content: `<p>Sell <b>${esc(item.name)}</b> for <b>${money(sellPrice(this.merchant, item))}</b>?</p>`, rejectClose: false });
				if (!ok) return;
				st.sel = null;
				return this.#run('sell', { seller: owner.uuid, item: item.id });
			}
			case 'buyback':
				return this.#run('buyback', { ...base, index: num(el.dataset.id) });
			case 'refill':
				return this.#run('refill', { actor: el.dataset.id, payer: st.payer });
			case 'inn':
				return this.#run('inn', { actors: st.inn ?? partyCharacters().map((a) => a.uuid), payer: st.payer, payerActor: buyer?.uuid });
			case 'haggle':
				return this.#run('deal', { buyer: buyer?.uuid, pair: st.pair });
			case 'setup': {
				const { ShopSetup } = await import('./setup.mjs');
				return new ShopSetup(this.merchant).render({ force: true });
			}
		}
	}
}
