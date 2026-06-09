"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Market } from "@/lib/markets";

interface MarketContextValue {
  market: Market;
  setMarket: (m: Market) => void;
}

const MarketContext = createContext<MarketContextValue>({
  market: "CN",
  setMarket: () => {},
});

export function MarketProvider({ children }: { children: ReactNode }) {
  const [market, setMarket] = useState<Market>("CN");

  return (
    <MarketContext.Provider value={{ market, setMarket }}>
      {children}
    </MarketContext.Provider>
  );
}

export function useMarket() {
  return useContext(MarketContext);
}
