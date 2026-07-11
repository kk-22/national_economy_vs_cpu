import type { Player, Worker } from '../game/types'

export function regularWorkers(workers: Worker[]): Worker[] {
  return workers.filter(w => !w.isAutomaton)
}

export function automatons(workers: Worker[]): Worker[] {
  return workers.filter(w => w.isAutomaton)
}

export function workerAvailable(workers: Worker[]): number {
  return regularWorkers(workers).filter(w => !w.isTraining && !w.placedAt).length
}

export function automatonAvailable(workers: Worker[]): number {
  return automatons(workers).filter(w => !w.placedAt).length
}

export function workerUnderCapacity(player: Player): boolean {
  const shatakuCount = player.ownedBuildings.filter(b => b.name === '社宅').length
  return shatakuCount > 0 && regularWorkers(player.workers).length < 5 + shatakuCount
}
