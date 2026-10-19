#!/usr/bin/env node
/*
 * Fail when a design token in src/design-system.css drifts from the value
 * Plepic's site uses: the :root block of css/styles.css on public-web main.
 * Runs in CI; when it fails, copy the new value into src/design-system.css,
 * or drop a token public-web no longer defines.
 *
 * Usage: pnpm check:tokens [path-or-url]   (defaults to public-web main)
 */
import { readFile } from 'node:fs/promises'

const UPSTREAM = 'https://raw.githubusercontent.com/Plepic-OU/public-web/main/css/styles.css'
const LOCAL = new URL('../src/design-system.css', import.meta.url)

/** Custom properties declared in top-level :root blocks; a later block wins. */
function rootTokens(css) {
  const tokens = new Map()
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let depth = 0
  let preludeStart = 0
  let bodyStart = -1
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'") {
      // Skip strings so a brace or semicolon inside `content: "}"` cannot
      // shift the block depth.
      const end = src.indexOf(ch, i + 1)
      i = end === -1 ? src.length : end
    } else if (ch === '{') {
      if (depth === 0 && src.slice(preludeStart, i).trim() === ':root') bodyStart = i + 1
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        if (bodyStart >= 0) {
          const body = src.slice(bodyStart, i)
          // `;` appended so a last declaration without one is still read.
          for (const [, name, value] of `${body};`.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
            tokens.set(name, value.replace(/\s+/g, ' ').trim())
          }
          bodyStart = -1
        }
        preludeStart = i + 1
      }
    } else if (ch === ';' && depth === 0) {
      // Top-level statements such as @import end with a semicolon, not a block.
      preludeStart = i + 1
    }
  }
  return tokens
}

async function load(source) {
  if (!/^https?:\/\//.test(source)) return readFile(source, 'utf8')
  const res = await fetch(source, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const source = process.argv[2] ?? UPSTREAM
const local = rootTokens(await readFile(LOCAL, 'utf8'))
const upstream = rootTokens(
  await load(source).catch((err) => fail(`Could not read ${source}: ${err.message}`)),
)

// An empty parse must not read as "all 0 tokens match".
if (local.size === 0) fail('Found no :root tokens in src/design-system.css')
if (upstream.size === 0) fail(`Found no top-level :root tokens in ${source}`)

const drift = []
for (const [name, value] of local) {
  const canonical = upstream.get(name)
  if (canonical === undefined) {
    drift.push(`${name}: no longer defined upstream`)
  } else if (canonical !== value) {
    drift.push(`${name}\n      upstream: ${canonical}\n      here:     ${value}`)
  }
}

if (drift.length > 0) {
  fail(
    `Design tokens differ from ${source}:\n  ${drift.join('\n  ')}\n` +
      'Copy the upstream values into src/design-system.css, or drop tokens public-web removed.',
  )
}
console.log(`All ${local.size} design tokens match ${source}`)
