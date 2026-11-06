"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/lib/account";

/** Twitch OAuth (implicit grant) lands here: keep the token in this browser, learn who it is, go back. */
export default function TwitchCallback() {
  const { data: cfg } = useConfig();
  const [msg, setMsg] = useState("Connecting Twitch…");
  useEffect(() => {
    if (!cfg?.twitchClientId) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    const err = new URLSearchParams(location.search).get("error_description");
    const back = sessionStorage.getItem("clutch.twitch.return") ?? "/live";
    const access = hash.get("access_token");
    if (!access) {
      setMsg(err ? `Twitch didn't connect: ${err}` : "Twitch didn't connect.");
      setTimeout(() => location.replace(back), 2500);
      return;
    }
    fetch("https://api.twitch.tv/helix/users", { headers: { "Client-Id": cfg.twitchClientId, Authorization: `Bearer ${access}` } })
      .then((r) => r.json())
      .then(({ data }) => {
        localStorage.setItem("clutch.twitch.token", JSON.stringify({ access, login: data[0].login, id: data[0].id }));
        location.replace(back);
      })
      .catch(() => setMsg("Couldn't read your Twitch account. Try again."));
  }, [cfg]);
  return <div className="grid min-h-dvh place-items-center bg-background text-sm text-muted-foreground">{msg}</div>;
}
