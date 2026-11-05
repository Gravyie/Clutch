"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProvider } from "@/lib/wallet";
import { AccountProvider } from "@/lib/account";
import { useChannel } from "@/lib/live";

function LiveRoot() {
  useChannel("global");
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } } }));
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={qc}>
        <WalletProvider>
          <AccountProvider>
            <TooltipProvider delayDuration={200}>
              <LiveRoot />
              {children}
              <Toaster position="bottom-right" theme="system" toastOptions={{ className: "!bg-surface !border-border !text-foreground !rounded-xl" }} />
            </TooltipProvider>
          </AccountProvider>
        </WalletProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
