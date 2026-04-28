export class SeededRandom {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0 || 1
  }

  next(): number {
    this.state ^= this.state << 13
    this.state ^= this.state >>> 17
    this.state ^= this.state << 5
    return (this.state >>> 0) / 0x100000000
  }

  getState(): number { return this.state }
}

export function makeSeed(): number {
  return (Date.now() ^ (Math.random() * 0xFFFFFFFF | 0)) >>> 0 || 1
}
