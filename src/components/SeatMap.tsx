/**
 * Visual TRAIN-CARRIAGE seat map.
 *
 * Layout:
 *   - Locomotive nose at the top (just decoration to evoke a train).
 *   - Rows of 4 seats arranged 2 + aisle + 2 (A B | C D).
 *   - Numbering goes row by row, left to right, so seat #1 is row 1 / A.
 *   - Trailing seats (when total_seats is not a multiple of 4) are placed
 *     in the last row from left to right and remaining slots are blank.
 *
 * Status colours:
 *   - taken     → muted, struck through (disabled)
 *   - your seat → primary outline (you can't book this trip again)
 *   - chosen    → solid primary (current selection)
 *   - free      → bordered card surface, hover hint
 */
import { Button } from "@/components/ui/button";
import { TrainFront } from "lucide-react";

export interface SeatMapProps {
  totalSeats: number;
  taken: Set<number>;
  ownSeat?: number;
  chosen: number | null;
  onChoose: (n: number) => void;
  alreadyBooked: boolean;
  onConfirm: () => void;
  busy: boolean;
}

export default function SeatMap({
  totalSeats,
  taken,
  ownSeat,
  chosen,
  onChoose,
  alreadyBooked,
  onConfirm,
  busy,
}: SeatMapProps) {
  // Build rows of up to 4 seats each.
  const rows: number[][] = [];
  for (let i = 1; i <= totalSeats; i += 4) {
    rows.push([i, i + 1, i + 2, i + 3].filter((n) => n <= totalSeats));
  }

  return (
    <div>
      {/* Legend — explicit colours per spec: white = available, green = selected, grey = taken */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Legend className="border border-border bg-white" label="Available" />
        <Legend className="bg-green-600 text-white" label="Selected" />
        <Legend className="border-2 border-green-600 bg-green-600/10" label="Your seat" />
        <Legend className="bg-gray-400 text-white line-through" label="Taken" />
      </div>

      {/* The carriage */}
      <div className="mx-auto max-w-sm">
        {/* Locomotive nose */}
        <div className="mx-auto flex w-32 flex-col items-center">
          <div className="flex h-10 w-32 items-center justify-center rounded-t-[50%] border-2 border-b-0 border-border bg-card text-primary">
            <TrainFront className="h-5 w-5" />
          </div>
        </div>

        {/* Carriage body */}
        <div className="rounded-2xl border-2 border-border bg-card/50 p-4 shadow-inner">
          {/* Driver / front label */}
          <div className="mb-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            ◀ Front of train
          </div>

          {/* Column letters header */}
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

          {/* Seat rows */}
          <div className="space-y-1.5">
            {rows.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1.25rem_1fr_1.25rem_1fr_1.25rem] items-center gap-1"
              >
                {/* Row number */}
                <span className="text-center text-[10px] text-muted-foreground">{idx + 1}</span>

                {/* Left pair (A, B) */}
                <div className="grid grid-cols-2 gap-1">
                  {[row[0], row[1]].map((n, i) => (
                    <Seat
                      key={i}
                      n={n}
                      taken={n ? taken.has(n) : false}
                      ownSeat={ownSeat}
                      chosen={chosen}
                      alreadyBooked={alreadyBooked}
                      onChoose={onChoose}
                    />
                  ))}
                </div>

                {/* Aisle */}
                <span className="text-center text-[10px] text-muted-foreground/60">|</span>

                {/* Right pair (C, D) */}
                <div className="grid grid-cols-2 gap-1">
                  {[row[2], row[3]].map((n, i) => (
                    <Seat
                      key={i}
                      n={n}
                      taken={n ? taken.has(n) : false}
                      ownSeat={ownSeat}
                      chosen={chosen}
                      alreadyBooked={alreadyBooked}
                      onChoose={onChoose}
                    />
                  ))}
                </div>

                {/* Right edge */}
                <span />
              </div>
            ))}
          </div>

          <div className="mt-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            Rear of train ▶
          </div>
        </div>
      </div>

      {/* Confirm bar */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <div className="text-sm">
          {alreadyBooked ? (
            <span className="text-muted-foreground">
              You already booked this trip (seat #{ownSeat}).
            </span>
          ) : (
            <span>
              Selected seat: <strong>{chosen ?? "—"}</strong>
            </span>
          )}
        </div>
        <Button onClick={onConfirm} disabled={!chosen || busy || alreadyBooked}>
          {busy ? "Booking…" : "Confirm booking"}
        </Button>
      </div>
    </div>
  );
}

/** Single seat button — handles all the colour logic. */
function Seat({
  n,
  taken,
  ownSeat,
  chosen,
  alreadyBooked,
  onChoose,
}: {
  n: number | undefined;
  taken: boolean;
  ownSeat?: number;
  chosen: number | null;
  alreadyBooked: boolean;
  onChoose: (n: number) => void;
}) {
  // Empty slot when the row is partially filled (last row of an odd carriage).
  if (!n) return <span className="h-9 rounded" />;

  const isOwn = ownSeat === n;
  const isTaken = taken && !isOwn;
  const isChosen = chosen === n;

  return (
    <button
      disabled={isTaken || alreadyBooked}
      onClick={() => onChoose(n)}
      title={isTaken ? "Taken" : isOwn ? "Your seat" : `Seat ${n}`}
      className={`h-9 rounded-md text-xs font-medium transition ${
        isTaken
          ? "cursor-not-allowed bg-gray-400 text-white line-through"
          : isOwn
          ? "border-2 border-green-600 bg-green-600/10 text-green-700 dark:text-green-400"
          : isChosen
          ? "scale-105 bg-green-600 text-white shadow"
          : "border border-border bg-white text-gray-800 hover:border-green-600 hover:bg-green-50"
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
