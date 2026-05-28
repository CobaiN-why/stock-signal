interface MentionNotification {
  ticker: string;
  price: string | null;
  blogger: string;
  postedAt: string;
  content: string;
  postUrl: string;
}

export async function sendMention(mention: MentionNotification): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const targets = [
    process.env.TELEGRAM_CHAT_ID,
    process.env.TELEGRAM_GROUP_CHAT_ID,
  ].filter(Boolean) as string[];
  if (targets.length === 0) return;

  const priceTag = mention.price ? ` ($${mention.price})` : "";
  const truncated =
    mention.content.length > 200
      ? mention.content.slice(0, 200) + "..."
      : mention.content;

  const text = [
    `📌 New mention: $${mention.ticker}${priceTag}`,
    `👤 @${mention.blogger} · ${mention.postedAt}`,
    "",
    truncated,
    "",
    `🔗 ${mention.postUrl}`,
  ].join("\n");

  await sendToTargets(token, targets, text);
}

function sendToTargets(token: string, targets: string[], text: string) {
  return Promise.all(
    targets.map((chatId) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      })
    )
  );
}

interface SentimentFlipNotification {
  ticker: string;
  blogger: string;
  previousSentiment: string;
  currentSentiment: string;
  content: string;
  postUrl: string;
}

export async function sendSentimentFlip(flip: SentimentFlipNotification): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const targets = [
    process.env.TELEGRAM_CHAT_ID,
    process.env.TELEGRAM_GROUP_CHAT_ID,
  ].filter(Boolean) as string[];
  if (targets.length === 0) return;

  const truncated = flip.content.length > 100
    ? flip.content.slice(0, 100) + "..."
    : flip.content;

  const text = [
    `⚡ 观点反转: $${flip.ticker}`,
    `👤 @${flip.blogger}: ${flip.previousSentiment} → ${flip.currentSentiment}`,
    "",
    truncated,
    "",
    `🔗 ${flip.postUrl}`,
  ].join("\n");

  await sendToTargets(token, targets, text);
}

interface DivergenceNotification {
  ticker: string;
  bullishBloggers: string[];
  bearishBloggers: string[];
  content: string;
  postUrl: string;
}

export async function sendDivergence(div: DivergenceNotification): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const targets = [
    process.env.TELEGRAM_CHAT_ID,
    process.env.TELEGRAM_GROUP_CHAT_ID,
  ].filter(Boolean) as string[];
  if (targets.length === 0) return;

  const truncated = div.content.length > 100
    ? div.content.slice(0, 100) + "..."
    : div.content;

  const text = [
    `⚠️ 观点分歧: $${div.ticker}`,
    `🟢 看多: ${div.bullishBloggers.map((b) => `@${b}`).join(", ")}`,
    `🔴 看空: ${div.bearishBloggers.map((b) => `@${b}`).join(", ")}`,
    "",
    truncated,
    "",
    `🔗 ${div.postUrl}`,
  ].join("\n");

  await sendToTargets(token, targets, text);
}
