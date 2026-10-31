import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { api, errorMessage, type PlacementType, type Screen } from '../api'

const PLACEMENTS: { value: PlacementType; label: string }[] = [
  { value: 'ENTRANCE', label: 'Entrance' },
  { value: 'NEAR_CHECKOUT', label: 'Near checkout' },
  { value: 'AISLE', label: 'Aisle' },
  { value: 'OTHER', label: 'Other' },
]

export default function ScreensCard(props: { storeId: string; screens: Screen[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [placementType, setPlacementType] = useState<PlacementType>('AISLE')
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      setError(null)
      props.onChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">Screens</Typography>
        <Typography variant="caption" color="text.secondary">
          Each screen loops 6 slots × 10 s. "Online" = synced in the last 10 minutes.
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <List dense>
          {props.screens.map((screen) => (
            <ListItem
              key={screen.screenId}
              disableGutters
              secondaryAction={
                <Tooltip title={screen.status === 'ACTIVE' ? 'Mark INACTIVE (broken / removed)' : 'Mark ACTIVE'}>
                  <Switch
                    edge="end"
                    checked={screen.status === 'ACTIVE'}
                    onChange={(e) =>
                      void run(() => api.setScreenStatus(screen.screenId, e.target.checked ? 'ACTIVE' : 'INACTIVE'))
                    }
                  />
                </Tooltip>
              }
            >
              <ListItemText
                primary={
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                    <span>{screen.name}</span>
                    <Chip
                      size="small"
                      label={screen.online ? 'Online' : 'Offline'}
                      color={screen.online ? 'success' : 'default'}
                      variant="outlined"
                    />
                  </Stack>
                }
                secondary={`${PLACEMENTS.find((p) => p.value === screen.placementType)?.label} · ${screen.status} · last seen ${
                  screen.lastSeenAt ? new Date(screen.lastSeenAt).toLocaleTimeString() : 'never'
                }`}
              />
            </ListItem>
          ))}
        </List>
        <Stack direction="row" sx={{ gap: 1 }}>
          <TextField size="small" label="New screen name" value={name} onChange={(e) => setName(e.target.value)} sx={{ flex: 1 }} />
          <TextField
            select
            size="small"
            label="Placement"
            value={placementType}
            onChange={(e) => setPlacementType(e.target.value as PlacementType)}
            sx={{ width: 150 }}
          >
            {PLACEMENTS.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            disabled={!name.trim()}
            onClick={() =>
              void run(async () => {
                await api.createScreen(props.storeId, { name: name.trim(), placementType })
                setName('')
              })
            }
          >
            Add
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
