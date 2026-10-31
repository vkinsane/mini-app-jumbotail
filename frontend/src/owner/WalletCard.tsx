import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { api, errorMessage, type Wallet } from '../api'

export default function WalletCard(props: { storeId: string; wallet: Wallet | null; onChanged: () => void }) {
  const [credits, setCredits] = useState('5000')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const buy = async () => {
    setBusy(true)
    try {
      await api.buyCredits(props.storeId, Number(credits))
      setError(null)
      props.onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Wallet
        </Typography>
        <Stack direction="row" sx={{ gap: 2, mb: 2 }}>
          <Amount label="Available" value={props.wallet?.available} hint="free to spend" />
          <Amount label="Held" value={props.wallet?.held} hint="reserved for booked ads" />
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}
        <Stack direction="row" sx={{ gap: 1 }}>
          <TextField
            size="small"
            type="number"
            label="Credits (1 credit = ₹1)"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            sx={{ flex: 1 }}
          />
          <Button variant="contained" onClick={() => void buy()} disabled={busy || !(Number(credits) > 0)}>
            Buy
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Mock payment gateway: the charge always succeeds instantly.
        </Typography>
      </CardContent>
    </Card>
  )
}

function Amount({ label, value, hint }: { label: string; value: number | undefined; hint: string }) {
  return (
    <Box sx={{ flex: 1, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {value === undefined ? '—' : value.toLocaleString('en-IN')}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    </Box>
  )
}
