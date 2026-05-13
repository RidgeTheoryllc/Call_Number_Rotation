"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { useTwilioDevice } from "@/hooks/useTwilioDevice";

type TwilioDeviceContextValue = ReturnType<typeof useTwilioDevice>;

const TwilioDeviceContext = createContext<TwilioDeviceContextValue | null>(null);

export function TwilioDeviceProvider({ children }: { children: ReactNode }) {
  const [identityHint, setIdentityHint] = useState("");
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    const syncIdentity = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setIdentityHint(user?.id ? `agent-${user.id}` : "");
    };

    void syncIdentity();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id;
      setIdentityHint(id ? `agent-${id}` : "");
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useTwilioDevice(identityHint);

  return <TwilioDeviceContext.Provider value={value}>{children}</TwilioDeviceContext.Provider>;
}

export function useTwilioDeviceContext(): TwilioDeviceContextValue {
  const ctx = useContext(TwilioDeviceContext);
  if (!ctx) {
    throw new Error("useTwilioDeviceContext must be used within TwilioDeviceProvider");
  }
  return ctx;
}
