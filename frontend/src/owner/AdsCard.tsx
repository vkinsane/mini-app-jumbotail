import { Fragment, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { api, errorMessage, type AdDetail, type AdStatus, type AdSummary } from '../api'

const statusColor: Record<AdStatus, 'success' | 'warning' | 'default' | 'info'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  CANCELLED: 'default',
  ENDED: 'info',
}

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })

export default function AdsCard(props: { storeId: string; version: number; onChanged: () => void }) {
  const [ads, setAds] = useState<AdSummary[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    api.ads(props.storeId).then(setAds, () => setAds([]))
  }, [props.storeId, props.version])

  const act = async (action: () => Promise<unknown>, done: string) => {
    try {
      const result = await action()
      const released = (result as { releasedCredits?: number }).releasedCredits
      setMessage({ severity: 'success', text: released !== undefined ? `${done}: ${released} credits returned` : done })
      props.onChanged()
    } catch (e) {
      setMessage({ severity: 'error', text: errorMessage(e) })
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">Your ads</Typography>
        {message && (
          <Alert severity={message.severity} sx={{ my: 1 }} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Ad</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Runs</TableCell>
                <TableCell align="right">Cost</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ads.map((ad) => (
                <Fragment key={ad.adId}>
                  <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => setOpen(open === ad.adId ? null : ad.adId)}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {ad.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {ad.headline}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={ad.status} color={statusColor[ad.status]} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {when(ad.startTime)} → {when(ad.endTime)}
                    </TableCell>
                    <TableCell align="right">{ad.totalCost.toLocaleString('en-IN')}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: 'nowrap' }}>
                      {ad.status === 'ACTIVE' && (
                        <Button size="small" onClick={() => void act(() => api.pause(ad.adId), 'Paused')}>
                          Pause
                        </Button>
                      )}
                      {ad.status === 'PAUSED' && (
                        <Button size="small" onClick={() => void act(() => api.resume(ad.adId), 'Resumed')}>
                          Resume
                        </Button>
                      )}
                      {(ad.status === 'ACTIVE' || ad.status === 'PAUSED') && (
                        <Button size="small" color="error" onClick={() => void act(() => api.cancel(ad.adId), 'Cancelled')}>
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 0, borderBottom: open === ad.adId ? undefined : 'none' }}>
                      <Collapse in={open === ad.adId} unmountOnExit>
                        <AdDetailPanel adId={ad.adId} version={props.version} />
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Box>
        {ads.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No ads yet. Create one above.
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

/** What the owner actually paid for: per day, plays booked vs charged vs returned. */
function AdDetailPanel({ adId, version }: { adId: string; version: number }) {
  const [detail, setDetail] = useState<AdDetail | null>(null)

  useEffect(() => {
    api.adDetail(adId).then(setDetail, () => setDetail(null))
  }, [adId, version])

  if (!detail) return null
  return (
    <Stack sx={{ gap: 1.5, py: 2 }}>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="body2">Booked on:</Typography>
        {detail.screens.map((s) => (
          <Chip
            key={s.screenId}
            size="small"
            variant="outlined"
            label={`${s.screenName} · slot ${s.slotIndex}${s.active ? '' : ' (freed)'}`}
          />
        ))}
        <Typography variant="body2" color="text.secondary">
          · {detail.playsReceived} plays reported by screens
        </Typography>
      </Stack>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Day</TableCell>
            <TableCell align="right">Booked plays</TableCell>
            <TableCell align="right">Held</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Charged</TableCell>
            <TableCell align="right">Returned</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {detail.dailyBilling.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.date}</TableCell>
              <TableCell align="right">{row.bookedPlays}</TableCell>
              <TableCell align="right">{row.held}</TableCell>
              <TableCell>
                <Chip size="small" label={row.status} color={row.status === 'SETTLED' ? 'success' : 'default'} variant="outlined" />
              </TableCell>
              <TableCell align="right">{row.status === 'SETTLED' ? row.deducted : '—'}</TableCell>
              <TableCell align="right">{row.status === 'SETTLED' ? row.released : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  )
}
