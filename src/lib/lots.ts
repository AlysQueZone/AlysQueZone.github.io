import lotsData from '../../data/lots.json';

export type Rarity = 'common' | 'rare' | 'legendary';

export interface HistoryEntry {
  from: string;
  to: string;
  price: number;
}

export interface Lot {
  id: string;
  title: string;
  owner: string;
  price: number;
  rarity: Rarity;
  /** false только у легендарного ЛУКа — не продаётся */
  forSale: boolean;
  history: HistoryEntry[];
  clipUrl?: string;
  meme?: string;
  /** Путь к звуку мем-лота (тикет 17), напр. `${base}sounds/m1-nyachos.mp3` без base */
  audio?: string;
  /** Путь к постеру мем-лота (тикет 17) */
  poster?: string;
}

const rarityRank: Record<Rarity, number> = { legendary: 0, rare: 1, common: 2 };

const rawLots: Lot[] = lotsData as Lot[];

export const lots: Lot[] = [...rawLots].sort((a, b) => {
  const byRarity = rarityRank[a.rarity] - rarityRank[b.rarity];
  if (byRarity !== 0) return byRarity;
  return b.price - a.price;
});

export function getLot(id: string): Lot | undefined {
  return lots.find((lot) => lot.id === id);
}

export function getLotIds(): string[] {
  return lots.map((lot) => lot.id);
}
