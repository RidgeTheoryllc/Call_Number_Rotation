"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Call, Device, type AudioHelper } from "@twilio/voice-sdk";
import {
  readPreferredMicId,
  TWILIO_AUDIO_TRACK_CONSTRAINTS,
  TWILIO_RTC_CONSTRAINTS,
  writePreferredMicId,
} from "@/lib/twilio-audio";

type TwilioCallStatus = "idle" | "registering" | "ready" | "ringing" | "in-progress" | "completed" | "error";

export type TwilioInputDeviceOption = {
  deviceId: string;
  label: string;
};

export interface UseTwilioDeviceOptions {
  /** Auto-accept incoming client legs (click-to-call, QA listen). */
  autoAcceptIncoming?: boolean;
  /** Mute microphone when an auto-accepted or manually accepted call connects. */
  muteOnConnect?: boolean;
}

function listInputDevices(audio: AudioHelper): TwilioInputDeviceOption[] {
  return Array.from(audio.availableInputDevices.values()).map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label?.trim() || `Microphone ${index + 1}`,
  }));
}

async function applyAudioEnhancements(audio: AudioHelper): Promise<void> {
  await audio.setAudioConstraints(TWILIO_AUDIO_TRACK_CONSTRAINTS);
}

async function applyPreferredMic(audio: AudioHelper, deviceId: string | null): Promise<string | null> {
  if (!deviceId || !audio.availableInputDevices.has(deviceId)) {
    return audio.inputDevice?.deviceId ?? null;
  }
  await audio.setInputDevice(deviceId);
  writePreferredMicId(deviceId);
  return deviceId;
}

export function useTwilioDevice(identityHint?: string, options?: UseTwilioDeviceOptions) {
  const autoAcceptIncoming = options?.autoAcceptIncoming ?? false;
  const muteOnConnect = options?.muteOnConnect ?? false;
  const [device, setDevice] = useState<Device | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [identity, setIdentity] = useState<string>("");
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callStatus, setCallStatus] = useState<TwilioCallStatus>("idle");
  const [deviceError, setDeviceError] = useState<string>("");
  const [inputDevices, setInputDevices] = useState<TwilioInputDeviceOption[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState("");
  const [audioSetupError, setAudioSetupError] = useState("");
  /** Prevents double `accept()` (Strict Mode / duplicate effects), which drops the call immediately. */
  const acceptedIncomingCallRef = useRef<Call | null>(null);
  /** When > Date.now(), the next incoming client leg is auto-accepted as click-to-call (PSTN inbound leaves this cleared). */
  const outboundClientLegExpectUntilMsRef = useRef(0);
  const audioHelperRef = useRef<AudioHelper | null>(null);

  const resolvedIdentity = useMemo(() => {
    if (identityHint?.trim()) return identityHint.trim();
    return "";
  }, [identityHint]);

  const refreshInputDevices = useCallback(() => {
    const audio = audioHelperRef.current;
    if (!audio) return;
    const listed = listInputDevices(audio);
    setInputDevices(listed);
    const activeId = audio.inputDevice?.deviceId ?? listed[0]?.deviceId ?? "";
    setSelectedInputDeviceId(activeId);
  }, []);

  const setupAudioHelper = useCallback(async (audio: AudioHelper) => {
    audioHelperRef.current = audio;
    setAudioSetupError("");
    try {
      await applyAudioEnhancements(audio);
      refreshInputDevices();
      const preferred = readPreferredMicId();
      const applied = await applyPreferredMic(audio, preferred);
      if (applied) {
        setSelectedInputDeviceId(applied);
      }
    } catch (error) {
      setAudioSetupError(
        error instanceof Error ? error.message : "Could not apply microphone noise reduction",
      );
    }
  }, [refreshInputDevices]);

  const acceptOptions = useMemo(
    () => ({ rtcConstraints: TWILIO_RTC_CONSTRAINTS }),
    [],
  );

  const acceptCall = useCallback(
    (call: Call) => {
      if (acceptedIncomingCallRef.current === call) return;
      acceptedIncomingCallRef.current = call;
      call.accept(acceptOptions);
    },
    [acceptOptions],
  );

  useEffect(() => {
    if (!resolvedIdentity) {
      return;
    }

    let isCancelled = false;
    let mountedDevice: Device | null = null;
    let audioDeviceChangeHandler: ((...args: unknown[]) => void) | null = null;

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
          const audio = mountedDevice?.audio;
          if (audio) {
            void setupAudioHelper(audio);
            audioDeviceChangeHandler = () => {
              refreshInputDevices();
            };
            audio.on("deviceChange", audioDeviceChangeHandler);
          }
        });

        mountedDevice.on("incoming", (incomingCall) => {
          if (isCancelled) return;
          setCallStatus("ringing");
          setActiveCall(incomingCall);

          incomingCall.on("accept", () => {
            if (isCancelled) return;
            if (muteOnConnect) {
              incomingCall.mute(true);
            }
            setCallStatus("in-progress");
          });

          const backToReady = () => {
            if (isCancelled) return;
            setActiveCall(null);
            // Stay on "ready" so the next outbound leg can ring; "completed" left stale breaks page logic.
            setCallStatus("ready");
          };

          incomingCall.on("disconnect", backToReady);

          incomingCall.on("cancel", backToReady);

          incomingCall.on("reject", backToReady);

          incomingCall.on("error", (error: Error) => {
            if (isCancelled) return;
            setDeviceError(error.message);
            setCallStatus("error");
            setActiveCall(null);
          });

          const expectUntil = outboundClientLegExpectUntilMsRef.current;
          const shouldAutoAccept =
            (expectUntil > 0 && Date.now() < expectUntil) || autoAcceptIncoming;
          if (shouldAutoAccept) {
            outboundClientLegExpectUntilMsRef.current = 0;
            acceptCall(incomingCall);
          }
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
      const audio = audioHelperRef.current;
      if (audio && audioDeviceChangeHandler) {
        audio.removeListener("deviceChange", audioDeviceChangeHandler);
      }
      audioHelperRef.current = null;
      if (mountedDevice) {
        mountedDevice.destroy();
      }
      setDevice(null);
      setActiveCall(null);
      setDeviceReady(false);
      setCallStatus("idle");
      setInputDevices([]);
      setSelectedInputDeviceId("");
      setAudioSetupError("");
    };
  }, [acceptCall, autoAcceptIncoming, muteOnConnect, refreshInputDevices, resolvedIdentity, setupAudioHelper]);

  useEffect(() => {
    if (!activeCall) {
      acceptedIncomingCallRef.current = null;
    }
  }, [activeCall]);

  const hangup = useCallback(() => {
    if (activeCall) {
      activeCall.disconnect();
    } else {
      device?.disconnectAll();
    }
  }, [activeCall, device]);

  const answerIncomingCall = useCallback(() => {
    if (!activeCall || callStatus !== "ringing") return;
    acceptCall(activeCall);
  }, [acceptCall, activeCall, callStatus]);

  const rejectIncomingCall = useCallback(() => {
    if (!activeCall || callStatus !== "ringing") return;
    activeCall.reject();
  }, [activeCall, callStatus]);

  const mute = useCallback((muted: boolean) => {
    if (!activeCall) return;
    activeCall.mute(muted);
  }, [activeCall]);

  const setSelectedInputDeviceIdHandler = useCallback(
    async (deviceId: string) => {
      const audio = audioHelperRef.current;
      if (!audio || !deviceId) return;
      if (callStatus === "ringing" || callStatus === "in-progress") {
        setAudioSetupError("Hang up before changing microphone.");
        return;
      }
      setAudioSetupError("");
      try {
        await applyPreferredMic(audio, deviceId);
        setSelectedInputDeviceId(deviceId);
        refreshInputDevices();
      } catch (error) {
        setAudioSetupError(error instanceof Error ? error.message : "Could not switch microphone");
      }
    },
    [callStatus, refreshInputDevices],
  );

  const signalOutboundClientLegExpected = useCallback(() => {
    outboundClientLegExpectUntilMsRef.current = Date.now() + 25_000;
  }, []);

  const clearOutboundClientLegExpected = useCallback(() => {
    outboundClientLegExpectUntilMsRef.current = 0;
  }, []);

  return {
    device,
    identity,
    deviceReady,
    activeCall,
    callStatus,
    deviceError,
    inputDevices,
    selectedInputDeviceId,
    setSelectedInputDeviceId: setSelectedInputDeviceIdHandler,
    audioSetupError,
    hangup,
    answerIncomingCall,
    rejectIncomingCall,
    mute,
    signalOutboundClientLegExpected,
    clearOutboundClientLegExpected,
  };
}
