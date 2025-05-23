const express = require('express');
const redis = require('redis');
const axios = require('axios');

const app = express();
const port = 8080;

app.use(express.json());

const client = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
  password: process.env.REDIS_PASSWORD
});

client.on('error', err => console.error('Redis Client Error', err));

(async () => {
  if (!client.isOpen) {
    await client.connect();
    console.log('[🔌 Redis connected]');
  }
})();

const DEBOUNCE_MS = 10000;
const debounceMap = new Map(); // threadId -> timeout

app.post('/', async (req, res) => {
  const { uidFrom, threadId, content } = req.body;

  console.log('[🚀 RECEIVED]', req.body);

  // ✅ Kiểm tra dữ liệu đầu vào
  if (!uidFrom || !threadId || typeof content !== 'string' || content.trim() === '') {
    console.warn('[⚠️ BỎ QUA] Dữ liệu không hợp lệ:', { uidFrom, threadId, content });
    return res.status(400).json({
      success: false,
      message: 'Thiếu uidFrom, threadId hoặc content không hợp lệ'
    });
  }

  try {
    await client.rPush(threadId, content.trim());

    if (debounceMap.has(threadId)) {
      clearTimeout(debounceMap.get(threadId));
      console.log(`⏱️ Reset timeout cho thread ${threadId}`);
    }

    const timeout = setTimeout(async () => {
      const allMessages = await client.lRange(threadId, 0, -1);
      console.log(`[📦 GOM TIN] ${threadId}`, allMessages);

      await client.del(threadId);
      debounceMap.delete(threadId);

      try {
        const response = await axios.post(process.env.WEBHOOK_URL, {
          uidFrom,
          threadId,
          messages: allMessages
        });
        console.log('[✅ WEBHOOK GỬI]', response.data);
      } catch (err) {
        console.error('[❌ GỬI WEBHOOK LỖI]', err.message);
      }
    }, DEBOUNCE_MS);

    debounceMap.set(threadId, timeout);

    res.json({ success: true, message: 'Debounce started' });

  } catch (err) {
    console.error('[❌ LỖI XỬ LÝ]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Zalo Redis wrapper running on port ${port}`);
});
