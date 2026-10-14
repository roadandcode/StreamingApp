/**
 * A readable device name such as "Chrome on Windows", derived from the User-Agent header.
 * The name is only a label for the viewer's device list; it is never used for decisions.
 */

const MAX_LENGTH = 64;

function detectBrowser(ua: string): string | null {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/\bOPR\/|\bOpera\b/.test(ua)) return "Opera";
  if (/\bSamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return "Firefox";
  if (/\bChrome\/|\bCriOS\/|\bHeadlessChrome\/|\bChromium\//.test(ua)) return "Chrome";
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "Safari";
  return null;
}

function detectOs(ua: string): string | null {
  if (/\b(iPhone|iPod)\b/.test(ua)) return "iPhone";
  if (/\biPad\b/.test(ua)) return "iPad";
  if (/\bAndroid\b/.test(ua)) return "Android";
  if (/\bCrOS\b/.test(ua)) return "ChromeOS";
  if (/\bWindows\b/.test(ua)) return "Windows";
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return "macOS";
  if (/\bLinux\b/.test(ua)) return "Linux";
  return null;
}

export function deviceNameFromUserAgent(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").slice(0, 512);
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  let name: string;
  if (browser && os) name = `${browser} on ${os}`;
  else if (browser) name = browser;
  else if (os) name = `Browser on ${os}`;
  else name = "Web browser";
  return name.slice(0, MAX_LENGTH);
}
