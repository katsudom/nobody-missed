// Claude does ONE job here: pull facts out of the victim's own words (SPEC §7). It never scores or ranks.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-5-5';

const SYSTEM = `You extract facts from an emergency help request. Return ONLY JSON:
{ "age": number|null, "people": number|null, "medical": ["oxygen","dialysis","insulin","ventilator","mobility","pregnant"...],
  "hazards": ["no_power","no_water","flooding","trapped","fire","injury","collapse"...], "children": bool, "location": string|null,
  "quotes": [ exact substrings of the message that justify each item ] }
Never invent. If unsure, omit. quotes must be verbatim substrings.`;

export interface Facts {
  age: number | null;
  people: number | null;
  medical: string[];
  hazards: string[];
  children: boolean;
  location: string | null;
  quotes: string[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['age', 'people', 'medical', 'hazards', 'children', 'location', 'quotes'],
  properties: {
    age: { type: ['number', 'null'] },
    people: { type: ['number', 'null'] },
    medical: { type: 'array', items: { type: 'string' } },
    hazards: { type: 'array', items: { type: 'string' } },
    children: { type: 'boolean' },
    location: { type: ['string', 'null'] },
    quotes: { type: 'array', items: { type: 'string' } },
  },
} as const;

let client: Anthropic | null = null;

/** Returns facts, or throws. Quotes that are not verbatim substrings are dropped (SPEC: "Nothing is estimated"). */
export async function extractFacts(text: string): Promise<Facts> {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: text }],
  });

  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Claude returned no text');

  const raw = JSON.parse(block.text) as Partial<Facts>;
  const lower = text.toLowerCase();
  return {
    age: typeof raw.age === 'number' ? raw.age : null,
    people: typeof raw.people === 'number' ? raw.people : null,
    medical: (raw.medical ?? []).map(String),
    hazards: (raw.hazards ?? []).map(String),
    children: raw.children === true,
    location: typeof raw.location === 'string' ? raw.location : null,
    quotes: (raw.quotes ?? []).map(String).filter((q) => q && lower.includes(q.toLowerCase())),
  };
}
