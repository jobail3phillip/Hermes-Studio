/**
 * Custom agent definition types.
 *
 * Built-in agents come from AGENT_PERSONAS (agent-personas.ts).
 * Custom agents are user-created and stored in .runtime/agent-definitions.json.
 */

export interface AgentDefinition {
  id: string
  name: string
  emoji: string
  /** Tailwind text-color class, e.g. "text-blue-400" */
  color: string
  roleLabel: string
  systemPrompt: string
  model: string | null
  tags: string[]
  isBuiltIn: boolean
  createdAt: number
  updatedAt: number
  /** Advisory-only agents (e.g. GPT/Atlas) have no live dispatch path. */
  advisory?: boolean
}

export type CreateAgentInput = {
  name: string
  emoji: string
  color: string
  roleLabel: string
  systemPrompt: string
  model?: string | null
  tags?: string[]
}

export type UpdateAgentInput = Partial<CreateAgentInput>
