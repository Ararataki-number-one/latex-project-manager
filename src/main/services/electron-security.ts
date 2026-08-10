export function isTrustedRendererUrl(url: string, expected: string): boolean {
  try {
    const actualUrl = new URL(url);
    const expectedUrl = new URL(expected);
    if (actualUrl.protocol !== expectedUrl.protocol) return false;
    if (actualUrl.protocol === "file:") return actualUrl.href === expectedUrl.href;
    return actualUrl.origin === expectedUrl.origin && actualUrl.pathname === expectedUrl.pathname;
  } catch {
    return false;
  }
}

export function rendererContentSecurityPolicy(development: boolean): string {
  const scriptSource = development ? "'self' 'unsafe-eval'" : "'self'";
  const connectSource = development ? "'self' ws: wss: http://127.0.0.1:* http://localhost:*" : "'self' file:";
  return [
    "default-src 'self'",
    `script-src ${scriptSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src ${connectSource}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'"
  ].join("; ");
}

