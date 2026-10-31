import { useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { ApiError, api, errorMessage, type Availability, type Screen, type Wallet } from '../api'

/** <input type="datetime-local"> works in the browser's local time (IST for the store owner). */
const toLocalInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const nextMinute = () => {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  return d
}

export default function CreateAdCard(props: {
  storeId: string
  screens: Screen[]
  wallet: Wallet | null
  onChanged: () => void
}) {
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [image, setImage] = useState<Blob | null>(null)
  const [start, setStart] = useState(() => toLocalInput(nextMinute()))
  const [end, setEnd] = useState(() => toLocalInput(new Date(nextMinute().getTime() + 30 * 60_000)))
  const [selected, setSelected] = useState<string[]>([])
  const [chosenSlots, setChosenSlots] = useState<Record<string, number>>({})
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [result, setResult] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const idempotencyKey = useRef(crypto.randomUUID()) // same key for retries of one publish attempt

  const activeScreens = props.screens.filter((s) => s.status === 'ACTIVE')
  const imagePreview = useMemo(() => (image ? URL.createObjectURL(image) : null), [image])
  useEffect(() => () => void (imagePreview && URL.revokeObjectURL(imagePreview)), [imagePreview])

  // A start time that has already passed means "start now" (the form may have been open a while).
  const startIsPast = !!start && new Date(start).getTime() < Date.now()
  const startIso = () => new Date(Math.max(new Date(start).getTime(), Date.now())).toISOString()
  const activeIds = activeScreens.map((s) => s.screenId).join(',')
  const [recheck, setRecheck] = useState(0)

  // Free slots for EVERY active screen (so the slot picker is always visible), refreshed when times change.
  useEffect(() => {
    if (!activeIds || !start || !end) {
      setAvailability(null)
      return
    }
    const timer = setTimeout(() => {
      api
        .availability({
          storeId: props.storeId,
          screenIds: activeIds.split(','),
          startTime: new Date(Math.max(new Date(start).getTime(), Date.now())).toISOString(),
          endTime: new Date(end).toISOString(),
        })
        .then((a) => {
          setAvailability(a)
          setCheckError(null)
          // Keep a still-free choice, otherwise default to the lowest free slot.
          setChosenSlots((prev) => {
            const next: Record<string, number> = {}
            a.screens.forEach((s) => {
              if (s.freeSlots.length > 0) next[s.screenId] = s.freeSlots.includes(prev[s.screenId]) ? prev[s.screenId] : s.freeSlots[0]
            })
            return next
          })
        })
        .catch((e) => {
          setAvailability(null)
          setCheckError(errorMessage(e))
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [props.storeId, activeIds, start, end, recheck])

  // Cost covers only the ticked screens.
  const freeSlotsOf = (screenId: string) => availability?.screens.find((s) => s.screenId === screenId)?.freeSlots
  const totalCost = (availability?.playsPerScreen ?? 0) * selected.length
  const available = props.wallet?.available ?? 0
  const missingCredits = Math.max(0, totalCost - available)
  const fullScreens = selected.filter((id) => (freeSlotsOf(id)?.length ?? 0) === 0)
  const canPublish =
    !busy && name.trim() && headline.trim() && image && availability && selected.length > 0 && missingCredits === 0 && fullScreens.length === 0

  const publish = async () => {
    if (!availability) return
    setBusy(true)
    try {
      const published = await api.publish(
        {
          storeId: props.storeId,
          name: name.trim(),
          headline: headline.trim(),
          startTime: startIso(),
          endTime: new Date(end).toISOString(),
          screens: selected.map((screenId) => ({ screenId, slotIndex: chosenSlots[screenId] ?? null })),
        },
        image,
        idempotencyKey.current,
      )
      setResult({
        severity: 'success',
        text: `Published! ${published.totalCost.toLocaleString('en-IN')} credits are now held for this ad.`,
      })
      idempotencyKey.current = crypto.randomUUID()
      setName('')
      setHeadline('')
      setImage(null)
      setSelected([])
      setRecheck((n) => n + 1)
      props.onChanged()
    } catch (e) {
      const text =
        e instanceof ApiError && e.code === 'SLOT_TAKEN'
          ? `${e.message}. Free slots were refreshed — pick again.`
          : errorMessage(e)
      setResult({ severity: 'error', text })
      idempotencyKey.current = crypto.randomUUID()
      setRecheck((n) => n + 1) // refresh free slots
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">Create an ad</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Your ad gets one 10-second slot in every 1-minute loop on each screen you pick, so it plays once a minute.
          1 play = 1 credit. The full cost is held now; you only pay for plays that actually air.
        </Typography>

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <Stack sx={{ gap: 2 }}>
            <TextField label="Ad name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali sweets" />
            <TextField
              label="Headline shown on screen"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="20% off on Kaju Katli"
            />
            <Stack direction="row" sx={{ gap: 2 }}>
              <TextField
                label="Starts"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Ends"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ flex: 1 }}
              />
            </Stack>
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="outlined" component="label">
                Upload image
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  onChange={(e) => setImage(e.target.files?.[0] ?? null)}
                />
              </Button>
              <Button onClick={() => void sampleImage(headline || name || 'Fresh offers today').then(setImage)}>
                Generate sample image
              </Button>
            </Stack>
            <Box
              sx={{
                aspectRatio: '16 / 9',
                borderRadius: 1.5,
                border: '1px dashed',
                borderColor: 'divider',
                overflow: 'hidden',
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'action.hover',
              }}
            >
              {imagePreview ? (
                <Box component="img" src={imagePreview} alt="Ad preview" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Typography variant="caption" color="text.secondary">
                  Image preview
                </Typography>
              )}
            </Box>
          </Stack>

          <Stack sx={{ gap: 1 }}>
            <Typography variant="subtitle2">Screens and slots</Typography>
            <Typography variant="caption" color="text.secondary">
              Tick the screens you want. Pick a slot on each (grey = already booked in this time range).
            </Typography>
            {startIsPast && (
              <Typography variant="caption" color="warning.main">
                The start time has passed, so the ad will start now.
              </Typography>
            )}
            {checkError && <Alert severity="warning">Can't check free slots: {checkError}</Alert>}
            {activeScreens.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No active screens. Add one in the Screens card.
              </Typography>
            )}
            {activeScreens.map((screen) => {
              const free = freeSlotsOf(screen.screenId)
              const isSelected = selected.includes(screen.screenId)
              const select = () => setSelected((s) => (s.includes(screen.screenId) ? s : [...s, screen.screenId]))
              return (
                <Box key={screen.screenId} sx={{ p: 1, borderRadius: 1.5, bgcolor: isSelected ? 'action.selected' : 'transparent' }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={isSelected}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked ? [...s, screen.screenId] : s.filter((id) => id !== screen.screenId),
                          )
                        }
                      />
                    }
                    label={screen.name}
                  />
                  {!free && !checkError && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4 }}>
                      Checking free slots…
                    </Typography>
                  )}
                  {free && (
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', pl: 4, opacity: isSelected ? 1 : 0.6 }}>
                      {Array.from({ length: screen.slotsPerLoop }, (_, slot) => {
                        const isFree = free.includes(slot)
                        return (
                          <Chip
                            key={slot}
                            size="small"
                            label={`Slot ${slot}`}
                            disabled={!isFree}
                            color={chosenSlots[screen.screenId] === slot ? 'primary' : 'default'}
                            variant={chosenSlots[screen.screenId] === slot ? 'filled' : 'outlined'}
                            onClick={() => {
                              setChosenSlots((c) => ({ ...c, [screen.screenId]: slot }))
                              select() // picking a slot also ticks the screen
                            }}
                          />
                        )
                      })}
                      {free.length === 0 && (
                        <Typography variant="caption" color="error">
                          All 6 slots are booked for this time range
                        </Typography>
                      )}
                    </Stack>
                  )}
                </Box>
              )
            })}

            <Divider sx={{ my: 1 }} />
            {availability && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 0.5, typography: 'body2' }}>
                <span>Plays per screen</span>
                <b>{availability.playsPerScreen.toLocaleString('en-IN')}</b>
                <span>Screens</span>
                <b>× {selected.length}</b>
                <span>Total cost (held now)</span>
                <b>{totalCost.toLocaleString('en-IN')} credits</b>
                <span>Available</span>
                <b>{available.toLocaleString('en-IN')}</b>
              </Box>
            )}
            {missingCredits > 0 && (
              <Alert severity="error">
                You need {missingCredits.toLocaleString('en-IN')} more credits. Buy credits or shorten the ad.
              </Alert>
            )}
            {result && <Alert severity={result.severity}>{result.text}</Alert>}
            <Button variant="contained" size="large" disabled={!canPublish} onClick={() => void publish()}>
              Publish ad
            </Button>
            {!image && (
              <Typography variant="caption" color="text.secondary">
                Add an image to publish (image ads only).
              </Typography>
            )}
          </Stack>
        </Box>
      </CardContent>
    </Card>
  )
}

/** Draws a simple 16:9 ad so the demo works without hunting for an image file. */
function sampleImage(text: string): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  const hue = Math.floor(Math.random() * 360)
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720)
  gradient.addColorStop(0, `hsl(${hue}, 75%, 45%)`)
  gradient.addColorStop(1, `hsl(${(hue + 50) % 360}, 80%, 30%)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1280, 720)
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.beginPath()
  ctx.arc(1050, 160, 260, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 72px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(text.slice(0, 28), 640, 360)
  ctx.font = '36px system-ui, sans-serif'
  ctx.fillText('Only at this store', 640, 430)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
