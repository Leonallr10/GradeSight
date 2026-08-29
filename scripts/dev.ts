/**
 * Local dev: Next.js + optional ChemVLM in one terminal.
 *
 * Set USE_CHEM_VLM=1 in .env.local to auto-start ChemVLM (GPU machine only).
 * On Vercel, leave USE_CHEM_VLM unset — only `next dev` / `next start` run there.
 */
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')
const IS_WIN = process.platform === 'win32'

function loadEnvFile(path: string) {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(join(ROOT, '.env'))
loadEnvFile(join(ROOT, '.env.local'))

const DEFAULT_CHEM_URL = 'http://127.0.0.1:8002'
const useChem = process.env.USE_CHEM_VLM === '1'

if (useChem && !process.env.CHEM_VLM_URL?.trim()) {
  process.env.CHEM_VLM_URL = DEFAULT_CHEM_URL
}

const children: ChildProcess[] = []
let shuttingDown = false

function killChild(child: ChildProcess) {
  if (!child.pid || child.killed) return
  if (IS_WIN) {
    spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { shell: true })
  } else {
    child.kill('SIGTERM')
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) killChild(child)
  setTimeout(() => process.exit(code), 300)
}

function run(name: string, command: string, args: string[]) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    shell: IS_WIN,
  })
  children.push(child)
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    const n = code ?? (signal ? 1 : 0)
    if (n !== 0) console.error(`[dev] ${name} exited (${code ?? signal})`)
    shutdown(n)
  })
  return child
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

if (useChem) {
  console.log(`[dev] ChemVLM enabled → ${process.env.CHEM_VLM_URL}`)
  run('chem-vlm', 'python', ['-m', 'ml.serve_chem'])
} else {
  console.log('[dev] ChemVLM disabled (set USE_CHEM_VLM=1 in .env.local to enable)')
}

console.log('[dev] Starting Next.js…')
run('next', 'npm', ['run', 'dev:next'])
