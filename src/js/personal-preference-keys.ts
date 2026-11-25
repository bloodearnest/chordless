/** The settings that are the person's and not the device's (what they play, how the chart reads): kept apart so the Worker can know them */
export const PERSONAL_PREFERENCE_KEYS = [
  'musician_type',
  'section_defaults',
  'enable_capo',
  'enabled_capo',
  'enable_pitch',
  'pitch',
  'tuning',
  'chord_tint',
  'font_ui',
  'font_lyrics',
  'font_chords',
] as const
