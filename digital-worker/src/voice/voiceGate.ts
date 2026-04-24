// ITSM Operations Digital Worker — Voice gate (enable/disable via Teams commands)

let voiceEnabled = true;

export function enableVoice(): void { voiceEnabled = true; console.log('[Voice] Enabled'); }
export function disableVoice(): void { voiceEnabled = false; console.log('[Voice] Disabled'); }
export function isVoiceEnabled(): boolean { return voiceEnabled; }
