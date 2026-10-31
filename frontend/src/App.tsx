import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { api, errorMessage, type Store } from './api'
import OwnerConsole from './owner/OwnerConsole'
import TvWall from './tv/TvWall'

type Page = 'owner' | 'tv'

const pageFromHash = (): Page => (window.location.hash === '#tv' ? 'tv' : 'owner')

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState<string>(() => localStorage.getItem('j24.storeId') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const loadStores = useCallback(async (select?: string) => {
    try {
      const list = await api.stores()
      setStores(list)
      setStoreId((current) => {
        const next = select ?? (list.some((s) => s.storeId === current) ? current : (list[0]?.storeId ?? ''))
        localStorage.setItem('j24.storeId', next)
        return next
      })
      setError(null)
    } catch (e) {
      setError(`Backend not reachable: ${errorMessage(e)}`)
    }
  }, [])

  useEffect(() => {
    void loadStores()
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [loadStores])

  const changePage = (next: Page) => {
    window.location.hash = next === 'tv' ? 'tv' : ''
    setPage(next)
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: { xs: 1, sm: 0 } }}>
          <Typography variant="h6" sx={{ fontWeight: 800, color: 'primary.main' }}>
            J24 Screen Ads
          </Typography>
          <Tabs value={page} onChange={(_, value: Page) => changePage(value)} sx={{ flex: 1, minWidth: 240 }}>
            <Tab value="owner" label="Owner console" />
            <Tab value="tv" label="TV wall" />
          </Tabs>
          <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
            <TextField
              select
              size="small"
              label="Store"
              value={stores.some((s) => s.storeId === storeId) ? storeId : ''}
              onChange={(e) => {
                localStorage.setItem('j24.storeId', e.target.value)
                setStoreId(e.target.value)
              }}
              sx={{ minWidth: 200 }}
            >
              {stores.map((store) => (
                <MenuItem key={store.storeId} value={store.storeId}>
                  {store.name}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" onClick={() => setCreating(true)}>
              New store
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth={page === 'tv' ? false : 'xl'} sx={{ py: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {storeId && page === 'owner' && <OwnerConsole key={storeId} storeId={storeId} />}
        {storeId && page === 'tv' && <TvWall key={storeId} storeId={storeId} />}
        {!storeId && !error && <Alert severity="info">Create a store to get started.</Alert>}
      </Container>

      <CreateStoreDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          void loadStores(id)
        }}
      />
    </Box>
  )
}

function CreateStoreDialog(props: { open: boolean; onClose: () => void; onCreated: (storeId: string) => void }) {
  const [form, setForm] = useState({ name: '', ownerName: '', phone: '', address: '' })
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    try {
      const { storeId } = await api.createStore(form)
      setForm({ name: '', ownerName: '', phone: '', address: '' })
      setError(null)
      props.onCreated(storeId)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogTitle>Onboard a store</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Store name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField
            label="Owner name"
            required
            value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
          />
          <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <TextField label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Typography variant="caption" color="text.secondary">
            The store starts with an empty wallet. Add screens and buy credits from the owner console.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={!form.name || !form.ownerName}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}
