const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const CHATS_DIR = './chats';

if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR);
}

function getUserId(req) {
  let userId = req.headers['x-user-id'];
  if (!userId) {
    userId = crypto.randomUUID();
  }
  return userId;
}

function getUserChatsFile(userId) {
  return path.join(CHATS_DIR, `${userId}.json`);
}

function readUserChats(userId) {
  const filePath = getUserChatsFile(userId);
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf8');
    if (!data || data.trim() === '') {
      fs.writeFileSync(filePath, JSON.stringify([]));
      return [];
    }
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading chats:', error);
    fs.writeFileSync(filePath, JSON.stringify([]));
    return [];
  }
}

function writeUserChats(userId, chats) {
  const filePath = getUserChatsFile(userId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(chats, null, 2));
  } catch (error) {
    console.error('Error writing chats:', error);
  }
}

function generateUUID() {
  return crypto.randomUUID();
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/api/chats', (req, res) => {
  try {
    const userId = getUserId(req);
    const chats = readUserChats(userId);
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.post('/api/chats', (req, res) => {
  try {
    const userId = getUserId(req);
    const chats = readUserChats(userId);
    const newChat = {
      id: generateUUID(),
      title: 'নতুন চ্যাট',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    chats.unshift(newChat);
    writeUserChats(userId, chats);
    res.status(201).json(newChat);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

app.delete('/api/chats/:id', (req, res) => {
  try {
    const userId = getUserId(req);
    const chats = readUserChats(userId);
    const filtered = chats.filter(chat => chat.id !== req.params.id);
    if (filtered.length === chats.length) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    writeUserChats(userId, filtered);
    res.status(200).json({ message: 'Chat deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// ===== Pollinations AI ব্যবহার করা হচ্ছে (ফ্রি, কোনো Token/Key লাগে না) =====
app.post('/api/chat/:id/message', async (req, res) => {
  const chatId = req.params.id;
  const { message, image } = req.body;
  const userId = getUserId(req);

  if (!message && !image) {
    return res.status(400).json({ error: 'Message or image is required' });
  }

  try {
    const chats = readUserChats(userId);
    const chatIndex = chats.findIndex(c => c.id === chatId);
    
    if (chatIndex === -1) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const userMessage = {
      role: 'user',
      content: message || 'এই ছবিটি বিশ্লেষণ করুন',
      timestamp: new Date().toISOString()
    };

    if (image) {
      userMessage.image = image;
    }

    chats[chatIndex].messages.push(userMessage);
    chats[chatIndex].updatedAt = new Date().toISOString();

    if (chats[chatIndex].messages.length === 1) {
      const title = (message || 'ছবি বিশ্লেষণ').trim().slice(0, 30) + 
                    ((message || 'ছবি বিশ্লেষণ').trim().length > 30 ? '...' : '');
      chats[chatIndex].title = title;
    }

    writeUserChats(userId, chats);

    // ===== Pollinations AI API কল =====
    // Pollinations AI-তে prompt পাঠান
    const prompt = message || 'এই ছবিটি বিশ্লেষণ করুন';
    
    console.log(`📡 Calling Pollinations AI with prompt: ${prompt.substring(0, 50)}...`);

    // Pollinations AI-এর টেক্সট জেনারেশন এন্ডপয়েন্ট
    const response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`, {
      method: 'GET'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Pollinations AI Error:', errorText);
      throw new Error(`API error: ${response.status}`);
    }

    const assistantContent = await response.text();
    console.log('✅ Pollinations AI Response received');

    const assistantMessage = {
      role: 'assistant',
      content: assistantContent || 'আমি উত্তর দিতে পারছি না। আবার চেষ্টা করুন। 🙏',
      timestamp: new Date().toISOString()
    };
    chats[chatIndex].messages.push(assistantMessage);
    writeUserChats(userId, chats);

    res.json({
      message: assistantMessage,
      chat: chats[chatIndex],
    });

  } catch (error) {
    console.error('❌ Chat error:', error);
    res.status(500).json({ error: error.message || 'Failed to process message' });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'), (err) => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(500).send('Server error');
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Using Pollinations AI (Free, No API Key Required)`);
  console.log(`📁 Chats directory: ${CHATS_DIR}`);
});
