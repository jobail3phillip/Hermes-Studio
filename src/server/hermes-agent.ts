import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const HERMES_HEALTH_TIMEOUT_MS = 2_000
const HERMES_START_PORT = 8642

let startPromise: Promise<StartHermesAgentResult> | null = null

export type StartHermesAgentResult =
  | {
      ok: true
      message: string
      pid?: number
    }
  | {
      ok: false
      error: string
    }

/**
 * Read ~/.hermes/.env and return key=value pairs as an object.
 * Silently returns {} if the file doesn't exist or can't be parsed.
 */
function readHermesEnv(): Record<string, string> {
  const envPath = join(homedir(), '.hermes', '.env')
  try {
    const raw = readFileSync(envPath, 'utf-8')
    const result: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx <= 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (key) result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

/**
 * Locate the installed `hermes` CLI. GUI-launched apps (Finder/Dock, or
 * `open`) get a minimal launchd PATH that excludes `~/.local/bin`, so a
 * bare `Command::new("hermes")`-style spawn fails silently here even
 * though `hermes` resolves fine from an interactive shell.
 */
export function resolveHermesCli(): string {
  const candidates = [
    join(homedir(), '.local', 'bin', 'hermes'),
    '/opt/homebrew/bin/hermes',
    '/usr/local/bin/hermes',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'hermes'
}

export async function isHermesAgentHealthy(
  port = HERMES_START_PORT,
): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HERMES_HEALTH_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function startHermesAgent(): Promise<StartHermesAgentResult> {
  if (await isHermesAgentHealthy()) {
    return { ok: true, message: 'already running' }
  }

  if (startPromise) {
    return startPromise
  }

  startPromise = (async () => {
    try {
      const hermesCli = resolveHermesCli()
      const hermesEnv = readHermesEnv()

      const child = spawn(hermesCli, ['gateway', 'run'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...hermesEnv },
      })

      const spawnError = new Promise<string | null>((resolveSpawn) => {
        child.once('error', (err) => resolveSpawn(err.message))
        child.once('spawn', () => resolveSpawn(null))
      })
      const err = await spawnError
      if (err) {
        return { ok: false, error: `hermes CLI not found: ${err}` }
      }

      child.unref()

      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolveAttempt) => setTimeout(resolveAttempt, 1_000))
        if (await isHermesAgentHealthy()) {
          return {
            ok: true,
            pid: child.pid,
            message: 'started',
          }
        }
      }

      return {
        ok: true,
        pid: child.pid,
        message: 'starting',
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })()

  try {
    return await startPromise
  } finally {
    startPromise = null
  }
}
