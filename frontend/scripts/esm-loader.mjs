import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SRC = '/tmp/smoke-out/src/'

export function resolve(specifier, context, next) {
  let target = null
  if (specifier.startsWith('@/')) {
    target = SRC + specifier.slice(2)
  } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    target = new URL(specifier, context.parentURL).pathname
  }
  if (target && !target.endsWith('.js')) {
    for (const cand of [`${target}.js`, `${target}/index.js`]) {
      if (existsSync(cand)) return next(pathToFileURL(cand).href, context)
    }
  }
  return next(specifier, context)
}
