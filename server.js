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

// ===== মাল্টি-টোকেন সিস্টেম =====
// সব Token সংগ্রহ করুন
const ALL_TOKENS = [];
for (let i = 1; i <= 10; i++) {
  const token = process.env[`TOKEN${i}`];
  if (token && token.startsWith('ghp_')) {
    ALL_TOKENS.push(token);
  }
}

// ডিফল্ট Token (যদি কোনো TOKEN1-10 না থাকে)
if (ALL_TOKENS.length === 0 && process.env.OPENAI_API_KEY) {
  ALL_TOKENS.push(process.env.OPENAI_API_KEY);
}

console.log(`📡 Loaded ${ALL_TOKENS.length} GitHub tokens`);

let currentTokenIndex = 0;
let tokenErrorCount = {};

// Token রোটেট ফাংশন
function getNextToken() {
  if (ALL_TOKENS.length === 0) {
    throw new Error('No GitHub tokens available!');
  }
  
  // ৫ বার চেষ্টা করুন
  for (let attempt = 0; attempt < ALL_TOKENS.length * 2; attempt++) {
    const token = ALL_TOKENS[currentTokenIndex];
    currentTokenIndex = (currentTokenIndex + 1) % ALL_TOKENS.length;
    
    // যদি এই Token-এ বেশি Error না হয়
    if (!tokenErrorCount[token] || tokenErrorCount[token] < 3) {
      return token;
    }
  }
  
  // সব Token Error থাকলে প্রথমটি ব্যবহার করুন
  currentTokenIndex = 0;
  return ALL_TOKENS[0];
}

// Token Error রিপোর্ট
function reportTokenError(token) {
  if (!tokenErrorCount[token]) {
    tokenErrorCount[token] = 0;
  }
  tokenErrorCount[token]++;
  console.log(`⚠️ Token error count: ${tokenErrorCount[token]} for token: ${token.slice(0, 10)}...`);
  
  // ৫ বার Error হলে Token রিসেট করুন
  if (tokenErrorCount[token] >= 5) {
    console.log(`🔄 Resetting error count for token: ${token.slice(0, 10)}...`);
    tokenErrorCount[token] = 0;
  }
}

// Token সফল হলে Error কাউন্ট রিসেট
function reportTokenSuccess(token) {
  if (tokenErrorCount[token]) {
    tokenErrorCount[token] = 0;
  }
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

// ===== মাল্টি-টোকেন সহ GitHub Models API =====
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

    // ===== মাল্টি-টোকেন সহ API কল =====
    const baseURL = process.env.OPENAI_BASE_URL || 'https://models.inference.ai.azure.com';
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    // মেসেজ ফরম্যাট
    let openaiMessages;
    if (image) {
      openaiMessages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: message || 'এই ছবিটি বিস্তারিত বর্ণনা করুন বাংলায়' },
            { type: 'image_url', image_url: { url: image } }
          ]
        }
      ];
    } else {
      openaiMessages = chats[chatIndex].messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    }

    // Token রোটেট করে চেষ্টা করুন
    let lastError = null;
    let usedTokens = [];

    for (let attempt = 0; attempt < ALL_TOKENS.length; attempt++) {
      const token = getNextToken();
      usedTokens.push(token.slice(0, 10) + '...');
      
      console.log(`🔄 Attempt ${attempt + 1}/${ALL_TOKENS.length} with token: ${token.slice(0, 10)}...`);

      try {
        const response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
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
          const errorData = JSON.parse(errorText);
          
          // Rate Limit Error (429)
          if (response.status === 429) {
            console.log(`⚠️ Rate limit reached for token: ${token.slice(0, 10)}...`);
            reportTokenError(token);
            lastError = new Error(`Rate limit: ${errorData.error?.message || 'Unknown'}`);
            continue; // পরবর্তী Token চেষ্টা করুন
          }
          
          // অন্যান্য Error
          throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        // সফল!
        reportTokenSuccess(token);
        const data = await response.json();
        const assistantContent = data.choices[0].message.content;

        const assistantMessage = {
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date().toISOString()
        };
        chats[chatIndex].messages.push(assistantMessage);
        writeUserChats(userId, chats);

        console.log(`✅ Success with token: ${token.slice(0, 10)}...`);
        console.log(`📡 Used tokens: ${usedTokens.join(', ')}`);

        res.json({
          message: assistantMessage,
          chat: chats[chatIndex],
        });
        return;

      } catch (error) {
        console.log(`❌ Failed with token: ${token.slice(0, 10)}...`);
        reportTokenError(token);
        lastError = error;
      }
    }

    // সব Token ব্যর্থ হলে
    console.log(`❌ All tokens failed! Used: ${usedTokens.join(', ')}`);
    throw new Error(lastError || 'All tokens failed');

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
  console.log(`📡 Using model: ${process.env.OPENAI_MODEL || 'gpt-4o'}`);
  console.log(`📡 Tokens loaded: ${ALL_TOKENS.length}`);
  console.log(`📁 Chats directory: ${CHATS_DIR}`);
});
