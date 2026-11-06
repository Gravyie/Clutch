import { DotType } from "@/components/dot-type";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Responsible play" };

export default function ResponsiblePlay() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-6">
      <DotType as="h1" start speed={34} text="Responsible play" className="display text-[2.9rem]" />
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">Clutch is for adults, for fun, with money you can afford to lose. These controls are built into the contracts, not just the app.</p>
      <div className="mt-10 space-y-8 text-[15px] leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold">Limits that follow you</h2>
          <p className="mt-1.5 text-muted-foreground">Your daily stake limit is attached to your verified human ID. Opening a new wallet doesn't reset it.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold">Take a break</h2>
          <p className="mt-1.5 text-muted-foreground">
            Block yourself from trading for 24 hours, a week, a month or six months from <Link href="/account" className="text-foreground underline underline-offset-4">Account</Link>. Breaks can be extended but never shortened, and they apply to every wallet you own.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold">18+ only</h2>
          <p className="mt-1.5 text-muted-foreground">Trading requires a World ID check that you're an adult. We never see your documents.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold">Test network</h2>
          <p className="mt-1.5 text-muted-foreground">Clutch currently runs on a test network with test funds that have no cash value. Real-money markets will only run through licensed operators where permitted.</p>
        </section>
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-semibold">Need to talk to someone?</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Free, confidential support: <a className="text-foreground underline underline-offset-4" href="https://www.begambleaware.org" target="_blank" rel="noreferrer">BeGambleAware</a> (UK), <a className="text-foreground underline underline-offset-4" href="https://www.ncpgambling.org" target="_blank" rel="noreferrer">NCPG 1-800-GAMBLER</a> (US), <a className="text-foreground underline underline-offset-4" href="https://www.gamblingtherapy.org" target="_blank" rel="noreferrer">Gambling Therapy</a> (worldwide).
          </p>
        </section>
      </div>
    </div>
  );
}
