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
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
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

const STEPS = ['Ad details', 'Screens and slots', 'Review and publish']

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function CreateAdCard(props: {
  storeId: string
  screens: Screen[]
  wallet: Wallet | null
  onChanged: () => void
}) {
  const [step, setStep] = useState(0) // STEPS.length = finished
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [image, setImage] = useState<Blob | null>(null)
  const [start, setStart] = useState(() => toLocalInput(nextMinute()))
  const [end, setEnd] = useState(() => toLocalInput(new Date(nextMinute().getTime() + 30 * 60_000)))
  // screenId -> the slots picked on it. A screen counts as selected when it has at least one slot.
  const [picked, setPicked] = useState<Record<string, number[]>>({})
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [result, setResult] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [recheck, setRecheck] = useState(0)
  const idempotencyKey = useRef(crypto.randomUUID()) // same key for retries of one publish attempt

  const activeScreens = props.screens.filter((s) => s.status === 'ACTIVE')
  const imagePreview = useMemo(() => (image ? URL.createObjectURL(image) : null), [image])
  useEffect(() => () => void (imagePreview && URL.revokeObjectURL(imagePreview)), [imagePreview])

  // A start time that has already passed means "start now" (the form may have been open a while).
  const startIsPast = !!start && new Date(start).getTime() < Date.now()
  const startIso = () => new Date(Math.max(new Date(start).getTime(), Date.now())).toISOString()
  const endAfterStart = !!start && !!end && new Date(end).getTime() > Math.max(new Date(start).getTime(), Date.now())
  const detailsDone = !!name.trim() && !!headline.trim() && !!image && endAfterStart
  const activeIds = activeScreens.map((s) => s.screenId).join(',')
  const onScreensStep = step >= 1

  // Free slots are fetched only once the ad details (and so the time range) are filled in.
  useEffect(() => {
    if (!onScreensStep || !activeIds) {
      setAvailability(null)
      return
    }
    setAvailability(null)
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
        // Keep only picks that are still free.
        setPicked((prev) => {
          const next: Record<string, number[]> = {}
          a.screens.forEach((s) => {
            const still = (prev[s.screenId] ?? []).filter((slot) => s.freeSlots.includes(slot))
            if (still.length > 0) next[s.screenId] = still
          })
          return next
        })
      })
      .catch((e) => {
        setAvailability(null)
        setCheckError(errorMessage(e))
      })
    // activeIds is a string, so the list of screens refreshing every 10 s doesn't refetch.
  }, [props.storeId, activeIds, onScreensStep, recheck])

  // Cost = plays per slot × every slot picked, across all screens.
  const freeSlotsOf = (screenId: string) => availability?.screens.find((s) => s.screenId === screenId)?.freeSlots
  const selected = Object.keys(picked).filter((id) => picked[id].length > 0)
  const slotCount = selected.reduce((sum, id) => sum + picked[id].length, 0)
  const totalCost = (availability?.playsPerScreen ?? 0) * slotCount
  const available = props.wallet?.available ?? 0
  const missingCredits = Math.max(0, totalCost - available)
  const screensDone = !!availability && slotCount > 0
  const toggleSlot = (screenId: string, slot: number) =>
    setPicked((p) => {
      const current = p[screenId] ?? []
      const next = current.includes(slot) ? current.filter((s) => s !== slot) : [...current, slot].sort((a, b) => a - b)
      return { ...p, [screenId]: next }
    })
  const canPublish = !busy && detailsDone && screensDone && missingCredits === 0

  const reset = () => {
    idempotencyKey.current = crypto.randomUUID()
    setName('')
    setHeadline('')
    setImage(null)
    setPicked({})
    setStart(toLocalInput(nextMinute()))
    setEnd(toLocalInput(new Date(nextMinute().getTime() + 30 * 60_000)))
    setResult(null)
    setStep(0)
  }

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
          screens: selected.flatMap((screenId) => picked[screenId].map((slotIndex) => ({ screenId, slotIndex }))),
        },
        image,
        idempotencyKey.current,
      )
      setResult({
        severity: 'success',
        text: `Published "${name.trim()}" on ${slotCount} slot(s) across ${selected.length} screen(s). ${published.totalCost.toLocaleString('en-IN')} credits are now held for this ad.`,
      })
      setStep(STEPS.length)
      props.onChanged()
    } catch (e) {
      idempotencyKey.current = crypto.randomUUID()
      if (e instanceof ApiError && e.code === 'SLOT_TAKEN') {
        setResult({ severity: 'error', text: `${e.message}. Free slots were refreshed — pick again.` })
        setStep(1)
        setRecheck((n) => n + 1)
      } else {
        setResult({ severity: 'error', text: errorMessage(e) })
      }
    } finally {
      setBusy(false)
    }
  }

  const goTo = (next: number) => {
    setResult(null)
    if (next === 1 && step === 0) setRecheck((n) => n + 1) // details may have changed: fetch fresh slots
    setStep(next)
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">Create an ad</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Each screen loops 6 slots of 10 seconds. Every slot you pick plays your ad once a minute.
          1 play = 1 credit. Credits are reserved now. You pay only for plays shown; unused credits are refunded.
        </Typography>

        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map((label, index) => {
            const caption =
              index === 0 && step > 0 ? name.trim() : index === 1 && step > 1 ? `${slotCount} slot(s) on ${selected.length} screen(s)` : undefined
            return (
              <Step key={label} completed={step > index}>
                <StepLabel optional={caption && <Typography variant="caption">{caption}</Typography>}>{label}</StepLabel>
              </Step>
            )
          })}
        </Stepper>

        {result && step < STEPS.length && (
          <Alert severity={result.severity} sx={{ mb: 2 }} onClose={() => setResult(null)}>
            {result.text}
          </Alert>
        )}

        {step === 0 && (
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
                  error={!!end && !endAfterStart}
                  helperText={!!end && !endAfterStart ? 'Must be after the start' : undefined}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ flex: 1 }}
                />
              </Stack>
              {startIsPast && (
                <Typography variant="caption" color="warning.main">
                  The start time has passed, so the ad will start now.
                </Typography>
              )}
              <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button variant="outlined" component="label">
                  Upload image
                  <input hidden type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
                </Button>
                <Button onClick={() => void sampleImage(headline || name || 'Fresh offers today').then(setImage)}>
                  Generate sample image
                </Button>
              </Stack>
            </Stack>
            <ImagePreview src={imagePreview} />
          </Box>
        )}

        {step === 1 && (
          <Stack sx={{ gap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Free slots for {formatTime(startIso())} → {formatTime(new Date(end).toISOString())}. Pick one or more
              slots on each screen you want, or tick a screen to take all its free slots (grey = already booked in this time range).
            </Typography>
            {checkError && <Alert severity="warning">Can't check free slots: {checkError}</Alert>}
            {activeScreens.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No active screens in this store.
              </Typography>
            )}
            {!availability && !checkError && activeScreens.length > 0 && (
              <Typography variant="body2" color="text.secondary">
                Fetching available screens…
              </Typography>
            )}
            {availability &&
              activeScreens.map((screen) => {
                const free = freeSlotsOf(screen.screenId) ?? []
                const mine = picked[screen.screenId] ?? []
                const isSelected = mine.length > 0
                return (
                  <Box key={screen.screenId} sx={{ p: 1, borderRadius: 1.5, bgcolor: isSelected ? 'action.selected' : 'transparent' }}>
                    <FormControlLabel
                      disabled={free.length === 0}
                      control={
                        <Checkbox
                          checked={isSelected}
                          indeterminate={isSelected && mine.length < free.length}
                          // Ticking the screen picks every free slot; unticking clears them.
                          onChange={(e) => setPicked((p) => ({ ...p, [screen.screenId]: e.target.checked ? [...free] : [] }))}
                        />
                      }
                      label={
                        <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                          <span>{screen.name}</span>
                          {isSelected && (
                            <Typography variant="caption" color="text.secondary">
                              {mine.length} slot(s)
                            </Typography>
                          )}
                          <Chip
                            size="small"
                            label={screen.online ? 'Online' : 'Offline'}
                            color={screen.online ? 'success' : 'default'}
                            variant="outlined"
                          />
                        </Stack>
                      }
                    />
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', pl: 4, opacity: isSelected ? 1 : 0.6 }}>
                      {Array.from({ length: screen.slotsPerLoop }, (_, slot) => {
                        const isFree = free.includes(slot)
                        const chosen = mine.includes(slot)
                        return (
                          <Chip
                            key={slot}
                            size="small"
                            label={`Slot ${slot}`}
                            disabled={!isFree}
                            color={chosen ? 'primary' : 'default'}
                            variant={chosen ? 'filled' : 'outlined'}
                            onClick={() => toggleSlot(screen.screenId, slot)}
                          />
                        )
                      })}
                      {free.length === 0 && (
                        <Typography variant="caption" color="error">
                          All 6 slots are booked for this time range
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                )
              })}
            {availability && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {slotCount} slot(s) × {availability.playsPerScreen.toLocaleString('en-IN')} plays ={' '}
                <b>{totalCost.toLocaleString('en-IN')} credits</b>
              </Typography>
            )}
          </Stack>
        )}

        {step === 2 && availability && (
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            <Stack sx={{ gap: 1 }}>
              <ImagePreview src={imagePreview} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {headline}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {name} · {formatTime(startIso())} → {formatTime(new Date(end).toISOString())}
              </Typography>
            </Stack>
            <Stack sx={{ gap: 1 }}>
              <Typography variant="subtitle2">Screens</Typography>
              {selected.map((id) => (
                <Typography key={id} variant="body2">
                  {props.screens.find((s) => s.screenId === id)?.name} · Slot {picked[id].join(', ')}
                </Typography>
              ))}
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 0.5, typography: 'body2' }}>
                <span>Plays per slot</span>
                <b>{availability.playsPerScreen.toLocaleString('en-IN')}</b>
                <span>Slots ({selected.length} screen(s))</span>
                <b>× {slotCount}</b>
                <span>Total cost (held now)</span>
                <b>{totalCost.toLocaleString('en-IN')} credits</b>
                <span>Available</span>
                <b>{available.toLocaleString('en-IN')}</b>
              </Box>
              {missingCredits > 0 && (
                <Alert severity="error">
                  You need {missingCredits.toLocaleString('en-IN')} more credits. Buy credits from the wallet or shorten the ad.
                </Alert>
              )}
            </Stack>
          </Box>
        )}

        {step === STEPS.length ? (
          <>
            {result && <Alert severity={result.severity}>{result.text}</Alert>}
            <Box sx={{ display: 'flex', flexDirection: 'row', pt: 2 }}>
              <Box sx={{ flex: '1 1 auto' }} />
              <Button onClick={reset}>Create another ad</Button>
            </Box>
          </>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'row', pt: 3 }}>
            <Button color="inherit" disabled={step === 0 || busy} onClick={() => goTo(step - 1)} sx={{ mr: 1 }}>
              Back
            </Button>
            <Box sx={{ flex: '1 1 auto' }} />
            {step < STEPS.length - 1 ? (
              <Button variant="contained" disabled={step === 0 ? !detailsDone : !screensDone} onClick={() => goTo(step + 1)}>
                Next
              </Button>
            ) : (
              <Button variant="contained" disabled={!canPublish} onClick={() => void publish()}>
                {busy ? 'Publishing…' : 'Publish ad'}
              </Button>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

function ImagePreview({ src }: { src: string | null }) {
  return (
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
      {src ? (
        <Box component="img" src={src} alt="Ad preview" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Typography variant="caption" color="text.secondary">
          Image preview (image ads only)
        </Typography>
      )}
    </Box>
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
