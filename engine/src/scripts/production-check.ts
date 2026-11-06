import { checkProductionDeployment } from '../production';
try {
  console.log(JSON.stringify({ ok: true, ...(await checkProductionDeployment()) }));
} catch {
  console.error('Production deployment check failed: verify RPC, contract manifest and separated agent/pass-signer roles. No transaction was sent.');
  process.exitCode = 1;
}
