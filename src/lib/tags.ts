/**
 * Hashtags for places.
 *
 * Most of a home is never worth itemising. The working alternative is a photo
 * plus a handful of words — "#cups #teacups #wine #beer" — typed once against
 * the cupboard. Tags are parsed out of ordinary free text rather than kept in
 * a separate field, so there is one box to fill in and no syntax to get wrong:
 * anything after a # is a tag, and the rest of the sentence stays searchable
 * on its own account.
 */

/** Tags found in a blob of text, lowercased and deduplicated, in order. */
export function parseTags(text?: string | null): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  // Letters, digits, hyphen and underscore. Hyphens let "#tea-cups" hold
  // together; a bare space ends the tag, which is what people expect.
  for (const m of text.matchAll(/#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)) {
    const t = m[1].toLowerCase()
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** The text with its tag markup removed, for when only the prose is wanted. */
export function stripTags(text?: string | null): string {
  if (!text) return ''
  return text.replace(/#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu, '$1').replace(/\s+/g, ' ').trim()
}

/**
 * Does a query target a tag?
 *
 * Typing "#wine" should mean "only things tagged wine", not a fuzzy match on
 * the word. A bare word still searches everything.
 */
export function tagQuery(q: string): string | null {
  const m = q.trim().match(/^#([\p{L}\p{N}][\p{L}\p{N}_-]*)$/u)
  return m ? m[1].toLowerCase() : null
}

/** Every distinct tag in use, most-used first — for suggesting as you type. */
export function tagCloud(texts: (string | null | undefined)[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const t of texts) {
    for (const tag of parseTags(t)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag))
}
