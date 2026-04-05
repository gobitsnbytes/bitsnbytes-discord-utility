# 🚀 Antigravity Discord Bot

A modular, Python-powered Discord bot with integration for **Notion (CRUD)**, **Google Gemini (AI)**, and **Moderation Tooling**.

## 🛠 Features
- **Notion CRUD**: Manage a Notion database directly from Discord with beautiful Modals and Embeds.
- **AI Chat**: Conversational memory powered by Google Gemini 1.5 Flash.
- **Moderation**: Commands for `!kick`, `!ban`, and `!clear`.
- **Server Info**: Detailed statistics about your community.
- **Modular Cogs**: Easily add or remove features by managing the `cogs/` directory.

---

## ⚙️ Setup Instructions

### 1. Prerequisites
- Python 3.9+ installed.
- A [Discord Developer](https://discord.com/developers/applications) account.
- A [Notion Developer](https://developers.notion.com/) integration.
- A [Google AI API Key](https://aistudio.google.com/app/apikey) (for the AI chat).

### 2. Configuration (`.env`)
Copy the `.env.example` file to a new file named `.env` and fill in your tokens:
```env
DISCORD_TOKEN=YOUR_BOT_TOKEN
NOTION_TOKEN=YOUR_NOTION_INTERNAL_INTEGRATION_TOKEN
NOTION_DATABASE_ID=YOUR_DATABASE_ID
GEMINI_API_KEY=YOUR_GEMINI_KEY
```

### 3. Installation
1.  Clone the repository or download the files.
2.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```

### 4. Running the Bot
```bash
python3 main.py
```

---

## 🗒 Notion Integration Guide
To make the CRUD features work, follow these steps:
1.  Create a **Notion Integration** [here](https://www.notion.so/my-integrations).
2.  **Copy the Token** and place it in your `.env`.
3.  Go to your **Notion Database**, click the `...`, select `Add connections`, and search for your integration's name.
4.  Copy the **Database ID** from the URL: `https://www.notion.so/username/<DATABASE_ID>?v=...`.

---

## 🤖 Commands
-   `!ping`: Check bot latency and uptime.
-   `!help`: Show this beautiful list.
-   `!kick @user <reason>`: Kick a user.
-   `!ban @user <reason>`: Ban a user.
-   `!clear <amount>`: Bulk delete messages.
-   `!n-add`: (Slash Command) Open a form to add a task to Notion.
-   `!n-list`: List recent Notion database entries.
-   `!chat <message>`: Talk to the AI.
-   `!serverinfo`: Display server stats.

---

## 📝 License
Built with ❤️ using `discord.py` and `antigravity`.
