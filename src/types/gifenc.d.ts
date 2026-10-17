declare module 'gifenc' {
  export type Palette = number[][]

  export function GIFEncoder(opts?: Record<string, unknown>): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: {
        palette?: Palette
        delay?: number
        repeat?: number
        transparent?: boolean
        transparentIndex?: number
        dispose?: number
        first?: boolean
      },
    ): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }

  export function quantize(
    rgba: Uint8ClampedArray | Uint8Array,
    maxColors: number,
    opts?: {
      format?: 'rgb565' | 'rgb444' | 'rgba4444'
      oneBitAlpha?: boolean | number
      clearAlpha?: boolean
      clearAlphaThreshold?: number
      clearAlphaColor?: number
    },
  ): Palette

  export function applyPalette(
    rgba: Uint8ClampedArray | Uint8Array,
    palette: Palette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array

  export function nearestColorIndex(palette: Palette, pixel: number[]): number
}
