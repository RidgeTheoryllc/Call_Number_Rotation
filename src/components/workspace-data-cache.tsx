"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { CallLogRecord, DidRecord, LeadRecord } from "@/types";

export type DidPoolCacheSnapshot = {
  dids: DidRecord[];
  defaultMessagingDid: string | null;
};

type CacheContextValue = {
  /** `null` = no cache for this user; otherwise the cached rows (may be empty). */
  getCachedLeads: (userId: string) => LeadRecord[] | null;
  setCachedLeads: (userId: string, leads: LeadRecord[]) => void;
  /** `null` = no cache for this user. */
  getCachedDidPool: (userId: string) => DidPoolCacheSnapshot | null;
  setCachedDidPool: (userId: string, snapshot: DidPoolCacheSnapshot) => void;
  /** `null` = no cache for this user. */
  getCachedCallLogs: (userId: string) => CallLogRecord[] | null;
  setCachedCallLogs: (userId: string, logs: CallLogRecord[]) => void;
  clearWorkspaceCache: () => void;
};

const WorkspaceDataCacheContext = createContext<CacheContextValue | null>(null);

export function WorkspaceDataCacheProvider({ children }: { children: ReactNode }) {
  const leadsRef = useRef<{ userId: string; rows: LeadRecord[] } | null>(null);
  const didPoolRef = useRef<{ userId: string } & DidPoolCacheSnapshot | null>(null);
  const callLogsRef = useRef<{ userId: string; rows: CallLogRecord[] } | null>(null);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const getCachedLeads = useCallback((userId: string): LeadRecord[] | null => {
    const h = leadsRef.current;
    if (!h || h.userId !== userId) return null;
    return h.rows;
  }, []);

  const setCachedLeads = useCallback((userId: string, leads: LeadRecord[]) => {
    leadsRef.current = { userId, rows: leads };
  }, []);

  const getCachedDidPool = useCallback((userId: string): DidPoolCacheSnapshot | null => {
    const h = didPoolRef.current;
    if (!h || h.userId !== userId) return null;
    return { dids: h.dids, defaultMessagingDid: h.defaultMessagingDid };
  }, []);

  const setCachedDidPool = useCallback((userId: string, snapshot: DidPoolCacheSnapshot) => {
    didPoolRef.current = {
      userId,
      dids: snapshot.dids,
      defaultMessagingDid: snapshot.defaultMessagingDid,
    };
  }, []);

  const getCachedCallLogs = useCallback((userId: string): CallLogRecord[] | null => {
    const h = callLogsRef.current;
    if (!h || h.userId !== userId) return null;
    return h.rows;
  }, []);

  const setCachedCallLogs = useCallback((userId: string, logs: CallLogRecord[]) => {
    callLogsRef.current = { userId, rows: logs };
  }, []);

  const clearWorkspaceCache = useCallback(() => {
    leadsRef.current = null;
    didPoolRef.current = null;
    callLogsRef.current = null;
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") clearWorkspaceCache();
    });
    return () => subscription.unsubscribe();
  }, [supabase, clearWorkspaceCache]);

  const value = useMemo(
    () => ({
      getCachedLeads,
      setCachedLeads,
      getCachedDidPool,
      setCachedDidPool,
      getCachedCallLogs,
      setCachedCallLogs,
      clearWorkspaceCache,
    }),
    [
      getCachedLeads,
      setCachedLeads,
      getCachedDidPool,
      setCachedDidPool,
      getCachedCallLogs,
      setCachedCallLogs,
      clearWorkspaceCache,
    ],
  );

  return (
    <WorkspaceDataCacheContext.Provider value={value}>{children}</WorkspaceDataCacheContext.Provider>
  );
}

export function useWorkspaceDataCache(): CacheContextValue {
  const ctx = useContext(WorkspaceDataCacheContext);
  if (!ctx) {
    throw new Error("useWorkspaceDataCache must be used within WorkspaceDataCacheProvider");
  }
  return ctx;
}
