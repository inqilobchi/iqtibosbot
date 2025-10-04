require('dotenv').config();
const Fastify = require('fastify');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const cron = require('node-cron');
const Canvas = require('canvas');
const moment = require('moment-timezone');
require('moment/locale/uz');
const now = moment().locale('uz');
const formattedDate = now.format("D-MMMM, YYYY");
const fastify = Fastify({ logger: true });
// ——— Sozlamalar ———


const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

const WEBHOOK_PATH = `/webhook/${token}`;
const FULL_WEBHOOK_URL = `${process.env.PUBLIC_URL}${WEBHOOK_PATH}`;

// Webhook endpoint
fastify.post(WEBHOOK_PATH, (req, reply) => {
  bot.processUpdate(req.body);
  reply.send({ ok: true });
});

// Health check endpoint (to prevent sleep)
fastify.get('/healthz', (req, reply) => {
  reply.send({ status: 'ok' });
});

// Start server
fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }, async (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log('Server running...');

  // Set webhook
  try {
    await bot.setWebHook(FULL_WEBHOOK_URL);
    console.log("Webhook set to:", FULL_WEBHOOK_URL);
  } catch (err) {
    console.error("Webhook set failed:", err);
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

// ——— Har daqiqa cron yordamida foydalanuvchilarga iqtibos yuborish ———

cron.schedule('* * * * *', async () => {
  try {
    const nowUTC = moment.utc();
    const users = await User.find({});

    const channels = await Channel.find({});
    const channelNames = channels.map(ch => ch.username);

    for (const user of users) {
      if (!user.lang) user.lang = 'uz';
      if (!user.sendTime) user.sendTime = DEFAULT_SEND_TIME;
      if (!user.timezone) user.timezone = DEFAULT_TIMEZONE;

      const userNow = nowUTC.clone().tz(user.timezone);
      const currentHM = userNow.format('HH:mm');

      if (currentHM === user.sendTime) {
        const quotes = await Quote.find({ lang: user.lang });
        if (!quotes || quotes.length === 0) continue;

        // Majburiy kanallarni tekshirish
        if (channelNames.length > 0) {
          try {
            let subscribed = true;
            for (const ch of channelNames) {
              const member = await bot.getChatMember(ch, user.userId).catch(() => null);
              if (!member || ['left', 'kicked'].includes(member.status)) {
                subscribed = false;
                break;
              }
            }
            if (!subscribed) continue; // Obuna bo'lmasa yubormaymiz
          } catch (err) {
            console.error("Kanal obunasini tekshirishda xato:", err);
            continue;
          }
        }

        const randomQuote = quotes[Math.floor(Math.random() * quotes.length)].text;

        try {
          const imgBuf = await makeQuoteImage(randomQuote, BOT_USERNAME || '');
          await bot.sendPhoto(user.userId, imgBuf, { caption: `Bugun ${formattedDate}\n\n${randomQuote}`, parse_mode: 'HTML' });
          console.log(`Iqtibos yuborildi userId=${user.userId} vaqt=${user.sendTime} ${user.timezone}`);
        } catch (err) {
          console.error(`Xato userga iqtibos yuborishda userId=${user.userId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("Cron ishlashida xato:", err);
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
      [{ text: "Iqtibos qo'shish", callback_data: "admin_add_quote" }],
      [{ text: "Majburiy obuna kanallar", callback_data: "admin_channels" }]
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

  let user = await User.findOne({ userId: chatId });
  if (!user) {
    user = new User({ userId: chatId });
    await user.save();
  }

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

  let user = await User.findOne({ userId: chatId });
  if (!user) {
    user = new User({ userId: chatId });
    await user.save();
  }

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
