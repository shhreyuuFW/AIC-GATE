import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

const CROP_VIEW_SIZE = 240;
const EXPORT_SIZE = 256;
const MAX_ENCODED_LEN = 185_000;

interface ImageDims {
  width: number;
  height: number;
}

export function AvatarCropper({
  imageSrc,
  onApply,
  onCancel,
}: {
  imageSrc: string;
  onApply: (croppedDataUri: string) => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [dims, setDims] = useState<ImageDims | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    ox: number;
    oy: number;
  } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setDims({ width: img.naturalWidth, height: img.naturalHeight });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const getScaledSize = useCallback(
    (z: number): { w: number; h: number } => {
      if (!dims) return { w: CROP_VIEW_SIZE, h: CROP_VIEW_SIZE };
      const baseScale = Math.max(
        CROP_VIEW_SIZE / Math.max(1, dims.width),
        CROP_VIEW_SIZE / Math.max(1, dims.height)
      );
      return {
        w: dims.width * baseScale * z,
        h: dims.height * baseScale * z,
      };
    },
    [dims]
  );

  const clampOffset = useCallback(
    (x: number, y: number, z: number): { x: number; y: number } => {
      const { w, h } = getScaledSize(z);
      const maxX = Math.max(0, (w - CROP_VIEW_SIZE) / 2);
      const maxY = Math.max(0, (h - CROP_VIEW_SIZE) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, x)),
        y: Math.min(maxY, Math.max(-maxY, y)),
      };
    },
    [getScaledSize]
  );

  const handleZoomChange = (nextZoom: number) => {
    const clampedZoom = Math.min(3, Math.max(1, Number(nextZoom.toFixed(2))));
    setZoom(clampedZoom);
    setOffset((prev) => clampOffset(prev.x, prev.y, clampedZoom));
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.clientX;
    const dy = e.clientY - dragStartRef.current.clientY;
    setOffset(
      clampOffset(
        dragStartRef.current.ox + dx,
        dragStartRef.current.oy + dy,
        zoom
      )
    );
  };

  const stopDrag = () => {
    setDragging(false);
    dragStartRef.current = null;
  };

  const handleApplyCrop = () => {
    const img = imgRef.current;
    if (!img || !dims) return;

    const { w, h } = getScaledSize(zoom);
    const leftInView = (CROP_VIEW_SIZE - w) / 2 + offset.x;
    const topInView = (CROP_VIEW_SIZE - h) / 2 + offset.y;

    const sx = Math.max(0, (-leftInView / w) * dims.width);
    const sy = Math.max(0, (-topInView / h) * dims.height);
    const sw = Math.min(dims.width - sx, (CROP_VIEW_SIZE / w) * dims.width);
    const sh = Math.min(dims.height - sy, (CROP_VIEW_SIZE / h) * dims.height);

    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_SIZE;
    canvas.height = EXPORT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
    let dataUri = canvas.toDataURL("image/png");
    if (dataUri.length > MAX_ENCODED_LEN) {
      dataUri = canvas.toDataURL("image/jpeg", 0.9);
    }
    onApply(dataUri);
  };

  const { w: scaledW, h: scaledH } = getScaledSize(zoom);

  return (
    <div className="space-y-3 border border-[var(--accent-cyan)]/50 bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono-tech text-[10px] font-bold tracking-wider text-[var(--accent-cyan)] uppercase">
          1:1 AVATAR CROP STUDIO
        </span>
        <span className="font-mono-tech border border-[var(--border-hair)] bg-[var(--bg-panel)] px-2 py-0.5 text-[9px] text-[var(--text-muted)] uppercase">
          1:1 RATIO LOCKED
        </span>
      </div>

      <div className="flex justify-center">
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onPointerLeave={stopDrag}
          style={{ width: CROP_VIEW_SIZE, height: CROP_VIEW_SIZE }}
          className={`relative overflow-hidden border-2 border-[var(--accent-cyan)] bg-black select-none ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          {dims && (
            <img
              src={imageSrc}
              alt="Crop preview"
              draggable={false}
              style={{
                width: `${scaledW}px`,
                height: `${scaledH}px`,
                maxWidth: "none",
                transform: `translate(${(CROP_VIEW_SIZE - scaledW) / 2 + offset.x}px, ${(CROP_VIEW_SIZE - scaledH) / 2 + offset.y}px)`,
              }}
              className="pointer-events-none block"
            />
          )}

          {/* Rule-of-thirds tactical reticle */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 border-l border-white/25" />
            <div className="absolute inset-y-0 left-2/3 border-l border-white/25" />
            <div className="absolute inset-x-0 top-1/3 border-t border-white/25" />
            <div className="absolute inset-x-0 top-2/3 border-t border-white/25" />
            <span className="absolute top-1 left-1 h-3 w-3 border-t-2 border-l-2 border-[var(--accent-volt)]" />
            <span className="absolute top-1 right-1 h-3 w-3 border-t-2 border-r-2 border-[var(--accent-volt)]" />
            <span className="absolute bottom-1 left-1 h-3 w-3 border-b-2 border-l-2 border-[var(--accent-volt)]" />
            <span className="absolute right-1 bottom-1 h-3 w-3 border-r-2 border-b-2 border-[var(--accent-volt)]" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleZoomChange(zoom - 0.15)}
          aria-label="Zoom out"
          className="border border-[var(--border-hair)] bg-[var(--bg-panel)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => handleZoomChange(Number(e.target.value))}
          className="flex-1 accent-[var(--accent-cyan)]"
        />
        <button
          type="button"
          onClick={() => handleZoomChange(zoom + 0.15)}
          aria-label="Zoom in"
          className="border border-[var(--border-hair)] bg-[var(--bg-panel)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono-tech min-w-10 text-right text-[10px] font-bold">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
          title="Center image"
          className="border border-[var(--border-hair)] bg-[var(--bg-panel)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="font-mono-tech border border-[var(--border-hair)] px-3 py-1.5 text-[11px] uppercase"
        >
          CANCEL
        </button>
        <button
          type="button"
          onClick={handleApplyCrop}
          className="endfield-chamfer-sm font-mono-tech inline-flex flex-1 items-center justify-center gap-1.5 bg-[var(--accent-volt)] px-3 py-1.5 text-[11px] font-bold text-[var(--accent-volt-ink)] uppercase"
        >
          <Check className="h-3.5 w-3.5" />
          APPLY 1:1 CROP
        </button>
      </div>
    </div>
  );
}
