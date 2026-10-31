import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CloudSyncOutlined from '@mui/icons-material/CloudSyncOutlined'
import ErrorOutline from '@mui/icons-material/ErrorOutlineOutlined'
import PlayCircleOutline from '@mui/icons-material/PlayCircleOutlined'
import CropFree from '@mui/icons-material/CropFree'
import TvOutlined from '@mui/icons-material/TvOutlined'
import type { SvgIconComponent } from '@mui/icons-material'
import type { SdkEvent } from './useScreenSdk'

const KINDS: Record<SdkEvent['kind'], { label: string; color: string; Icon: SvgIconComponent }> = {
  play: { label: 'Ads shown', color: '#2e7d32', Icon: PlayCircleOutline },
  sync: { label: 'Check-ins', color: '#0277bd', Icon: CloudSyncOutlined },
  device: { label: 'TV', color: '#ef6c00', Icon: TvOutlined },
  error: { label: 'Problems', color: '#c62828', Icon: ErrorOutline },
  slot: { label: 'Empty slots', color: '#757575', Icon: CropFree },
}

const ORDER: SdkEvent['kind'][] = ['play', 'sync', 'device', 'error', 'slot']

const ago = (at: number, now: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)} min ago`
}

/** What the TV has been doing, newest first, in plain words. Updates live while open. */
export default function SdkLogDialog(props: {
  open: boolean
  onClose: () => void
  screenName: string
  status: string
  queued: number
  events: SdkEvent[]
}) {
  // Empty slots are noisy (one every 10 seconds), so they start hidden.
  const [hidden, setHidden] = useState<Set<SdkEvent['kind']>>(() => new Set(['slot']))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!props.open) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [props.open])

  const count = (kind: SdkEvent['kind']) => props.events.filter((e) => e.kind === kind).length
  const toggle = (kind: SdkEvent['kind']) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  const shown = props.events.filter((e) => !hidden.has(e.kind))
  const lastCheckIn = props.events.find((e) => e.kind === 'sync')

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          {props.screenName}
          <Chip
            size="small"
            label={props.status}
            color={props.status === 'Online' ? 'success' : props.status === 'Offline' ? 'warning' : 'default'}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          What this TV has been doing, newest first.
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: 1, borderColor: 'divider' }}>
          <Stat label="Ads shown" value={String(count('play'))} />
          <Stat label="Plays waiting to send" value={String(props.queued)} />
          <Stat label="Last check-in" value={lastCheckIn ? ago(lastCheckIn.at, now) : 'not yet'} />
        </Box>

        <Stack direction="row" sx={{ gap: 1, px: 2, py: 1.5, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
          {ORDER.map((kind) => {
            const { label, color, Icon } = KINDS[kind]
            const on = !hidden.has(kind)
            return (
              <Chip
                key={kind}
                size="small"
                icon={<Icon sx={{ fontSize: 16, color: `${on ? color : 'inherit'} !important` }} />}
                label={`${label} · ${count(kind)}`}
                variant={on ? 'filled' : 'outlined'}
                onClick={() => toggle(kind)}
                sx={{ bgcolor: on ? `${color}14` : 'transparent', opacity: on ? 1 : 0.6 }}
              />
            )
          })}
        </Stack>

        <Box sx={{ height: 360, overflowY: 'auto', py: 0.5 }}>
          {shown.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
              Nothing to show yet.
            </Typography>
          )}
          {shown.map((event, i) => {
            const { color, Icon } = KINDS[event.kind]
            return (
              <Stack
                key={`${event.at}-${i}`}
                direction="row"
                sx={{
                  gap: 1.5,
                  px: 2,
                  py: 1,
                  alignItems: 'flex-start',
                  bgcolor: event.kind === 'error' ? `${color}0f` : 'transparent',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box
                  sx={{
                    mt: 0.25,
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: `${color}1a`,
                    color,
                  }}
                >
                  <Icon sx={{ fontSize: 17 }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {event.text}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(event.at).toLocaleTimeString('en-IN')} · {ago(event.at, now)}
                  </Typography>
                </Box>
              </Stack>
            )
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  )
}
