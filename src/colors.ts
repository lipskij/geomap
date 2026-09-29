// Distinct colors, assigned in order of first appearance
export const PALETTE = [
  '#e6194b', // red
  '#4363d8', // blue
  '#f58231', // orange
  '#911eb4', // purple
  '#42d4f4', // cyan
  '#f032e6', // magenta
  '#3cb44b', // green
  '#800000', // maroon
  '#000075', // navy
  '#9a6324', // brown
]
const colors = new Map<string, string>()

export function colorFor(id: string): string {
  let c = colors.get(id)
  if (!c) {
    c = PALETTE[colors.size % PALETTE.length]
    colors.set(id, c)
  }
  return c
}
