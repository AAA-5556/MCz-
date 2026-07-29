import { useCallback, useState } from 'react'

import MemberProfileModal from '../components/MemberProfileModal'
import { MemberProfileContext } from './memberProfileContext'

// Lets any component open the member profile modal via the useMemberProfile
// hook, without passing callbacks through every table. Renders one shared modal.
export function MemberProfileProvider({ children }) {
  const [memberId, setMemberId] = useState(null)
  const open = useCallback((id) => setMemberId(id), [])
  const close = useCallback(() => setMemberId(null), [])

  return (
    <MemberProfileContext.Provider value={open}>
      {children}
      <MemberProfileModal memberId={memberId} onClose={close} />
    </MemberProfileContext.Provider>
  )
}
