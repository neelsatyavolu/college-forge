/** The public origin for links and OAuth metadata: forge.xanom.co in production, the request's origin locally. */
export function appOrigin(req: Request): string {
  if (process.env.FORGE_ORIGIN) return process.env.FORGE_ORIGIN.replace(/\/$/, "");
  return new URL(req.url).origin;
}
