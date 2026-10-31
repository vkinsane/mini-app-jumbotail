import { useCallback, useEffect, useState } from 'react'
import Stack from '@mui/material/Stack'
import { api, type Screen, type Wallet } from '../api'
import AdsCard from './AdsCard'
import CreateAdCard from './CreateAdCard'

/**
 * Store owner's view. `version` is bumped after every change (and every 10 s, to pick up settlement),
 * so each card re-reads what it shows. `walletVersion` comes from the header, bumped after a purchase.
 */
export default function OwnerConsole({
  storeId,
  walletVersion,
  onWalletChanged,
}: {
  storeId: string
  walletVersion: number
  onWalletChanged: () => void
}) {
  const [version, setVersion] = useState(0)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [screens, setScreens] = useState<Screen[]>([])
  const refresh = useCallback(() => {
    setVersion((v) => v + 1)
    onWalletChanged()
  }, [onWalletChanged])

  useEffect(() => {
    api.wallet(storeId).then(setWallet, () => setWallet(null))
    api.screens(storeId).then(setScreens, () => setScreens([]))
  }, [storeId, version, walletVersion])

  useEffect(() => {
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <Stack sx={{ gap: 2, minWidth: 0 }}>
      <CreateAdCard storeId={storeId} screens={screens} wallet={wallet} onChanged={refresh} />
      <AdsCard storeId={storeId} version={version} onChanged={refresh} />
    </Stack>
  )
}
