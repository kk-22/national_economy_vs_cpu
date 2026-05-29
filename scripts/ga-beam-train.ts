/**
 * ビームサーチの中間評価関数 (scoreIntermediateBeam) の係数を
 * 遺伝的アルゴリズムで最適化するスクリプト。
 *
 * 実行方法:
 *   npx tsx scripts/ga-beam-train.ts [--gen N] [--seeds N]
 *
 * オプション:
 *   --gen N    世代数（デフォルト: 100）
 *   --seeds N  1世代あたりの評価シード数（デフォルト: 10）
 *
 * 設計:
 *   - 4人全CPU戦、プレイヤー0 がビーム（候補個体）・プレイヤー1-2 がお邪魔CPU
 *   - 固定シードを世代ごとに更新して評価（同一世代内は全個体が同じシードで比較）
 *   - 適応度: 1位=2点、2位=1点、3-4位=0点 の合計（seeds分）
 *   - 単調制約: workers3Bonus ≥ workers4Bonus ≥ workers5Bonus を個体修正で強制
 *   - workplace1CostMult ≥ workplace2CostMult ≥ workplace3CostMult も同様
 */

import { createGame } from '../src/game/init.ts'
import { processCpuTurns } from '../src/game/turns.ts'
import { calculateScores } from '../src/game/round.ts'
import {
  DEFAULT_BEAM_EVAL_WEIGHTS,
  BEAM_EVAL_WEIGHT_BOUNDS,
  setBeamEvalWeights,
  clearBeamEvalWeights,
  type BeamEvalWeights,
} from '../src/game/cpu-scoring.ts'
import { makeSeed } from '../src/game/random.ts'

// ---- コマンドライン引数のパース ----
function parseArgs(): { generations: number; seedsPerGen: number } {
  const args = process.argv.slice(2)
  let generations = 100
  let seedsPerGen = 10
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--gen' && args[i + 1]) {
      const v = parseInt(args[i + 1])
      if (!isNaN(v) && v > 0) generations = v
      i++
    } else if (args[i] === '--seeds' && args[i + 1]) {
      const v = parseInt(args[i + 1])
      if (!isNaN(v) && v > 0) seedsPerGen = v
      i++
    }
  }
  return { generations, seedsPerGen }
}

// ---- GA ハイパーパラメータ ----
const POP_SIZE       = 10    // ビームは1ゲームが重くメモリも多いので小さめに
const TOURNAMENT_K   = 3     // トーナメント選択のサイズ
const CROSSOVER_RATE = 0.7   // 交叉確率
const MUTATION_SIGMA = 0.10  // 突然変異の標準偏差（遺伝子範囲に対する割合）
const ELITE_COUNT    = 2     // エリート保存数

// ---- 型 ----
type Gene = keyof BeamEvalWeights
const GENES = Object.keys(DEFAULT_BEAM_EVAL_WEIGHTS) as Gene[]

// ---- 個体のクランプと単調制約修正 ----
function repair(w: BeamEvalWeights): BeamEvalWeights {
  const result = { ...w }

  // 各遺伝子を範囲内にクランプし整数化（GA最適化は1刻み）
  for (const key of GENES) {
    const [lo, hi] = BEAM_EVAL_WEIGHT_BOUNDS[key]
    result[key] = Math.round(Math.max(lo, Math.min(hi, result[key])))
  }

  // 単調制約: workers3Bonus ≥ workers4Bonus ≥ workers5Bonus（early/late 両方）
  result.workers4Bonus_early = Math.min(result.workers4Bonus_early, result.workers3Bonus_early)
  result.workers5Bonus_early = Math.min(result.workers5Bonus_early, result.workers4Bonus_early)
  result.workers4Bonus_late  = Math.min(result.workers4Bonus_late,  result.workers3Bonus_late)
  result.workers5Bonus_late  = Math.min(result.workers5Bonus_late,  result.workers4Bonus_late)

  // 単調制約: workplace1CostMult ≥ workplace2CostMult ≥ workplace3CostMult（early/late 両方）
  result.workplace2CostMult_early = Math.min(result.workplace2CostMult_early, result.workplace1CostMult_early)
  result.workplace3CostMult_early = Math.min(result.workplace3CostMult_early, result.workplace2CostMult_early)
  result.workplace2CostMult_late  = Math.min(result.workplace2CostMult_late,  result.workplace1CostMult_late)
  result.workplace3CostMult_late  = Math.min(result.workplace3CostMult_late,  result.workplace2CostMult_late)

  // 単調制約で下限を下回る可能性があるため再クランプ
  for (const key of GENES) {
    const [lo, hi] = BEAM_EVAL_WEIGHT_BOUNDS[key]
    result[key] = Math.round(Math.max(lo, Math.min(hi, result[key])))
  }

  return result
}

// ---- 個体生成（DEFAULT_BEAM_EVAL_WEIGHTS にランダム整数ノイズを加えた初期集団） ----
function randomIndividual(): BeamEvalWeights {
  const w = { ...DEFAULT_BEAM_EVAL_WEIGHTS }
  for (const key of GENES) {
    const [lo, hi] = BEAM_EVAL_WEIGHT_BOUNDS[key]
    const range = hi - lo
    const noise = Math.round((Math.random() * 2 - 1) * range * 0.3)
    w[key] = w[key] + noise
  }
  return repair(w)
}

// ---- 突然変異（整数刻み） ----
function mutate(w: BeamEvalWeights): BeamEvalWeights {
  const result = { ...w }
  for (const key of GENES) {
    const [lo, hi] = BEAM_EVAL_WEIGHT_BOUNDS[key]
    const range = hi - lo
    // 整数単位のガウスノイズ（最小±1を保証）
    const noise = Math.round(randn() * range * MUTATION_SIGMA) || (Math.random() < 0.5 ? 1 : -1)
    result[key] = result[key] + noise
  }
  return repair(result)
}

// ---- 一様交叉 ----
function crossover(a: BeamEvalWeights, b: BeamEvalWeights): BeamEvalWeights {
  const child = { ...a }
  for (const key of GENES) {
    if (Math.random() < 0.5) {
      child[key] = b[key]
    }
  }
  return repair(child)
}

// ---- 標準正規分布（Box-Muller法） ----
function randn(): number {
  const u = 1 - Math.random()
  const v = 1 - Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ---- 1試合シミュレーション（プレイヤー0がビーム候補個体、1-2がお邪魔CPU） ----
// seedIndex を使って手番を順番にサイクル: 0→先手($5), 1→2手目($6), 2→3手目($7), 3→先手…
function runGame(weights: BeamEvalWeights, seed: number, seedIndex: number): number[] {
  setBeamEvalWeights(weights)
  try {
    const playerOrder = (seedIndex % 3) + 1
    let state = createGame({
      humanName: '',
      cpuCount: 3,
      cpuOnly: true,
      seed,
      playerOrder,
      cpuStrategies: ['beam', 'disruptive', 'disruptive'],
    })
    // GA用途ではログ不要のため配列を空に保ち、メモリ肥大化を防ぐ
    state = { ...state, log: [] }
    state = processCpuTurns(state)
    // processCpuTurns 後のログも解放
    state = { ...state, log: [] }
    const scores = calculateScores(state)
    return scores
      .sort((a, b) => a.playerId - b.playerId)
      .map(s => s.total)
  } finally {
    clearBeamEvalWeights()
  }
}

// ---- 適応度評価（自分の最終スコア平均を適応度とする） ----
type EvalResult = { fitness: number; avgMyScore: number; avgAllScore: number }

function evaluate(weights: BeamEvalWeights, seeds: number[]): EvalResult {
  let totalMyScore = 0
  let totalAllScore = 0
  for (let i = 0; i < seeds.length; i++) {
    const totals = runGame(weights, seeds[i], i)
    totalMyScore += totals[0]
    totalAllScore += totals.reduce((a, b) => a + b, 0) / totals.length
  }
  const avgMyScore = totalMyScore / seeds.length
  return {
    fitness: avgMyScore,   // 自分のスコア平均が適応度（他プレイヤーのスコアは無視）
    avgMyScore,
    avgAllScore: totalAllScore / seeds.length,
  }
}

// ---- トーナメント選択 ----
function tournament(pop: BeamEvalWeights[], fitnesses: number[]): BeamEvalWeights {
  let best = Math.floor(Math.random() * pop.length)
  for (let i = 1; i < TOURNAMENT_K; i++) {
    const challenger = Math.floor(Math.random() * pop.length)
    if (fitnesses[challenger] > fitnesses[best]) best = challenger
  }
  return pop[best]
}

// ---- 結果フォーマット ----
function formatDiff(w: BeamEvalWeights): string {
  const lines: string[] = []
  for (const key of GENES) {
    const def = DEFAULT_BEAM_EVAL_WEIGHTS[key]
    const cur = w[key]
    const diff = cur - def
    const pct = def !== 0 ? ((diff / def) * 100).toFixed(1) : '---'
    lines.push(`  ${key.padEnd(28)} ${String(cur).padStart(6)}  (default: ${String(def).padStart(4)}, ${diff >= 0 ? '+' : ''}${pct}%)`)
  }
  return lines.join('\n')
}

// ---- メインループ ----
async function main() {
  const { generations, seedsPerGen } = parseArgs()

  console.log(`GA開始 (ビームサーチ中間評価最適化)`)
  console.log(`集団${POP_SIZE}個体 × ${generations}世代, シード${seedsPerGen}本/世代`)
  console.log(`遺伝子数: ${GENES.length}`)
  console.log()

  // 初期集団（DEFAULT_BEAM_EVAL_WEIGHTSを1個体として含める）
  let population: BeamEvalWeights[] = [
    { ...DEFAULT_BEAM_EVAL_WEIGHTS },
    ...Array.from({ length: POP_SIZE - 1 }, randomIndividual),
  ]

  let bestFitness = -Infinity
  let bestWeights = { ...DEFAULT_BEAM_EVAL_WEIGHTS }
  const startTime = Date.now()

  for (let gen = 0; gen < generations; gen++) {
    const seeds = Array.from({ length: seedsPerGen }, () => makeSeed())

    const results = population.map(w => evaluate(w, seeds))
    const fitnesses = results.map(r => r.fitness)
    const maxFit = Math.max(...fitnesses)
    const avgFit = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length
    const bestIdx = fitnesses.indexOf(maxFit)
    const bestResult = results[bestIdx]

    if (maxFit > bestFitness) {
      bestFitness = maxFit
      bestWeights = { ...population[bestIdx] }
      console.log(`★ Gen ${String(gen + 1).padStart(3)}: 最良スコア ${maxFit.toFixed(1)} 平均 ${avgFit.toFixed(1)} | 自分 ${bestResult.avgMyScore.toFixed(1)} / 3人平均 ${bestResult.avgAllScore.toFixed(1)} [更新]`)
      // クラッシュ時でも最良重みを失わないよう即時出力
      console.log(`  [チェックポイント] export const OPTIMIZED_BEAM_EVAL_WEIGHTS: BeamEvalWeights = { ${GENES.map(k => `${k}: ${bestWeights[k]}`).join(', ')} }`)
    } else if ((gen + 1) % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
      console.log(`  Gen ${String(gen + 1).padStart(3)}: 最良スコア ${maxFit.toFixed(1)} 平均 ${avgFit.toFixed(1)} | 自分 ${bestResult.avgMyScore.toFixed(1)} / 3人平均 ${bestResult.avgAllScore.toFixed(1)} (${elapsed}s)`)
    }

    // エリート保存
    const sortedIdx = fitnesses
      .map((f, i) => ({ f, i }))
      .sort((a, b) => b.f - a.f)
      .map(x => x.i)
    const elites = sortedIdx.slice(0, ELITE_COUNT).map(i => population[i])

    // 次世代生成
    const nextPop: BeamEvalWeights[] = [...elites]
    while (nextPop.length < POP_SIZE) {
      const parent1 = tournament(population, fitnesses)
      let child: BeamEvalWeights
      if (Math.random() < CROSSOVER_RATE) {
        const parent2 = tournament(population, fitnesses)
        child = crossover(parent1, parent2)
      } else {
        child = { ...parent1 }
      }
      nextPop.push(mutate(child))
    }
    population = nextPop
  }

  // 最終評価（シードを増やして精度を上げる）
  const finalSeedCount = Math.max(30, seedsPerGen * 2)
  const finalSeeds = Array.from({ length: finalSeedCount }, () => makeSeed())
  const finalResult = evaluate(bestWeights, finalSeeds)
  const defaultResult = evaluate({ ...DEFAULT_BEAM_EVAL_WEIGHTS }, finalSeeds)

  console.log()
  console.log('='.repeat(60))
  console.log('GA完了')
  console.log('='.repeat(60))
  console.log(`最終評価（${finalSeedCount}シード）:`)
  console.log(`  候補個体:       自分 ${finalResult.avgMyScore.toFixed(1)} / 3人平均 ${finalResult.avgAllScore.toFixed(1)}`)
  console.log(`  デフォルト重み: 自分 ${defaultResult.avgMyScore.toFixed(1)} / 3人平均 ${defaultResult.avgAllScore.toFixed(1)}`)
  console.log()
  console.log('最適化後の重み（DEFAULT_BEAM_EVAL_WEIGHTSとの差分）:')
  console.log(formatDiff(bestWeights))
  console.log()
  console.log('TypeScript定数として貼り付け用:')
  console.log('export const OPTIMIZED_BEAM_EVAL_WEIGHTS: BeamEvalWeights = {')
  for (const key of GENES) {
    console.log(`  ${key.padEnd(28)}: ${bestWeights[key]},`)
  }
  console.log('}')

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log()
  console.log(`実行時間: ${elapsed}秒`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
