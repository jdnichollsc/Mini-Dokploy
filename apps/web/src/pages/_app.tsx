import "../index.css";

import { Toaster } from "@mini-dokploy/ui/components/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import type { AppType } from "next/app";
import { useState } from "react";

import Header from "@/components/header";
import { trpc } from "@/utils/trpc";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return `http://localhost:${process.env.PORT ?? 3001}`;
}

const App: AppType = ({ Component, pageProps }) => {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          fetch(url, options) {
            return fetch(url, { ...options, credentials: "include" });
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div
            className={`${geistSans.variable} ${geistMono.variable} grid grid-rows-[auto_1fr] h-svh`}
          >
            <Header />
            <Component {...pageProps} />
          </div>
          <Toaster richColors />
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
};

export default App;
