import type {NarrationIntent, NarrationSegment} from '@pose-clip/schemas';

const SENTENCE_BOUNDARY = /(?<=[.\u3002\uFF01\uFF1F!?])\s*/u;

export function segmentNarration(intents: readonly NarrationIntent[]): NarrationSegment[] {
  return intents.flatMap(intent => {
    const parts = intent.text.split(SENTENCE_BOUNDARY).map(text => text.trim()).filter(Boolean);
    return parts.map((text, sequence) => ({
      id: `${intent.id}.segment.${sequence + 1}`,
      narrationIntentId: intent.id,
      shotId: intent.shotId,
      sequence,
      text,
      language: intent.language,
    }));
  });
}
