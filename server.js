const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const CHATS_DIR = './chats';

// চ্যাট ফোল্ডার তৈরি করুন
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR);
}

// ===================== ইউজার আইডি ফাংশন =====================
function getUserId(req) {
  let userId = req.headers['x-user-id'];
  if (!userId) {
    userId = crypto.randomUUID();
  }
  return userId;
}

// ===================== ফাইল অপারেশন =====================
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

// ===================== মিডলওয়্যার =====================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ===================== API রাউট =====================

// সব চ্যাট পাওয়া
app.get('/api/chats', (req, res) => {
  try {
    const userId = getUserId(req);
    const chats = readUserChats(userId);
    res.json(chats);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// নতুন চ্যাট তৈরি
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
    console.error('Error creating chat:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

// চ্যাট ডিলিট
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
    console.error('Error deleting chat:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// ===================== মেসেজ সেন্ড =====================
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

    // ===== ইউজার মেসেজ তৈরি =====
    const userMessage = {
      role: 'user',
      content: message || 'এই ছবিটি বিস্তারিত বর্ণনা করুন বাংলায়',
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

    // ===== API-র জন্য মেসেজ প্রস্তুত =====
    let openaiMessages = [];

    if (image) {
      // GitHub Models-এর জন্য ছবি সহ মেসেজ ফরম্যাট
      openaiMessages = [
        {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: message || 'এই ছবিটি বিস্তারিত বর্ণনা করুন বাংলায়। ছবিতে কী আছে, তার বিস্তারিত বলুন।' 
            },
            { 
              type: 'image_url', 
              image_url: { 
                url: image 
              } 
            }
          ]
        }
      ];
    } else {
      // শুধু টেক্সট মেসেজ
      openaiMessages = chats[chatIndex].messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    }

    // ===== OpenAI API কল (GitHub Models) =====
    const apiUrl = process.env.OPENAI_BASE_URL || 'https://models.inference.ai.azure.com';
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    
    console.log(`📡 Calling API: ${apiUrl}`);
    console.log(`📡 Using model: ${model}`);
    console.log(`📡 Messages:`, JSON.stringify(openaiMessages, null, 2).slice(0, 500) + '...');

    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model,
        messages: openaiMessages,
        stream: false,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error Response:', errorText);
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ API Response received');

    const assistantContent = data.choices[0].message.content;

    // ===== অ্যাসিস্ট্যান্ট মেসেজ সেভ =====
    const assistantMessage = {
      role: 'assistant',
      content: assistantContent,
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

// ===================== ক্যাচ-অল রাউট =====================
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

// ===================== সার্ভার চালু =====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Using model: ${process.env.OPENAI_MODEL || 'gpt-4o'}`);
  console.log(`📡 API Base URL: ${process.env.OPENAI_BASE_URL || 'https://models.inference.ai.azure.com'}`);
  console.log(`📁 Chats directory: ${CHATS_DIR}`);
});
