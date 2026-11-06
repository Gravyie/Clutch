import { discover } from "../video/twitch";
const live = await discover(2);
for (const s of live) console.log(s.game.padEnd(20), s.login.padEnd(18), String(s.viewers).padStart(6), s.title.slice(0, 50));
