import { describe, expect, it } from 'vitest'
import { activeTier, breakOptionText, nextBreakHint, validateTiers } from '@/lib/distribution'

describe('validateTiers', () => {
  it('accepts descending prices', () => expect(validateTiers([{ min_qty: '10', unit_price: '5' }, { min_qty: '100', unit_price: '4.5' }])).toBeNull())
  it('rejects duplicate quantities', () => expect(validateTiers([{ min_qty: '10', unit_price: '5' }, { min_qty: '10', unit_price: '4' }])).toMatch(/same minimum/))
  it('rejects a higher tier costing more, whatever the row order', () =>
    expect(validateTiers([{ min_qty: '100', unit_price: '6' }, { min_qty: '10', unit_price: '5' }])).toMatch(/must not cost more/))
  it('rejects bad numbers', () => {
    expect(validateTiers([{ min_qty: '0', unit_price: '1' }])).toMatch(/Row 1/)
    expect(validateTiers([{ min_qty: '1.5', unit_price: '1' }])).toMatch(/whole number/)
    expect(validateTiers([{ min_qty: '5', unit_price: '' }])).toMatch(/unit price/)
  })
})

describe('activeTier', () => {
  const tiers = [{ min_qty: 100, unit_price: '8' }, { min_qty: 25, unit_price: '9' }, { min_qty: 500, unit_price: '7' }]
  it('is null below the first break', () => expect(activeTier(tiers, 24)).toBeNull())
  it('is inclusive at the break', () => expect(activeTier(tiers, 25)?.min_qty).toBe(25))
  it('picks the highest break not above qty', () => { expect(activeTier(tiers, 99)?.min_qty).toBe(25); expect(activeTier(tiers, 5000)?.min_qty).toBe(500) })
})

describe('text helpers', () => {
  it('formats a break option', () =>
    expect(breakOptionText({ min_qty: 200, unit_price: 12.67, extra_units: 100, extra_cost: 1200, saving_per_unit: 0.67, cheaper_in_total: false }))
      .toBe('buy 200 for $12.67/unit (saves $0.67/unit, +100 units, +$1200.00)'))
  it('hints at the next break', () => {
    expect(nextBreakHint(30, { min_qty: 100, unit_price: '8' })).toBe('Buy 70 more to get $8.00/unit')
    expect(nextBreakHint(600, null)).toBeNull()
  })
})
