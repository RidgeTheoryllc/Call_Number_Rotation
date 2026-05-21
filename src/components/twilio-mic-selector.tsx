"use client";

import { useMemo } from "react";
import { useTwilioDeviceContext } from "@/components/twilio-device-provider";

type TwilioMicSelectorProps = {
  className?: string;
  /** Max width of the control (default fills container up to 28rem). */
  maxWidthClass?: string;
};

export function TwilioMicSelector({
  className = "",
  maxWidthClass = "max-w-full",
}: TwilioMicSelectorProps) {
  const {
    deviceReady,
    callStatus,
    inputDevices,
    selectedInputDeviceId,
    setSelectedInputDeviceId,
    audioSetupError,
  } = useTwilioDeviceContext();

  const micLocked = callStatus === "ringing" || callStatus === "in-progress";
  const disabled = !deviceReady || micLocked || inputDevices.length === 0;

  const selectedLabel = useMemo(() => {
    const match = inputDevices.find((d) => d.deviceId === selectedInputDeviceId);
    return match?.label ?? inputDevices[0]?.label ?? "Select microphone";
  }, [inputDevices, selectedInputDeviceId]);

  return (
    <div className={`w-full min-w-0 ${maxWidthClass} ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <label
          htmlFor="twilio-mic-select"
          className="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
        >
          Microphone
        </label>
        <span
          className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-px text-[10px] font-medium text-slate-600"
          title="Browser noise suppression, echo cancellation, and auto gain"
        >
          Noise reduction on
        </span>
      </div>

      <div className="relative mt-1 w-full">
        <select
          id="twilio-mic-select"
          value={selectedInputDeviceId}
          onChange={(e) => void setSelectedInputDeviceId(e.target.value)}
          disabled={disabled}
          title={selectedLabel}
          className="h-7 w-full min-w-0 appearance-none truncate rounded-md border border-slate-300 bg-white py-0 pl-2 pr-7 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
        >
          {inputDevices.length === 0 ? (
            <option value="">No microphones found</option>
          ) : (
            inputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId} title={d.label}>
                {d.label}
              </option>
            ))
          )}
        </select>
        <span
          className="pointer-events-none absolute inset-y-0 right-0 flex w-7 items-center justify-center text-slate-400"
          aria-hidden
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </div>

      {micLocked ? (
        <p className="mt-1 text-[10px] text-slate-500">Change mic before answering or after hang up.</p>
      ) : null}
      {audioSetupError ? (
        <p className="mt-1 text-[10px] font-medium text-amber-700">{audioSetupError}</p>
      ) : null}
    </div>
  );
}
