"use client";

import { create } from "zustand";

interface UI {
  onboarding: boolean;
  /** the action the user tapped before setup (e.g. "Yes $5"); runs once they're ready */
  pending?: () => void;
  openOnboarding(pending?: () => void): void;
  /** the World ID upgrade (higher limits, agents), opened on purpose rather than as a gate */
  verifying: boolean;
  openVerify(): void;
  closeOnboarding(): void;
  command: boolean;
  setCommand(v: boolean): void;
  /** the four-card tour: first visit, or "How it works" in the top bar */
  tutorial: boolean;
  setTutorial(v: boolean): void;
  /** the wallet sheet: false (closed), true (home) or a specific view */
  wallet: boolean | "deposit" | "withdraw";
  setWallet(v: boolean | "deposit" | "withdraw"): void;
}

export const useUI = create<UI>((set) => ({
  onboarding: false,
  openOnboarding: (pending) => set({ onboarding: true, pending }),
  closeOnboarding: () => set({ onboarding: false, pending: undefined, verifying: false }),
  verifying: false,
  openVerify: () => set({ onboarding: true, verifying: true }),
  command: false,
  setCommand: (v) => set({ command: v }),
  tutorial: false,
  setTutorial: (v) => set({ tutorial: v }),
  wallet: false,
  setWallet: (v) => set({ wallet: v }),
}));
