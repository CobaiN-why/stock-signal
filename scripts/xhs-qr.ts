import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto("https://www.xiaohongshu.com", { waitUntil: "networkidle" });
  // Click login button if visible, or just wait for QR
  await page.waitForTimeout(3000);
  // Screenshot full page
  await page.screenshot({ path: "/tmp/xhs-login.png", fullPage: true });
  console.log("Screenshot saved to /tmp/xhs-login.png");

  // Try to extract QR code image URL
  const qrImg = await page.$('img[src*="qrcode"], img[src*="qr"], canvas');
  if (qrImg) {
    console.log("QR element found:", await qrImg.getAttribute("src") || "canvas");
  }

  // Wait for user to scan
  console.log("Waiting 60s for login...");
  await page.waitForTimeout(60000);
  // Save cookies
  const cookies = await page.context().cookies();
  const important = cookies.filter((c) =>
    ["a1", "webId", "web_session"].includes(c.name)
  );
  console.log("Cookies:", JSON.stringify(important, null, 2));
  await browser.close();
}

main();
