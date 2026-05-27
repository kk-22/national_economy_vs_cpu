import { createGame } from '../src/game/init.ts'
import { processCpuTurns } from '../src/game/turns.ts'
import { calculateScores } from '../src/game/round.ts'
import { setBeamEvalWeights, clearBeamEvalWeights, DEFAULT_BEAM_EVAL_WEIGHTS } from '../src/game/cpu-scoring.ts'

const seeds = [12345, 99999, 54321, 11111, 77777]

for (const seed of seeds) {
  setBeamEvalWeights(DEFAULT_BEAM_EVAL_WEIGHTS)
  try {
    let state = createGame({
      humanName: '',
      cpuCount: 4,
      cpuOnly: true,
      seed,
      cpuStrategies: ['beam', 'greedy', 'greedy', 'greedy'],
    })
    state = processCpuTurns(state)

    const scores = calculateScores(state)
    const sorted = scores.sort((a, b) => a.playerId - b.playerId)
    const totals = sorted.map(s => s.total)
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length

    console.log(`seed=${seed}  phase=${state.phase}  round=${state.round}`)
    sorted.forEach(s => {
      console.log(`  player${s.playerId}: total=${s.total}  money=${s.money}  buildingValue=${s.buildingValue}  unpaidPenalty=${s.unpaidPenalty}`)
    })
    console.log(`  beam=${totals[0]}  4人平均=${avg.toFixed(1)}`)
    console.log()
  } finally {
    clearBeamEvalWeights()
  }
}
