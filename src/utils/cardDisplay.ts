import type { HandCard } from '../game/types'

export function cardLabel(card: { kind: string; name?: string }): string {
  return card.kind === 'building' ? card.name! : '消費財'
}

export function bcardNameStyle(name: string, small = false): Record<string, string> {
  const usable = small ? 46 : 88
  const base   = small ? 11 : 14
  if (!name || name.length * base <= usable) return {}
  return { fontSize: Math.max(8, Math.floor(usable / name.length)) + 'px' }
}

export function tagBadgeClass(tag: string): string {
  if (tag === '農') return 'bcard-type-badge--farm'
  if (tag === '工') return 'bcard-type-badge--factory'
  if (tag === '禁') return 'bcard-type-badge--nosell'
  return ''
}

export function handCount(hand: HandCard[]): number {
  return hand.length
}

export function handDetail(hand: HandCard[]): string {
  const total = hand.length
  if (total === 0) return ''
  const buildings = hand.filter(c => c.kind === 'building').length
  const consumptions = total - buildings
  if (consumptions > 0) return `（建物${buildings}+消費財${consumptions}）`
  return `（建物${buildings}）`
}
