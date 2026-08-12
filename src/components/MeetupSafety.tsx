"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  checkInOrder,
  startMeetupShare,
  stopMeetupShare,
  updateMeetupShare,
  useOrderCheckins,
  useOrderShares,
} from "@/lib/db";
import { formatDate } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/** Straight-line distance between two coordinates (haversine, metres). */
function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.max(1, Math.round(m))} m` : `${(m / 1000).toFixed(1)} km`;
}

function friendlyGeoError(e: unknown): string {
  const posErr =
    typeof GeolocationPositionError !== "undefined" && e instanceof GeolocationPositionError;
  if (posErr) {
    if (e.code === e.PERMISSION_DENIED) {
      return "Location permission denied. Allow it in your browser to share.";
    }
    if (e.code === e.TIMEOUT) {
      return "Couldn't get your location. Check your GPS and try again.";
    }
    if (e.code === e.POSITION_UNAVAILABLE) {
      return "Your location isn't available right now. Try again.";
    }
  }
  // Anything else (RPC failures like NOT_A_PARTICIPANT, network errors, …)
  // keeps its real message so the actual cause isn't hidden.
  return e instanceof Error && e.message ? e.message : "Live location isn't available on this device.";
}

/**
 * Meetup safety for one order: an "I'm here" check-in plus an opt-in 30-minute
 * live location share between the buyer and seller.
 *
 * Safety notes baked into the design:
 *  - The share row is participant-only at the DB level (RLS), so no one but
 *    the two parties — or the owner — can ever read the coordinates.
 *  - Coordinates are validated + throttled server-side (RPCs), so the browser
 *    can't spam or poison the table.
 *  - Every share auto-expires (30 min from start) and the watch is cleared
 *    when the component unmounts or the share lapses.
 *
 * `isSeller` only changes how the other party is labelled ("Buyer"/"Seller").
 */
export default function MeetupSafety({
  orderId,
  isSeller = false,
}: {
  orderId: string;
  isSeller?: boolean;
}) {
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const otherLabel = isSeller ? "Buyer" : "Seller";

  const checkins = useOrderCheckins(orderId);
  const shares = useOrderShares(orderId);
  const now = useNow(15_000);

  const [checkingIn, setCheckingIn] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [sharingLocally, setSharingLocally] = useState(false);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [error, setError] = useState("");

  const watchIdRef = useRef<number | null>(null);
  const lastPushRef = useRef(0);
  // When the current server-side share expires (set from the RPC's return
  // value on start — never a render-time write).
  const expiryRef = useRef(0);

  const myCheckin = (checkins ?? []).find((c) => c.userId === uid);
  const theirCheckin = (checkins ?? []).find((c) => c.userId !== uid);
  const activeShares = (shares ?? []).filter((s) => s.expiresAt.getTime() > now);
  const myShare = activeShares.find((s) => s.userId === uid);
  const theirShare = activeShares.find((s) => s.userId !== uid);

  // Sharing is "on" only while BOTH the watch is running and the server still
  // has an unexpired share — a lapsed row flips the button back automatically.
  const sharing = sharingLocally && Boolean(myShare);
  const distance =
    myPos && theirShare
      ? haversineMeters(myPos.lat, myPos.lng, theirShare.lat, theirShare.lng)
      : null;

  // Clear the GPS watch when the component unmounts. The share row itself
  // auto-expires server-side, so no network call is needed in cleanup.
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  const checkIn = async () => {
    if (checkingIn || !uid) return;
    setCheckingIn(true);
    setError("");
    try {
      await checkInOrder(orderId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check in.");
    } finally {
      setCheckingIn(false);
    }
  };

  const onPosition = (pos: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = pos.coords;
    setMyPos({ lat: latitude, lng: longitude, accuracy });
    // The share lapsed (or the user stopped it elsewhere): drop the watch.
    if (expiryRef.current && Date.now() >= expiryRef.current) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setSharingLocally(false);
      return;
    }
    // Local throttle (the server also throttles to ~3s) keeps the writes sane.
    if (Date.now() - lastPushRef.current < 3_000) return;
    lastPushRef.current = Date.now();
    void updateMeetupShare(orderId, latitude, longitude, accuracy).catch(() => {});
  };

  const onGeoError = (err: GeolocationPositionError) => {
    setError(friendlyGeoError(err));
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharingLocally(false);
  };

  const startSharing = async () => {
    if (shareBusy || !uid) return;
    setShareBusy(true);
    setError("");
    if (!("geolocation" in navigator)) {
      setError("Live location isn't supported on this device.");
      setShareBusy(false);
      return;
    }
    try {
      // Permission + first fix up-front, so a denial surfaces as a friendly
      // error instead of a silent never-starting watch.
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 10_000,
          timeout: 15_000,
        })
      );
      const expiry = await startMeetupShare(
        orderId,
        pos.coords.latitude,
        pos.coords.longitude,
        pos.coords.accuracy
      );
      // A previous watch may still be running (e.g. the share lapsed while
      // the user was stationary, so onPosition never fired to clear it).
      // Never stack two watchPosition streams — clear first.
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      expiryRef.current = expiry.getTime();
      lastPushRef.current = Date.now();
      setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onGeoError, {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 15_000,
      });
      setSharingLocally(true);
    } catch (e) {
      setError(friendlyGeoError(e));
    } finally {
      setShareBusy(false);
    }
  };

  const stopSharing = async () => {
    if (shareBusy) return;
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharingLocally(false);
    setMyPos(null);
    setShareBusy(true);
    setError("");
    try {
      await stopMeetupShare(orderId);
    } catch {
      // The 30-minute expiry would clear it anyway — never block on this.
    } finally {
      setShareBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-sand/40 p-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-ink-soft">
        Meetup safety
      </p>

      {/* Check-in */}
      <div className="flex flex-wrap items-center gap-2">
        {myCheckin ? (
          <span
            title={`Checked in ${formatDate(myCheckin.checkedInAt)}`}
            className="rounded-full bg-lime px-3 py-1 text-[11px] font-bold text-lime-ink"
          >
            You&apos;re here ✓
          </span>
        ) : (
          <button
            onClick={checkIn}
            disabled={checkingIn || !uid}
            className="rounded-full border-2 border-ink px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition hover:bg-ink hover:text-cream disabled:opacity-50"
          >
            {checkingIn ? "Checking in…" : "I&apos;m here ✓"}
          </button>
        )}
        {theirCheckin ? (
          <span className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-bold text-ink">
            {otherLabel}&apos;s here ✓
          </span>
        ) : (
          <span className="rounded-full bg-paper px-3 py-1 text-[11px] text-ink-soft">
            {otherLabel} hasn&apos;t checked in yet
          </span>
        )}
      </div>

      {/* Live location share */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => (sharing ? void stopSharing() : void startSharing())}
          disabled={shareBusy || !uid}
          className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition disabled:opacity-50 ${
            sharing
              ? "bg-accent text-white hover:bg-accent-deep"
              : "border-2 border-accent text-accent hover:bg-accent hover:text-white"
          }`}
        >
          {shareBusy
            ? "Working…"
            : sharing
              ? "⏹ Stop sharing"
              : "📍 Share live location (30 min)"}
        </button>
        {theirShare && (
          <span className="text-[11px] font-semibold text-accent">
            {distance !== null
              ? `🤝 ${otherLabel} is sharing: ${formatDistance(distance)} away`
              : `🤝 ${otherLabel} is sharing until ${formatDate(theirShare.expiresAt)}`}
          </span>
        )}
      </div>
      {sharing && myShare && (
        <p className="text-[11px] text-ink-soft">
          Sharing your live location with the {otherLabel.toLowerCase()} until{" "}
          {formatDate(myShare.expiresAt)}. Only they can see it.
        </p>
      )}
      {error && <p className="text-[11px] font-medium text-accent">{error}</p>}
      <p className="text-[10px] text-ink-soft">
        Meet in a busy, public place. Location shares expire automatically and are visible
        only to the buyer and seller.
      </p>
    </div>
  );
}
