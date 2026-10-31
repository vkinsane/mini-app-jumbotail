import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import { api, type Screen, type Wallet } from '../api'
import AdsCard from './AdsCard'
import CreateAdCard from './CreateAdCard'
import OpsCard from './OpsCard'
import ScreensCard from './ScreensCard'
import TransactionsCard from './TransactionsCard'
import WalletCard from './WalletCard'

/**
 * Store owner's view. `version` is bumped after every change (and every 10 s, to pick up settlement),
 * so each card re-reads what it shows.
 */
export default function OwnerConsole({ storeId }: { storeId: string }) {
  const [version, setVersion] = useState(0)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [screens, setScreens] = useState<Screen[]>([])
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    api.wallet(storeId).then(setWallet, () => setWallet(null))
    api.screens(storeId).then(setScreens, () => setScreens([]))
  }, [storeId, version])

  useEffect(() => {
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
      <Stack sx={{ gap: 2, minWidth: 0 }}>
        <CreateAdCard storeId={storeId} screens={screens} wallet={wallet} onChanged={refresh} />
        <AdsCard storeId={storeId} version={version} onChanged={refresh} />
      </Stack>
      <Stack sx={{ gap: 2, minWidth: 0 }}>
        <WalletCard storeId={storeId} wallet={wallet} onChanged={refresh} />
        <ScreensCard storeId={storeId} screens={screens} onChanged={refresh} />
        <OpsCard version={version} onChanged={refresh} />
        <TransactionsCard storeId={storeId} version={version} />
      </Stack>
    </Box>
  )
}
