/**
 * Admin — Trains CRUD.
 * A train cannot be deleted while trips reference it (DB FK would block,
 * we also guard client-side and surface a friendly error).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ADMIN_NAV } from "./nav";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface Train { id: string; code: string; name: string; }

export default function AdminTrains() {
  const [rows, setRows] = useState<Train[]>([]);
  const [tripsByTrain, setTripsByTrain] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Train | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const [tRes, tripRes] = await Promise.all([
      supabase.from("trains").select("id, code, name").order("code"),
      supabase.from("trips").select("train_id"),
    ]);
    setRows((tRes.data ?? []) as Train[]);
    const counts: Record<string, number> = {};
    (tripRes.data ?? []).forEach((r: any) => { counts[r.train_id] = (counts[r.train_id] ?? 0) + 1; });
    setTripsByTrain(counts);
  };
  useEffect(() => { load(); }, []);

  const remove = async (t: Train) => {
    if ((tripsByTrain[t.id] ?? 0) > 0) {
      toast.error("This train has trips — delete or reassign them first.");
      return;
    }
    if (!confirm(`Delete train ${t.code}?`)) return;
    const { error } = await supabase.from("trains").delete().eq("id", t.id);
    if (error) toast.error(error.message);
    else { toast.success("Train deleted."); load(); }
  };

  return (
    <AppShell nav={ADMIN_NAV}>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trains</h1>
          <p className="text-sm text-muted-foreground">Manage the rolling stock available for trips.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> New train
            </Button>
          </DialogTrigger>
          <TrainDialog
            key={editing?.id ?? "new"}
            train={editing}
            onSaved={() => { setOpen(false); load(); }}
          />
        </Dialog>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Trips</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-4 py-2 font-mono">{t.code}</td>
                <td className="px-4 py-2">{t.name}</td>
                <td className="px-4 py-2">{tripsByTrain[t.id] ?? 0}</td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(t); setOpen(true); }} title="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(t)} title="Delete">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No trains yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </AppShell>
  );
}

function TrainDialog({ train, onSaved }: { train: Train | null; onSaved: () => void }) {
  const [code, setCode] = useState(train?.code ?? "");
  const [name, setName] = useState(train?.name ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return toast.error("Code and name are required.");
    setBusy(true);
    const payload = { code: code.trim().toUpperCase(), name: name.trim() };
    const { error } = train
      ? await supabase.from("trains").update(payload).eq("id", train.id)
      : await supabase.from("trains").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success(train ? "Train updated." : "Train created."); onSaved(); }
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{train ? "Edit train" : "New train"}</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="HHR-401" required />
        </div>
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Haramain Express 401" required />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : (train ? "Save" : "Create")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
