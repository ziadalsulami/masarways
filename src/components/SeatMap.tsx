/**
 * Visual TRAIN-CARRIAGE seat map.
 *
 * Supports multi-seat selection (a single passenger may now book several
 * tickets for adults + kids under their own name). The parent owns the
 * `chosen` Set and we toggle entries in/out via `onToggle`.
 *
 * Status colours:
 *   - taken     → muted, struck through (disabled)
 *   - your seat → green outline (already booked by you on this trip)
 *   - chosen    → solid green (current selection — possibly multiple)
 *   - free      → bordered card surface, hover hint
 */
import { Button } from "@/components/ui/button";
import { TrainFront } from "lucide-react";

export interface SeatMapProps {
  totalSeats: number;
  taken: Set<number>;
  ownSeats?: Set<number>;
  chosen: Set<number>;
  onToggle: (n: number) => void;
  maxSelectable: number;
  onConfirm: () => void;
  busy: boolean;
}

export default function SeatMap({
  totalSeats,
  taken,
  ownSeats,
  chosen,
  onToggle,
  maxSelectable,
  onConfirm,
  busy,
}: SeatMapProps) {
  const rows: number[][] = [];
  for (let i = 1; i <= totalSeats; i += 4) {
    rows.push([i, i + 1, i + 2, i + 3].filter((n) => n <= totalSeats));
  }

  const atLimit = chosen.size >= maxSelectable;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Legend className="border border-gray-300 bg-white" label="Available" />
        <Legend className="bg-green-600" label="Selected" />
        <Legend className="border-2 border-green-600 bg-green-600/20" label="Your seat" />
        <Legend className="bg-gray-400" label="Taken" />
      </div>

      <div className="mx-auto max-w-sm">
        <div className="mx-auto flex w-32 flex-col items-center">
          <div className="flex h-10 w-32 items-center justify-center rounded-t-[50%] border-2 border-b-0 border-border bg-card text-primary">
            <TrainFront className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-2xl border-2 border-border bg-card/50 p-4 shadow-inner">
          <div className="mb-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            ◀ Front of train
          </div>

          <div className="mb-2 grid grid-cols-[1.25rem_1fr_1.25rem_1fr_1.25rem] items-center gap-1 text-center text-[10px] text-muted-foreground">
            <span />
            <div className="grid grid-cols-2 gap-1">
              <span>A</span>
              <span>B</span>
            </div>
            <span className="opacity-50">·</span>
            <div className="grid grid-cols-2 gap-1">
              <span>C</span>
              <span>D</span>
            </div>
            <span />
          </div>

          <div className="space-y-1.5">
            {rows.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1.25rem_1fr_1.25rem_1fr_1.25rem] items-center gap-1"
              >
                <span className="text-center text-[10px] text-muted-foreground">{idx + 1}</span>

                <div className="grid grid-cols-2 gap-1">
                  {[row[0], row[1]].map((n, i) => (
                    <Seat
                      key={i}
                      n={n}
                      taken={n ? taken.has(n) : false}
                      ownSeats={ownSeats}
                      chosen={chosen}
                      atLimit={atLimit}
                      onToggle={onToggle}
                    />
                  ))}
                </div>

                <span className="text-center text-[10px] text-muted-foreground/60">|</span>

                <div className="grid grid-cols-2 gap-1">
                  {[row[2], row[3]].map((n, i) => (
                    <Seat
                      key={i}
                      n={n}
                      taken={n ? taken.has(n) : false}
                      ownSeats={ownSeats}
                      chosen={chosen}
                      atLimit={atLimit}
                      onToggle={onToggle}
                    />
                  ))}
                </div>

                <span />
              </div>
            ))}
          </div>

          <div className="mt-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            Rear of train ▶
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-sm">
          {chosen.size === 0 ? (
            <span className="text-muted-foreground">
              Pick {maxSelectable === 1 ? "a seat" : `up to ${maxSelectable} seats`}.
            </span>
          ) : (
            <span>
              Selected: <strong>{[...chosen].sort((a, b) => a - b).map((n) => `#${n}`).join(", ")}</strong>{" "}
              <span className="text-muted-foreground">({chosen.size}/{maxSelectable})</span>
            </span>
          )}
        </div>
        <Button onClick={onConfirm} disabled={chosen.size === 0 || chosen.size !== maxSelectable || busy}>
          {busy ? "Booking…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function Seat({
  n,
  taken,
  ownSeats,
  chosen,
  atLimit,
  onToggle,
}: {
  n: number | undefined;
  taken: boolean;
  ownSeats?: Set<number>;
  chosen: Set<number>;
  atLimit: boolean;
  onToggle: (n: number) => void;
}) {
  if (!n) return <span className="h-9 rounded" />;

  const isOwn = ownSeats?.has(n) ?? false;
  const isTaken = taken && !isOwn;
  const isChosen = chosen.has(n);
  const disabled = isTaken || isOwn || (atLimit && !isChosen);

  return (
    <button
      disabled={disabled}
      onClick={() => onToggle(n)}
      title={isTaken ? "Taken" : isOwn ? "Your seat" : `Seat ${n}`}
      className={`h-9 rounded-md text-xs font-semibold transition ${
        isTaken
          ? "cursor-not-allowed bg-gray-400 text-white line-through"
          : isOwn
          ? "border-2 border-green-600 bg-green-600/20 text-green-700 dark:text-green-300"
          : isChosen
          ? "scale-105 bg-green-600 text-white shadow ring-2 ring-green-400"
          : atLimit
          ? "cursor-not-allowed border border-gray-200 bg-gray-50 text-gray-400"
          : "border border-gray-300 bg-white text-gray-800 hover:border-green-600 hover:bg-green-50"
      }`}
    >
      {n}
    </button>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded ${className}`} /> {label}
    </span>
  );
}
