const Anthropic = require('@anthropic-ai/sdk');

const CHARACTER_LIMITS = {
  twitter: 280,
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
};

async function rewriteCaption(originalCaption, subscriberProfile, platform) {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const charLimit = CHARACTER_LIMITS[platform] || 2200;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are a social media content writer for real estate agents. Rewrite the given caption to sound like it was written by the agent personally, incorporating their name and brand voice. Keep the same message and call-to-action but make it feel authentic and personal. Stay within the platform\'s character limit. Return ONLY the rewritten caption text, no explanation.',
      messages: [
        {
          role: 'user',
          content: `Rewrite this caption for ${platform} (max ${charLimit} characters):

Original caption: ${originalCaption}

Agent name: ${subscriberProfile.name}
Company: ${subscriberProfile.company || ''}
Tagline: ${subscriberProfile.tagline || ''}
Platform: ${platform}`,
        },
      ],
    });

    const rewritten = message.content[0].text.trim();
    return rewritten.substring(0, charLimit);
  } catch (err) {
    console.error('Claude caption rewrite failed:', err.message);
    return originalCaption;
  }
}

module.exports = { rewriteCaption };
