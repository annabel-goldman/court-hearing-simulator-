/**
 * Simulation Configuration
 * 
 * Centralized timing constants for the courtroom simulation.
 * Adjust these values to fine-tune the user experience.
 */

// =============================================================================
// AUDIO RECORDING SETTINGS
// =============================================================================

/** Duration of each audio chunk sent to the backend (in milliseconds) */
export const AUDIO_CHUNK_DURATION_MS = 4000

/** Interval between starting new recordings (should be slightly > chunk duration) */
export const RECORDING_INTERVAL_MS = 4500

/** Delay before starting recording after phase change */
export const RECORDING_SYNC_DELAY_MS = 500

// =============================================================================
// SESSION TIMING
// =============================================================================

/** Total time for demo mode session (in seconds) */
export const DEMO_SESSION_DURATION_SECONDS = 180

/** How long to display the recent transcript before clearing (ms) */
export const TRANSCRIPT_DISPLAY_DURATION_MS = 5000

// =============================================================================
// JUDGE SPEECH TIMING
// =============================================================================

/** Milliseconds per word for calculating speaking duration */
export const MS_PER_WORD = 400

/** Minimum time to display judge question (ms) */
export const MIN_SPEAKING_TIME_MS = 3000

/** Fallback timeout if no audio format is provided (ms) */
export const FALLBACK_QUESTION_TIMEOUT_MS = 5000

// =============================================================================
// RITUAL PHASE TIMING
// =============================================================================

/** Delay before starting the "All Rise" ritual after page load (ms) */
export const RITUAL_START_DELAY_MS = 1500

/** Duration of "Judge Entering" phase before seated (ms) */
export const JUDGE_ENTERING_DURATION_MS = 3000

/** Delay before judge speaks opening statement after PROCEEDING starts (ms) */
export const PROCEEDING_START_DELAY_MS = 1000

/** Duration to display opening statement before clearing (ms) */
export const OPENING_STATEMENT_DURATION_MS = 4000

// =============================================================================
// BROWSER TTS FALLBACK SETTINGS
// =============================================================================

/** Speech rate for browser TTS fallback */
export const BROWSER_TTS_RATE = 0.85

/** Pitch for browser TTS fallback */
export const BROWSER_TTS_PITCH = 0.9

// =============================================================================
// TIMER SETTINGS
// =============================================================================

/** Interval for countdown timer updates (ms) */
export const TIMER_INTERVAL_MS = 1000

/** Microphone level below this value is treated as user silence */
export const SILENCE_AUDIO_LEVEL_THRESHOLD = 10

/** Judge asks a question after this much uninterrupted user silence (ms) */
export const SILENCE_TRIGGER_MS = 8000

/** Extra response window granted when timer expires mid-question (seconds) */
export const TIMER_OVERTIME_SECONDS = 10
