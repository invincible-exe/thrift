"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Image from "next/image";
import Modal from "./ui/Modal";
import { useShop } from "@/context/ShopContext";
import { useAuth } from "@/context/AuthContext";
import {
  createListing,
  removeProductImage,
  uploadProductImage,
  type UploadedImage,
} from "@/lib/db";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { compressImage } from "@/lib/compress-image";
import { CATEGORIES, CONDITIONS, PLATFORM_COMMISSION_MIN_KES } from "@/lib/constants";
import { computeCommission } from "@/lib/payments";
import LocationPicker from "./LocationPicker";
import type { Location, ProductCategory } from "@/lib/types";

const INITIAL = {
  title: "",
  brand: "",
  category: "Tops" as ProductCategory,
  size: "",
  condition: "Very good",
  priceKes: "",
  description: "",
};

// Listing photos — up to 5. Raw phone photos can be 5-10MB, but every
// selected photo is compressed client-side before upload, so the 20MB cap
// is just a sanity guard against absurd files.
const MAX_PHOTOS = 5;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

interface PickedImage {
  file: File;
  previewUrl: string;
}

export default function SellModal() {
  const { sellOpen, closeSell, showToast } = useShop();
  const { user } = useAuth();

  const [form, setForm] = useState(INITIAL);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [meetup, setMeetup] = useState<Location | null>(null);
  const [phase, setPhase] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  // Keep the latest photos in a ref so the unmount cleanup can revoke every
  // preview URL without stale closure captures.
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  });

  // Free all object URLs when the modal unmounts so previews don't leak.
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, []);

  const set = <K extends keyof typeof INITIAL>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const price = Number(form.priceKes);
  const commission =
    Number.isFinite(price) && price > 0 ? computeCommission(price, true).commission : 0;

  const reset = () => {
    setForm(INITIAL);
    imagesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
    setMeetup(null);
    setPhase("idle");
    setMessage("");
  };

  const handleClose = () => {
    if (phase === "submitting") return;
    closeSell();
    reset();
  };

  const handleImagesSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const room = MAX_PHOTOS - images.length;
    if (room <= 0) {
      setPhase("error");
      setMessage(`You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    if (files.some((f) => !f.type.startsWith("image/"))) {
      setPhase("error");
      setMessage("Only image files: JPG, PNG or WebP.");
      return;
    }
    if (files.some((f) => f.size > MAX_IMAGE_BYTES)) {
      setPhase("error");
      setMessage("A photo is over 5 MB. Pick smaller ones.");
      return;
    }
    if (files.length > room) {
      setPhase("error");
      setMessage(
        `Only ${room} more photo slot${room === 1 ? "" : "s"} left. Pick fewer at once.`
      );
      return;
    }
    // Compress each photo before it goes anywhere — phone photos are
    // 3-8MB, and Vercel's serverless functions cap request bodies at
    // ~4.5MB, so raw uploads die with "Failed to fetch".
    // Sequential, not parallel: decoding 5 full-size phone photos at once
    // can blow through memory on the low-end devices this fix targets.
    const added: PickedImage[] = [];
    for (const file of files) {
      const compressed = await compressImage(file);
      added.push({ file: compressed, previewUrl: URL.createObjectURL(compressed) });
    }
    setImages((prev) => [...prev, ...added]);
    setPhase("idle");
    setMessage("");
    e.target.value = ""; // allow re-selecting the same file
  };

  const removeImage = (index: number) => {
    const removed = images[index];
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!isSupabaseConfigured) {
      setPhase("error");
      setMessage("Connect Supabase to list pieces. See the README for setup.");
      return;
    }
    if (!meetup) {
      setPhase("error");
      setMessage("Pick a meetup location. Every piece needs one so buyers know where to find you.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setPhase("error");
      setMessage("Enter a valid price in KES.");
      return;
    }
    if (!images.length) {
      setPhase("error");
      setMessage("Add at least one photo of your piece from your device.");
      return;
    }
    setPhase("submitting");
    setMessage("");
    const uploaded: UploadedImage[] = [];
    try {
      // Upload one by one so a mid-batch failure still knows which photos
      // already landed in storage (and can clean them all up below).
      for (const file of images.map((i) => i.file)) {
        uploaded.push(await uploadProductImage(user.id, file));
      }
      const imageUrls = uploaded.map((u) => u.url);
      await createListing({
        item: {
          title: form.title,
          brand: form.brand || "Unknown",
          category: form.category,
          size: form.size || "Various",
          condition: form.condition,
          priceKes: price,
          imageUrl: imageUrls[0] ?? "",
          imageUrls,
          description: form.description || undefined,
          locationId: meetup?.id ?? null,
          locationLabel: meetup ? `${meetup.city} · ${meetup.area}` : null,
        },
      });
      setPhase("success");
      showToast("Submitted. It'll hit the feed once approved ✨");
    } catch (err) {
      // Don't leave orphaned photos in storage if the listing failed.
      for (const u of uploaded) await removeProductImage(u.path);
      setPhase("error");
      // Surface the real error so a schema/setup problem is obvious instead
      // of a generic "try again" (e.g. a stale migration rejects the RPC).
      // Some thrown values are plain objects (PostgrestError) whose
      // String() is "[object Object]" — unwrap `.message` when present.
      const detail =
        err instanceof Error
          ? err.message
          : String((err as { message?: unknown } | null | undefined)?.message ?? err);
      // A raw browser network error ("Failed to fetch") means the request
      // never got a response — usually a dropped connection, not a bug.
      // Say so plainly instead of leaking the technical message.
      if (/failed to fetch|networkerror|load failed|typeerror/i.test(detail)) {
        setMessage("Couldn't reach the server. Check your connection and try again.");
      } else {
        setMessage(`Couldn't create the listing: ${detail.slice(0, 160)}`);
      }
      console.error("createListing failed:", err);
    }
  }

  const inputCls =
    "w-full rounded-2xl border border-line bg-paper px-4 py-3 text-sm outline-none transition focus:border-ink";
  const labelCls = "mb-1.5 block text-xs font-bold uppercase tracking-widest text-ink-soft";

  return (
    <Modal open={sellOpen} onClose={handleClose} label="Sell a piece">
      <div className="p-6 sm:p-8">
        {phase === "success" ? (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-lime text-4xl">✓</span>
            <h2 className="mt-4 font-display text-3xl font-black">Added to your closet.</h2>
            <p className="mt-2 max-w-xs text-sm text-ink-soft">
              Your piece is now in your closet. It&apos;ll hit the feed once approved. You keep{" "}
              <span className="font-bold text-ink">up to 90%</span> of every sale.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <a
                href="/account#closet"
                onClick={handleClose}
                className="rounded-full bg-ink px-7 py-3 text-sm font-bold text-cream transition hover:bg-black"
              >
                View my closet
              </a>
              <button
                onClick={reset}
                className="rounded-full border-2 border-ink px-7 py-3 text-sm font-bold transition hover:bg-ink hover:text-cream"
              >
                Add another piece
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 className="font-display text-2xl font-black tracking-tight">Sell a piece</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Add it to your closet. Once approved it hits the feed. You keep up to 90% of
                  every sale.
                </p>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:bg-sand hover:text-ink"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelCls} htmlFor="sell-title">Title</label>
                <input
                  id="sell-title"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  required
                  placeholder="e.g. Vintage Levi's Denim Jacket"
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="sell-brand">Brand</label>
                  <input
                    id="sell-brand"
                    value={form.brand}
                    onChange={(e) => set("brand", e.target.value)}
                    placeholder="Levi's"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="sell-size">Size</label>
                  <input
                    id="sell-size"
                    value={form.size}
                    onChange={(e) => set("size", e.target.value)}
                    placeholder="M / 42 / One size"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="sell-category">Category</label>
                  <select
                    id="sell-category"
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                    className={inputCls}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="sell-condition">Condition</label>
                  <select
                    id="sell-condition"
                    value={form.condition}
                    onChange={(e) => set("condition", e.target.value)}
                    className={inputCls}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls} htmlFor="sell-price">Price (KES)</label>
                <input
                  id="sell-price"
                  type="number"
                  min={1}
                  value={form.priceKes}
                  onChange={(e) => set("priceKes", e.target.value)}
                  required
                  placeholder="1200"
                  className={inputCls}
                />
                {Number.isFinite(price) && price > 0 && (
                  <p className="mt-1.5 text-xs text-ink-soft">
                    You keep <span className="font-bold text-ink">{price - commission} KES</span> · platform
                    commission {commission} KES (min {PLATFORM_COMMISSION_MIN_KES})
                  </p>
                )}
              </div>

              <div>
                <span className={labelCls}>
                  Where will you hand over the piece?{" "}
                  <span className="text-accent">*</span>
                </span>
                <LocationPicker value={meetup?.id ?? null} onChange={setMeetup} />
                {meetup ? (
                  <p className="mt-1.5 text-xs text-lime">
                    ✓ Meet area locked: {meetup.city} · {meetup.area}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-ink-soft">
                    Required. Buyers see this as the area you meet in when the piece sells. You can
                    agree on the exact spot in the order chat.
                  </p>
                )}
              </div>

              <div>
                <span className={labelCls}>
                  Photos{images.length > 0 ? ` (${images.length}/${MAX_PHOTOS})` : ""}
                </span>

                {images.length === 0 ? (
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-paper px-4 py-8 text-center transition hover:border-accent hover:bg-sand/60">
                    <span className="text-3xl">📸</span>
                    <span className="mt-2 text-sm font-bold text-ink">Tap to add photos</span>
                    <span className="mt-1 text-xs text-ink-soft">
                      Pick from your device. Up to {MAX_PHOTOS}, the first is the cover
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={handleImagesSelect}
                    />
                  </label>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {images.map((img, i) => (
                      <div
                        key={img.previewUrl}
                        className="relative aspect-square overflow-hidden rounded-xl border border-line bg-sand"
                      >
                        <Image
                          src={img.previewUrl}
                          alt={`Photo ${i + 1}`}
                          fill
                          sizes="25%"
                          className="object-cover"
                          unoptimized
                        />
                        {i === 0 && (
                          <span className="absolute left-1.5 top-1.5 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-cream">
                            Cover
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          aria-label={`Remove photo ${i + 1}`}
                          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/80 text-xs text-cream transition hover:bg-accent"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {images.length < MAX_PHOTOS && (
                      <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line bg-paper text-center transition hover:border-accent hover:bg-sand/60">
                        <span className="text-xl leading-none text-ink-soft">＋</span>
                        <span className="text-[10px] font-bold text-ink-soft">Add photo</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="sr-only"
                          onChange={handleImagesSelect}
                        />
                      </label>
                    )}
                  </div>
                )}

                <p className="mt-1.5 text-xs text-ink-soft">
                  Up to {MAX_PHOTOS} photos. The first is the cover · JPG, PNG or WebP up to 5 MB
                  each
                </p>
              </div>

              <div>
                <label className={labelCls} htmlFor="sell-desc">Description</label>
                <textarea
                  id="sell-desc"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  rows={3}
                  placeholder="Era, flaws, why it's a 10/10…"
                  className={inputCls}
                />
              </div>

              {phase === "error" && (
                <p className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-medium">
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={phase === "submitting"}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink py-4 text-sm font-bold uppercase tracking-wider text-cream transition hover:bg-black disabled:opacity-60"
              >
                {phase === "submitting" ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-cream/40 border-t-cream" />
                    Adding…
                  </>
                ) : (
                  "Add to my closet"
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}
