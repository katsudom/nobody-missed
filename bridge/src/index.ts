// Bridge entry point (SPEC §7). Filled in at build steps 5–7:
//   photon.ts  – Photon inbound → submitRequest / victimReplied; send_text
//   claude.ts  – extract_facts → setFacts
//   calls.ts   – place_call → ElevenLabs, poll result → callResult
// The bridge never scores or decides anything. If it dies, the board still works.

const required = ['SPACETIMEDB_HOST', 'SPACETIMEDB_DB_NAME'] as const;
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`bridge: missing env ${missing.join(', ')} (copy .env.example to bridge/.env)`);
  process.exit(1);
}

console.log(
  `bridge: would connect to ${process.env.SPACETIMEDB_HOST} / ${process.env.SPACETIMEDB_DB_NAME} (DEMO=${process.env.DEMO ?? 'true'})`
);
