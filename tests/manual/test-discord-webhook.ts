/**
 * Manual test: Discord Webhook
 *
 * Tests that the Discord webhook is configured correctly
 * and can send messages.
 *
 * Usage:
 *   npx tsx tests/manual/test-discord-webhook.ts
 */

async function testDiscordWebhook() {
  const webhookUrl = process.env.DISCORD_LIVERMORE_BOT;

  if (!webhookUrl) {
    console.error('ERROR: DISCORD_LIVERMORE_BOT environment variable not set');
    process.exit(1);
  }

  console.log('Testing Discord webhook...');

  const payload = {
    content: `Livermore Test Alert - ${new Date().toISOString()}`,
    embeds: [
      {
        title: 'Test Alert',
        description: 'This is a test message from the Livermore system.',
        color: 0x00ff00, // Green
        fields: [
          {
            name: 'Status',
            value: 'Discord webhook is working correctly',
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log('SUCCESS: Discord message sent');
    } else {
      const text = await response.text();
      console.error(`ERROR: Discord returned ${response.status}: ${text}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('ERROR: Failed to send Discord message:', error);
    process.exit(1);
  }
}

testDiscordWebhook();
