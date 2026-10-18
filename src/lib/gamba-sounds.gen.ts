// Сгенерировано scripts/sounds_sync.py gen из content/sounds.toml.
// Руками не править: правь манифест и перегенерируй.
// Фолбэк пулов: звучит, пока клиент не получил список из БД (docs/adr/0011).
export const GAMBA_SOUND_POOLS_FALLBACK = {
  spin: [
    'gamba-spin-sova.mp3',
    'gamba-spin-maknagens.mp3',
    'gamba-spin-toptop.mp3',
    'gamba-spin-sapogi.mp3',
    'gamba-spin-trtrtrtr.mp3',
    'gamba-spin-tutututu.mp3',
    'gamba-spin-kazu-tatata.mp3',
    'gamba-spin-tratatatata.mp3',
    'gamba-spin-maknaggetskue.mp3',
    'gamba-spin-otvinta.mp3',
    'gamba-spin-rgg-koleso.mp3',
    'gamba-spin-belaya-noch.mp3',
    'gamba-spin-tyapa-tyapa.mp3',
    'gamba-bg.mp3',
    'gamba-win-taktak.mp3',
    'gamba-spin-trrr-trrr.mp3',
  ],
  win: [
    'gamba-win1k.mp3',
    'gamba-win-ideal.mp3',
    'gamba-win-oooo.mp3',
    'gamba-win-pivo.mp3',
    'gamba-win-ya-lublu-pivo.mp3',
  ],
  jackpot: [
    'gamba-win100k.mp3',
    'gamba-super-vanna.mp3',
    'gamba-super-snow.mp3',
    'gamba-super-ebaaaat.mp3',
    'gamba-super-vnimanie-ay.mp3',
  ],
  lose: [
    'm4-scum.mp3',
    'gamba-lose-higan.mp3',
    'gamba-lose-pivka.mp3',
    'gamba-lose-proigrala-zhopu.mp3',
    'gamba-lose-dengi-na-pivo.mp3',
  ],
} as const;
