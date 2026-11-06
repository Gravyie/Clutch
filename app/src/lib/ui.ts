"use client";

import { create } from "zustand";

interface UI {
  onboarding: boolean;
  /** the action the user tapped before setup (e.g. "Yes $5"); runs once they're ready */
  pending?: () => void;
  openOnboarding(pending?: () => void): void;
  closeOnboarding(): void;
  command: boolean;
  setCommand(v: boolean): void;
}

export const useUI = create<UI>((set) => ({
  onboarding: false,
  openOnboarding: (pending) => set({ onboarding: true, pending }),
  closeOnboarding: () => set({ onboarding: false, pending: undefined }),
  command: false,
  setCommand: (v) => set({ command: v }),
}));
