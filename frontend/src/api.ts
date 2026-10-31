// Thin typed client for the J24 backend (/api/v1). Errors come back as {code, message, ...details}.

export type Store = { storeId: string; name: string; ownerName: string; phone?: string; address?: string }

export type PlacementType = 'ENTRANCE' | 'NEAR_CHECKOUT' | 'AISLE' | 'OTHER'

export type Screen = {
  screenId: string
  name: string
  placementType: PlacementType
  slotsPerLoop: number
  slotDurationSeconds: number
  status: 'ACTIVE' | 'INACTIVE'
  online: boolean
  lastSeenAt: string | null
}

export type Wallet = { storeId: string; available: number; held: number }

export type CreditTransaction = {
  id: number
  type: 'PURCHASE' | 'HOLD' | 'DEDUCT' | 'RELEASE'
  amount: number
  adId: string | null
  createdAt: string
}

export type Availability = {
  screens: { screenId: string; screenName: string; freeSlots: number[] }[]
  playsPerScreen: number
  totalCost: number
  available: number
  missingCredits: number
}

export type AdStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'ENDED'

export type AdSummary = {
  adId: string
  name: string
  headline: string
  status: AdStatus
  startTime: string
  endTime: string
  totalCost: number
  hasImage: boolean
  createdAt: string
}

export type BillingRow = {
  id: string
  date: string
  bookedPlays: number
  held: number
  status: 'HELD' | 'SETTLED'
  deducted: number
  released: number
  settledAt: string | null
}

export type AdDetail = {
  ad: AdSummary
  pricePerPlay: number
  playsReceived: number
  screens: { screenId: string; screenName: string; slotIndex: number; active: boolean }[]
  dailyBilling: BillingRow[]
}

export type PlaylistItem = {
  adId: string
  slotIndex: number
  name: string
  headline: string
  startTime: string
  endTime: string
  imageUrl: string | null
}

export type Playlist = {
  validUntil: string
  slotsPerLoop: number
  slotDurationSeconds: number
  screenStatus: 'ACTIVE' | 'INACTIVE'
  items: PlaylistItem[]
}

export type PlayLog = { playId: string; adId: string; slotIndex: number; playedAt: string }

export type SyncResult = { receivedPlayIds: string[]; serverTime: string; playlist: Playlist }

export type AdminAlert = { screenId: string; storeId: string; screenName: string; reason: string; since: string }

export class ApiError extends Error {
  status: number
  code: string
  details: Record<string, unknown>

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.message ?? `request failed (${status})`))
    this.status = status
    this.code = String(body.code ?? 'ERROR')
    this.details = body
  }
}

const BASE = '/api/v1'

async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const isForm = body instanceof FormData
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new ApiError(response.status, data ?? {})
  }
  return data as T
}

export const api = {
  stores: () => request<Store[]>('GET', '/stores'),
  createStore: (store: { name: string; ownerName: string; phone?: string; address?: string }) =>
    request<{ storeId: string }>('POST', '/stores', store),

  screens: (storeId: string) => request<Screen[]>('GET', `/stores/${storeId}/screens`),
  createScreen: (storeId: string, screen: { name: string; placementType: PlacementType }) =>
    request<{ screenId: string }>('POST', `/stores/${storeId}/screens`, screen),
  setScreenStatus: (screenId: string, status: Screen['status']) =>
    request<Screen>('PATCH', `/screens/${screenId}`, { status }),

  wallet: (storeId: string) => request<Wallet>('GET', `/stores/${storeId}/wallet`),
  transactions: (storeId: string) => request<CreditTransaction[]>('GET', `/stores/${storeId}/wallet/transactions`),
  buyCredits: (storeId: string, credits: number) =>
    request<Wallet>('POST', `/stores/${storeId}/credits/purchase`, { credits }),

  availability: (query: { storeId: string; screenIds: string[]; startTime: string; endTime: string }) =>
    request<Availability>('POST', '/ads/availability', query),
  publish: (
    ad: {
      storeId: string
      name: string
      headline: string
      startTime: string
      endTime: string
      screens: { screenId: string; slotIndex: number | null }[]
    },
    image: Blob | null,
    idempotencyKey: string,
  ) => {
    const form = new FormData()
    form.append('ad', new Blob([JSON.stringify(ad)], { type: 'application/json' }))
    if (image) form.append('image', image, 'ad-image')
    return request<{ adId: string; totalCost: number }>('POST', '/ads', form, { 'Idempotency-Key': idempotencyKey })
  },
  ads: (storeId: string) => request<AdSummary[]>('GET', `/ads?storeId=${storeId}`),
  adDetail: (adId: string) => request<AdDetail>('GET', `/ads/${adId}`),
  pause: (adId: string) => request<AdSummary>('POST', `/ads/${adId}/pause`),
  resume: (adId: string) => request<AdSummary>('POST', `/ads/${adId}/resume`),
  cancel: (adId: string) => request<{ releasedCredits: number }>('POST', `/ads/${adId}/cancel`),

  sync: (screenId: string, playLogs: PlayLog[]) =>
    request<SyncResult>('POST', `/screens/${screenId}/sync`, { playLogs }),

  runSettlement: (skipGrace: boolean) =>
    request<{ settled: number; deducted: number; released: number }>(
      'POST',
      `/admin/settlement/run?skipGrace=${skipGrace}`,
    ),
  alerts: () => request<AdminAlert[]>('GET', '/admin/alerts'),
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
