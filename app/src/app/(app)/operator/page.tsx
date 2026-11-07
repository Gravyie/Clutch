"use client";

import { useEffect, useState } from "react";
import { CircleNotchIcon, PowerIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ENGINE_URL } from "@/lib/env";
import type { AgentState } from "@clutch/shared";
import { cn } from "@/lib/utils";

/**
 * Operator switch for the platform AI (0G inference), so credits are only spent around demos. Not linked anywhere.
 * The engine checks the token (ADMIN_TOKEN); it's kept in this tab's session only.
 */
const KEY = "clutch.admin-token";

export default function OperatorPage() {
  const [token, setToken] = useState("");
  const [ai, setAi] = useState<AgentState>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(KEY) ?? "");
    } catch {}
    const load = () =>
      fetch(`${ENGINE_URL}/admin/ai`)
        .then((r) => r.json())
        .then(setAi)
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const flip = async (enabled: boolean) => {
    setBusy(true);
    try {
      const r = await fetch(`${ENGINE_URL}/admin/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Token": token },
        body: JSON.stringify({ enabled }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 403 ? "Wrong token, or ADMIN_TOKEN isn't set on the engine." : (j.message ?? "Request failed"));
      setAi(j);
      try {
        sessionStorage.setItem(KEY, token);
      } catch {}
      toast.success(enabled ? "AI on: markets will start opening" : "AI off: no more 0G spend");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const on = ai?.enabled !== false;
  const label = !ai ? "Loading…" : !on ? "Off" : ai.outOfCredits ? "On · 0G out of credits" : ai.mode === "paused" ? "On · daily budget spent" : "On";

  return (
    <div className="mx-auto max-w-[520px] space-y-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="display text-[2.2rem] font-bold">AI switch</h1>
        <p className="mt-1 text-muted-foreground">Turn 0G inference on just before a demo and off after. Open markets still settle while it's off.</p>
      </div>
      <div className="surface space-y-4 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Status</span>
          <span className={cn("rounded-full px-3 py-1 text-sm font-semibold", on && ai?.mode !== "paused" ? "bg-yes-soft text-yes" : "bg-raised text-muted-foreground")}>{label}</span>
        </div>
        {ai && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground">Calls today</div>
              <div className="font-mono text-lg">{ai.requestsToday}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Spent today</div>
              <div className="font-mono text-lg">
                ${ai.spentTodayUsd.toFixed(3)} <span className="text-faint">/ ${ai.capTodayUsd}</span>
              </div>
            </div>
          </div>
        )}
        <Input type="password" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy || !token} onClick={() => flip(true)} className="h-11 rounded-full bg-brand font-semibold text-brand-foreground hover:bg-brand/90">
            {busy ? <CircleNotchIcon className="animate-spin" /> : <PowerIcon weight="bold" />} Turn on
          </Button>
          <Button disabled={busy || !token} variant="outline" onClick={() => flip(false)} className="h-11 rounded-full font-semibold">
            Turn off
          </Button>
        </div>
      </div>
    </div>
  );
}
