import type { OverviewCardPreference } from "../services/api";

export const OVERVIEW_CARD_IDS = ["control", "quick_proxy", "traffic", "memory"] as const;

export type OverviewCardId = (typeof OVERVIEW_CARD_IDS)[number];

export const DEFAULT_OVERVIEW_CARDS: OverviewCardPreference[] = OVERVIEW_CARD_IDS.map((id) => ({
  id,
  visible: true,
}));

export function normalizeOverviewCards(cards?: OverviewCardPreference[]): OverviewCardPreference[] {
  const byId = new Map(cards?.map((card) => [card.id, card]));
  const normalized = cards?.filter((card) => OVERVIEW_CARD_IDS.includes(card.id as OverviewCardId)) ?? [];
  const unique = normalized.filter(
    (card, index) => normalized.findIndex((candidate) => candidate.id === card.id) === index
  );

  for (const defaultCard of DEFAULT_OVERVIEW_CARDS) {
    if (!byId.has(defaultCard.id)) unique.push(defaultCard);
  }

  return unique;
}

export function getOverviewCardOrder(cards: OverviewCardPreference[], id: OverviewCardId): number {
  const index = cards.findIndex((card) => card.id === id);
  return index >= 0 ? index : OVERVIEW_CARD_IDS.indexOf(id);
}

export function isOverviewCardVisible(cards: OverviewCardPreference[], id: OverviewCardId): boolean {
  return cards.find((card) => card.id === id)?.visible ?? true;
}
