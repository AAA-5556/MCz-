import { useEffect, useState } from 'react'

// Formatters are built once (module scope). All are anchored to Asia/Tehran so
// the widget shows Iran time regardless of the viewer's own timezone.
const TZ = 'Asia/Tehran'

const timeFmt = new Intl.DateTimeFormat('fa-IR', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})
const shamsiFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
})
const qamariFmt = new Intl.DateTimeFormat('fa-IR-u-ca-islamic-umalqura', {
  timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric',
})
const miladiFmt = new Intl.DateTimeFormat('fa-IR-u-ca-gregory', {
  timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric',
})

/**
 * Sticky footer widget: a live Tehran clock plus today's date in three
 * calendars — Solar Hijri (Shamsi), Lunar Hijri (Qamari), and Gregorian (Miladi).
 */
export default function ClockFooter() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <footer className="sticky bottom-0 z-10 bg-base-300/95 backdrop-blur border-t border-base-content/10 px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <span className="opacity-70">ساعت ایران</span>
          <span className="badge badge-primary badge-lg tabular-nums font-mono text-base">
            {timeFmt.format(now)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 opacity-90">
          <span><span className="opacity-60">شمسی:</span> {shamsiFmt.format(now)}</span>
          <span><span className="opacity-60">قمری:</span> {qamariFmt.format(now)}</span>
          <span><span className="opacity-60">میلادی:</span> {miladiFmt.format(now)}</span>
        </div>
      </div>
    </footer>
  )
}
