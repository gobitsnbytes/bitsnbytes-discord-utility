import os
import asyncio
import discord
from discord.ext import commands
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')

class AntigravityBot(commands.Bot):
    def __init__(self):
        # Setting up intents
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        
        super().__init__(
            command_prefix='!',
            intents=intents,
            help_command=None # We'll implement a custom help command later
        )

    async def setup_hook(self):
        """This runs before the bot starts."""
        print("--- Loading Cogs ---")
        for filename in os.listdir('./cogs'):
            if filename.endswith('.py') and filename != '__init__.py':
                try:
                    await self.load_extension(f'cogs.{filename[:-3]}')
                    print(f'Successfully loaded: {filename}')
                except Exception as e:
                    print(f'Failed to load {filename}: {e}')
        print("--- Cogs Loaded ---\n")

    async def on_ready(self):
        print(f'Logged in as {self.user} (ID: {self.user.id})')
        print(f'Connected to {len(self.guilds)} guilds.')
        print('--- Bot is Ready ---')

async def main():
    bot = AntigravityBot()
    async with bot:
        await bot.start(TOKEN)

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Bot is shutting down...")
