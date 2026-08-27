/** Lightweight lexical vectors so Pass-2 matching works without external embeddings.
 *  Keeps LaTeX-ish tokens (frac, dx, subscripts) so formulas can still match.
 */
export function lexicalEmbedTexts(texts: string[]): number[][] {
  const docs = texts.map((t) =>
    t
      .toLowerCase()
      .replace(/\\\\[a-z]+/g, (m) => ` ${m.slice(2)} `) // \frac → frac
      .replace(/[^a-z0-9\s_^]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1),
  )
  const vocab = new Map<string, number>()
  for (const tokens of docs) {
    for (const w of tokens) {
      if (!vocab.has(w)) vocab.set(w, vocab.size)
    }
  }
  const dim = Math.max(vocab.size, 1)
  return docs.map((tokens) => {
    const vec = new Array(dim).fill(0)
    for (const w of tokens) {
      const i = vocab.get(w)
      if (i !== undefined) vec[i] += 1
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
    return vec.map((v) => v / norm)
  })
}
