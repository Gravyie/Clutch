// Saves a finished Lichess blitz game (moves, clocks, result) as the offline replay fixture.
// Usage: node scripts/record-game.mjs [gameId]
import { writeFileSync } from "node:fs";
let id = process.argv[2];
if (!id) {
  const res = await fetch("https://lichess.org/api/games/user/DrNykterstein?max=20&perfType=blitz&clocks=true&moves=true", { headers: { Accept: "application/x-ndjson" } });
  const games = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  const g = games.find((g) => g.winner && g.moves.split(" ").length > 70 && g.clocks?.length);
  id = g.id;
}
const g = await (await fetch(`https://lichess.org/game/export/${id}?moves=true&clocks=true`, { headers: { Accept: "application/json" } })).json();
writeFileSync(new URL("../engine/fixtures/game.json", import.meta.url), JSON.stringify({ id: g.id, moves: g.moves, clocks: g.clocks, status: g.status, winner: g.winner, players: g.players }, null, 1));
console.log(`saved ${g.id}: ${g.players.white.user?.name} vs ${g.players.black.user?.name}, ${g.moves.split(" ").length} plies, ${g.status} ${g.winner ?? ""}`);
