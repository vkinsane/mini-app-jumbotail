import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { api, errorMessage, type OpsAlert } from '../api'

/** J24-side tools for the demo: run settlement now, and see the screen-health alerts J24 ops gets. */
export default function OpsCard({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [skipGrace, setSkipGrace] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<OpsAlert[]>([])

  useEffect(() => {
    api.alerts().then(setAlerts, () => setAlerts([]))
  }, [version])

  const settle = async () => {
    try {
      const r = await api.runSettlement(skipGrace)
      setResult(`Settled ${r.settled} ad-day(s): charged ${r.deducted}, returned ${r.released}`)
      onChanged()
    } catch (e) {
      setResult(errorMessage(e))
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">J24 ops (demo)</Typography>
        <Typography variant="caption" color="text.secondary">
          Settlement runs every minute on its own. A day settles after the ad's window ends and every booked screen has
          synced (or after 72 hours).
        </Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => void settle()}>
            Run settlement now
          </Button>
          <FormControlLabel
            control={<Checkbox size="small" checked={skipGrace} onChange={(e) => setSkipGrace(e.target.checked)} />}
            label={<Typography variant="caption">Don't wait for offline screens</Typography>}
          />
        </Stack>
        {result && (
          <Alert severity="info" sx={{ mt: 1 }}>
            {result}
          </Alert>
        )}
        <Typography variant="subtitle2" sx={{ mt: 2 }}>
          Screen alerts
        </Typography>
        {alerts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            All screens healthy.
          </Typography>
        ) : (
          alerts.map((alert) => (
            <Alert key={alert.screenId} severity="warning" sx={{ mt: 1 }}>
              {alert.screenName}: {alert.reason}. J24 will inform the store owner.
            </Alert>
          ))
        )}
      </CardContent>
    </Card>
  )
}
