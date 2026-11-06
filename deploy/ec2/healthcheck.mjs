try {
  const r = await fetch('http://127.0.0.1:8787/ready', { signal: AbortSignal.timeout(5000) });
  if (!r.ok) process.exit(1);
  const body = await r.json();
  if (!body.ok || body.chainId !== 84532) process.exit(1);
} catch { process.exit(1); }
