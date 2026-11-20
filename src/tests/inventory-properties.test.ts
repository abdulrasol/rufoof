import { describe, expect, it } from 'vitest'
import { getBalance, getRunningBalances } from '../lib/inventory'
import type { Item, Movement } from '../lib/types'

const item: Item = {
  id: 'item', code: 'A', name: 'Material', unit: 'piece', openingBalance: 37,
  category: '', minimumStock: null, location: '', notes: '', custom: {},
}

function movement(index: number, quantity: number, kind: Movement['kind']): Movement {
  return {
    id: `m-${index}`, itemId: item.id, date: `2026-11-${String(1 + index % 28).padStart(2, '0')}`,
    kind, quantity, party: '', document: '', notes: '', custom: {},
  }
}

describe('inventory invariants', () => {
  it('keeps the final ledger balance equal to the calculated current balance', () => {
    for (let seed = 0; seed < 50; seed++) {
      const history = Array.from({ length: 30 }, (_, i) => {
        const kind: Movement['kind'] = (i + seed) % 3 === 0 ? 'adjustment' : (i + seed) % 3 === 1 ? 'in' : 'out'
        const magnitude = (i * 7 + seed) % 11 + 1
        return movement(i, kind === 'adjustment' && i % 2 ? -magnitude : magnitude, kind)
      })
      const ledger = getRunningBalances(item, history)
      expect(ledger.at(-1)?.balance).toBe(getBalance(item, history))
    }
  })

  it('reaches the counted quantity after recording an adjustment', () => {
    const history = [movement(1, 10, 'in'), movement(2, 4, 'out')]
    for (const actual of [0, 12, 43, 100]) {
      const difference = actual - getBalance(item, history)
      expect(getBalance(item, [...history, movement(3, difference, 'adjustment')])).toBe(actual)
    }
  })
})
