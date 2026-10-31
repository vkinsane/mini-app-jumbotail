import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { Screen } from '../api'
import { useScreenSdk, type Showing } from './useScreenSdk'

const placementLabel: Record<Screen['placementType'], string> = {
  ENTRANCE: 'Entrance',
  NEAR_CHECKOUT: 'Near checkout',
  AISLE: 'Aisle',
  OTHER: 'Other',
}

const houseReason: Record<string, string> = {
  NO_AD: 'No ad booked for this slot',
  NO_PLAYLIST: 'Waiting for first sync',
  PLAYLIST_EXPIRED: 'Cached playlist expired (offline > 3 days)',
  MEDIA_MISSING: 'Ad image missing — not billed',
  SCREEN_INACTIVE: 'Screen marked INACTIVE',
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString() : '—')

export default function TvScreen({ screen, syncIntervalMs }: { screen: Screen; syncIntervalMs: number }) {
  const [online, setOnline] = useState(true)
  const [powered, setPowered] = useState(true)
  const { state, syncNow, resetCache } = useScreenSdk(screen.screenId, { online, powered, syncIntervalMs })
  const slots = Array.from({ length: state.playlist?.slotsPerLoop ?? screen.slotsPerLoop }, (_, i) => i)
  const slotSeconds = state.playlist?.slotDurationSeconds ?? screen.slotDurationSeconds
  const [clockMs, setClockMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setClockMs(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  const now = clockMs + state.clockOffsetMs // server time, same clock the SDK plays by
  const secondsIntoSlot = Math.floor(now / 1000) % slotSeconds
  const liveItems = (state.playlist?.items ?? []).filter(
    (i) => Date.parse(i.startTime) <= now && now < Date.parse(i.endTime),
  )

  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            {screen.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {placementLabel[screen.placementType]} · {screen.screenId.slice(0, 8)}
          </Typography>
        </Box>
        <Chip
          size="small"
          label={!powered ? 'Power off' : online ? 'Online' : 'Offline'}
          color={!powered ? 'default' : online ? 'success' : 'warning'}
        />
      </Stack>

      <TvFrame showing={state.showing} />

      <Box>
        <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            1-minute loop · {slots.length} slots × {slotSeconds}s
          </Typography>
          {powered && (
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Slot {state.slotIndex} · {slotSeconds - secondsIntoSlot}s left
            </Typography>
          )}
        </Stack>
        <Stack direction="row" sx={{ gap: 0.5 }}>
          {slots.map((slot) => {
            const item = liveItems.find((i) => i.slotIndex === slot)
            const isCurrent = powered && slot === state.slotIndex
            const from = slot * slotSeconds
            return (
              <Tooltip
                key={slot}
                title={`Seconds ${from}–${from + slotSeconds} of every minute · ${item ? item.name : 'house content'}`}
              >
                <Box
                  sx={{
                    position: 'relative',
                    flex: 1,
                    minWidth: 0,
                    py: 0.5,
                    borderRadius: 1,
                    overflow: 'hidden',
                    textAlign: 'center',
                    lineHeight: 1.2,
                    color: item ? 'primary.contrastText' : 'text.secondary',
                    bgcolor: item ? 'primary.main' : 'action.hover',
                    outline: isCurrent ? '2px solid' : 'none',
                    outlineColor: 'secondary.main',
                    outlineOffset: 1,
                  }}
                >
                  {isCurrent && (
                    // Fills up over the slot's 10 seconds.
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 0,
                        bottom: 0,
                        height: 3,
                        width: `${(secondsIntoSlot / slotSeconds) * 100}%`,
                        bgcolor: 'secondary.main',
                        transition: 'width 0.25s linear',
                      }}
                    />
                  )}
                  <Box sx={{ fontSize: 11, fontWeight: 700 }}>{slot}</Box>
                  <Box sx={{ fontSize: 9, opacity: 0.85 }}>
                    {from}–{from + slotSeconds}s
                  </Box>
                </Box>
              </Tooltip>
            )
          })}
        </Stack>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1, typography: 'caption' }}>
        <span>Queued play logs</span>
        <b>{state.queue.length}</b>
        <span>Plays written</span>
        <b>{state.playsWritten}</b>
        <span>Ads in playlist</span>
        <b>{state.playlist?.items.length ?? 0}</b>
        <span>Last sync</span>
        <b>{state.syncing ? 'syncing…' : time(state.lastSyncAt)}</b>
        <span>Cache valid until</span>
        <b>{state.playlist ? new Date(state.playlist.validUntil).toLocaleString() : '—'}</b>
      </Box>
      {state.lastError && online && powered && (
        <Typography variant="caption" color="error">
          Sync failed: {state.lastError} (retrying)
        </Typography>
      )}

      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
        <FormControlLabel
          control={<Switch size="small" checked={online} onChange={(e) => setOnline(e.target.checked)} />}
          label={<Typography variant="caption">Wi-Fi</Typography>}
        />
        <FormControlLabel
          control={<Switch size="small" checked={powered} onChange={(e) => setPowered(e.target.checked)} />}
          label={<Typography variant="caption">Power</Typography>}
        />
        <Button size="small" onClick={() => void syncNow()} disabled={!online || !powered}>
          Sync now
        </Button>
        <Button size="small" color="inherit" onClick={resetCache}>
          Clear cache
        </Button>
      </Stack>
    </Paper>
  )
}

function TvFrame({ showing }: { showing: Showing }) {
  return (
    <Box
      sx={{
        position: 'relative',
        aspectRatio: '16 / 9',
        borderRadius: 1.5,
        overflow: 'hidden',
        bgcolor: '#111',
        border: '6px solid #222',
      }}
    >
      {showing.kind === 'OFF' && null}
      {showing.kind === 'HOUSE' && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            color: '#fff',
            background: 'linear-gradient(135deg, #00695c 0%, #004d40 100%)',
            p: 1,
          }}
        >
          <Box>
            <Typography sx={{ fontWeight: 800, letterSpacing: 2 }}>J24</Typography>
            <Typography variant="caption" sx={{ display: 'block', opacity: 0.85 }}>
              Shop smart · Save more
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', opacity: 0.6, mt: 0.5 }}>
              {houseReason[showing.reason]}
            </Typography>
          </Box>
        </Box>
      )}
      {showing.kind === 'AD' && (
        <>
          {showing.imageSrc ? (
            <Box
              component="img"
              src={showing.imageSrc}
              alt={showing.item.headline}
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #d84315, #ff8a65)' }} />
          )}
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              p: 1,
              color: '#fff',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {showing.item.headline}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {showing.item.name} · slot {showing.item.slotIndex}
            </Typography>
          </Box>
        </>
      )}
    </Box>
  )
}
