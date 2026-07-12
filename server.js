const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const CHATS_FILE = './chats.json';

// UUID ফাংশন নিজে তৈরি করুন (crypto ব্যবহার করে)
function generateUUID() {
  return crypto.randomUUID();
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

function readChats() {
  try {
    if (!fs.existsSync(CHATS_FILE)) {
      fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(CHATS_FILE, 'utf8');
    if (!data || data.trim() === '') {
      fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
      return [];
    }
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading chats:', error);
    fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
    return [];
  }
}

function writeChats(chats) {
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
  } catch (error) {
    console.error('Error writing chats:', error);
  }
}

app.get('/api/chats', (req, res) => {
  try {
    res.json(readChats());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.post('/api/chats', (req, res) => {
  try {
    const chats = readChats();
    const newChat = {
      id: generateUUID(),
      title: 'নতুন চ্যাট',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    chats.unshift(newChat);
    writeChats(chats);
    res.status(201).json(newChat);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

app.delete('/api/chats/:id', (req, res) => {
  try {
    const chats = readChats();
    const filtered = chats.filter(chat => chat.id !== req.params.id);
    if (filtered.length === chats.length) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    writeChats(filtered);
    res.status(200).json({ message: 'Chat deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

app.post('/api/chat/:id/message', async (req, res) => {
  const chatId = req.params.id;
  const { message } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const chats = readChats();
    const chatIndex = chats.findIndex(c => c.id === chatId);
    
    if (chatIndex === -1) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const userMessage = {
      role: 'user',
      content: message.trim(),
      timestamp: new Date().toISOString()
    };
    chats[chatIndex].messages.push(userMessage);
    chats[chatIndex].updatedAt = new Date().toISOString();

    if (chats[chatIndex].messages.length === 1) {
      const title = message.trim().slice(0, 30) + (message.trim().length > 30 ? '...' : '');
      chats[chatIndex].title = title;
    }

    writeChats(chats);

    const openaiMessages = chats[chatIndex].messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: openaiMessages,
        stream: false,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const assistantContent = data.choices[0].message.content;

    const assistantMessage = {
      role: 'assistant',
      content: assistantContent,
      timestamp: new Date().toISOString()
    };
    chats[chatIndex].messages.push(assistantMessage);
    writeChats(chats);

    res.json({
      message: assistantMessage,
      chat: chats[chatIndex],
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Failed to process message' });
  }
});

// ===== পরিবর্তিত অংশ =====
// API routes এর পর catch-all route
app.get('*', (req, res) => {
  // API রিকোয়েস্ট চেক করুন - এগুলোকে 404 রিটার্ন দিন
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  // বাকি সব রিকোয়েস্ট index.html-এ পাঠান
  res.sendFile(path.join(__dirname, 'index.html'), (err) => {
    if (err) {
      res.status(500).send('Server error');
    }
  });
});

// সার্ভার চালু করুন
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Using model: ${process.env.OPENAI_MODEL || 'gpt-3.5-turbo'}`);
});
