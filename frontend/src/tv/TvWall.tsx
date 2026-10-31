import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { api, errorMessage, type Screen } from '../api'
import TvScreen from './TvScreen'

const SYNC_INTERVALS = [
  { ms: 15_000, label: 'Every 15 seconds (demo)' },
  { ms: 60_000, label: 'Every minute' },
  { ms: 300_000, label: 'Every 5 minutes (real)' },
]

/** A wall of simulated TVs for one store. Each runs its own SDK: it pulls, caches and plays by itself. */
export default function TvWall({ storeId }: { storeId: string }) {
  const [screens, setScreens] = useState<Screen[]>([])
  const [error, setError] = useState<string | null>(null)
  const [syncIntervalMs, setSyncIntervalMs] = useState(SYNC_INTERVALS[0].ms)

  useEffect(() => {
    api.screens(storeId).then(setScreens, (e) => setError(errorMessage(e)))
  }, [storeId])

  return (
    <Stack sx={{ gap: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6">Screens</Typography>
          <Typography variant="body2" color="text.secondary">
            Each TV runs the J24 SDK: it pulls its 3-day playlist, plays from its cache every 10 seconds and
            uploads play logs. Turn Wi-Fi off to see offline playback; turn it back on to see the queue drain.
          </Typography>
        </Box>
        <TextField
          select
          size="small"
          label="Screen sync"
          value={syncIntervalMs}
          onChange={(e) => setSyncIntervalMs(Number(e.target.value))}
          sx={{ minWidth: 230 }}
        >
          {SYNC_INTERVALS.map((option) => (
            <MenuItem key={option.ms} value={option.ms}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {screens.length === 0 && !error && <Alert severity="info">This store has no screens yet.</Alert>}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)', xl: 'repeat(5, 1fr)' },
        }}
      >
        {screens.map((screen) => (
          <TvScreen key={screen.screenId} screen={screen} syncIntervalMs={syncIntervalMs} />
        ))}
      </Box>
    </Stack>
  )
}
