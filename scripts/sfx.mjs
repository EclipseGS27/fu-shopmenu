import { setting } from './util.mjs';

/**
 * Menu sounds. This module ships none of its own: with Fabula Ultima Battle UI active it plays that module's
 * menu sounds (the pack each player picked there), otherwise it stays silent.
 */
const CUE = { cursor: 'cursor', confirm: 'confirm', back: 'back', error: 'error', buy: 'chime', sell: 'chime', rest: 'fanfare' };
let last = 0;

export function sfx(cue) {
	if (setting('sounds') === false) return;
	const bui = game.modules.get('fu-battle-ui');
	if (!bui?.active) return;
	let pack = 'ff13';
	try {
		pack = game.settings.get('fu-battle-ui', 'sfxPack');
	} catch {
		/* older Battle UI */
	}
	if (!['ff13', 'ff7'].includes(pack)) return;
	const name = CUE[cue] ?? 'confirm';
	// the cursor plays on every row the mouse crosses: keep it from stacking up
	if (name === 'cursor') {
		if (performance.now() - last < 60) return;
		last = performance.now();
	}
	const src = `modules/fu-battle-ui/sounds/${pack}/${name}.ogg`;
	try {
		foundry.audio.AudioHelper.play({ src, volume: 0.5, autoplay: true, loop: false, channel: 'interface' }, false);
	} catch {
		/* no audio */
	}
}
