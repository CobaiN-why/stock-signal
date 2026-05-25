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

  await Promise.all(
    targets.map((chatId) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      })
    )
  );
}
