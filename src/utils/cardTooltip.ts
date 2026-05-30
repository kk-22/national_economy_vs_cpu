import type { GameEffect } from '../game/types'
import { ALL_BUILDING_CARDS } from '../game/primitives'

export function effectDesc(effect: GameEffect): string {
  switch (effect.kind) {
    case 'draw':               return `山札から建物カードを${effect.n}枚引く`
    case 'draw-consumption':   return `消費財を${effect.n}枚引く`
    case 'draw-become-start':  return `カードを1枚引き、スタートプレイヤーになる`
    case 'slash-burn':         return `消費財を5枚引く。ラウンド終了時に廃棄`
    case 'gain-supply':        return `家計から $${effect.n} もらう（家計に$${effect.n}以上必要）`
    case 'reveal-pick':        return `山札から建物カード${effect.n}枚を公開し、1枚選んで手札に加える`
    case 'discard-draw':       return `手札${effect.discard}枚捨てて山札から${effect.draw}枚引く`
    case 'build':              return effect.discount > 0
                                 ? `コスト${effect.discount}割引で建設${effect.drawAfter > 0 ? `。その後${effect.drawAfter}枚引く` : ''}`
                                 : `建設する${effect.drawAfter > 0 ? `。その後${effect.drawAfter}枚引く` : ''}`
    case 'draw-consumption-to':return `消費財を計${effect.target}枚になるまで引く（手札${effect.target}枚以上なら配置不可）`
    case 'build-farm-free':    return `農園マークの建物をコスト無しで建設する`
    case 'discard-gain':       return `手札${effect.discard}枚捨てて家計から $${effect.gain} もらう（家計に$${effect.gain}以上必要）`
    case 'add-worker':         return `労働者を1人雇う${effect.immediate ? '（即時使用可）' : ''}`
    case 'fill-workers':       return `労働者を${effect.target}人になるまで雇う`
    case 'build-double':       return `同コストの建物を2棟同時に建設（コスト1つ分を支払う）`
    case 'draw-if-empty':      return `手札0枚なら${effect.empty}枚、手札1枚以上なら${effect.normal}枚引く`
    case 'p-hand-limit':       return `手札上限 +${effect.n}（恒久効果）`
    case 'p-worker-limit':     return `雇用できる労働者の上限 +${effect.n}（恒久効果）`
    case 'p-forgive-wages':    return `ゲーム終了時、未払い賃金を最大${effect.max}枚まで免除`
    case 'p-per-building':     return `ゲーム終了時、所有建物1棟につき +${effect.pts}点`
    case 'p-per-consumption':  return `ゲーム終了時、手札の消費財1枚につき +${effect.pts}点`
    case 'p-per-worker':       return `ゲーム終了時、労働者1人につき +${effect.pts}点`
    case 'p-per-no-sell':      return `ゲーム終了時、売却不可の建物1棟につき +${effect.pts}点`
    case 'p-per-factory':      return `ゲーム終了時、工場系建物1棟につき +${effect.pts}点`
    // メセナ効果
    case 'draw-consumption-by-hand': return `手札が3枚になるまで消費財を引く`
    case 'discard-gain-household':   return `手札${effect.discard}枚捨てて家計から$${effect.gain}もらう（家計$${effect.minHousehold}以上必要）`
    case 'draw-if-mine':             return `自コマが鉱山に配置中なら建物カードを${effect.n}枚引く`
    case 'build-gain-vp':            return `建設${effect.discount > 0 ? `（コスト${effect.discount}割引）` : ''}し勝利点カードを1枚取る`
    case 'draw-gain-vp':             return `${effect.drawType === 'consumption' ? '消費財' : '建物カード'}を${effect.n}枚引き勝利点カードを1枚取る`
    case 'draw-consumption-if-have': return `手札に消費財あり→${effect.withConsumption}枚、なし→${effect.without}枚引く`
    case 'gain-per-consumption':     return `手札の消費財1枚につき家計から$${effect.perCard}もらう`
    case 'gain-household':           return `家計から$${effect.net}もらう（家計$${effect.minHousehold}以上必要）`
    case 'build-free-if-cheap':      return `資産価値${effect.maxAsset}以下の建物を1棟無料建設`
    case 'build-two':                return `建物2棟を合計コストを支払って同時建設\n建設後に手札が0枚なら、建物カードを3枚引く`
    case 'draw-consumption-hold':    return `消費財${effect.n}枚を次のラウンド開始時に手札に加える`
    case 'discard-draw-min-hand':    return `手札${effect.discard}枚捨てて${effect.draw}枚引く（手札${effect.minHand}枚以下は配置不可）`
    case 'draw-with-build-discount': return `建物カードを${effect.n}枚引く`
    case 'discard-gain-household-min': return `手札${effect.discard}枚捨てて家計から$${effect.gain}もらう（家計$${effect.minHousehold}以上必要）`
    case 'build-no-sell':            return `売却不可建物をコストを支払って建設し、建物カードを${effect.drawAfter}枚引く`
    case 'p-if-empty-hand':          return `ゲーム終了時、手札0枚なら資産価値+${effect.bonus}`
    case 'p-vp-double':              return `ゲーム終了時、勝利点カードの得点が2倍`
    case 'p-if-own-n-buildings':     return `ゲーム終了時、所有建物${effect.threshold}棟以上なら資産価値+${effect.bonus}`
    case 'p-if-tag-n':               return `ゲーム終了時、${effect.tag === 'farm' ? '農業' : '工業'}建物${effect.threshold}棟以上なら資産価値+${effect.bonus}`
    case 'p-if-no-sell-n':           return `ゲーム終了時、売却不可建物${effect.threshold}棟以上なら資産価値+${effect.bonus}`
    case 'p-vp-build-discount':      return `勝利点${effect.vpThreshold}枚以上で建設コスト${effect.discount}割引（建設時判定）`
    case 'none':               return `効果なし`
    // グローリー効果
    case 'on-build-gain-vp':              return `建てたときに勝利点カードを${effect.n}枚取る`
    case 'on-build-gain-automaton':       return `建てたときに機械人形コマを1個得る。このラウンドから配置可・賃金不要`
    case 'draw-consumption-or-discard-draw': return `消費財${effect.n}枚引く　OR　消費財${effect.n}枚捨てて建物カード${effect.n + 1}枚引く`
    case 'build-then-draw-consumption':   return `建設する。その後消費財を${effect.consumption}枚引く`
    case 'draw-consumption-odd-even':     return `手札が偶数枚なら消費財${effect.even}枚、奇数枚なら${effect.odd}枚引く`
    case 'build-draw-if-empty':           return `建設する。建設後に手札が0枚になったら建物カードを${effect.drawAfterEmpty}枚引く`
    case 'gain-household-by-workers':     return `手元にコマがない場合は家計から$${effect.withoutWorker}、ある場合は$${effect.withWorker}もらう`
    case 'gain-household-if-hand':        return `手札がちょうど${effect.exactHand}枚なら家計から$${effect.gain}、そうでなければ$${effect.otherwise}もらう`
    case 'build-consumption-double':      return `建設する。コストとして捨てる消費財は1枚を2枚分として扱う`
    case 'draw-gain-household':           return `建物カードを${effect.n}枚引き、家計から$${effect.gain}もらう`
    case 'build-free-any':               return `手札から建物1枚をコスト無しで建設する`
    case 'p-if-tag-asset-min':            return `ゲーム終了時、${effect.tag === 'agriculture' ? '農業' : '工業'}マーク建物の資産価値合計が${effect.minAsset}以上なら資産価値+${effect.bonus}`
    case 'p-if-has-both-tags':           return `ゲーム終了時、農業マーク建物と工業マーク建物の両方を所有していれば資産価値+${effect.bonus}`
    case 'p-if-vp-min':                  return `ゲーム終了時、勝利点カードが${effect.minVp}枚以上なら資産価値+${effect.bonus}`
    case 'p-if-workers-min':             return `ゲーム終了時、労働者が${effect.minWorkers}人以上（機械人形除く）なら資産価値+${effect.bonus}`
    case 'p-if-consumption-in-hand-min': return `ゲーム終了時、手札の消費財が${effect.minCount}枚以上なら資産価値+${effect.bonus}`
    case 'p-if-only-no-sell':            return `ゲーム終了時、所有する売却不可建物がこのカードだけなら資産価値+${effect.bonus}`
    default:                   return ''
  }
}

export function cardTypeTags(name: string): string[] {
  const def = ALL_BUILDING_CARDS[name]
  if (!def) return []
  const parts: string[] = []
  if (def.tags.includes('farm')) parts.push('農')
  if (def.tags.includes('factory')) parts.push('工')
  if (def.tags.includes('agriculture')) parts.push('農')
  if (def.tags.includes('industry')) parts.push('工')
  if (!def.canSell) parts.push('禁')
  return parts
}

export function constructionDiscountDesc(name: string): string {
  const def = ALL_BUILDING_CARDS[name]
  const cd = def?.constructionDiscount
  if (!cd || !def) return ''
  const base = def.cost
  if (cd.condition === 'own-tag') {
    const tagLabel = cd.tag === 'farm' ? '農業マーク' : '工業マーク'
    return `建設割引：${tagLabel}建物を所有していれば建設コスト${base}→${Math.max(0, base - cd.discount)}`
  }
  if (cd.condition === 'own-vp-min') {
    return `建設割引：勝利点カード${cd.minVp}枚以上でコスト${base}→${Math.max(0, base - cd.discount)}`
  }
  if (cd.condition === 'per-owned-tag') {
    const tagLabel = cd.tag === 'farm' ? '農業マーク' : '工業マーク'
    return `建設割引：${tagLabel}建物1棟につきコスト-${cd.discountPerTag}（基本コスト${base}）`
  }
  return ''
}

export function cardTooltip(name: string): string {
  const d = ALL_BUILDING_CARDS[name]
  if (!d) return ''
  const lines: string[] = [effectDesc(d.effect)]
  const discountDesc = constructionDiscountDesc(name)
  if (discountDesc) lines.push(discountDesc)
  const tags: string[] = []
  if (d.tags.includes('farm') || d.tags.includes('agriculture')) tags.push('農業マーク')
  if (d.tags.includes('factory') || d.tags.includes('industry')) tags.push('工業マーク')
  const attrs: string[] = []
  if (!d.canSell) attrs.push('売却不可')
  if (!d.isWorkplace) attrs.push('使用不可')
  if (d.requiresDoubleWorker) attrs.push('2コマ同時配置')
  if (tags.length > 0) lines.push('タイプ：' + tags.join(' / '))
  if (attrs.length > 0) lines.push(attrs.join(' / '))
  return lines.filter(Boolean).join('\n')
}
