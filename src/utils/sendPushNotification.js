// utils/sendPushNotification.js

async function sendPushNotification(expoPushTokens, title, body, data = {}) {
  // Accept string (single) OR array (multiple)
  const tokens = Array.isArray(expoPushTokens) ? expoPushTokens : [expoPushTokens];

  const validTokens = tokens.filter(Boolean); // remove null/undefined

  if (validTokens.length === 0) return;

  const messages = validTokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    badge: 1,
    android: {
      channelId: 'new-bookings-v3',
      sound: 'default',
      priority: 'high',
    },
    ios: {
      sound: 'booking.wav'
    }
  }));

  // Expo allows up to 100 messages per request
  const chunks = chunkArray(messages, 100);

  for (const chunk of chunks) {
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      console.error("Push notification failed:", err);
    }
  }
}

// Helper: Split array into chunks
function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

module.exports = { sendPushNotification };