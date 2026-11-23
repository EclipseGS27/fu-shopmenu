import { MODULE_ID, SOCKET, esc, level, num, partyCharacters } from './util.mjs';
import { DEFAULTS, SHOP_KINDS, config } from './merchant.mjs';
import { rareCeiling, restock } from './generate.mjs';

const { ApplicationV2 } = foundry.applications.api;

/** GM window: how this merchant trades, its stock, and opening it to the players */
export class ShopSetup extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		tag: 'form',
		classes: ['fush-setup'],
		window: { title: 'Shop setup', icon: 'fa-solid fa-gear', resizable: true },
		position: { width: 560, height: 'auto' },
		form: { handler: ShopSetup.#onSubmit, closeOnSubmit: false, submitOnChange: false },
		actions: { restock: ShopSetup.#onRestock, partyLevel: ShopSetup.#onPartyLevel, openPlayers: ShopSetup.#onOpenPlayers, newVisit: ShopSetup.#onNewVisit },
	};

	constructor(merchant, options = {}) {
		super(options);
		this.merchant = merchant;
	}

	get title() {
		return `Shop setup: ${this.merchant.name}`;
	}

	async _renderHTML() {
		const m = this.merchant;
		const c = config(m);
		const opt = (map, sel) => Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
		const div = document.createElement('div');
		div.className = 'fush-setup-body';
		div.innerHTML = `
			<p class="note">${esc(m.name)} sells the items on its actor. Project FU's own <b>price rate</b> (${Math.round(num(m.system?.rates?.item, 1) * 100)}%) and <b>IP recharge</b> (${num(m.system?.rates?.recharge, 10)} per point) are set on the merchant's sheet.</p>
			<fieldset><legend>Shop</legend>
				<label>Kind <select name="kind">${opt(SHOP_KINDS, c.kind)}</select></label>
				<label>Greeting <input type="text" name="greeting" value="${esc(c.greeting)}"></label>
				<label class="chk"><input type="checkbox" name="open" ${c.open ? 'checked' : ''}> Open: players can visit from the Shops button</label>
			</fieldset>
			<fieldset><legend>Prices</legend>
				<label>Discount for everyone (%) <input type="number" name="discount" min="0" max="90" value="${c.discount}"></label>
				<label>Pays for players' items (% of list price) <input type="number" name="sellRate" min="0" max="200" value="${c.sellRate}"></label>
				<label>Buys <select name="buysTypes">${opt({ all: 'Anything with a price', same: 'Only the kinds of items it sells' }, c.buysTypes)}</select></label>
				<label>Haggling Difficulty <input type="number" name="negotiateDL" min="1" max="30" value="${c.negotiateDL}"></label>
				<label class="chk"><input type="checkbox" name="trackZenit" ${c.trackZenit ? 'checked' : ''}> Uses its own zenit (can run out of money when buying)</label>
			</fieldset>
			<fieldset><legend>Services</legend>
				<label class="chk"><input type="checkbox" name="ipRefill" ${c.ipRefill ? 'checked' : ''}> Restocks Inventory Points</label>
				<label>Inn, price per person (0 = no rooms) <input type="number" name="innPrice" min="0" value="${c.innPrice}"></label>
			</fieldset>
			<fieldset><legend>Stock</legend>
				<label class="chk"><input type="checkbox" name="limited" ${c.limited ? 'checked' : ''}> Limited: each item sells once</label>
				<label>Level <span class="inl"><input type="number" name="level" min="1" max="60" value="${c.level}"><button type="button" data-action="partyLevel">Party level</button></span></label>
				<label>Rare items to stock <input type="number" name="stockSize" min="1" max="60" value="${c.stockSize}"></label>
				<p class="note">Restock replaces what was generated before (items you added by hand stay): every basic item this kind of shop deals in, plus rare items up to <b>${rareCeiling(c.level)} zenit</b> at level ${c.level}. It also clears buy-backs and haggling.</p>
			</fieldset>
			<div class="foot">
				<button type="button" data-action="restock"><i class="fa-solid fa-boxes-stacked"></i> Restock</button>
				<button type="button" data-action="newVisit" data-tooltip="Clear haggling and buy-backs without changing the stock"><i class="fa-solid fa-door-open"></i> New visit</button>
				<button type="button" data-action="openPlayers"><i class="fa-solid fa-users"></i> Open for players</button>
				<span class="sp"></span>
				<button type="submit" class="gold"><i class="fa-solid fa-floppy-disk"></i> Save</button>
			</div>`;
		return div;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
	}

	#read() {
		const fd = new foundry.applications.ux.FormDataExtended(this.element);
		return ShopSetup.#clean(fd.object);
	}

	static #clean(o) {
		const out = {};
		for (const k of Object.keys(DEFAULTS)) {
			if (typeof DEFAULTS[k] === 'boolean') out[k] = !!o[k];
			else if (typeof DEFAULTS[k] === 'number') out[k] = num(o[k], DEFAULTS[k]);
			else out[k] = String(o[k] ?? DEFAULTS[k]);
		}
		return out;
	}

	static async #onSubmit(event, form, formData) {
		await this.merchant.setFlag(MODULE_ID, 'config', ShopSetup.#clean(formData.object));
		ui.notifications.info(`${this.merchant.name}: saved.`);
		this.render();
	}

	static async #onRestock() {
		const cfg = this.#read();
		await this.merchant.setFlag(MODULE_ID, 'config', cfg);
		await restock(this.merchant, { level: cfg.level, size: cfg.stockSize });
		this.render();
	}

	static async #onPartyLevel() {
		const chars = partyCharacters();
		if (!chars.length) return ui.notifications.warn('No party characters found.');
		const avg = Math.round(chars.reduce((s, a) => s + level(a), 0) / chars.length);
		const input = this.element.querySelector('input[name=level]');
		if (input) input.value = avg;
	}

	static async #onNewVisit() {
		await this.merchant.setFlag(MODULE_ID, 'buyback', []);
		await this.merchant.unsetFlag(MODULE_ID, 'deals');
		ui.notifications.info(`${this.merchant.name}: haggling and buy-backs cleared.`);
	}

	/** Open the shop window for every player (and let them see the merchant) */
	static async #onOpenPlayers() {
		const cfg = this.#read();
		cfg.open = true;
		await this.merchant.setFlag(MODULE_ID, 'config', cfg);
		game.socket.emit(SOCKET, { type: 'open', merchant: this.merchant.uuid });
		ui.notifications.info(`${this.merchant.name} is open for the players.`);
		this.render();
	}
}
