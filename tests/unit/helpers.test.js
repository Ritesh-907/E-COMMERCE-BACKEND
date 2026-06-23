// tests/unit/helpers.test.js
const { slugify, roundToTwo } = require('../../src/utils/helpers')

describe('slugify', () => {
  it('converts spaces to hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })
  it('strips special characters', () => {
    expect(slugify('Sale! 50% off')).toBe('sale-50-off')
  })
  it('handles accented characters', () => {
    expect(slugify('Ñoño')).toBe('nono')
  })
})

describe('roundToTwo', () => {
  it('fixes floating-point drift', () => {
    expect(roundToTwo(0.1 + 0.2)).toBe(0.30)
  })
})