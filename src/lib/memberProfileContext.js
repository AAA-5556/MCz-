import { createContext, useContext } from 'react'

// Context holding openMember(id). Lives in its own (non-component) module so
// the provider file can export only a component — keeps React Fast Refresh happy.
export const MemberProfileContext = createContext(() => {})

/** Returns openMember(id) — opens the shared profile modal for that member. */
export function useMemberProfile() {
  return useContext(MemberProfileContext)
}
