import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined'
import OpenInNew from '@mui/icons-material/OpenInNew'
import { api, errorMessage, type Store, type Wallet } from './api'
import OwnerConsole from './owner/OwnerConsole'
import WalletDialog from './owner/WalletDialog'
import TvWall from './tv/TvWall'

type Page = 'owner' | 'tv'

const pageFromHash = (): Page => (window.location.hash === '#tv' ? 'tv' : 'owner')

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState<string>(() => localStorage.getItem('j24.storeId') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [walletVersion, setWalletVersion] = useState(0)
  const [walletOpen, setWalletOpen] = useState(false)
  const refreshWallet = useCallback(() => setWalletVersion((v) => v + 1), [])

  useEffect(() => {
    if (!storeId) return
    api.wallet(storeId).then(setWallet, () => setWallet(null))
  }, [storeId, walletVersion])

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
    // The Screens page opens in its own browser tab, so it can run next to the owner console.
    if (next === 'tv' && page !== 'tv') {
      window.open('/#tv', '_blank', 'noopener')
      return
    }
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
          {/* The Screens page runs in its own browser tab, like the TVs in the store: no console navigation or wallet. */}
          {page === 'owner' ? (
            <Tabs value={page} onChange={(_, value: Page) => changePage(value)} sx={{ flex: 1, minWidth: 240 }}>
              <Tab value="owner" label="Owner console" />
              <Tab value="tv" label="Screens" icon={<OpenInNew fontSize="small" />} iconPosition="end" sx={{ minHeight: 48 }} />
            </Tabs>
          ) : (
            <Box sx={{ flex: 1 }} />
          )}
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
            {storeId && page === 'owner' && (
              <Button variant="contained" startIcon={<AccountBalanceWalletOutlined />} onClick={() => setWalletOpen(true)}>
                {wallet ? `${wallet.available.toLocaleString('en-IN')} credits` : 'Wallet'}
              </Button>
            )}
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth={page === 'tv' ? false : 'xl'} sx={{ py: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {storeId && page === 'owner' && <OwnerConsole key={storeId} storeId={storeId} walletVersion={walletVersion} onWalletChanged={refreshWallet} />}
        {storeId && page === 'tv' && <TvWall key={storeId} storeId={storeId} />}
        {!storeId && !error && <Alert severity="info">No stores yet. Start the backend with demo data to seed two stores.</Alert>}
      </Container>

      <WalletDialog
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        storeId={storeId}
        wallet={wallet}
        onChanged={refreshWallet}
      />
    </Box>
  )
}
