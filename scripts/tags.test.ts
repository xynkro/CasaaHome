import { parseTags, stripTags, tagQuery, tagCloud } from '../src/lib/tags'

let fails = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? '  ok' : 'FAIL'}  ${name}`, cond ? '' : JSON.stringify(extra))
  if (!cond) fails++
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

check('finds plain tags', eq(parseTags('#cups #wine #beer'), ['cups','wine','beer']), parseTags('#cups #wine #beer'))
check('lowercases', eq(parseTags('#Cups #WINE'), ['cups','wine']))
check('dedupes, keeps order', eq(parseTags('#cups #wine #cups'), ['cups','wine']))
check('hyphens hold together', eq(parseTags('#tea-cups'), ['tea-cups']))
check('underscores and digits', eq(parseTags('#box_2 #shelf3'), ['box_2','shelf3']))
check('a space ends the tag', eq(parseTags('#tea cups'), ['tea']), parseTags('#tea cups'))
check('mixed prose and tags', eq(parseTags('mugs and #cups, some #wine glasses'), ['cups','wine']))
check('ignores a bare hash', eq(parseTags('# # #'), []), parseTags('# # #'))
check('ignores mid-word hashes', eq(parseTags('a#b'), ['b']), parseTags('a#b'))
check('handles nothing', eq(parseTags(''), []) && eq(parseTags(null), []) && eq(parseTags(undefined), []))
check('non-latin tags work', eq(parseTags('#杯子 #kopi'), ['杯子','kopi']), parseTags('#杯子 #kopi'))

check('strip leaves the words', stripTags('#cups and #wine glasses') === 'cups and wine glasses', stripTags('#cups and #wine glasses'))
check('strip collapses whitespace', stripTags('  #a   #b  ') === 'a b')

check('#wine is a tag query', tagQuery('#wine') === 'wine')
check('#Wine normalises', tagQuery('  #Wine  ') === 'wine')
check('a bare word is not', tagQuery('wine') === null)
check('two tags is not a tag query', tagQuery('#wine #beer') === null)

const cloud = tagCloud(['#cups #wine', '#cups', '#beer #cups', null])
check('cloud counts and ranks', eq(cloud, [
  { tag: 'cups', count: 3 }, { tag: 'beer', count: 1 }, { tag: 'wine', count: 1 },
]), cloud)

console.log(fails === 0 ? '\nAll tag checks passed.' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
