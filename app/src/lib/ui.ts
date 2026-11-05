"use client";

import { create } from "zustand";

interface UI {
  onboarding: boolean;
  openOnboarding(): void;
  closeOnboarding(): void;
  command: boolean;
  setCommand(v: boolean): void;
}

export const useUI = create<UI>((set) => ({
  onboarding: false,
  openOnboarding: () => set({ onboarding: true }),
  closeOnboarding: () => set({ onboarding: false }),
  command: false,
  setCommand: (v) => set({ command: v }),
}));
