import { MODULE_ID, SOCKET, esc } from './util.mjs';
import { config, isMerchant } from './merchant.mjs';
import { onSocket } from './transactions.mjs';
import { openShop, rerenderShops } from './shop-app.mjs';
import { ShopSetup } from './setup.mjs';
import { restock } from './generate.mjs';

/** Merchants the players may visit right now */
export const openMerchants = () => game.actors.filter((a) => isMerchant(a) && (game.user.isGM || config(a).open));

async function pickShop() {
	const list = openMerchants();
	if (!list.length) return ui.notifications.info(game.user.isGM ? 'No merchants yet: make a Stash actor, tick Merchant on its sheet, then use Open shop.' : 'No shop is open right now.');
	if (list.length === 1) return openShop(list[0]);
	const D = foundry.applications.api.DialogV2;
	const id = await D.wait({
		window: { title: 'Shops', icon: 'fa-solid fa-store' },
		content: `<p>Where to?</p>`,
		buttons: list.map((a, i) => ({ action: a.id, label: esc(a.name), default: i === 0 })),
		rejectClose: false,
		classes: ['fush-dialog'],
	});
	const m = id ? game.actors.get(id) : null;
	if (m) openShop(m);
}

Hooks.once('init', () => {
	const reg = (key, data) => game.settings.register(MODULE_ID, key, { config: true, ...data });
	reg('merchantDiscount', { name: 'Merchant in the party: discount (%)', hint: 'Homebrew. When the buyer or anyone in the active party has the Merchant class, shop prices drop by this much. 0 turns it off.', scope: 'world', type: Number, range: { min: 0, max: 50, step: 5 }, default: 10 });
	reg('rarePerLevel', { name: 'Rare item price per level', hint: 'Restocking offers rare items costing up to 300 + level × this. 60 gives 600 zenit at level 5, 1500 at level 20.', scope: 'world', type: Number, range: { min: 20, max: 200, step: 10 }, default: 60 });
	reg('sounds', { name: 'Shop sounds', hint: 'Menu sounds in the shop (needs Fabula Ultima Battle UI, which has the sounds).', scope: 'client', type: Boolean, default: true });

	game.modules.get(MODULE_ID).api = { openShop, pickShop, restock, setup: (m) => new ShopSetup(m).render({ force: true }), openMerchants };
});

Hooks.once('ready', () => {
	if (game.system.id !== 'projectfu') return ui.notifications.warn('Fabula Ultima Shop & Economy needs the Project FU system.');
	game.socket.on(SOCKET, (msg) => {
		if (msg?.type === 'open') {
			if (game.user.isGM) return;
			fromUuid(msg.merchant).then((m) => m && openShop(m));
			return;
		}
		onSocket(msg);
	});
});

/* Keep open shop windows current */
for (const h of ['updateActor', 'createItem', 'updateItem', 'deleteItem']) Hooks.on(h, (doc) => rerenderShops(doc));
Hooks.on('updateSetting', (s) => {
	if (s.key === 'projectfu.optionActiveParty') for (const a of game.actors.filter(isMerchant)) rerenderShops(a);
});

/* "Shops" button in the token controls, for everyone */
Hooks.on('getSceneControlButtons', (controls) => {
	try {
		const tokens = controls.tokens ?? controls.token;
		if (tokens?.tools && !Array.isArray(tokens.tools)) {
			tokens.tools.fushShops = { name: 'fushShops', title: 'Shops', icon: 'fa-solid fa-store', button: true, order: 60, visible: true, onChange: () => pickShop() };
		}
	} catch (err) {
		console.warn(`${MODULE_ID} | scene control`, err);
	}
});

/* "Open shop" and "Shop setup" on a merchant's sheet header */
Hooks.on('getHeaderControlsApplicationV2', (app, controls) => {
	const actor = app.document ?? app.actor;
	if (!isMerchant(actor)) return;
	controls.unshift({ icon: 'fa-solid fa-store', label: 'Open shop', action: 'fushOpen', onClick: () => openShop(actor) });
	if (game.user.isGM) controls.unshift({ icon: 'fa-solid fa-gear', label: 'Shop setup', action: 'fushSetup', onClick: () => new ShopSetup(actor).render({ force: true }) });
});

/* older (Application v1) sheets */
Hooks.on('getActorSheetHeaderButtons', (app, buttons) => {
	const actor = app.actor;
	if (!isMerchant(actor)) return;
	buttons.unshift({ class: 'fush-open', icon: 'fa-solid fa-store', label: 'Open shop', onclick: () => openShop(actor) });
	if (game.user.isGM) buttons.unshift({ class: 'fush-setup', icon: 'fa-solid fa-gear', label: 'Shop setup', onclick: () => new ShopSetup(actor).render({ force: true }) });
});

/* Right-click a merchant in the Actors sidebar */
Hooks.on('getActorContextOptions', (app, options) => {
	options.push({
		name: 'Open shop',
		icon: '<i class="fa-solid fa-store"></i>',
		condition: (li) => isMerchant(game.actors.get(li.dataset?.entryId ?? li.data?.('entryId'))),
		callback: (li) => openShop(game.actors.get(li.dataset?.entryId ?? li.data?.('entryId'))),
	});
});
