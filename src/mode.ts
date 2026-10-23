// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.

/**
 * How someone is attending. "extras" is someone coming only to the opt-in sessions (e.g. just the dinner): stored as
 * attendance 'in_person' with no place, because they need no room place and never join its waiting list. Every
 * in-person registration that wants the day has a place ('place' or 'waitlist'), so a missing place is unambiguous.
 */
export type Mode = 'in_person' | 'remote' | 'extras';
export const modeOf = (r: { attendance: string; place: string | null }): Mode => (r.attendance === 'remote' ? 'remote' : r.place ? 'in_person' : 'extras');
