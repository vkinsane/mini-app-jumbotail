import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage, type PlayLog, type Playlist, type PlaylistItem } from '../api'

/**
 * Simulates the J24 SDK installed on a screen. The screen is responsible for everything:
 * - pull: call /sync on start, every interval, and right after the network comes back
 * - cache: keep the 3-day playlist + images locally, swap in a new playlist only when its images are ready
 * - play: every 10 s pick the slot from the clock and show the ad (or house content), writing a play log
 * - queue: keep play logs locally until the server acknowledges them (survives being offline / reloads)
 */

const IST_OFFSET_SECONDS = 5.5 * 60 * 60
const MAX_LOGS_PER_SYNC = 500
const RETRY_AFTER_FAILURE_MS = 5_000

export type Showing =
  | { kind: 'AD'; item: PlaylistItem; imageSrc: string | null }
  | { kind: 'HOUSE'; reason: 'NO_AD' | 'NO_PLAYLIST' | 'PLAYLIST_EXPIRED' | 'MEDIA_MISSING' | 'SCREEN_INACTIVE' }
  | { kind: 'OFF' }

type Stored = { playlist: Playlist | null; queue: PlayLog[]; clockOffsetMs: number; lastSyncAt: string | null }

export type SdkState = Stored & {
  showing: Showing
  slotIndex: number
  syncing: boolean
  lastError: string | null
  playsWritten: number
}

const storageKey = (screenId: string) => `j24.sdk.${screenId}`

function load(screenId: string): Stored {
  try {
    const raw = localStorage.getItem(storageKey(screenId))
    if (raw) return JSON.parse(raw) as Stored
  } catch {
    // storage unavailable: start empty, like a freshly installed screen
  }
  return { playlist: null, queue: [], clockOffsetMs: 0, lastSyncAt: null }
}

function save(screenId: string, stored: Stored) {
  try {
    localStorage.setItem(storageKey(screenId), JSON.stringify(stored))
  } catch {
    // best effort only
  }
}

/** Which slot of the loop is on air: the 10-second block of the day, wrapped around the loop. */
export function currentSlot(nowMs: number, slotsPerLoop: number, slotSeconds: number) {
  const secondsSinceMidnightIst = (Math.floor(nowMs / 1000) + IST_OFFSET_SECONDS) % 86_400
  return Math.floor(secondsSinceMidnightIst / slotSeconds) % slotsPerLoop
}

export function useScreenSdk(screenId: string, options: { online: boolean; powered: boolean; syncIntervalMs: number }) {
  const { online, powered, syncIntervalMs } = options
  const stored = useRef<Stored>(load(screenId))
  const images = useRef(new Map<string, string | null>()) // adId -> object URL (null = failed to download)
  const lastBlock = useRef<number | null>(null)
  const syncInFlight = useRef(false)
  const nextSyncAt = useRef(0)

  const [state, setState] = useState<SdkState>(() => ({
    ...stored.current,
    showing: { kind: 'HOUSE', reason: 'NO_PLAYLIST' },
    slotIndex: 0,
    syncing: false,
    lastError: null,
    playsWritten: 0,
  }))

  const persist = useCallback(
    (patch: Partial<Stored>) => {
      stored.current = { ...stored.current, ...patch }
      save(screenId, stored.current)
      setState((s) => ({ ...s, ...stored.current }))
    },
    [screenId],
  )

  /** Download every image the playlist needs. A failed image is remembered so that slot shows house content. */
  const prefetchImages = useCallback(async (playlist: Playlist) => {
    await Promise.all(
      playlist.items.map(async (item) => {
        if (!item.imageUrl || images.current.has(item.adId)) return
        try {
          const response = await fetch(item.imageUrl)
          if (!response.ok) throw new Error(String(response.status))
          images.current.set(item.adId, URL.createObjectURL(await response.blob()))
        } catch {
          images.current.set(item.adId, null)
        }
      }),
    )
  }, [])

  const sync = useCallback(async () => {
    if (syncInFlight.current) return
    syncInFlight.current = true
    setState((s) => ({ ...s, syncing: true }))
    const batch = stored.current.queue.slice(0, MAX_LOGS_PER_SYNC) // oldest first
    const sentAt = Date.now()
    try {
      const result = await api.sync(screenId, batch)
      const receivedAt = Date.now()
      const acked = new Set(result.receivedPlayIds)
      // Server time at the moment of the response ≈ midpoint of the round trip.
      const clockOffsetMs = Date.parse(result.serverTime) - (sentAt + receivedAt) / 2
      await prefetchImages(result.playlist) // swap the playlist in only once its images are cached
      persist({
        playlist: result.playlist,
        queue: stored.current.queue.filter((log) => !acked.has(log.playId)),
        clockOffsetMs,
        lastSyncAt: new Date(receivedAt).toISOString(),
      })
      setState((s) => ({ ...s, lastError: null }))
      // More logs still queued (long offline period): sync again right away.
      nextSyncAt.current = stored.current.queue.length > 0 ? 0 : Date.now() + syncIntervalMs
    } catch (e) {
      setState((s) => ({ ...s, lastError: errorMessage(e) }))
      nextSyncAt.current = Date.now() + RETRY_AFTER_FAILURE_MS
    } finally {
      syncInFlight.current = false
      setState((s) => ({ ...s, syncing: false }))
    }
  }, [screenId, persist, prefetchImages, syncIntervalMs])

  // On power-on and on reconnect: sync immediately.
  useEffect(() => {
    if (powered && online) nextSyncAt.current = 0
  }, [powered, online])

  useEffect(() => {
    nextSyncAt.current = Math.min(nextSyncAt.current, Date.now() + syncIntervalMs)
  }, [syncIntervalMs])

  // On app start, re-download images for the cached playlist (the in-memory image cache was lost).
  useEffect(() => {
    if (stored.current.playlist) void prefetchImages(stored.current.playlist)
  }, [prefetchImages])

  // The player loop: runs whether online or not.
  useEffect(() => {
    const tick = () => {
      if (!powered) {
        lastBlock.current = null
        setState((s) => (s.showing.kind === 'OFF' ? s : { ...s, showing: { kind: 'OFF' } }))
        return
      }
      if (online && Date.now() >= nextSyncAt.current) void sync()

      const { playlist, clockOffsetMs } = stored.current
      const now = Date.now() + clockOffsetMs
      const slotSeconds = playlist?.slotDurationSeconds ?? 10
      const slotsPerLoop = playlist?.slotsPerLoop ?? 6
      const block = Math.floor(now / 1000 / slotSeconds)
      if (block === lastBlock.current) return
      lastBlock.current = block

      const slotIndex = currentSlot(now, slotsPerLoop, slotSeconds)
      const showing = decide(playlist, slotIndex, now, images.current)
      if (showing.kind === 'AD') {
        // The play counts from the moment the slot starts showing the ad.
        const log: PlayLog = {
          playId: crypto.randomUUID(),
          adId: showing.item.adId,
          slotIndex,
          playedAt: new Date(now).toISOString(),
        }
        persist({ queue: [...stored.current.queue, log] })
        setState((s) => ({ ...s, showing, slotIndex, playsWritten: s.playsWritten + 1 }))
      } else {
        setState((s) => ({ ...s, showing, slotIndex }))
      }
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [online, powered, sync, persist])

  const resetCache = useCallback(() => {
    images.current.clear()
    persist({ playlist: null, queue: [], clockOffsetMs: 0, lastSyncAt: null })
    lastBlock.current = null
  }, [persist])

  return { state, syncNow: () => online && powered && sync(), resetCache }
}

function decide(
  playlist: Playlist | null,
  slotIndex: number,
  now: number,
  images: Map<string, string | null>,
): Showing {
  if (!playlist) return { kind: 'HOUSE', reason: 'NO_PLAYLIST' }
  if (playlist.screenStatus === 'INACTIVE') return { kind: 'HOUSE', reason: 'SCREEN_INACTIVE' }
  if (now > Date.parse(playlist.validUntil)) return { kind: 'HOUSE', reason: 'PLAYLIST_EXPIRED' }
  const item = playlist.items.find(
    (i) => i.slotIndex === slotIndex && Date.parse(i.startTime) <= now && now < Date.parse(i.endTime),
  )
  if (!item) return { kind: 'HOUSE', reason: 'NO_AD' }
  if (item.imageUrl) {
    const src = images.get(item.adId)
    if (!src) return { kind: 'HOUSE', reason: 'MEDIA_MISSING' } // not billed: no play log
    return { kind: 'AD', item, imageSrc: src }
  }
  return { kind: 'AD', item, imageSrc: null }
}
