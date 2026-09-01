/**
 * Isolation test for getStudioRuntimeDir.
 * Uses the pure helper studioRuntimeDirForProfile — no mocking required.
 * Run: node --import tsx/esm src/server/__tests__/runtime-dir.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { studioRuntimeDirForProfile } from '../runtime-dir'

const LEGACY_PATH = join(process.cwd(), '.runtime')

test('default profile returns the legacy .runtime path', () => {
  const result = studioRuntimeDirForProfile('default')
  assert.equal(result, LEGACY_PATH)
})

test('empty/falsy profile also returns the legacy .runtime path', () => {
  assert.equal(studioRuntimeDirForProfile(''), LEGACY_PATH)
})

test('non-default profile returns path under ~/.hermes/profiles/<name>/.studio-runtime', () => {
  const result = studioRuntimeDirForProfile('work')
  const expected = join(homedir(), '.hermes', 'profiles', 'work', '.studio-runtime')
  assert.equal(result, expected)
})

test('default and non-default paths are not equal', () => {
  const def = studioRuntimeDirForProfile('default')
  const other = studioRuntimeDirForProfile('work')
  assert.notEqual(def, other)
})

test('non-default path is under ~/.hermes/profiles, not process.cwd()', () => {
  const result = studioRuntimeDirForProfile('myprofile')
  assert.ok(result.startsWith(homedir()), `expected path under homedir, got: ${result}`)
  assert.ok(!result.startsWith(process.cwd()), `expected path NOT under cwd, got: ${result}`)
})
