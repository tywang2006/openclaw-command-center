import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAgentState } from '../hooks/useAgentState'

type AgentStateReturn = ReturnType<typeof useAgentState>

const AgentStateContext = createContext<AgentStateReturn>(null!)

export function AgentStateProvider({ children }: { children: ReactNode }) {
  const agentState = useAgentState()

  // Memoize context value to prevent unnecessary re-renders when functions don't change
  const contextValue = useMemo(() => agentState, [
    agentState.departments,
    agentState.bulletin,
    agentState.memories,
    agentState.requests,
    agentState.activities,
    agentState.selectedDeptId,
    agentState.connected,
    agentState.toolStates,
    agentState.gatewayStatus,
    agentState.gatewayDetail,
    agentState.connectionState,
    // Functions are stable (useCallback in useAgentState), so we track their dependencies instead
  ])

  return (
    <AgentStateContext.Provider value={contextValue}>
      {children}
    </AgentStateContext.Provider>
  )
}

export function useAgentStateContext() {
  return useContext(AgentStateContext)
}
