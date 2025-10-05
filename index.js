require('dotenv').config();
const Fastify = require('fastify');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const cron = require('node-cron');
const Canvas = require('canvas');
const moment = require('moment-timezone');
require('moment/locale/uz');
function getFormattedDateByLang(lang) {
  const now = moment().tz("Asia/Tashkent"); // yoki user.timezone
  const latinMonths = [
    'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
    'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
  ];

  const day = now.date();
  const monthIndex = now.month(); // 0-based
  const year = now.year();

  if (lang === 'uz') {
    return `Bugun ${day}-${latinMonths[monthIndex]}, ${year}`;
  }

  if (lang === 'ru') {
    return `Сегодня ${now.locale('ru').format("D MMMM, YYYY")}`;
  }

  return `Today ${now.locale('en').format("D MMMM, YYYY")}`;
}

const fastify = Fastify({ logger: true });
// ——— Sozlamalar ———


const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { webHook: true });

const WEBHOOK_PATH = `/webhook/${token}`;
const FULL_WEBHOOK_URL = `${process.env.PUBLIC_URL}${WEBHOOK_PATH}`;

// Webhook endpoint
fastify.post(WEBHOOK_PATH, (req, reply) => {
  try {
    bot.processUpdate(req.body);  // Telegram update-larni botga uzatish juda muhim
    console.log('Update processed:', req.body);
    reply.code(200).send();       // Telegram API uchun 200 OK javob qaytarish kerak
  } catch (error) {
    console.error('Error processing update:', error);
    reply.sendStatus(500);
  }
});

// Health check endpoint
fastify.get('/healthz', (req, reply) => {
  reply.send({ status: 'ok' });
});

// Serverni ishga tushirish va webhook o‘rnatish
fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }, async (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  fastify.log.info(`Server listening at ${address}`);

  try {
const response = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, null, {
  params: { url: FULL_WEBHOOK_URL }
});

    if (response.data.ok) {
      fastify.log.info('Webhook successfully set:', response.data);
    } else {
      fastify.log.error('Failed to set webhook:', response.data);
    }
  } catch (error) {
    fastify.log.error('Error setting webhook:', error.message);
  }
});

const ADMINS = process.env.ADMINS ? process.env.ADMINS.split(',').map(s => s.trim()).map(Number) : [];

const DEFAULT_SEND_TIME = "08:00";
const DEFAULT_TIMEZONE = "Asia/Tashkent";

// ——— MongoDB bilan bog'lanish ———

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("MongoDB ga ulandi");
}).catch(err => {
  console.error("MongoDB ga ulanishda xato:", err);
  process.exit(1);
});

// ——— Mongoose modellari ———

const userSchema = new mongoose.Schema({
  userId: { type: Number, unique: true },
  lang: { type: String, default: 'uz' },
  sendTime: { type: String, default: DEFAULT_SEND_TIME },
  timezone: { type: String, default: DEFAULT_TIMEZONE },
  adminAction: { type: Object, default: null }
});
const User = mongoose.model('User', userSchema);

const channelSchema = new mongoose.Schema({
  name: { type: String, unique: true }, 
  username: { type: String, unique: true }
});
const Channel = mongoose.model('Channel', channelSchema);

const quoteSchema = new mongoose.Schema({
  lang: { type: String, enum: ['uz', 'ru', 'en'] },
  text: String
});
const Quote = mongoose.model('Quote', quoteSchema);

function mandatoryChannelsKeyboard(channels) {
  return {
    inline_keyboard: channels.map(ch => ([
      { text: ch.name, url: `https://t.me/${ch.username.replace(/^@/, '')}` }
    ]))
  };
}

// ——— Telegram bot ———


let BOT_USERNAME = null;
bot.getMe()
  .then(me => {
    BOT_USERNAME = me.username;
    console.log("Bot username:", BOT_USERNAME);
  })
  .catch(err => {
    console.error("getMe xatosi:", err);
  });

// ——— Inline tugmalar uchun tekstlar ———

const TEXT = {
  choose_lang: {
    uz: "Tilni tanlang",
    ru: "Выберите язык",
    en: "Choose language"
  },
  no_channels: {
    uz: "Hozircha hech qanday kanal yo‘q.",
    ru: "Пока что нет ни одного канала.",
    en: "There are no channels yet."
  },
  not_admin: {
    uz: "Siz admin emassiz.",
    ru: "Вы не администратор.",
    en: "You are not admin."
  },
  admin_panel: {
    uz: "Admin panel:",
    ru: "Панель администратора:",
    en: "Admin panel:"
  },
  set_time: {
    uz: "Yuborish vaqtini tanlang:",
    ru: "Выберите время отправки:",
    en: "Choose sending time:"
  },
  set_timezone: {
    uz: "Vaqt zonasini tanlang:",
    ru: "Выберите часовой пояс:",
    en: "Choose timezone:"
  },
  send_time_set: {
    uz: "Yuborish vaqti %s ga o‘rnatildi.",
    ru: "Время отправки установлено на %s.",
    en: "Sending time set to %s."
  },
  timezone_set: {
    uz: "Vaqt zonasi %s ga o‘zgartirildi.",
    ru: "Часовой пояс изменен на %s.",
    en: "Timezone changed to %s."
  },
  quote_added: {
    uz: "Iqtibos qo‘shildi [%s]: %s",
    ru: "Цитата добавлена [%s]: %s",
    en: "Quote added [%s]: %s"
  },
  wrong_format: {
    uz: "Format noto‘g‘ri. Misol: uz: Matn",
    ru: "Неверный формат. Пример: ru: Текст",
    en: "Wrong format. Example: en: Text"
  },
  sub_channels: {
    uz: "Majburiy obuna kanallar:",
    ru: "Обязательные подписки на каналы:",
    en: "Mandatory subscription channels:"
  },
  no_sub_channels: {
    uz: "Majburiy kanal qo‘shilmagan.",
    ru: "Обязательных каналов нет.",
    en: "No mandatory channels added."
  },
  add_channel: {
    uz: "Kanal nomi yoki username (masalan: @channelname) yuboring:",
    ru: "Отправьте имя или username канала (например, @channelname):",
    en: "Send the channel name or username (e.g. @channelname):"
  },
  channel_added: {
    uz: "Kanal qo‘shildi: %s",
    ru: "Канал добавлен: %s",
    en: "Channel added: %s"
  },
  channel_removed: {
    uz: "Kanal o‘chirildi: %s",
    ru: "Канал удалён: %s",
    en: "Channel removed: %s"
  }
};

// ——— Iqtibosni rasmga aylantirish ———

async function makeQuoteImage(text, botUser) {
  const width = 800;
  const height = 400;
  const canvas = Canvas.createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#FFFFFF';
  const fontSize = 36;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = width * 0.8;
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.3;
  const textHeight = lines.length * lineHeight;

  const startY = (height - textHeight) / 2;

  lines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, startY + idx * lineHeight);
  });

  ctx.font = `20px sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`@${botUser}`, width / 2, height - 30);

  return canvas.toBuffer();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (let w of words) {
    const test = current ? (current + ' ' + w) : w;
    const metrics = ctx.measureText(test);
    if (metrics.width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
async function batchSend(users, handler, batchSize = 50, delayMs = 2000) {
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(handler));
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

// ——— Har daqiqa cron yordamida foydalanuvchilarga iqtibos yuborish ———

cron.schedule("* * * * *", async () => {
  const now = moment().tz("Asia/Tashkent");
  const currentTime = now.format("HH:mm");

  try {
    const users = await User.find({ sendTime: currentTime });

    await batchSend(users, async (user) => {
      try {
        const userNow = moment().tz(user.timezone || "Asia/Tashkent");
        const userTime = userNow.format("HH:mm");

        // Foydalanuvchi hozir o‘zining sozlangan vaqtida bo‘lishi kerak
        if (userTime !== user.sendTime) return;

        // Kanal obunasini tekshirish (majburiy bo‘lsa)
        const ch = process.env.CHANNEL;
        if (ch) {
          const member = await bot.getChatMember(ch, user.userId).catch(() => null);
          if (!member || ["left", "kicked"].includes(member.status)) {
            return; // Obuna bo‘lmagan
          }
        }

        // Tasodifiy iqtibosni olish
        const totalQuotes = await Quote.countDocuments({ lang: user.lang });
        if (totalQuotes === 0) return;

        const randomIndex = Math.floor(Math.random() * totalQuotes);
        const randomQuote = await Quote.findOne({ lang: user.lang }).skip(randomIndex);
        if (!randomQuote) return;

        const formattedDate = getFormattedDateByLang(user.lang);
        const imgBuf = await makeQuoteImage(randomQuote.text, BOT_USERNAME);

        // Iqtibosni yuborish
        await bot.sendPhoto(user.userId, imgBuf, {
          caption: `${formattedDate}\n\n${randomQuote.text}`,
        });

      } catch (err) {
        console.error(`❌ Xatolik foydalanuvchi (${user.userId}) uchun:`, err.message);
      }
    }, 50, 2000); // 50 ta batch, 2s delay

  } catch (err) {
    console.error("❌ Cron job xatolikka uchradi:", err.message);
  }
});




// ——— Inline klaviaturalar yaratish funksiyalari ———

function langKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🇺🇿 O‘zbek", callback_data: "lang_uz" }],
      [{ text: "🇷🇺 Русский", callback_data: "lang_ru" }],
      [{ text: "🇬🇧 English", callback_data: "lang_en" }]
    ]
  };
}

function timeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🌄08:00", callback_data: "settime_08:00" }],
      [{ text: "🌥09:00", callback_data: "settime_09:00" }],
      [{ text: "🏞10:00", callback_data: "settime_10:00" }],
      [{ text: "☀️12:00", callback_data: "settime_12:00" }],
      [{ text: "🌅18:00", callback_data: "settime_18:00" }],
      [{ text: "🌃20:00", callback_data: "settime_20:00" }],
    ]
  };
}

function timezoneKeyboard() {
  const zones = [
    "Asia/Tashkent",
    "Europe/Moscow",
    "Europe/Istanbul",
    "Europe/Berlin",
    "Asia/Dubai",
    "Europe/London"
  ];

  return {
    inline_keyboard: zones.map(tz => [{ text: tz, callback_data: "settz_" + tz }])
  };
}

function mainSettingsKeyboard(isAdmin) {
  const keyboard = [
    [{ text: "🔖 Til / Language", callback_data: "settings_lang" }],
    [{ text: "⏰ Vaqt / Time", callback_data: "settings_time" }],
    [{ text: "🌌 Vaqt zonasi / Timezone", callback_data: "settings_timezone" }]
  ];
  if (isAdmin) {
    keyboard.push([{ text: "Admin panel", callback_data: "admin_panel" }]);
  }
  return {
    inline_keyboard: keyboard
  };
}

function adminPanelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📝 Iqtibos qo'shish", callback_data: "admin_add_quote" }],
      [{ text: "🛎 Majburiy obuna kanallar", callback_data: "admin_channels" }],
      [{ text: "📊 Statistika", callback_data: "admin_stats" }],
      [{ text: "📢 Xabar yuborish", callback_data: "admin_broadcast" }]
    ]
  };
}

async function adminChannelsKeyboard() {
  const channels = await Channel.find({});
  let keys = channels.map(ch => [{ text: ch.name, callback_data: `admin_remove_channel_${ch.name}` }]);
  if (keys.length === 0) keys.push([{ text: TEXT.no_channels.uz, callback_data: "admin_no_channels" }]);
  keys.push([{ text: "Kanal qo‘shish", callback_data: "admin_add_channel" }]);
  return {
    inline_keyboard: keys
  };
}

// ——— /start komandasi ———

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

const user = await User.findOneAndUpdate(
  { userId: chatId },
  { $setOnInsert: { userId: chatId, lang: 'uz', sendTime: DEFAULT_SEND_TIME, timezone: DEFAULT_TIMEZONE } },
  { upsert: true, new: true }
);


  const channels = await Channel.find({});
  const channelNames = channels.map(ch => ch.username);

  if (channelNames.length > 0) {
    try {
      let subscribed = true;
      for (const ch of channelNames) {
        const member = await bot.getChatMember(ch, chatId).catch(() => null);
        if (!member || ['left', 'kicked'].includes(member.status)) {
          subscribed = false;
          break;
        }
      }
      if (!subscribed) {
  return bot.sendMessage(chatId,
    "❗️Iltimos, botdan foydalanishdan oldin quyidagi kanallarga obuna bo‘ling⤵️",
    {
      reply_markup: mandatoryChannelsKeyboard(channels)
    }
  );
      }
    } catch (err) {
      console.error("Kanal obunasini tekshirishda xato:", err);
      return bot.sendMessage(chatId, "Kanal obunasini tekshirishda xatolik yuz berdi, iltimos keyinroq urinib ko‘ring.");
    }
  }

  // Agar hamma yaxshi bo'lsa, til tanlash menyusini ko‘rsatish
  bot.sendMessage(chatId, TEXT.choose_lang[user.lang] || TEXT.choose_lang.uz, {
    reply_markup: langKeyboard()
  });
});


// ——— Callback querylar bilan ishlash ———

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

const user = await User.findOneAndUpdate(
  { userId: chatId },
  { $setOnInsert: { userId: chatId, lang: 'uz', sendTime: DEFAULT_SEND_TIME, timezone: DEFAULT_TIMEZONE } },
  { upsert: true, new: true }
);


  // — Tilni tanlash
  if (data.startsWith("lang_")) {
    const lang = data.split("_")[1];
    user.lang = lang;
    await user.save();
    await bot.answerCallbackQuery(query.id, { text: `Til ${lang} ga o‘zgartirildi.` });
    return bot.editMessageText(TEXT.choose_lang[lang], {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: mainSettingsKeyboard(ADMINS.includes(chatId))
    });
  }

  // — Sozlamalar bo‘limi
  if (data === "settings_lang") {
    return bot.editMessageText(TEXT.choose_lang[user.lang], {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: langKeyboard()
    });
  }

  if (data === "settings_time") {
    return bot.editMessageText(TEXT.set_time[user.lang], {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: timeKeyboard()
    });
  }

  if (data === "settings_timezone") {
    return bot.editMessageText(TEXT.set_timezone[user.lang], {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: timezoneKeyboard()
    });
  }

  // — Vaqtni o'rnatish
  if (data.startsWith("settime_")) {
    const time = data.split("_")[1];
    user.sendTime = time;
    await user.save();
    await bot.answerCallbackQuery(query.id, { text: TEXT.send_time_set[user.lang].replace("%s", time) });
    return bot.editMessageText(TEXT.send_time_set[user.lang].replace("%s", time), {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: mainSettingsKeyboard(ADMINS.includes(chatId))
    });
  }

  // — Vaqt zonasini o'rnatish
  if (data.startsWith("settz_")) {
    const tz = data.split("_")[1];
    user.timezone = tz;
    await user.save();
    await bot.answerCallbackQuery(query.id, { text: TEXT.timezone_set[user.lang].replace("%s", tz) });
    return bot.editMessageText(TEXT.timezone_set[user.lang].replace("%s", tz), {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: mainSettingsKeyboard(ADMINS.includes(chatId))
    });
  }

  // — Admin panelga kirish
  if (data === "admin_panel") {
    if (!ADMINS.includes(chatId)) {
      return bot.answerCallbackQuery(query.id, { text: TEXT.not_admin[user.lang], show_alert: true });
    }
    return bot.editMessageText(TEXT.admin_panel[user.lang], {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: adminPanelKeyboard()
    });
  }

  // — Admin iqtibos qo'shish bosqichi
  if (data === "admin_add_quote") {
    if (!ADMINS.includes(chatId)) {
      return bot.answerCallbackQuery(query.id, { text: TEXT.not_admin[user.lang], show_alert: true });
    }
    user.adminAction = { type: "add_quote" };
    await user.save();
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId, "Iqtibos qo'shish uchun quyidagi formatda yuboring:\nuz: Matn\nru: Текст\nen: Text");
  }

  // — Admin kanallar ro'yxati
  if (data === "admin_channels") {
    if (!ADMINS.includes(chatId)) {
      return bot.answerCallbackQuery(query.id, { text: TEXT.not_admin[user.lang], show_alert: true });
    }
    const keyboard = await adminChannelsKeyboard();
    return bot.editMessageText(TEXT.sub_channels[user.lang], {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: keyboard
    });
  }
if (data === "admin_stats") {
  if (!ADMINS.includes(chatId)) {
    return bot.answerCallbackQuery(query.id, { text: TEXT.not_admin[user.lang], show_alert: true });
  }

  const userCount = await User.countDocuments();
  const users = await User.find({});
  const quotes = await Quote.find({});

  // Timezonelar statistikasi
  const tzStats = {};
  const timeStats = {};
  for (let u of users) {
    tzStats[u.timezone] = (tzStats[u.timezone] || 0) + 1;
    timeStats[u.sendTime] = (timeStats[u.sendTime] || 0) + 1;
  }

  const tzLines = Object.entries(tzStats).map(([tz, count]) => `🕓 ${tz} - ${count} ta`).join('\n');
  const timeLines = Object.entries(timeStats).map(([time, count]) => `⏰ ${time} - ${count} ta`).join('\n');

  // Iqtiboslar statistikasi
  const langStats = { uz: 0, ru: 0, en: 0 };
  for (let q of quotes) {
    langStats[q.lang] = (langStats[q.lang] || 0) + 1;
  }

  const quoteLines = `📚 Iqtiboslar:\n🇺🇿 uz - ${langStats.uz} ta\n🇷🇺 ru - ${langStats.ru} ta\n🇬🇧 en - ${langStats.en} ta`;

  const statsText = `📊 Statistika:\n👥 Umumiy foydalanuvchilar: ${userCount} ta\n\n${tzLines}\n\n${timeLines}\n\n${quoteLines}`;

  return bot.editMessageText(statsText, {
    chat_id: chatId,
    message_id: query.message.message_id,
    reply_markup: adminPanelKeyboard()
  });
}
  if (data === "admin_broadcast") {
  if (!ADMINS.includes(chatId)) {
    return bot.answerCallbackQuery(query.id, { text: TEXT.not_admin[user.lang], show_alert: true });
  }

  user.adminAction = { type: "broadcast" };
  await user.save();

  await bot.answerCallbackQuery(query.id);
  return bot.sendMessage(chatId, "📢 Hammaga yuboriladigan matn, rasm yoki videoni yuboring:");
}

  // — Kanal qo'shish bosqichi
  if (data === "admin_add_channel") {
    if (!ADMINS.includes(chatId)) {
      return bot.answerCallbackQuery(query.id, { text: TEXT.not_admin[user.lang], show_alert: true });
    }
    user.adminAction = { type: "add_channel" };
    await user.save();
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId, TEXT.add_channel[user.lang]);
  }

  // — Kanal o'chirish tugmasi bosildi
  if (data.startsWith("admin_remove_channel_")) {
    if (!ADMINS.includes(chatId)) {
      return bot.answerCallbackQuery(query.id, { text: TEXT.not_admin[user.lang], show_alert: true });
    }
    const chName = data.replace("admin_remove_channel_", "");
    await Channel.deleteOne({ name: chName });
    await bot.answerCallbackQuery(query.id, { text: TEXT.channel_removed[user.lang].replace("%s", chName) });

    const keyboard = await adminChannelsKeyboard();
    return bot.editMessageReplyMarkup({
      inline_keyboard: keyboard.inline_keyboard
    }, {
      chat_id: chatId,
      message_id: query.message.message_id
    });
  }

  // — Default javob
  await bot.answerCallbackQuery(query.id);
});

// ——— Admin tomonidan yuborilgan matnni qabul qilish ———

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Group va channel xabarlarini e'tiborga olmang
  if (msg.chat.type !== 'private') return;

  let user = await User.findOne({ userId: chatId });
  if (!user) {
    user = new User({ userId: chatId });
    await user.save();
  }

  if (user.adminAction) {
    const action = user.adminAction;

    if (action.type === "add_quote") {
      const text = msg.text.trim();
      // Format: lang: text
      const match = text.match(/^(\w{2}):\s*(.+)$/);
      if (!match) {
        return bot.sendMessage(chatId, TEXT.wrong_format[user.lang]);
      }
      const lang = match[1].toLowerCase();
      const quoteText = match[2];
      if (!['uz', 'ru', 'en'].includes(lang)) {
        return bot.sendMessage(chatId, TEXT.wrong_format[user.lang]);
      }
      const newQuote = new Quote({ lang, text: quoteText });
      await newQuote.save();
      user.adminAction = null;
      await user.save();
      return bot.sendMessage(chatId, TEXT.quote_added[user.lang].replace("%s", lang).replace("%s", quoteText));
    }

if (action.type === "add_channel") {
  let chUsername = msg.text.trim();
  if (!chUsername.startsWith('@')) {
    return bot.sendMessage(chatId, TEXT.add_channel[user.lang]);
  }

  chUsername = chUsername.toLowerCase();

  const exists = await Channel.findOne({ username: chUsername });
  if (exists) {
    return bot.sendMessage(chatId, "Kanal allaqachon mavjud.");
  }


  let channelInfo;
  try {
    channelInfo = await bot.getChat(chUsername);
  } catch (err) {
    return bot.sendMessage(chatId, "Kanal topilmadi yoki botga kirish huquqi yo‘q.");
  }

  const newChannel = new Channel({ 
    name: channelInfo.title || chUsername,  
    username: chUsername 
  });

  await newChannel.save();
  user.adminAction = null;
  await user.save();
  return bot.sendMessage(chatId, TEXT.channel_added[user.lang].replace("%s", chUsername));
}
if (action.type === "broadcast") {
  user.adminAction = null;
  await user.save();

  const allUsers = await User.find({});
  for (let u of allUsers) {
    try {
      if (msg.text) {
        await bot.sendMessage(u.userId, msg.text);
      } else if (msg.photo) {
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        await bot.sendPhoto(u.userId, photoId, { caption: msg.caption || '' });
      } else if (msg.video) {
        await bot.sendVideo(u.userId, msg.video.file_id, { caption: msg.caption || '' });
      }
    } catch (e) {
      console.error(`Yuborilmadi userId=${u.userId}:`, e.message);
    }
  }

  return bot.sendMessage(chatId, "✅ Xabar barcha foydalanuvchilarga yuborildi.");
}

  }
});

// ——— User xabarlarini admin panelga yo'naltirish ———

bot.onText(/\/settings/, async (msg) => {
  const chatId = msg.chat.id;

  let user = await User.findOne({ userId: chatId });
  if (!user) {
    user = new User({ userId: chatId });
    await user.save();
  }

  bot.sendMessage(chatId, "Sozlamalar:", {
    reply_markup: mainSettingsKeyboard(ADMINS.includes(chatId))
  });
});
