const questionOrder=/^(?:what|who|whom|whose|which|when|where|why|how) (?:am|is|are|was|were|do|does|did|can|could|will|would|shall|should|may|might|must|have|has|had) \p{L}/u;
const normalizedWords=(text:string)=>text.trim().replace(/[\s.!?。！？…]+$/gu,'').replace(/\s+/gu,' ').toLowerCase();

/** A punctuation-only model edit must preserve all words and already have
 * clear wh + auxiliary question order. Possessive apostrophes stay meaningful. */
export function restoresQuestionPunctuation(draft:string,value:string){
 const original=normalizedWords(draft);
 return original===normalizedWords(value)&&questionOrder.test(original);
}

/** Complete an otherwise unpunctuated, single-clause English question before
 * optional refinement. Do not reinterpret existing marks, quotes, reported
 * speech or multiple clauses; this never changes the translator's words. */
export function punctuateBareQuestion(draft:string){
 const text=draft.trim();
 if(!text||/[\p{P}\p{S}]$/u.test(text)||/[\r\n.!?。！？,，;；:：—–]/u.test(text))return draft;
 if(!questionOrder.test(text.replace(/\s+/gu,' ').toLowerCase()))return draft;
 return text+'?';
}
