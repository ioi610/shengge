/** Retain quiet initial consonants before a model's confident speech onset.
 * Never rewind across the current search origin (the preceding accepted end).
 * This affects only a detected turn's replay, not forward playback of gaps. */
export function dialogueLeadIn<T extends {startMs:number;endMs:number}>(boundary:T,origin:number):T{
 return {...boundary,startMs:Math.max(origin,boundary.startMs-480)};
}
