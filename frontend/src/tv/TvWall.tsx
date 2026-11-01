import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { api, errorMessage, type Screen } from '../api'
import TvScreen from './TvScreen'

/** Real TVs sync every 5 minutes; the demo syncs faster so changes show up quickly. */
const SYNC_INTERVAL_MS = 15_000

/** A wall of simulated TVs for one store. Each runs its own SDK: it pulls, caches and plays by itself. */
export default function TvWall({ storeId }: { storeId: string }) {
  const [screens, setScreens] = useState<Screen[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.screens(storeId).then(setScreens, (e) => setError(errorMessage(e)))
  }, [storeId])

  return (
    <Stack sx={{ gap: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6">Screens</Typography>
        </Box>
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
          <TvScreen key={screen.screenId} screen={screen} syncIntervalMs={SYNC_INTERVAL_MS} />
        ))}
      </Box>
    </Stack>
  )
}
