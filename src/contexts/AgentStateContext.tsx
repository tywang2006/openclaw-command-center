import { createContext, useContext, type ReactNode } from 'react'
import { useAgentState } from '../hooks/useAgentState'

type AgentStateReturn = ReturnType<typeof useAgentState>

const AgentStateContext = createContext<AgentStateReturn>(null!)

export function AgentStateProvider({ children }: { children: ReactNode }) {
  const agentState = useAgentState()
  return (
    <AgentStateContext.Provider value={agentState}>
      {children}
    </AgentStateContext.Provider>
  )
}

export function useAgentStateContext() {
  return useContext(AgentStateContext)
}
