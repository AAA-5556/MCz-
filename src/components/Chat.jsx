import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Chat / Messenger component — a two-person messenger embedded in the dashboard.
 *
 * Calls the chat-messenger Worker directly at its workers.dev URL.
 * The worker is open (no JWT) — for an internal tool this is acceptable
 * since only users with a valid attendance-app account can access the page.
 */
const CHAT_API = 'https://chat-messenger.aolsonozeyiclang.workers.dev'

export default function Chat({ me }) {
  const [contacts, setContacts] = useState([])
  const [activeChat, setActiveChat] = useState(null)   // { chatId, targetUser }
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [totalUnread, setTotalUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)

  const myUsername = me?.username || ''

  // ── Simple fetch wrapper for chat-messenger Worker ──
  async function chatFetch(path, options = {}) {
    const url = `${CHAT_API}${path}`
    const fetchOpts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    }
    if (options.body) {
      fetchOpts.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
    }
    if (options.formData) {
      fetchOpts.body = options.formData
      delete fetchOpts.headers['Content-Type']
    }
    const resp = await fetch(url, fetchOpts)
    return resp.json()
  }

  // ── Sync current user to chat system on mount ──
  useEffect(() => {
    chatFetch('/sync-user', {
      method: 'POST',
      body: {
        username: myUsername,
        displayName: me?.display_name || myUsername,
      },
    }).catch(() => {})
  }, [myUsername, me])

  // ── Load contacts ──
  const loadContacts = useCallback(async () => {
    try {
      const res = await chatFetch('/users')
      const users = (res.users || []).filter(u => u.username !== myUsername)
      setContacts(users)
    } catch {
      setContacts([])
    }
  }, [myUsername])

  useEffect(() => {
    loadContacts()
    const interval = setInterval(loadContacts, 20000) // refresh every 20s
    return () => clearInterval(interval)
  }, [loadContacts])

  // ── Poll unread counts ──
  const pollUnread = useCallback(async () => {
    try {
      const res = await chatFetch(`/unread-count?username=${encodeURIComponent(myUsername)}`)
      setTotalUnread(res.count || 0)
    } catch {}
  }, [myUsername])

  useEffect(() => {
    pollUnread()
    const interval = setInterval(pollUnread, 15000)
    return () => clearInterval(interval)
  }, [pollUnread])

  // ── Open a chat ──
  const openChat = useCallback(async (targetUsername) => {
    setLoading(true)
    try {
      const res = await chatFetch('/get-or-create-chat', {
        method: 'POST',
        body: { currentUser: myUsername, targetUser: targetUsername },
      })
      if (!res.success) {
        console.error('Chat error:', res.error)
        setLoading(false)
        return
      }
      setActiveChat({ chatId: res.chatId, targetUser: targetUsername })

      const msgRes = await chatFetch(`/get-messages?chatId=${res.chatId}&limit=100`)
      setMessages(msgRes.messages || [])

      // Mark as read
      await chatFetch('/mark-read', {
        method: 'POST',
        body: { chatId: res.chatId, username: myUsername },
      })
      pollUnread()
    } catch (err) {
      console.error('Failed to open chat:', err)
    }
    setLoading(false)
  }, [myUsername, pollUnread])

  // ── Poll messages when chat is open ──
  useEffect(() => {
    if (!activeChat) return
    const interval = setInterval(async () => {
      try {
        const res = await chatFetch(`/get-messages?chatId=${activeChat.chatId}&limit=100`)
        setMessages(res.messages || [])
      } catch {}
    }, 5000)
    return () => clearInterval(interval)
  }, [activeChat])

  // ── Scroll to bottom ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send text message ──
  const sendMessage = async () => {
    const text = input.trim()
    if (!text || !activeChat || sending) return

    setSending(true)
    try {
      await chatFetch('/send-message', {
        method: 'POST',
        body: { chatId: activeChat.chatId, senderUsername: myUsername, content: text },
      })
      setInput('')
      const res = await chatFetch(`/get-messages?chatId=${activeChat.chatId}&limit=100`)
      setMessages(res.messages || [])
    } catch (err) {
      console.error('Send failed:', err)
    }
    setSending(false)
  }

  // ── Send file ──
  const sendFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !activeChat) return

    setSending(true)
    try {
      const formData = new FormData()
      formData.append('chatId', activeChat.chatId)
      formData.append('senderUsername', myUsername)
      formData.append('file', file)
      formData.append('content', '')

      await chatFetch('/upload-file', { method: 'POST', formData })

      const res = await chatFetch(`/get-messages?chatId=${activeChat.chatId}&limit=100`)
      setMessages(res.messages || [])
    } catch (err) {
      console.error('Upload failed:', err)
    }
    setSending(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Handle Enter key ──
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Helpers ──
  function formatTime(ts) {
    if (!ts) return ''
    return new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
  }

  function isMe(msg) {
    return msg.sender_username === myUsername
  }

  function getFileType(path) {
    if (!path) return null
    const ext = path.split('.').pop()?.toLowerCase()
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
    if (['mp4', 'webm', 'ogg'].includes(ext)) return 'video'
    if (['pdf'].includes(ext)) return 'pdf'
    if (['mp3', 'wav', 'aac', 'flac'].includes(ext)) return 'audio'
    return 'file'
  }

  function getFileName(path) {
    if (!path) return 'فایل'
    const parts = path.split('/')
    const last = parts[parts.length - 1]
    const idx = last.indexOf('_')
    return idx > 0 ? last.slice(idx + 1) : last
  }

  // ── Render ──
  return (
    <div className="flex gap-3 h-[calc(100vh-200px)] min-h-[400px]" dir="rtl">

      {/* ════ RIGHT — Contact List ════ */}
      <div className="w-72 flex-shrink-0 bg-base-100 rounded-xl border border-base-300 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-base-300">
          <h3 className="font-bold text-sm flex items-center gap-2">
            💬 پیام‌رسان
            {totalUnread > 0 && (
              <span className="badge badge-primary badge-sm">{totalUnread}</span>
            )}
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 ? (
            <div className="p-4 text-center text-sm opacity-50">
              هنوز کاربری ثبت نشده
            </div>
          ) : (
            contacts.map((contact) => (
              <button
                key={contact.username}
                className={`w-full text-right px-3 py-2.5 flex items-center gap-2 hover:bg-base-200 transition-colors border-b border-base-200 ${
                  activeChat?.targetUser === contact.username ? 'bg-base-200' : ''
                }`}
                onClick={() => openChat(contact.username)}
              >
                <div className="avatar placeholder flex-shrink-0">
                  <div className="bg-primary text-primary-content rounded-full w-9 h-9">
                    <span className="text-sm">
                      {(contact.display_name || contact.username)?.[0] || '?'}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {contact.display_name || contact.username}
                  </div>
                  <div className="text-xs opacity-50 truncate">{contact.username}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ════ LEFT — Chat Window ════ */}
      <div className="flex-1 bg-base-100 rounded-xl border border-base-300 flex flex-col overflow-hidden">
        {!activeChat ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center opacity-50">
              <div className="text-5xl mb-3">💬</div>
              <p className="text-lg font-medium">یک مکالمه را انتخاب کنید</p>
              <p className="text-sm mt-1">از لیست سمت راست یک کاربر را انتخاب کنید</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-3 border-b border-base-300 flex items-center gap-2">
              <div className="avatar placeholder">
                <div className="bg-primary text-primary-content rounded-full w-8 h-8">
                  <span className="text-xs">
                    {activeChat.targetUser?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              </div>
              <span className="font-bold text-sm">{activeChat.targetUser}</span>
              {loading && <span className="loading loading-spinner loading-xs"></span>}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.length === 0 && (
                <div className="text-center opacity-40 text-sm py-8">
                  هنوز پیامی رد و بدل نشده
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${isMe(msg) ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                      isMe(msg)
                        ? 'bg-primary text-primary-content rounded-br-sm'
                        : 'bg-base-200 text-base-content rounded-bl-sm'
                    }`}
                  >
                    {msg.content && (
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    )}

                    {msg.attachment_path && (
                      <div className="mt-1">
                        {getFileType(msg.attachment_path) === 'image' && msg.attachment_url ? (
                          <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={msg.attachment_url}
                              alt="عکس"
                              className="rounded-lg max-w-full max-h-48 object-cover cursor-pointer hover:opacity-80"
                            />
                          </a>
                        ) : getFileType(msg.attachment_path) === 'video' && msg.attachment_url ? (
                          <video
                            src={msg.attachment_url}
                            controls
                            className="rounded-lg max-w-full max-h-48"
                          />
                        ) : (
                          <a
                            href={msg.attachment_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1 text-xs underline ${
                              isMe(msg) ? 'text-primary-content' : 'text-primary'
                            }`}
                          >
                            📎 {getFileName(msg.attachment_path)}
                          </a>
                        )}
                      </div>
                    )}

                    <div className={`text-[10px] mt-0.5 ${
                      isMe(msg) ? 'text-primary-content/60' : 'text-base-content/40'
                    }`}>
                      {formatTime(msg.created_at)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-base-300">
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-ghost btn-sm btn-circle"
                  onClick={() => fileInputRef.current?.click()}
                  title="ارسال فایل"
                >
                  📎
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={sendFile}
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                />

                <input
                  type="text"
                  className="input input-bordered flex-1 text-sm"
                  placeholder="پیام بنویسید..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sending}
                />

                <button
                  className="btn btn-primary btn-sm"
                  onClick={sendMessage}
                  disabled={!input.trim() || sending}
                >
                  {sending ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    'ارسال'
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
