// Эмоуты канала (тикет 16): alysqueCLAP + маппинг lot.id → 7TV-эмоут.
// data/lots.json НЕ трогаем — маппинг живёт здесь.

export const ALYSQUE_CLAP_LIGHT =
  'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1075070639054e5d8cacb8a0ef4872d7/default/light/3.0';
export const ALYSQUE_CLAP_DARK =
  'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1075070639054e5d8cacb8a0ef4872d7/default/dark/3.0';

const cdn = (id: string): string => `https://cdn.7tv.app/emote/${id}/2x.webp`;

/** 7TV ID хлопалок канала. */
export const POG_CLAP_ID = '01F6NJQCBG000898NRWSAVVV08';
export const CAT_CLAP_ID = '01H9D5QNVR0005XNK7Z4N9D90F';

/** lot.id → { src, name } для карточек. ID проверены 2026-09-04 через 7TV API сета канала. */
export const LOT_EMOTES: Record<string, { src: string; name: string }> = {
  'lot-gedo-sleepy': { src: cdn('01F640EPQG0003B9G1Z40HFHWQ'), name: 'peepoSleep' },
  'lot-gedo-uvernulya': { src: cdn('01F6SEPX9G00074VGGPSJ3VHJF'), name: 'peepoWeirdLeave' },
  'lot-gedo-flat': { src: cdn('01F8N4K8XR0005WVNRT1191P1R'), name: 'peepoRich' },
  'lot-evil-friendship': { src: cdn('01F6Q0MMYR0005CV1Y3Z4ZYH04'), name: 'peepoFriendship' },
  'lot-cool-holst': { src: cdn('01H32XFQTR000BXX005J6Z48FN'), name: 'Pivo' },
  'lot-gribo-calendar': { src: cdn('01F6MFEK8G0000WDA7ERTDTR9R'), name: 'GoodMorning' },
  'lot-vandal-privet': { src: cdn('01GKC231ZR0007N0FY4NB609ZK'), name: 'hiHelloHi:)' },
  'lot-rush-podelu': { src: cdn('01F6QWHR20000EB9BSAR8G1DKZ'), name: 'PauseChamp' },
  'lot-las-skum': { src: cdn('01GWACFXSG0002CCPRV6KPX2XA'), name: 'SCAMBA' },
  'lot-andrew-37': { src: cdn('01FF3R5C30000FF5VVCKV49G6J'), name: 'xdd' },
  'luk-legend': { src: cdn(POG_CLAP_ID), name: 'PogClap' },
  'lot-meme-repeat': { src: cdn(POG_CLAP_ID), name: 'PogClap' },
  'lot-meme-remolol': { src: cdn(CAT_CLAP_ID), name: 'CatClap' },
  'lot-meme-salat': { src: cdn(POG_CLAP_ID), name: 'PogClap' },
  'lot-meme-quevizar': { src: cdn(CAT_CLAP_ID), name: 'CatClap' },
  'lot-meme-myth': { src: cdn(POG_CLAP_ID), name: 'PogClap' },
  'lot-meme-evilzeg': { src: cdn(CAT_CLAP_ID), name: 'CatClap' },
};

export function lotEmote(id: string): { src: string; name: string } | null {
  return LOT_EMOTES[id] ?? null;
}
