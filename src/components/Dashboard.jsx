import { useEffect, useState } from 'react'

import { api, ROLE_LABELS } from '../lib/api'
import { MemberProfileProvider } from '../lib/memberProfile'
import Attendance from './Attendance'
import History from './History'
import Reports from './Reports'
import CreateUser from './CreateUser'
import UserManagement from './UserManagement'
import Institutes from './Institutes'
import Members from './Members'
import TransferRequests from './TransferRequests'
import ChangePassword from './ChangePassword'
import ClockFooter from './ClockFooter'

/**
 * Role-aware dashboard shell. Builds the nav from the user's role and renders
 * the active page. Institutes are loaded once and shared with child pages that
 * need an institute picker.
 */
export default function Dashboard({ user, onLogout }) {
  const [institutes, setInstitutes] = useState([])
  const [tab, setTab] = useState('attendance')
  const [supervisor, setSupervisor] = useState(null)

  async function loadInstitutes() {
    try {
      const res = await api.get('/api/institutes')
      setInstitutes(res.institutes)
    } catch {
      setInstitutes([])
    }
  }

  useEffect(() => {
    loadInstitutes()
    // Fetch the direct supervisor's details securely from the session.
    api.get('/api/me')
      .then((r) => setSupervisor(r.supervisor || null))
      .catch(() => setSupervisor(null))
  }, [])

  const isInstitute = user.role === 'institute'
  const canCreateUsers = user.role !== 'institute'
  const canManageUsers = user.role !== 'institute'
  // Transfers tab: institutes request; level1_admin & root approve; mid_admin views.
  const showTransfers = ['institute', 'level1_admin', 'root', 'mid_admin'].includes(user.role)

  // Nav items available to this role.
  const tabs = [
    { key: 'attendance', label: 'حضور و غیاب امروز' },
    { key: 'history', label: 'تاریخچه' },
    { key: 'reports', label: 'گزارش آماری' },
    !isInstitute && { key: 'institutes', label: 'مؤسسه‌ها' },
    { key: 'members', label: 'اعضا' },
    showTransfers && { key: 'transfers', label: 'انتقال اعضا' },
    canCreateUsers && { key: 'users', label: 'ساخت کاربر' },
    canManageUsers && { key: 'manage', label: 'مدیریت کاربران' },
    { key: 'password', label: 'تغییر رمز' },
  ].filter(Boolean)

  return (
    <MemberProfileProvider>
    <div className="min-h-screen flex flex-col bg-base-200" dir="rtl">
      <div className="navbar bg-base-100 shadow-sm px-4 flex-wrap">
        <div className="flex-1 flex items-center gap-3 flex-wrap">
          <span className="text-lg font-semibold">سامانه‌ی حضور و غیاب</span>
          {/* Direct-supervisor widget (hidden when the user has no supervisor). */}
          {supervisor && (
            <span className="badge badge-outline badge-lg gap-1">
              ناظر: {supervisor.display_name || supervisor.username} - ({supervisor.username}) : ({ROLE_LABELS[supervisor.role] || supervisor.role})
            </span>
          )}
        </div>
        <div className="flex-none gap-3 items-center">
          <span className="text-sm opacity-70">{user.display_name || user.username}</span>
          <div className="badge badge-neutral">{ROLE_LABELS[user.role] || user.role}</div>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>خروج</button>
        </div>
      </div>

      <div className="p-3 flex-1">
        <div role="tablist" className="tabs tabs-boxed bg-base-100 mb-4 inline-flex flex-wrap">
          {tabs.map((t) => (
            <button key={t.key} role="tab"
              className={`tab ${tab === t.key ? 'tab-active' : ''}`}
              onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-1">
          {tab === 'attendance' && <Attendance me={user} institutes={institutes} />}
          {tab === 'history' && <History me={user} institutes={institutes} />}
          {tab === 'reports' && <Reports me={user} institutes={institutes} />}
          {tab === 'institutes' && !isInstitute && (
            <Institutes me={user} onChanged={loadInstitutes} />
          )}
          {tab === 'members' && <Members me={user} institutes={institutes} />}
          {tab === 'transfers' && <TransferRequests me={user} institutes={institutes} />}
          {tab === 'users' && canCreateUsers && (
            <CreateUser me={user} institutes={institutes} onCreated={loadInstitutes} />
          )}
          {tab === 'manage' && canManageUsers && <UserManagement me={user} />}
          {tab === 'password' && <ChangePassword />}
        </div>
      </div>

      <ClockFooter />
    </div>
    </MemberProfileProvider>
  )
}
