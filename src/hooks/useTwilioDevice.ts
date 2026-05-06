"use client";

import { useEffect, useMemo, useState } from "react";
import { Call, Device } from "@twilio/voice-sdk";

type TwilioCallStatus = "idle" | "registering" | "ready" | "ringing" | "in-progress" | "completed" | "error";

export function useTwilioDevice(identityHint?: string) {
  const [device, setDevice] = useState<Device | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [identity, setIdentity] = useState<string>("");
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callStatus, setCallStatus] = useState<TwilioCallStatus>("idle");
  const [deviceError, setDeviceError] = useState<string>("");

  const resolvedIdentity = useMemo(() => {
    if (identityHint?.trim()) return identityHint.trim();
    return "";
  }, [identityHint]);

  useEffect(() => {
    if (!resolvedIdentity) {
      return;
    }

    let isCancelled = false;
    let mountedDevice: Device | null = null;

    const initialize = async () => {
      try {
        setCallStatus("registering");
        const fetchToken = async (): Promise<{ token: string; identity: string }> => {
          const tokenRes = await fetch(`/api/twilio/token?identity=${encodeURIComponent(resolvedIdentity)}`);
          const tokenData = (await tokenRes.json()) as { token?: string; identity?: string; error?: string };

          if (!tokenRes.ok || !tokenData.token || !tokenData.identity) {
            throw new Error(tokenData.error ?? "Failed to fetch Twilio token");
          }

          return { token: tokenData.token, identity: tokenData.identity };
        };

        const tokenData = await fetchToken();

        if (isCancelled) return;
        setDeviceError("");
        setIdentity(tokenData.identity);

        mountedDevice = new Device(tokenData.token, {
          closeProtection: true,
          codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        });

        mountedDevice.on("registered", () => {
          if (isCancelled) return;
          setDeviceReady(true);
          setCallStatus("ready");
        });

        mountedDevice.on("incoming", (incomingCall) => {
          if (isCancelled) return;
          setCallStatus("ringing");
          setActiveCall(incomingCall);
          incomingCall.accept();

          incomingCall.on("accept", () => {
            if (isCancelled) return;
            setCallStatus("in-progress");
          });

          incomingCall.on("disconnect", () => {
            if (isCancelled) return;
            setActiveCall(null);
            setCallStatus("completed");
          });

          incomingCall.on("cancel", () => {
            if (isCancelled) return;
            setActiveCall(null);
            setCallStatus("completed");
          });

          incomingCall.on("reject", () => {
            if (isCancelled) return;
            setActiveCall(null);
            setCallStatus("completed");
          });

          incomingCall.on("error", (error: Error) => {
            if (isCancelled) return;
            setDeviceError(error.message);
            setCallStatus("error");
          });
        });

        mountedDevice.on("error", (error: Error) => {
          if (isCancelled) return;
          setDeviceError(error.message);
          setCallStatus("error");
          setDeviceReady(false);
        });
        mountedDevice.on("tokenWillExpire", async () => {
          try {
            const refreshed = await fetchToken();
            await mountedDevice?.updateToken(refreshed.token);
          } catch (error) {
            if (isCancelled) return;
            setDeviceError(error instanceof Error ? error.message : "Failed to refresh Twilio token");
            setCallStatus("error");
          }
        });

        if (isCancelled) return;
        setDevice(mountedDevice);
        await mountedDevice.register();
      } catch (error) {
        if (isCancelled) return;
        setDeviceError(error instanceof Error ? error.message : "Failed to initialize Twilio Device");
        setCallStatus("error");
      }
    };

    void initialize();

    return () => {
      isCancelled = true;
      if (mountedDevice) {
        mountedDevice.destroy();
      }
      setDevice(null);
      setActiveCall(null);
      setDeviceReady(false);
      setCallStatus("idle");
    };
  }, [resolvedIdentity]);

  const hangup = () => {
    if (activeCall) {
      activeCall.disconnect();
    } else {
      device?.disconnectAll();
    }
  };

  const mute = (muted: boolean) => {
    if (!activeCall) return;
    activeCall.mute(muted);
  };

  return {
    device,
    identity,
    deviceReady,
    activeCall,
    callStatus,
    deviceError,
    hangup,
    mute,
  };
}
