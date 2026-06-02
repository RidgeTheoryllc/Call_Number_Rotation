/** WebRTC mic constraints applied to agent browser calls.
 * Match Teams-style voice leveling more closely by letting the browser boost and clean up mic input.
 */
export const TWILIO_AUDIO_TRACK_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export const TWILIO_RTC_CONSTRAINTS: MediaStreamConstraints = {
  audio: TWILIO_AUDIO_TRACK_CONSTRAINTS,
};

export const TWILIO_PREFERRED_MIC_STORAGE_KEY = "twilio-preferred-input-device-id";

export function readPreferredMicId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TWILIO_PREFERRED_MIC_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePreferredMicId(deviceId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TWILIO_PREFERRED_MIC_STORAGE_KEY, deviceId);
  } catch {
    // Private mode / blocked storage
  }
}
