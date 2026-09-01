import { homedir } from 'node:os'
import { join } from 'node:path'
import { getActiveProfileName } from './profiles-browser'

/** Pure helper — exposed for testing without mocking. */
export function studioRuntimeDirForProfile(profileName: string): string {
  if (!profileName || profileName === 'default')
    return join(process.cwd(), '.runtime')
  return join(homedir(), '.hermes', 'profiles', profileName, '.studio-runtime')
}

export function getStudioRuntimeDir(): string {
  return studioRuntimeDirForProfile(getActiveProfileName())
}
