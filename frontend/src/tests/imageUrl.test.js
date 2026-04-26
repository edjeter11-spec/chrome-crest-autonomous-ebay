import { describe, it, expect } from 'vitest'
import { upscaleEbayImage, upscaleEbayImages } from '../lib/imageUrl'

describe('upscaleEbayImage', () => {
  it('bumps a 225 thumb to 500 by default', () => {
    expect(upscaleEbayImage('https://i.ebayimg.com/images/g/abc/s-l225.jpg'))
      .toBe('https://i.ebayimg.com/images/g/abc/s-l500.jpg')
  })

  it('respects a custom size argument', () => {
    expect(upscaleEbayImage('https://i.ebayimg.com/images/g/abc/s-l140.jpg', 1600))
      .toBe('https://i.ebayimg.com/images/g/abc/s-l1600.jpg')
  })

  it('preserves query strings on the URL', () => {
    expect(upscaleEbayImage('https://i.ebayimg.com/images/g/abc/s-l225.jpg?v=2', 800))
      .toBe('https://i.ebayimg.com/images/g/abc/s-l800.jpg?v=2')
  })

  it('handles webp suffix', () => {
    expect(upscaleEbayImage('https://i.ebayimg.com/images/g/abc/s-l140.webp'))
      .toBe('https://i.ebayimg.com/images/g/abc/s-l500.webp')
  })

  it('returns non-eBay URLs unchanged', () => {
    const url = 'https://example.com/cards/foo/s-l225.jpg'
    expect(upscaleEbayImage(url)).toBe(url)
  })

  it('returns eBay URLs without a size token unchanged', () => {
    const url = 'https://i.ebayimg.com/thumbs/foo.jpg'
    expect(upscaleEbayImage(url)).toBe(url)
  })

  it('returns empty string for nullish input', () => {
    expect(upscaleEbayImage(null)).toBe('')
    expect(upscaleEbayImage(undefined)).toBe('')
    expect(upscaleEbayImage('')).toBe('')
  })

  it('falls back to 500 for invalid sizes', () => {
    expect(upscaleEbayImage('https://i.ebayimg.com/images/g/abc/s-l225.jpg', 0))
      .toBe('https://i.ebayimg.com/images/g/abc/s-l500.jpg')
    expect(upscaleEbayImage('https://i.ebayimg.com/images/g/abc/s-l225.jpg', NaN))
      .toBe('https://i.ebayimg.com/images/g/abc/s-l500.jpg')
  })
})

describe('upscaleEbayImages', () => {
  it('maps each url and drops nullish entries', () => {
    expect(upscaleEbayImages([
      'https://i.ebayimg.com/images/g/abc/s-l225.jpg',
      null,
      'https://example.com/foo.jpg',
      undefined,
    ])).toEqual([
      'https://i.ebayimg.com/images/g/abc/s-l500.jpg',
      'https://example.com/foo.jpg',
    ])
  })

  it('returns [] for non-array input', () => {
    expect(upscaleEbayImages(null)).toEqual([])
    expect(upscaleEbayImages('string')).toEqual([])
  })
})
